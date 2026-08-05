<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\User;
use App\Models\Voucher;
use App\Models\WalletTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();

        return $this->ok(match ($actor->role) {
            'admin' => $this->adminDashboard($actor),
            'reseller' => $this->resellerDashboard($actor),
            default => $this->sellerDashboard($actor),
        });
    }

    private function adminDashboard(User $admin): array
    {
        return [
            'role' => 'admin',
            'balances' => [
                'wallet' => $admin->wallet_balance,
                'gb' => $admin->gb_balance,
                'gb_reserved' => $admin->gb_reserved,
                'gb_allowable' => $admin->gb_allowable,
                'wallet_due' => $admin->wallet_due,
            ],
            'counts' => [
                'resellers' => User::where('role', 'reseller')->count(),
                'sellers' => User::where('role', 'seller')->count(),
            ],
            'today_sales' => (float) Invoice::where('sender_id', $admin->id)->whereDate('created_at', now()->toDateString())->sum('total_amount'),
            'wallet_distributed' => (float) WalletTransaction::where('type', 'load')->sum('amount'),
            'gb_distributed' => (float) DB::table('gb_transactions')->where('type', 'allocate')->where('from_user_id', $admin->id)->sum('gb_amount'),
            'vouchers' => $this->voucherBreakdown(Voucher::query()),
            'gb_vouchers' => $this->voucherBreakdown(Voucher::whereHas('plan', fn($q) => $q->where('package_type', 'gb'))),
            'wallet_vouchers' => $this->voucherBreakdown(Voucher::whereHas('plan', fn($q) => $q->where('package_type', 'wallet'))),
            'commission_earned' => (float) WalletTransaction::where('user_id', $admin->id)->where('type', 'commission')->sum('amount'),
            'commission_today' => (float) WalletTransaction::where('user_id', $admin->id)->where('type', 'commission')->whereDate('created_at', now()->toDateString())->sum('amount'),
            // Live outstanding commission owed to admin, summed across every reseller
            // (mirrors each reseller's own commission_due, just rolled up system-wide).
            'commission_due' => (float) User::where('role', 'reseller')->sum('commission_due'),
            // GB allocation payments actually collected from resellers vs. still
            // outstanding — same collected/receivable split resellers see for their
            // own sellers (collected_from_sellers / outstanding_due), rolled up here
            // for the admin -> reseller leg of the same GB-on-credit flow.
            'collected_from_resellers' => (float) Invoice::where('sender_id', $admin->id)->sum('paid_amount'),
            'pending_from_resellers' => (float) User::where('role', 'reseller')->sum('wallet_due'),
            'top_resellers' => $this->topByVoucherSales('reseller_id', null, true),
            'top_sellers' => $this->topByVoucherSales('seller_id', null),
            'recent_transactions' => WalletTransaction::with(['user', 'fromUser', 'toUser'])->latest()->limit(5)->get()->map(fn($t) => [
                'id' => $t->id,
                'user' => $t->user?->username,
                'type' => $t->type,
                'amount' => (float) $t->amount,
                'note' => $t->note ?? $t->reference ?? '—',
                'created_at' => $t->created_at->toIso8601String(),
            ])->all(),
            // System-wide daily trend (all resellers + sellers combined) — no scoping.
            'daily_trend' => $this->voucherDailyTrend(),
        ];
    }

    private function resellerDashboard(User $reseller): array
    {
        $sellerIds = User::where('parent_id', $reseller->id)->pluck('id');

        // 1. Invoices (GB Allocations to Sellers)
        $invoiceTotal = (float) Invoice::where('sender_id', $reseller->id)->sum('total_amount');
        $invoiceToday = (float) Invoice::where('sender_id', $reseller->id)->whereDate('created_at', now()->toDateString())->sum('total_amount');
        $invoiceMonth = (float) Invoice::where('sender_id', $reseller->id)->whereMonth('created_at', now()->month)->whereYear('created_at', now()->year)->sum('total_amount');

        // 2. Direct Voucher Sales (Reseller direct) — a voucher only counts once it's
        // actually been sold or used (whichever happens first), never while merely
        // 'active' and untouched. sold_at covers an explicit sale; activated_at
        // covers a GB Package voucher consumed via first login without ever being
        // marked sold (see GbService::settleVoucherConsumption). Gating on these
        // timestamps instead of `status` also naturally includes 'used'/'expired'
        // vouchers that were genuinely sold/used before moving to that status.
        $directVoucherSales = fn () => Voucher::where('reseller_id', $reseller->id)
            ->whereNull('seller_id')
            ->where(fn ($q) => $q->whereNotNull('sold_at')->orWhereNotNull('activated_at'));

        // "Voucher Sales" specifically means GB Package vouchers the reseller sold
        // himself. Wallet Package direct sales are already fully represented via
        // commission_due/commission_net_earnings below — folding them in here too
        // would double-count that same revenue under a second framing.
        $gbVoucherSales = fn () => $directVoucherSales()->whereHas('plan', fn ($q) => $q->where('package_type', 'gb'));

        $voucherTotal = (float) $gbVoucherSales()->sum('price');
        $voucherToday = (float) $gbVoucherSales()
            ->whereRaw('COALESCE(sold_at, activated_at) >= ?', [now()->startOfDay()])
            ->sum('price');
        $voucherMonth = (float) $gbVoucherSales()
            ->whereRaw('COALESCE(sold_at, activated_at) >= ?', [now()->startOfMonth()])
            ->sum('price');

        $totalSales = $invoiceTotal + $voucherTotal;
        $todaySales = $invoiceToday + $voucherToday;
        $monthlySales = $invoiceMonth + $voucherMonth;

        // 3. Unified recent transactions
        // A. Wallet Transactions (loads/payments)
        $walletTx = WalletTransaction::where('user_id', $reseller->id)
            ->latest()
            ->limit(5)
            ->get()
            ->map(fn($t) => [
                'id' => 'wxt_' . $t->id,
                'type' => $t->type,
                'amount' => (float) $t->amount,
                'note' => $t->note ?? $t->reference ?? '—',
                'is_positive' => $t->type === 'load' || $t->type === 'transfer',
                'created_at' => $t->created_at,
            ]);

        // B. Invoices (sales to sellers)
        $invoicesTx = Invoice::with('receiver')
            ->where('sender_id', $reseller->id)
            ->latest()
            ->limit(5)
            ->get()
            ->map(fn($inv) => [
                'id' => 'inv_' . $inv->id,
                'type' => 'GB Allocation',
                'amount' => (float) $inv->total_amount,
                'note' => "Allocated " . number_format($inv->gb_amount) . " GB to " . ($inv->receiver?->username ?? 'Seller'),
                'is_positive' => true,
                'created_at' => $inv->created_at,
            ]);

        // C. Direct Voucher Sales — sold or used, same gate as $directVoucherSales above.
        $vouchersTx = $directVoucherSales()
            ->with('plan')
            ->orderByRaw('COALESCE(sold_at, activated_at) DESC')
            ->limit(5)
            ->get()
            ->map(fn($v) => [
                'id' => 'vch_' . $v->id,
                'type' => 'Voucher Sale',
                'amount' => (float) $v->price,
                'note' => "Sold " . ($v->plan?->name ?? 'Voucher') . " (" . $v->code . ")" . ($v->customer_username ? " to {$v->customer_username}" : ""),
                'is_positive' => true,
                'created_at' => $v->sold_at ?? $v->activated_at,
            ]);

        // Merge, sort descending by transaction date, take 5
        $mergedTransactions = collect()
            ->concat($walletTx)
            ->concat($invoicesTx)
            ->concat($vouchersTx)
            ->sortByDesc('created_at')
            ->take(5)
            ->map(fn($tx) => [
                'id' => $tx['id'],
                'type' => $tx['type'],
                'amount' => $tx['amount'],
                'note' => $tx['note'],
                'is_positive' => $tx['is_positive'],
                'created_at' => $tx['created_at']->toIso8601String(),
            ])
            ->values()
            ->all();

        $retailProfit = $directVoucherSales()->get()->sum(function ($v) {
            return (float) $v->price - (float) $v->base_price;
        });

        $gbPurchased = (float) Invoice::where('receiver_id', $reseller->id)->sum('gb_amount');
        $gbAllocated = (float) Invoice::where('sender_id', $reseller->id)->sum('gb_amount');
        $revenueSellers = (float) Invoice::where('sender_id', $reseller->id)->sum('total_amount');
        // Actually paid, not just invoiced — Invoice.paid_amount accrues both the
        // upfront paidAmount recorded at allocation time (GbService::allocate) and
        // any later payoff via PaymentService::collect(). total_amount - this is
        // exactly what outstanding_due (sum of sellers' wallet_due) represents.
        $collectedFromSellers = (float) Invoice::where('sender_id', $reseller->id)->sum('paid_amount');
        $packagesCount = \App\Models\InternetPlan::where('created_by', $reseller->id)->count();

        // Daily Sales Trend & Voucher Count (split GB vs Wallet) for the last 14 days.
        // Scoped to reseller_id, which covers the reseller's own direct sales AND every
        // sale made by sellers under them (a downline voucher keeps reseller_id set to
        // its seller's parent) — same scope already used for the vouchers/gb_vouchers/
        // wallet_vouchers/voucher_sales figures above.
        $dailyTrend = $this->voucherDailyTrend(fn ($q) => $q->where('vouchers.reseller_id', $reseller->id));

        return [
            'role' => 'reseller',
            'balances' => [
                'wallet' => $reseller->wallet_balance,
                'gb' => $reseller->gb_balance,
                'gb_reserved' => $reseller->gb_reserved,
                'gb_allowable' => $reseller->gb_allowable,
                'wallet_due' => $reseller->wallet_due,
            ],
            'counts' => [
                'sellers' => $sellerIds->count(),
                'packages' => $packagesCount,
            ],
            'gb_purchased' => $gbPurchased,
            'gb_allocated' => $gbAllocated,
            'revenue_sellers' => $revenueSellers,
            'collected_from_sellers' => $collectedFromSellers,
            'voucher_sales' => $voucherTotal,
            'retail_profit' => (float) $retailProfit,
            'today_sales' => $todaySales,
            'monthly_sales' => $monthlySales,
            // Own vouchers only (whereNull('seller_id')) — same "direct" scope as
            // $directVoucherSales above. reseller_id alone would also pull in every
            // voucher generated by sellers under this reseller, double-billing this
            // card as a mix of the reseller's own stock and their downline's.
            'vouchers' => $this->voucherBreakdown(Voucher::where('reseller_id', $reseller->id)->whereNull('seller_id')),
            'gb_vouchers' => $this->voucherBreakdown(Voucher::where('reseller_id', $reseller->id)->whereNull('seller_id')->whereHas('plan', fn($q) => $q->where('package_type', 'gb'))),
            'wallet_vouchers' => $this->voucherBreakdown(Voucher::where('reseller_id', $reseller->id)->whereNull('seller_id')->whereHas('plan', fn($q) => $q->where('package_type', 'wallet'))),
            'sales' => $totalSales,
            'outstanding_due' => (float) User::where('parent_id', $reseller->id)->sum('wallet_due'),
            'commission_percent' => (float) $reseller->commission_percent,
            // Live outstanding balance (mirrors PaymentService::collectCommission
            // settlements) — not a raw historical sum of admin_share, which would
            // never decrease even after the reseller pays the admin.
            'commission_due' => (float) $reseller->commission_due,
            'commission_paid' => (float) Voucher::where('reseller_id', $reseller->id)->whereNotNull('admin_share')->sum('admin_share'),
            'commission_net_earnings' => (float) Voucher::where('reseller_id', $reseller->id)->whereNotNull('reseller_share')->sum('reseller_share'),
            'top_sellers' => $this->topByVoucherSales('seller_id', $sellerIds),
            'recent_wallet_transfers' => $mergedTransactions,
            'daily_trend' => $dailyTrend,
        ];
    }

    private function sellerDashboard(User $seller): array
    {
        $today = Voucher::where('seller_id', $seller->id)->whereDate('created_at', now()->toDateString());
        // Today's sales = vouchers generated today
        $todaySales = Voucher::where('seller_id', $seller->id)->whereDate('created_at', now()->toDateString());

        // Fetch reseller (parent) name — needed for profit calculation below
        $reseller = $seller->parent_id ? User::find($seller->parent_id) : null;
        $resellerName = $reseller ? ($reseller->name ?? $reseller->username) : null;

        $vouchers = Voucher::where('seller_id', $seller->id)
            ->whereIn('status', ['sold', 'active', 'expired'])
            ->get();

        // Reseller's gb_rate is the seller's cost per GB (what the reseller charges)
        $parentGbRate = $reseller ? ((float) $reseller->gb_rate) : ((float) $seller->gb_rate ?? 1.00);
        $retailProfit = $vouchers->sum(function ($v) use ($parentGbRate) {
            $cost = ($v->data_gb > 0) ? ($v->data_gb * $parentGbRate) : (float) $v->base_price;
            return (float) $v->price - $cost;
        });

        $voucherSales = $vouchers->sum('price');
        $packagesCount = \App\Models\InternetPlan::where('created_by', $seller->id)->count();

        // Daily Sales Trend & Voucher Count (split GB vs Wallet) for the last 14 days.
        $dailyTrend = $this->voucherDailyTrend(fn ($q) => $q->where('vouchers.seller_id', $seller->id));

        return [
            'role' => 'seller',
            'balances' => [
                'wallet' => $seller->wallet_balance,
                'gb' => $seller->gb_balance,
                'gb_reserved' => $seller->gb_reserved,
                'gb_allowable' => $seller->gb_allowable,
                'wallet_due' => $seller->wallet_due,
            ],
            'reseller_name' => $resellerName,
            'counts' => [
                'packages' => $packagesCount,
            ],
            'voucher_sales' => (float) $voucherSales,
            'retail_profit' => (float) $retailProfit,
            'vouchers' => $this->voucherBreakdown(Voucher::where('seller_id', $seller->id)),
            'gb_vouchers' => $this->voucherBreakdown(Voucher::where('seller_id', $seller->id)->whereHas('plan', fn($q) => $q->where('package_type', 'gb'))),
            'wallet_vouchers' => $this->voucherBreakdown(Voucher::where('seller_id', $seller->id)->whereHas('plan', fn($q) => $q->where('package_type', 'wallet'))),
            'daily_trend' => $dailyTrend,
            'today' => [
                'vouchers' => (clone $today)->count(),
                'sales' => (float) $todaySales->sum('price'),
            ],
            'recent_customers' => Voucher::where('seller_id', $seller->id)->whereNotNull('customer_username')->latest()->limit(10)->get(['code', 'status', 'customer_username', 'price', 'activated_at', 'sold_at'])->all(),
        ];
    }

    /**
     * Daily sales/voucher-count trend for the last 14 days, split by package
     * type (GB vs Wallet). Pass a callback to scope to a reseller/seller
     * (e.g. fn ($q) => $q->where('vouchers.reseller_id', $id)); omit it for
     * an unscoped, system-wide trend (admin view).
     *
     * A voucher only counts once it's actually been sold or used (whichever
     * happens first) — never while merely generated/'active' stock that
     * hasn't reached a customer. sold_at covers an explicit sale;
     * activated_at covers a GB Package voucher consumed via first login
     * without ever being marked sold (see GbService::settleVoucherConsumption).
     * Same gate as $directVoucherSales in resellerDashboard() above — bucketing
     * by created_at instead would count freshly-generated, unsold stock as
     * "sold" on its generation date.
     */
    private function voucherDailyTrend(?\Closure $scope = null): array
    {
        $days = collect(range(13, 0))->map(fn ($i) => now()->subDays($i)->toDateString());

        $query = Voucher::query()
            ->where(fn ($q) => $q->whereNotNull('vouchers.sold_at')->orWhereNotNull('vouchers.activated_at'))
            ->whereRaw('COALESCE(vouchers.sold_at, vouchers.activated_at) >= ?', [now()->subDays(13)->startOfDay()])
            ->join('internet_plans', 'internet_plans.id', '=', 'vouchers.plan_id');

        if ($scope) {
            $scope($query);
        }

        $dailySalesRaw = $query
            ->selectRaw(
                'DATE(COALESCE(vouchers.sold_at, vouchers.activated_at)) as date, ' .
                'SUM(vouchers.price) as total, ' .
                'COUNT(*) as count, ' .
                "SUM(internet_plans.package_type = 'gb') as gb_count, " .
                "SUM(internet_plans.package_type = 'wallet') as wallet_count, " .
                "SUM(CASE WHEN internet_plans.package_type = 'gb' THEN vouchers.price ELSE 0 END) as gb_sales, " .
                "SUM(CASE WHEN internet_plans.package_type = 'wallet' THEN vouchers.price ELSE 0 END) as wallet_sales"
            )
            ->groupBy('date')
            ->get()
            ->keyBy('date');

        return $days->map(function ($date) use ($dailySalesRaw) {
            $row = $dailySalesRaw->get($date);
            return [
                'date' => $date,
                'sales' => $row ? (float) $row->total : 0,
                'count' => $row ? (int) $row->count : 0,
                'gb_count' => $row ? (int) $row->gb_count : 0,
                'wallet_count' => $row ? (int) $row->wallet_count : 0,
                'gb_sales' => $row ? (float) $row->gb_sales : 0,
                'wallet_sales' => $row ? (float) $row->wallet_sales : 0,
            ];
        })->values()->all();
    }

    private function voucherBreakdown($query): array
    {
        $byStatus = (clone $query)->select('status', DB::raw('count(*) as c'))->groupBy('status')->pluck('c', 'status');
        $total = (int) $byStatus->sum();
        $used = (int) ($byStatus['used'] ?? 0) + (int) ($byStatus['expired'] ?? 0);
        $last7Days = (clone $query)->where('created_at', '>=', now()->subDays(7))->count();

        return [
            'total' => $total,
            'by_status' => $byStatus,
            'used' => $used,
            'remaining' => $total - $used,
            'last_7_days' => $last7Days,
        ];
    }

    private function topByVoucherSales(string $column, $restrictIds = null, bool $includeCommission = false): array
    {
        $selects = [$column, DB::raw('count(*) as vouchers'), DB::raw('sum(price) as revenue')];
        if ($includeCommission) {
            $selects[] = DB::raw('sum(admin_share) as commission');
        }

        $q = Voucher::query()->whereNotNull($column)
            ->select($selects)
            ->groupBy($column)->orderByDesc('revenue')->limit(5);
        if ($restrictIds !== null) {
            $q->whereIn($column, $restrictIds);
        }
        $rows = $q->get();
        $users = User::whereIn('id', $rows->pluck($column))->get(['id', 'username', 'commission_percent'])->keyBy('id');

        return $rows->map(function ($r) use ($column, $users, $includeCommission) {
            $user = $users[$r->$column] ?? null;
            $item = [
                'user' => $user->username ?? "#{$r->$column}",
                'vouchers' => (int) $r->vouchers,
                'revenue' => (float) $r->revenue,
            ];
            if ($includeCommission) {
                $item['commission'] = (float) ($r->commission ?? 0);
                $item['commission_percent'] = $user ? (float) $user->commission_percent : 0.0;
            }

            return $item;
        })->all();
    }
}
