<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BrandingSetting;
use App\Models\PppoeCustomer;
use App\Models\PppoeRecharge;
use App\Models\SystemLoad;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\Radius\OnlineSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    /** List users within the actor's subtree; optional ?role= filter, search, status, parent_id. */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();
        $query = User::query()->visibleTo($actor)->where('id', '!=', $actor->id);

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }

        if ($status = $request->query('status')) {
            if (in_array($status, ['active', 'disabled'], true)) {
                $query->where('status', $status);
            }
        }

        if ($parentId = $request->query('reseller_id') ?? $request->query('parent_id')) {
            $query->where('parent_id', $parentId);
        }

        if ($userId = $request->query('id') ?? $request->query('user_id')) {
            $query->where('id', $userId);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('username', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhereHas('parent', function ($pq) use ($search) {
                      $pq->where('name', 'like', "%{$search}%")
                         ->orWhere('username', 'like', "%{$search}%");
                  });
            });
        }

        $perPage = $request->integer('per_page', 15);

        $users = $query->with('parent:id,name,username')
            ->withCount(['children', 'vouchers'])
            ->orderByDesc('id')
            ->paginate($perPage);

        return $this->ok($users);
    }

    public function show(Request $request, User $user): JsonResponse
    {
        if (! $user->isManagedBy($request->user())) {
            return $this->fail('Not found.', 404);
        }

        return $this->ok($user->loadCount('children'));
    }

    /** Admin creates a reseller (parented to the admin). */
    public function storeReseller(Request $request): JsonResponse
    {
        $data = $this->validateNewUser($request);
        // PPPoE-only installs have no voucher commission to set up front, so the
        // percent is optional there (it defaults to 0 on the users table).
        $pppoeOnly = (bool) BrandingSetting::find(1)?->pppoe_only;
        $validated = $request->validate([
            'commission_percent' => [$pppoeOnly ? 'nullable' : 'required', 'numeric', 'min:0', 'max:100'],
        ]);
        if (isset($validated['commission_percent'])) {
            $data['commission_percent'] = $validated['commission_percent'];
        }
        $admin = $request->user();

        $reseller = User::create($data + [
            'role' => 'reseller',
            'parent_id' => $admin->id,
            'created_by' => $admin->id,
            'status' => 'active',
        ]);

        return $this->created($reseller, 'Reseller created.');
    }

    /** Create a seller. Only resellers can create sellers, parented to themselves. */
    public function storeSeller(Request $request): JsonResponse
    {
        $actor = $request->user();

        if (! $actor->isReseller()) {
            return $this->fail('Only resellers can create sellers.', 403);
        }

        $data = $this->validateNewUser($request);

        $seller = User::create($data + [
            'role' => 'seller',
            'parent_id' => $actor->id,
            'created_by' => $actor->id,
            'status' => 'active',
        ]);

        return $this->created($seller, 'Seller created.');
    }

    /** Update reseller or seller information. */
    public function update(Request $request, User $user): JsonResponse
    {
        $actor = $request->user();
        if ($user->isSeller() && $actor->isAdmin()) {
            return $this->fail('Admins can only view sellers.', 403);
        }
        if (! $user->isManagedBy($actor)) {
            return $this->fail('You are not authorized to manage this user.', 403);
        }

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:255', Rule::unique('users', 'username')->ignore($user->id)],
            'email' => ['nullable', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['nullable', 'string', \Illuminate\Validation\Rules\Password::min(10)->letters()->numbers()],
        ];

        if ($actor->isAdmin()) {
            $rules['gb_rate'] = ['nullable', 'numeric', 'min:0.01'];
            if ($user->isReseller()) {
                $rules['commission_percent'] = ['nullable', 'numeric', 'min:0', 'max:100'];
            }
            if ($user->isSeller()) {
                $rules['parent_id'] = ['nullable', 'integer', Rule::exists('users', 'id')->where('role', 'reseller')];
            }
        }

        $data = $request->validate($rules);

        if (! empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }

        if (! $actor->isAdmin()) {
            unset($data['gb_rate']);
            unset($data['parent_id']);
            unset($data['commission_percent']);
        }

        $user->update($data);

        return $this->ok($user->fresh(), 'User updated successfully.');
    }

    /** Enable/disable a user in the actor's subtree. */
    public function setStatus(Request $request, User $user): JsonResponse
    {
        $actor = $request->user();
        if ($user->isSeller() && $actor->isAdmin()) {
            return $this->fail('Admins can only view sellers.', 403);
        }
        if (! $user->isManagedBy($actor) || $user->id === $actor->id) {
            return $this->fail('You cannot change this user\'s status.', 403);
        }
        $data = $request->validate(['status' => ['required', 'in:active,disabled']]);
        $user->update(['status' => $data['status']]);

        return $this->ok($user, "User {$data['status']}.");
    }

    /** Update a user's GB rate (Admin only). */
    public function updateGbRate(Request $request, User $user): JsonResponse
    {
        if (! $request->user()->isAdmin()) {
            return $this->fail('Only Admins can change GB rates.', 403);
        }
        $data = $request->validate([
            'gb_rate' => ['required', 'numeric', 'min:0.01'],
        ]);
        $user->update(['gb_rate' => $data['gb_rate']]);

        return $this->ok($user, "GB rate updated successfully.");
    }

    /** System load of wallet and/or GB balance directly into the admin's account (Admin only). */
    public function systemLoad(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can perform system loads.', 403);
        }

        $data = $request->validate([
            'wallet_amount' => ['nullable', 'numeric', 'min:0'],
            'gb_amount' => ['nullable', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $walletAmount = (float) ($data['wallet_amount'] ?? 0);
        $gbAmount = (float) ($data['gb_amount'] ?? 0);
        $note = $data['note'] ?? 'System manual load';

        if ($walletAmount <= 0 && $gbAmount <= 0) {
            return $this->fail('Please provide a positive amount for wallet or GB balance.', 422);
        }

        \Illuminate\Support\Facades\DB::transaction(function () use ($actor, $walletAmount, $gbAmount, $note) {
            $user = User::whereKey($actor->id)->lockForUpdate()->first();

            if ($walletAmount > 0) {
                $user->increment('wallet_balance', $walletAmount);
                $user->refresh();
                \App\Models\WalletTransaction::create([
                    'user_id' => $user->id,
                    'type' => 'opening',
                    'amount' => $walletAmount,
                    'balance_after' => $user->wallet_balance,
                    'from_user_id' => $actor->id,
                    'note' => $note,
                    'reference' => 'system:load',
                ]);
            }

            if ($gbAmount > 0) {
                $user->increment('gb_balance', $gbAmount);
                $user->refresh();
                \App\Models\GbTransaction::create([
                    'user_id' => $user->id,
                    'type' => 'opening',
                    'gb_amount' => $gbAmount,
                    'balance_after' => $user->gb_balance,
                    'from_user_id' => $actor->id,
                    'reference' => 'system:load',
                    'note' => $note,
                ]);
            }

            SystemLoad::create([
                'user_id' => $user->id,
                'created_by' => $actor->id,
                'wallet_amount' => $walletAmount,
                'gb_amount' => $gbAmount,
                'wallet_balance_after' => $user->wallet_balance,
                'gb_balance_after' => $user->gb_balance,
                'note' => $note,
            ]);
        });

        return $this->ok(['user' => $actor->fresh()], 'System load successful.');
    }

    /** Fetch paginated system load history (Admin only). */
    public function systemLoadHistory(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can view system load history.', 403);
        }

        $query = SystemLoad::query()
            ->with([
                'user:id,name,username,role',
                'creator:id,name,username,role',
            ])
            ->latest();

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('note', 'like', "%{$search}%")
                  ->orWhereHas('creator', function ($cq) use ($search) {
                      $cq->where('name', 'like', "%{$search}%")
                         ->orWhere('username', 'like', "%{$search}%");
                  });
            });
        }

        $history = $query->paginate($request->integer('per_page', 20));

        return $this->ok($history);
    }

    /**
     * Reseller overview statistics for Admin:
     * Aggregate KPIs across all resellers + per-reseller metrics for user counts and financials.
     */
    public function resellerOverviewStats(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can view reseller overview statistics.', 403);
        }

        $tz = 'Asia/Kathmandu';
        $todayStart = now($tz)->startOfDay()->utc();
        $monthStart = now($tz)->startOfMonth()->utc();

        // 1. Resellers query
        $resellersQuery = User::where('role', 'reseller');
        if ($resellerId = $request->query('reseller_id') ?? $request->query('id')) {
            $resellersQuery->where('id', $resellerId);
        }
        $resellers = $resellersQuery->get(['id', 'name', 'username', 'wallet_balance', 'wallet_due', 'commission_due', 'status', 'created_at']);
        $resellerIds = $resellers->pluck('id')->all();

        // 2. PPPoE Customer counts grouped by reseller
        $customerRows = DB::table('pppoe_customers')
            ->where(function ($q) use ($resellerIds) {
                $q->whereIn('reseller_id', $resellerIds)
                  ->orWhereIn('owner_id', $resellerIds);
            })
            ->select([
                DB::raw('COALESCE(reseller_id, owner_id) as assigned_reseller_id'),
                'status',
                DB::raw('COUNT(*) as total_count'),
            ])
            ->groupBy(DB::raw('COALESCE(reseller_id, owner_id)'), 'status')
            ->get();

        $subscribersByReseller = [];
        foreach ($resellerIds as $rId) {
            $subscribersByReseller[$rId] = [
                'total' => 0,
                'active' => 0,
                'expired' => 0,
                'suspended' => 0,
                'pending' => 0,
            ];
        }

        foreach ($customerRows as $row) {
            $rId = (int) $row->assigned_reseller_id;
            if (isset($subscribersByReseller[$rId])) {
                $status = strtolower($row->status ?? 'pending');
                $count = (int) $row->total_count;
                $subscribersByReseller[$rId]['total'] += $count;
                if (isset($subscribersByReseller[$rId][$status])) {
                    $subscribersByReseller[$rId][$status] += $count;
                }
            }
        }

        // 3. Online sessions per reseller from radacct
        $onlineQuery = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers as pc', 'pc.username', '=', 'radacct.username')
            ->where(function ($q) use ($resellerIds) {
                $q->whereIn('pc.reseller_id', $resellerIds)
                  ->orWhereIn('pc.owner_id', $resellerIds);
            })
            ->select(
                DB::raw('COALESCE(pc.reseller_id, pc.owner_id) as assigned_reseller_id'),
                DB::raw('COUNT(DISTINCT radacct.username) as online_count')
            )
            ->groupBy(DB::raw('COALESCE(pc.reseller_id, pc.owner_id)'))
            ->pluck('online_count', 'assigned_reseller_id');

        // 4. Wallet loads (Top-ups) per reseller
        $topupQuery = DB::table('wallet_transactions')
            ->whereIn('user_id', $resellerIds)
            ->whereIn('type', ['load', 'opening'])
            ->select([
                'user_id',
                DB::raw('COALESCE(SUM(amount), 0) as all_time'),
                DB::raw("COALESCE(SUM(CASE WHEN created_at >= '{$monthStart->toDateTimeString()}' THEN amount ELSE 0 END), 0) as this_month"),
                DB::raw("COALESCE(SUM(CASE WHEN created_at >= '{$todayStart->toDateTimeString()}' THEN amount ELSE 0 END), 0) as today"),
                DB::raw('COUNT(*) as total_loads_count'),
            ])
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        // 5. PPPoE Recharges per reseller (only recharges processed through reseller wallet)
        $rechargeQuery = DB::table('pppoe_recharges as pr')
            ->whereIn('pr.reseller_id', $resellerIds)
            ->select([
                'pr.reseller_id as assigned_reseller_id',
                DB::raw('COALESCE(SUM(pr.price), 0) as all_time'),
                DB::raw("COALESCE(SUM(CASE WHEN pr.created_at >= '{$monthStart->toDateTimeString()}' THEN pr.price ELSE 0 END), 0) as this_month"),
                DB::raw("COALESCE(SUM(CASE WHEN pr.created_at >= '{$todayStart->toDateTimeString()}' THEN pr.price ELSE 0 END), 0) as today"),
                DB::raw('COUNT(*) as total_recharge_count'),
            ])
            ->groupBy('pr.reseller_id')
            ->get()
            ->keyBy('assigned_reseller_id');

        $resellersData = [];
        $totalSubscribersAll = 0;
        $activeSubscribersAll = 0;
        $expiredSubscribersAll = 0;
        $onlineNowAll = 0;
        $totalWalletBalanceAll = 0.0;
        $totalWalletDueAll = 0.0;
        $totalTopupAllTime = 0.0;
        $totalTopupThisMonth = 0.0;
        $totalRechargeAllTime = 0.0;
        $totalRechargeThisMonth = 0.0;

        foreach ($resellers as $r) {
            $rId = (int) $r->id;
            $subs = $subscribersByReseller[$rId] ?? ['total' => 0, 'active' => 0, 'expired' => 0, 'suspended' => 0, 'pending' => 0];
            $online = (int) ($onlineQuery[$rId] ?? 0);
            $topups = $topupQuery[$rId] ?? null;
            $recharges = $rechargeQuery[$rId] ?? null;

            $walletBal = (float) ($r->wallet_balance ?? 0);
            $walletDue = (float) ($r->wallet_due ?? 0);
            $commDue = (float) ($r->commission_due ?? 0);
            $totalDue = round($walletDue + $commDue, 2);

            $topupAll = (float) ($topups ? $topups->all_time : 0);
            $topupMonth = (float) ($topups ? $topups->this_month : 0);
            $topupToday = (float) ($topups ? $topups->today : 0);

            $rechargeAll = (float) ($recharges ? $recharges->all_time : 0);
            $rechargeMonth = (float) ($recharges ? $recharges->this_month : 0);
            $rechargeToday = (float) ($recharges ? $recharges->today : 0);

            $resellersData[$rId] = [
                'reseller_id' => $rId,
                'name' => $r->name,
                'username' => $r->username,
                'status' => $r->status,
                'subscribers' => [
                    'total' => $subs['total'],
                    'active' => $subs['active'],
                    'expired' => $subs['expired'],
                    'suspended' => $subs['suspended'],
                    'online' => $online,
                ],
                'financials' => [
                    'wallet_balance' => $walletBal,
                    'wallet_due' => $walletDue,
                    'commission_due' => $commDue,
                    'total_due' => $totalDue,
                    'topup_all_time' => $topupAll,
                    'topup_this_month' => $topupMonth,
                    'topup_today' => $topupToday,
                    'recharge_all_time' => $rechargeAll,
                    'recharge_this_month' => $rechargeMonth,
                    'recharge_today' => $rechargeToday,
                ],
            ];

            $totalSubscribersAll += $subs['total'];
            $activeSubscribersAll += $subs['active'];
            $expiredSubscribersAll += $subs['expired'];
            $onlineNowAll += $online;
            $totalWalletBalanceAll += $walletBal;
            $totalWalletDueAll += $totalDue;
            $totalTopupAllTime += $topupAll;
            $totalTopupThisMonth += $topupMonth;
            $totalRechargeAllTime += $rechargeAll;
            $totalRechargeThisMonth += $rechargeMonth;
        }

        return $this->ok([
            'summary' => [
                'total_resellers' => count($resellers),
                'total_subscribers' => $totalSubscribersAll,
                'active_subscribers' => $activeSubscribersAll,
                'expired_subscribers' => $expiredSubscribersAll,
                'online_now' => $onlineNowAll,
                'total_wallet_balance' => round($totalWalletBalanceAll, 2),
                'total_wallet_due' => round($totalWalletDueAll, 2),
                'total_topup_all_time' => round($totalTopupAllTime, 2),
                'total_topup_this_month' => round($totalTopupThisMonth, 2),
                'total_recharge_all_time' => round($totalRechargeAllTime, 2),
                'total_recharge_this_month' => round($totalRechargeThisMonth, 2),
            ],
            'resellers' => $resellersData,
        ]);
    }

    /**
     * Complete One-Sight Snapshot for a single Reseller (Admin only).
     */
    public function resellerSnapshot(Request $request, User $user): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can view reseller snapshot.', 403);
        }

        if ($user->role !== 'reseller') {
            return $this->fail('User is not a reseller.', 400);
        }

        $tz = 'Asia/Kathmandu';
        $todayStart = now($tz)->startOfDay()->utc();
        $monthStart = now($tz)->startOfMonth()->utc();

        $resellerId = $user->id;

        // 1. Subscribers count breakdown
        $subsQuery = PppoeCustomer::where(fn ($q) => $q->where('reseller_id', $resellerId)->orWhere('owner_id', $resellerId));
        $subsTotal = (clone $subsQuery)->count();
        $subsActive = (clone $subsQuery)->where('status', 'active')->count();
        $subsExpired = (clone $subsQuery)->where('status', 'expired')->count();
        $subsSuspended = (clone $subsQuery)->where('status', 'suspended')->count();
        $subsNewThisMonth = (clone $subsQuery)->where('created_at', '>=', $monthStart->toDateTimeString())->count();
        $subsExpiringSoon = (clone $subsQuery)
            ->where('status', 'active')
            ->whereNotNull('expires_at')
            ->where('expires_at', '>=', now()->toDateTimeString())
            ->where('expires_at', '<=', now()->addDays(7)->toDateTimeString())
            ->count();

        // Online sessions count
        $onlineCount = (int) OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers as pc', 'pc.username', '=', 'radacct.username')
            ->where(fn ($q) => $q->where('pc.reseller_id', $resellerId)->orWhere('pc.owner_id', $resellerId))
            ->distinct()
            ->count('radacct.username');

        // Plans breakdown
        $plansBreakdown = DB::table('pppoe_customers as pc')
            ->join('internet_plans as ip', 'ip.id', '=', 'pc.plan_id')
            ->where(fn ($q) => $q->where('pc.reseller_id', $resellerId)->orWhere('pc.owner_id', $resellerId))
            ->select('ip.name as plan_name', DB::raw('COUNT(*) as count'))
            ->groupBy('ip.name')
            ->orderByDesc('count')
            ->get();

        // 14-day daily sales & activity trend
        $dailyTrend = [];
        for ($i = 13; $i >= 0; $i--) {
            $d = now()->subDays($i)->format('Y-m-d');
            $newSubsCount = DB::table('pppoe_customers')
                ->where(fn ($q) => $q->where('reseller_id', $resellerId)->orWhere('owner_id', $resellerId))
                ->whereDate('created_at', $d)
                ->count();
            // Subscribers whose subscription lapsed on this day and haven't been renewed.
            $expiredCount = DB::table('pppoe_customers')
                ->where(fn ($q) => $q->where('reseller_id', $resellerId)->orWhere('owner_id', $resellerId))
                ->whereNotNull('expires_at')
                ->whereDate('expires_at', $d)
                ->where('expires_at', '<=', now())
                ->where('status', '<>', 'active')
                ->count();
            // Renewals only — initial activations are already counted as new subscribers.
            $rechargesCount = DB::table('pppoe_recharges')
                ->where('reseller_id', $resellerId)
                ->whereDate('created_at', $d)
                ->where(fn ($q) => $q->whereNull('note')->orWhere('note', 'not like', 'Initial activation%'))
                ->count();
            // PPPoE New Sales (Initial Activations)
            $pppoeNewSalesSum = (float) DB::table('pppoe_recharges')
                ->where('reseller_id', $resellerId)
                ->whereDate('created_at', $d)
                ->where('note', 'like', 'Initial activation%')
                ->sum('price');

            // PPPoE Recharge Sales (Renewals / Subsequent Recharges)
            $pppoeRechargeSalesSum = (float) DB::table('pppoe_recharges')
                ->where('reseller_id', $resellerId)
                ->whereDate('created_at', $d)
                ->where(fn ($q) => $q->whereNull('note')->orWhere('note', 'not like', 'Initial activation%'))
                ->sum('price');

            $dailyTrend[] = [
                'date' => $d,
                'date_short' => now()->subDays($i)->format('m-d'),
                'new_subscribers' => $newSubsCount,
                'expired' => $expiredCount,
                'recharges' => $rechargesCount,
                'pppoe_new_sales' => $pppoeNewSalesSum,
                'pppoe_recharge_sales' => $pppoeRechargeSalesSum,
                'new_sales' => $pppoeNewSalesSum,
                'recharge_sales' => $pppoeRechargeSalesSum,
                'recharge_amount' => $pppoeNewSalesSum + $pppoeRechargeSalesSum,
            ];
        }

        // 2. Financial totals (Top-up & Recharge)
        $topupStats = DB::table('wallet_transactions')
            ->where('user_id', $resellerId)
            ->whereIn('type', ['load', 'opening'])
            ->select([
                DB::raw('COALESCE(SUM(amount), 0) as all_time'),
                DB::raw("COALESCE(SUM(CASE WHEN created_at >= '{$monthStart->toDateTimeString()}' THEN amount ELSE 0 END), 0) as this_month"),
                DB::raw("COALESCE(SUM(CASE WHEN created_at >= '{$todayStart->toDateTimeString()}' THEN amount ELSE 0 END), 0) as today"),
                DB::raw('COUNT(*) as total_count'),
            ])
            ->first();

        $rechargeStats = DB::table('pppoe_recharges as pr')
            ->where('pr.reseller_id', $resellerId)
            ->select([
                DB::raw('COALESCE(SUM(pr.price), 0) as all_time'),
                DB::raw("COALESCE(SUM(CASE WHEN pr.created_at >= '{$monthStart->toDateTimeString()}' THEN pr.price ELSE 0 END), 0) as this_month"),
                DB::raw("COALESCE(SUM(CASE WHEN pr.created_at >= '{$todayStart->toDateTimeString()}' THEN pr.price ELSE 0 END), 0) as today"),
                DB::raw('COALESCE(SUM(pr.admin_share), 0) as admin_share_all_time'),
                DB::raw('COALESCE(SUM(pr.reseller_share), 0) as reseller_share_all_time'),
                DB::raw('COUNT(*) as total_count'),
            ])
            ->first();

        // 3. Recent Recharges
        $recentRecharges = PppoeRecharge::with(['customer:id,username,full_name', 'plan:id,name'])
            ->where('reseller_id', $resellerId)
            ->latest('id')
            ->limit(15)
            ->get()
            ->map(fn ($r) => [
                'id' => $r->id,
                'reference' => $r->reference,
                'type' => str_starts_with((string) $r->note, 'Initial activation') ? 'new' : 'renewal',
                'customer_username' => $r->customer?->username,
                'customer_name' => $r->customer?->full_name,
                'plan_name' => $r->plan?->name,
                'price' => (float) $r->price,
                'validity_days' => $r->validity_days,
                'admin_share' => (float) $r->admin_share,
                'reseller_share' => (float) $r->reseller_share,
                'created_at' => $r->created_at?->toISOString(),
            ]);

        // 4. Recent Top-Ups (Wallet loads)
        $recentTopups = WalletTransaction::with('fromUser:id,name,username')
            ->where('user_id', $resellerId)
            ->whereIn('type', ['load', 'opening', 'package_adjustment'])
            ->latest('id')
            ->limit(15)
            ->get()
            ->map(fn ($t) => [
                'id' => $t->id,
                'amount' => (float) $t->amount,
                'balance_after' => (float) $t->balance_after,
                'type' => $t->type,
                'reference' => $t->reference,
                'note' => $t->note,
                'from_username' => $t->fromUser?->username ?? 'Admin',
                'created_at' => $t->created_at?->toISOString(),
            ]);

        return $this->ok([
            'reseller' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'phone' => $user->phone,
                'email' => $user->email,
                'status' => $user->status,
                'commission_percent' => (float) $user->commission_percent,
                'wallet_balance' => (float) $user->wallet_balance,
                'wallet_due' => (float) $user->wallet_due,
                'commission_due' => (float) $user->commission_due,
                'total_due' => round((float) $user->wallet_due + (float) $user->commission_due, 2),
                'created_at' => $user->created_at?->toISOString(),
            ],
            'subscribers' => [
                'total' => $subsTotal,
                'active' => $subsActive,
                'expired' => $subsExpired,
                'suspended' => $subsSuspended,
                'online' => $onlineCount,
                'new_this_month' => $subsNewThisMonth,
                'expiring_soon_7d' => $subsExpiringSoon,
                'plans_breakdown' => $plansBreakdown,
                'daily_trend' => $dailyTrend,
            ],
            'financials' => [
                'wallet_balance' => (float) $user->wallet_balance,
                'wallet_due' => (float) $user->wallet_due,
                'commission_due' => (float) $user->commission_due,
                'total_due' => round((float) $user->wallet_due + (float) $user->commission_due, 2),
                'topup' => [
                    'all_time' => (float) ($topupStats->all_time ?? 0),
                    'this_month' => (float) ($topupStats->this_month ?? 0),
                    'today' => (float) ($topupStats->today ?? 0),
                    'count' => (int) ($topupStats->total_count ?? 0),
                ],
                'recharge' => [
                    'all_time' => (float) ($rechargeStats->all_time ?? 0),
                    'this_month' => (float) ($rechargeStats->this_month ?? 0),
                    'today' => (float) ($rechargeStats->today ?? 0),
                    'admin_share_all_time' => (float) ($rechargeStats->admin_share_all_time ?? 0),
                    'reseller_share_all_time' => (float) ($rechargeStats->reseller_share_all_time ?? 0),
                    'count' => (int) ($rechargeStats->total_count ?? 0),
                ],
            ],
            'recent_recharges' => $recentRecharges,
            'recent_topups' => $recentTopups,
        ]);
    }

    private function validateNewUser(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:255', 'unique:users,username'],
            'email' => ['nullable', 'email', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['required', 'string', \Illuminate\Validation\Rules\Password::min(10)->letters()->numbers()],
            'gb_rate' => ['nullable', 'numeric', 'min:0.01'],
        ]);
        $data['password'] = Hash::make($data['password']);

        return $data;
    }
}
