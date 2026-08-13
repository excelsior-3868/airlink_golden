<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use App\Services\PppoeCustomerService;
use App\Services\PppoeRechargeService;
use App\Services\Radius\OnlineSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PppoeCustomerController extends Controller
{
    public function __construct(
        private readonly PppoeCustomerService $customerService,
        private readonly PppoeRechargeService $rechargeService,
    ) {
    }

    /**
     * List subscribers with server-side pagination, filtering, and live session status.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = $this->scopedQuery($actor)
            ->with(['plan:id,name,bandwidth,validity_days,selling_price,status', 'owner:id,name,username,role', 'reseller:id,name,username', 'nasDevice:id,name,nasname']);

        // Filter: Search / Query
        if ($search = trim($request->input('q') ?? $request->input('search') ?? '')) {
            $query->where(function ($q) use ($search) {
                $q->where('username', 'like', "%{$search}%")
                  ->orWhere('full_name', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhere('customer_code', 'like', "%{$search}%")
                  ->orWhere('address', 'like', "%{$search}%");
            });
        }

        // Filter: Status
        if ($status = $request->input('status')) {
            if ($status !== 'all') {
                $query->where('status', $status);
            }
        }

        // Filter: Plan
        if ($planId = $request->input('plan_id')) {
            $query->where('plan_id', $planId);
        }

        // Filter: NAS Device
        if ($nasId = $request->input('nas_device_id')) {
            $query->where('nas_device_id', $nasId);
        }

        // Filter: Owner (Admin only)
        if ($actor->isAdmin() && ($ownerId = $request->input('owner_id'))) {
            $query->where('owner_id', $ownerId);
        }

        // Sorting
        $sort = $request->input('sort', 'created_at');
        $dir = strtolower($request->input('dir', 'desc')) === 'asc' ? 'asc' : 'desc';
        if (in_array($sort, ['created_at', 'expires_at', 'username', 'full_name', 'status', 'activated_at'])) {
            $query->orderBy($sort, $dir);
        } else {
            $query->orderBy('created_at', 'desc');
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $customers = $query->paginate($perPage);

        // Fetch live sessions and lifetime data for this page of subscribers
        $usernames = $customers->pluck('username')->all();
        $liveSessions = [];
        $usageStats = [];

        if (!empty($usernames)) {
            $liveSessions = OnlineSession::scopeLive(DB::table('radacct'))
                ->select('username', 'framedipaddress', 'callingstationid', 'nasipaddress', 'acctstarttime')
                ->whereIn('username', $usernames)
                ->get()
                ->keyBy('username')
                ->all();

            $usageStats = DB::table('radacct')
                ->select('username', DB::raw('SUM(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)) as total_octets'), DB::raw('MAX(acctstoptime) as last_stop'))
                ->whereIn('username', $usernames)
                ->groupBy('username')
                ->get()
                ->keyBy('username')
                ->all();
        }

        $customers->getCollection()->transform(function ($c) use ($liveSessions, $usageStats) {
            $live = $liveSessions[$c->username] ?? null;
            $usage = $usageStats[$c->username] ?? null;

            $c->is_online = $live !== null;
            $c->current_ip = $live?->framedipaddress ?? $c->nas_ip;
            $c->current_mac = $live?->callingstationid ?? $c->mac_address;
            $c->session_start = $live?->acctstarttime;
            $c->total_used_bytes = $usage ? (int) $usage->total_octets : 0;
            $c->last_session_at = $live ? $live->acctstarttime : ($usage?->last_stop ?? $c->activated_at);

            return $c;
        });

        return $this->ok($customers);
    }

    /**
     * Aggregated stat counts for dashboard/header tiles.
     */
    public function summary(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $base = $this->scopedQuery($actor);

        $total = (clone $base)->count();
        $active = (clone $base)->where('status', 'active')->count();
        $expiring7d = (clone $base)
            ->where('status', 'active')
            ->whereNotNull('expires_at')
            ->whereBetween('expires_at', [now(), now()->addDays(7)])
            ->count();
        $expiredOrSuspended = (clone $base)->whereIn('status', ['expired', 'suspended'])->count();

        // Online count across scoped customers
        $scopedUsernamesQuery = $this->scopedQuery($actor)->select('username');
        $online = OnlineSession::scopeLive(DB::table('radacct'))
            ->whereIn('username', $scopedUsernamesQuery)
            ->distinct()
            ->count('username');

        return $this->ok([
            'total' => $total,
            'active' => $active,
            'expiring_7d' => $expiring7d,
            'expired_suspended' => $expiredOrSuspended,
            'online' => $online,
        ]);
    }

    /**
     * Show subscriber profile with history.
     */
    public function show(Request $request, PppoeCustomer $customer): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $customer->load([
            'plan',
            'owner:id,name,username,role',
            'reseller:id,name,username',
            'nasDevice:id,name,nasname',
            'recharges' => fn ($q) => $q->with('collectedBy:id,name,username')->orderBy('created_at', 'desc')->limit(10),
        ]);

        $live = OnlineSession::scopeLive(DB::table('radacct'))
            ->where('username', $customer->username)
            ->first();

        $customer->is_online = $live !== null;
        $customer->current_session = $live;

        return $this->ok($customer);
    }

    /**
     * Create a new subscriber.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (!$actor->tokenCan('pppoe.write') && !$actor->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.write' ability.", 403);
        }

        $data = $request->validate([
            'username' => ['required', 'string', 'min:3', 'max:64', 'regex:/^[A-Za-z0-9._@-]{3,64}$/'],
            'password' => ['required', 'string', 'min:1', 'max:255'],
            'plan_id' => ['required', 'integer', 'exists:internet_plans,id'],
            'full_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'customer_code' => ['nullable', 'string', 'max:40'],
            'bandwidth' => ['nullable', 'string', 'max:50'],
            'simultaneous_use' => ['nullable', 'integer', 'min:1', 'max:10'],
            'contract_price' => ['nullable', 'numeric', 'min:0'],
            'mac_bind' => ['nullable', 'boolean'],
            'mac_address' => ['nullable', 'string', 'regex:/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/'],
            'nas_device_id' => ['nullable', 'integer', 'exists:nas_devices,id'],
            'owner_id' => ['nullable', 'integer', 'exists:users,id'],
            // Optional one-step onboarding: create the subscriber and take the
            // first prepaid recharge together, so an operator signing up a
            // customer who is paying today does not have to do it in two moves.
            'activate_now' => ['nullable', 'boolean'],
            'periods' => ['nullable', 'integer', 'min:1', 'max:24'],
            'payment_method' => ['nullable', 'string', 'max:40'],
        ]);

        $activateNow = (bool) ($data['activate_now'] ?? false);
        $periods = (int) ($data['periods'] ?? 1);
        $paymentMethod = $data['payment_method'] ?? 'wallet';
        unset($data['activate_now'], $data['periods'], $data['payment_method']);

        // One transaction so a failed first recharge (most often an insufficient
        // wallet) rolls the subscriber back too, rather than leaving a stranded
        // 'pending' row behind. The subscriber is 'pending' at this point, so
        // recharge() never fires a CoA — nothing escapes the transaction.
        $customer = DB::transaction(function () use ($actor, $data, $activateNow, $periods, $paymentMethod) {
            $customer = $this->customerService->create($actor, $data);

            if ($activateNow) {
                $this->rechargeService->recharge(
                    $actor,
                    $customer,
                    $customer->plan,
                    null,
                    null,
                    $periods,
                    $paymentMethod,
                    'Initial activation',
                );
            }

            return $customer;
        });

        return $this->created($customer->fresh(['plan', 'owner', 'reseller', 'nasDevice']), 'PPPoE subscriber created successfully.');
    }

    /**
     * Update an existing subscriber.
     */
    public function update(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        if (!$actor->tokenCan('pppoe.write') && !$actor->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.write' ability.", 403);
        }

        $data = $request->validate([
            'password' => ['nullable', 'string', 'min:1', 'max:255'],
            'plan_id' => ['nullable', 'integer', 'exists:internet_plans,id'],
            'full_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'customer_code' => ['nullable', 'string', 'max:40'],
            'bandwidth' => ['nullable', 'string', 'max:50'],
            'simultaneous_use' => ['nullable', 'integer', 'min:1', 'max:10'],
            'contract_price' => ['nullable', 'numeric', 'min:0'],
            'mac_bind' => ['nullable', 'boolean'],
            'mac_address' => ['nullable', 'string', 'regex:/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/'],
            'nas_device_id' => ['nullable', 'integer', 'exists:nas_devices,id'],
        ]);

        $updated = $this->customerService->update($actor, $customer, $data);

        return $this->ok($updated->fresh(['plan', 'owner', 'reseller', 'nasDevice']), 'PPPoE subscriber updated successfully.');
    }

    /**
     * Suspend a subscriber.
     */
    public function suspend(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $suspended = $this->customerService->suspend($actor, $customer);

        return $this->ok($suspended, 'Subscriber suspended.');
    }

    /**
     * Resume a subscriber.
     */
    public function resume(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $resumed = $this->customerService->resume($actor, $customer);

        return $this->ok($resumed, 'Subscriber resumed.');
    }

    /**
     * Change a subscriber's plan.
     */
    public function changePlan(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $data = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:internet_plans,id'],
        ]);

        $plan = InternetPlan::findOrFail($data['plan_id']);
        $changed = $this->customerService->changePlan($actor, $customer, $plan);

        return $this->ok($changed->fresh(['plan']), 'Plan changed successfully.');
    }

    /**
     * Disconnect active live sessions.
     */
    public function disconnect(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $result = $this->customerService->disconnect($actor, $customer);

        return $this->ok($result, 'Disconnect command issued.');
    }

    /**
     * Delete subscriber permanently.
     */
    public function destroy(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $this->customerService->destroy($actor, $customer);

        return $this->ok(null, 'Subscriber deleted successfully.');
    }

    /**
     * Radius accounting history for a subscriber.
     */
    public function sessions(Request $request, PppoeCustomer $customer): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $sessions = DB::table('radacct')
            ->where('username', $customer->username)
            ->orderBy('radacctid', 'desc')
            ->paginate($perPage);

        return $this->ok($sessions);
    }

    /**
     * Live active RADIUS sessions across all scoped PPPoE subscribers.
     */
    public function liveSessions(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username')
            ->leftJoin('internet_plans', 'internet_plans.id', '=', 'pppoe_customers.plan_id')
            ->select(
                'radacct.radacctid',
                'radacct.username',
                'pppoe_customers.id as customer_id',
                'pppoe_customers.full_name',
                'pppoe_customers.phone',
                'internet_plans.name as plan_name',
                'radacct.framedipaddress as ip_address',
                'radacct.callingstationid as mac_address',
                'radacct.nasipaddress as nas_ip',
                'radacct.acctstarttime as start_time',
                'radacct.acctupdatetime as update_time',
                'radacct.acctinputoctets as input_bytes',
                'radacct.acctoutputoctets as output_bytes',
                DB::raw('CAST(GREATEST(0, TIMESTAMPDIFF(SECOND, radacct.acctstarttime, NOW())) AS UNSIGNED) as session_time')
            );

        if (!$actor->isAdmin()) {
            if ($actor->isReseller()) {
                $query->where(function ($q) use ($actor) {
                    $q->where('pppoe_customers.owner_id', $actor->id)
                      ->orWhere('pppoe_customers.reseller_id', $actor->id);
                });
            } else {
                $query->whereRaw('1 = 0');
            }
        }

        if ($search = trim($request->input('q') ?? $request->input('search') ?? '')) {
            $query->where(function ($q) use ($search) {
                $q->where('radacct.username', 'like', "%{$search}%")
                  ->orWhere('pppoe_customers.full_name', 'like', "%{$search}%")
                  ->orWhere('radacct.callingstationid', 'like', "%{$search}%")
                  ->orWhere('radacct.framedipaddress', 'like', "%{$search}%")
                  ->orWhere('radacct.nasipaddress', 'like', "%{$search}%");
            });
        }

        // Filtered here rather than in the client: the feed is paginated, so a
        // client-side NAS filter would only ever narrow the visible page.
        if ($nasIp = trim((string) $request->input('nas_ip', ''))) {
            $query->where('radacct.nasipaddress', $nasIp);
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $sessions = $query->orderBy('radacct.acctstarttime', 'desc')->paginate($perPage);

        return $this->ok($sessions);
    }

    /**
     * Export subscribers as CSV.
     */
    public function exportCsv(Request $request): StreamedResponse|JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = $this->scopedQuery($actor)->with(['plan', 'owner', 'reseller']);

        $filename = 'pppoe_subscribers_' . date('Ymd_His') . '.csv';

        return response()->streamDownload(function () use ($query) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, [
                'ID', 'Username', 'Full Name', 'Phone', 'Address', 'Customer Code',
                'Status', 'Plan', 'Activated At', 'Expires At', 'Contract Price',
                'Bandwidth', 'NAS IP', 'MAC Address', 'Owner', 'Reseller'
            ]);

            $query->chunk(200, function ($customers) use ($handle) {
                foreach ($customers as $c) {
                    fputcsv($handle, [
                        $c->id,
                        $c->username,
                        $c->full_name,
                        $c->phone ?? '',
                        $c->address ?? '',
                        $c->customer_code ?? '',
                        $c->status,
                        $c->plan?->name ?? '',
                        $c->activated_at ? $c->activated_at->toDateTimeString() : '',
                        $c->expires_at ? $c->expires_at->toDateTimeString() : '',
                        $c->contract_price ?? '',
                        $c->bandwidth ?? '',
                        $c->nas_ip ?? '',
                        $c->mac_address ?? '',
                        $c->owner?->name ?? '',
                        $c->reseller?->name ?? '',
                    ]);
                }
            });

            fclose($handle);
        }, $filename, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * Base scoped query for subscribers based on user role.
     */
    private function scopedQuery(User $actor)
    {
        $query = PppoeCustomer::query();

        if ($actor->isAdmin()) {
            return $query;
        }

        if ($actor->isReseller()) {
            return $query->where(function ($q) use ($actor) {
                $q->where('owner_id', $actor->id)
                  ->orWhere('reseller_id', $actor->id);
            });
        }

        // Sellers are barred from PPPoE
        return $query->whereRaw('1 = 0');
    }

    /**
     * Check if actor has permission to view/modify subscriber.
     */
    private function canAccess(User $actor, PppoeCustomer $customer): bool
    {
        if ($actor->isAdmin()) {
            return true;
        }

        if ($actor->isReseller()) {
            return $customer->owner_id === $actor->id || $customer->reseller_id === $actor->id;
        }

        return false;
    }
}
