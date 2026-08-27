<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    /**
     * Used-voucher report: per-package generated / used / remaining, scoped to
     * the caller's tree and the spec's filter set (date, package, reseller,
     * seller, status).
     */
    public function packageSummary(Request $request): JsonResponse
    {
        $q = $this->scoped($request);

        $rows = (clone $q)
            ->join('internet_plans as p', 'p.id', '=', 'vouchers.plan_id')
            ->select(
                'p.id as plan_id', 'p.name as plan', 'p.package_type', 'vouchers.status',
                DB::raw('CASE WHEN vouchers.activated_at IS NOT NULL THEN 1 ELSE 0 END as is_activated'),
                DB::raw('count(*) as c'), DB::raw('sum(vouchers.price) as revenue'), DB::raw('sum(vouchers.data_gb) as gb')
            )
            ->groupBy('p.id', 'p.name', 'p.package_type', 'vouchers.status', DB::raw('CASE WHEN vouchers.activated_at IS NOT NULL THEN 1 ELSE 0 END'))
            ->get();

        // Cards come in two flavours a reseller prices and settles differently —
        // GB packages (direct-due) and wallet packages (commission-split) — so the
        // status rollup is reported per package type as well as in total.
        $emptyStatuses = ['ready' => 0, 'active' => 0, 'used' => 0, 'disabled' => 0];
        $byPackageType = [
            'gb' => ['generated' => 0, 'sold' => 0, 'by_status' => $emptyStatuses],
            'wallet' => ['generated' => 0, 'sold' => 0, 'by_status' => $emptyStatuses],
        ];

        $summary = [];
        foreach ($rows as $r) {
            $status = $r->status;
            // Disabled cards are revoked stock, not inventory. They stay in
            // by_status so the Disabled tile still reports them, but they never
            // count toward `generated` — and so never toward the `remaining`
            // and `in_stock` figures derived from it.
            $inventory = $status === 'disabled' ? 0 : (int) $r->c;
            if (isset($byPackageType[$r->package_type])) {
                $byPackageType[$r->package_type]['generated'] += $inventory;
                $byPackageType[$r->package_type]['by_status'][$status] += (int) $r->c;
                if (in_array($status, ['active', 'used'], true) || $r->is_activated) {
                    $byPackageType[$r->package_type]['sold'] += (int) $r->c;
                }
            }
            $summary[$r->plan_id] ??= [
                'plan_id' => $r->plan_id, 'plan' => $r->plan,
                'generated' => 0, 'used' => 0, 'remaining' => 0, 'revenue' => 0, 'gb_sold' => 0,
                'by_status' => ['ready' => 0, 'active' => 0, 'used' => 0, 'disabled' => 0],
            ];
            $summary[$r->plan_id]['generated'] += $inventory;
            $summary[$r->plan_id]['by_status'][$status] += (int) $r->c;
            // Only cards actually handed off to a customer count toward sales
            // — 'ready' is printed but still sitting in stock.
            if (in_array($status, ['active', 'used'], true) || $r->is_activated) {
                $summary[$r->plan_id]['revenue'] += (float) $r->revenue;
                $summary[$r->plan_id]['gb_sold'] += (float) $r->gb;
            }
            // "Used" = vouchers that are fully used/redeemed or expired.
            if ($status === 'used') {
                $summary[$r->plan_id]['used'] += (int) $r->c;
            }
        }
        $totalsByStatus = ['ready' => 0, 'active' => 0, 'used' => 0, 'disabled' => 0];
        foreach ($summary as &$s) {
            // Unsold stock is the 'ready' count. 'generated' - 'used' would call
            // every card the customer is still using (status 'active') remaining
            // stock, since 'used' only covers the terminal stage.
            $s['remaining'] = (int) ($s['by_status']['ready'] ?? 0);
            // "Sold" = actually handed off to a customer — 'ready' is printed
            // but still sitting in stock (mirrors reseller-summary's stock math).
            $s['sold'] = ($s['by_status']['active'] ?? 0) + ($s['by_status']['used'] ?? 0);
            $s['in_stock'] = max(0, $s['generated'] - $s['sold']);
            foreach ($s['by_status'] as $status => $count) {
                $totalsByStatus[$status] += $count;
            }
        }
        unset($s);

        return $this->ok([
            'packages' => array_values($summary),
            'totals' => [
                'generated' => array_sum(array_column($summary, 'generated')),
                'used' => array_sum(array_column($summary, 'used')),
                'remaining' => array_sum(array_column($summary, 'remaining')),
                'sold' => array_sum(array_column($summary, 'sold')),
                'in_stock' => array_sum(array_column($summary, 'in_stock')),
                'revenue' => array_sum(array_column($summary, 'revenue')),
                'gb_sold' => array_sum(array_column($summary, 'gb_sold')),
                'by_status' => $totalsByStatus,
                'by_package_type' => $byPackageType,
            ],
        ]);
    }

    /**
     * Sales Summary Report: per-account rollup of card generation, cards sold,
     * GB sold and sales amount — feeds the "Sales Summary" tab on Voucher Sales.
     *
     * `group` selects the tier: 'reseller' (default), 'seller', or 'all' for a
     * single list containing both. Scope is unchanged in every mode — an admin
     * sees every account, a reseller sees itself plus its own sellers.
     */
    public function resellerSummary(Request $request): JsonResponse
    {
        $actor = $request->user();

        $requested = $request->query('group');
        $group = in_array($requested, ['seller', 'all'], true) ? $requested : 'reseller';

        $roles = match ($group) {
            'seller' => ['seller'],
            'all' => ['reseller', 'seller'],
            default => ['reseller'],
        };

        if ($actor->isAdmin()) {
            $userQuery = User::query()->whereIn('role', $roles);
        } elseif ($actor->isReseller()) {
            // A reseller is its own reseller-tier row and the parent of its
            // seller-tier rows; it may never see a sibling reseller.
            $userQuery = User::query()->where(function ($q) use ($actor, $roles) {
                if (in_array('reseller', $roles, true)) {
                    $q->orWhere(fn ($x) => $x->whereKey($actor->id));
                }
                if (in_array('seller', $roles, true)) {
                    $q->orWhere(fn ($x) => $x->where('role', 'seller')->where('parent_id', $actor->id));
                }
            });
        } else {
            return $this->ok(['role_label' => null, 'accounts' => [], 'totals' => $this->emptyResellerSummaryTotals()]);
        }

        if ($search = $request->query('search')) {
            $userQuery->where(fn ($q) => $q->where('name', 'like', "%{$search}%")->orWhere('username', 'like', "%{$search}%"));
        }

        // Resellers first, then sellers, each alphabetical — so a combined list
        // reads as two sections rather than interleaving the two tiers.
        $users = $userQuery->get()
            ->sortBy(fn ($u) => ($u->role === 'seller' ? '1' : '0') . mb_strtolower((string) $u->name))
            ->values();

        // The load-bearing detail of the combined list: a reseller's cards hang
        // off vouchers.reseller_id and a seller's off vouchers.seller_id. Keying
        // both tiers off one column would silently report zeros for half the
        // rows, so each tier is aggregated on its own column and matched back to
        // an account by that account's role.
        //
        // In 'all' mode the reseller tier is narrowed to cards it holds directly
        // (seller_id IS NULL). A seller's card carries its parent's reseller_id
        // too, so without this the reseller row would be a rollup *containing*
        // the seller rows listed beneath it and any sum over the list would
        // double-count. The single-tier modes keep their existing meaning: a
        // reseller row there is the whole downline.
        $directResellerCardsOnly = $group === 'all';

        $statsByRole = [
            'reseller' => $this->voucherStatsByAccount(
                'reseller_id',
                $users->where('role', 'reseller')->pluck('id')->all(),
                $directResellerCardsOnly
            ),
            'seller' => $this->voucherStatsByAccount(
                'seller_id',
                $users->where('role', 'seller')->pluck('id')->all()
            ),
        ];

        $accounts = $users->map(function ($u) use ($statsByRole) {
            $s = ($statsByRole[$u->role] ?? collect())->get($u->id);
            $generated = (int) ($s->generated ?? 0);
            $sold = (int) ($s->sold ?? 0);

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'role' => $u->role,
                'cards_generated' => $generated,
                'cards_sold' => $sold,
                'cards_in_stock' => max(0, $generated - $sold),
                'gb_sold' => round((float) ($s->gb_sold ?? 0), 3),
                'sales_amount' => round((float) ($s->sales_amount ?? 0), 2),
            ];
        })->values();

        $totals = [
            'cards_generated' => (int) $accounts->sum('cards_generated'),
            'cards_sold' => (int) $accounts->sum('cards_sold'),
            'cards_in_stock' => (int) $accounts->sum('cards_in_stock'),
            'gb_sold' => round((float) $accounts->sum('gb_sold'), 3),
            'sales_amount' => round((float) $accounts->sum('sales_amount'), 2),
        ];

        return $this->ok(['role_label' => $group, 'accounts' => $accounts, 'totals' => $totals]);
    }

    /**
     * Card generation / sales aggregates for a set of accounts, grouped on one
     * ownership column (`reseller_id` or `seller_id`), keyed by account id.
     *
     * Voucher sales tracking is purely card-based: a card only counts as "sold"
     * (and its GB/price counted toward sales) once it has actually been handed
     * off to a customer — 'ready' cards are printed but still sitting in stock.
     *
     * `$directOnly` excludes cards delegated to a seller, so a reseller row
     * counts only what it holds itself. See the caller for why that matters
     * only when both tiers share one list.
     */
    private function voucherStatsByAccount(string $groupColumn, array $userIds, bool $directOnly = false)
    {
        if (! $userIds) {
            return collect();
        }

        $cardsSoldSet = "'active', 'used'";

        $query = Voucher::query()
            ->whereNull('vouchers.void_reason')
            ->whereIn("vouchers.{$groupColumn}", $userIds);

        if ($directOnly) {
            $query->whereNull('vouchers.seller_id');
        }

        return $query
            ->select(
                "vouchers.{$groupColumn} as uid",
                DB::raw('count(*) as generated'),
                DB::raw("sum(case when vouchers.status in ({$cardsSoldSet}) or vouchers.activated_at is not null then 1 else 0 end) as sold"),
                DB::raw("sum(case when vouchers.status in ({$cardsSoldSet}) or vouchers.activated_at is not null then vouchers.data_gb else 0 end) as gb_sold"),
                DB::raw("sum(case when vouchers.status in ({$cardsSoldSet}) or vouchers.activated_at is not null then vouchers.price else 0 end) as sales_amount")
            )
            ->groupBy("vouchers.{$groupColumn}")
            ->get()
            ->keyBy('uid');
    }

    private function emptyResellerSummaryTotals(): array
    {
        return [
            'cards_generated' => 0, 'cards_sold' => 0, 'cards_in_stock' => 0,
            'gb_sold' => 0, 'sales_amount' => 0,
        ];
    }

    /**
     * Base voucher query scoped to the actor + shared report filters.
     *
     * Every column here is table-qualified on purpose: packageSummary joins
     * internet_plans, which shares `status`, `created_at`, `data_gb` and others
     * with vouchers. An unqualified predicate makes MySQL raise "Column ... is
     * ambiguous" (SQLSTATE 1052) the moment a status/date/season filter is used.
     */
    private function scoped(Request $request)
    {
        $actor = $request->user();
        // Rows the original legacy import should never have created. They stay
        // in the table for audit but are not vouchers, so no report, tile or
        // listing built on this scope may see them.
        $q = Voucher::query()->whereNull('vouchers.void_reason');

        if ($actor->isReseller()) {
            $q->where('vouchers.reseller_id', $actor->id);
        } elseif ($actor->isSeller()) {
            $q->where('vouchers.seller_id', $actor->id);
        }

        if ($p = $request->query('plan_id')) {
            $q->where('vouchers.plan_id', $p);
        }
        if ($s = $request->query('status')) {
            $q->where('vouchers.status', $s);
        }
        if (($rid = $request->query('reseller_id')) && $actor->isAdmin()) {
            $q->where('vouchers.reseller_id', $rid);
        }
        // 'own' / 'all' / an id — see VoucherController@index for the three views.
        if ($sid = $request->query('seller_id')) {
            if ($sid === 'own') {
                $q->whereNull('vouchers.seller_id');
                if ($actor->isAdmin()) {
                    $q->whereNull('vouchers.reseller_id');
                }
            } elseif ($sid === 'all') {
                $q->whereNotNull('vouchers.seller_id');
            } else {
                $q->where('vouchers.seller_id', $sid);
            }
        }
        if ($code = $request->query('code')) {
            $q->where('vouchers.code', 'like', "%$code%");
        }
        if ($batch = $request->query('batch')) {
            $q->whereHas('batch', fn ($x) => $x->where('batch_code', 'like', "%$batch%"));
        }
        if ($cu = $request->query('customer_username')) {
            $q->where('vouchers.customer_username', 'like', "%$cu%");
        }
        if ($from = $request->query('from')) {
            $q->whereDate('vouchers.created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $q->whereDate('vouchers.created_at', '<=', $to);
        }
        if ($seasonId = $request->query('season_id')) {
            $season = \App\Models\Season::find($seasonId);
            if ($season) {
                $sm = $season->start_month;
                $sd = $season->start_day;
                $em = $season->end_month;
                $ed = $season->end_day;

                $q->where(function ($query) use ($sm, $sd, $em, $ed) {
                    if ($sm < $em || ($sm === $em && $sd <= $ed)) {
                        $query->whereRaw("
                            (MONTH(vouchers.created_at) > ? OR (MONTH(vouchers.created_at) = ? AND DAY(vouchers.created_at) >= ?))
                            AND
                            (MONTH(vouchers.created_at) < ? OR (MONTH(vouchers.created_at) = ? AND DAY(vouchers.created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    } else {
                        $query->whereRaw("
                            (MONTH(vouchers.created_at) > ? OR (MONTH(vouchers.created_at) = ? AND DAY(vouchers.created_at) >= ?))
                            OR
                            (MONTH(vouchers.created_at) < ? OR (MONTH(vouchers.created_at) = ? AND DAY(vouchers.created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    }
                });
            }
        }

        return $q;
    }

    /**
     * PPPoE Sales Summary: new subscriber registrations and prepaid recharges
     * over a date range, with a per-plan breakdown of each.
     *
     * Vouchers are deliberately absent. This report used to combine both sides
     * of the business, but the voucher half is covered in full by the Sales
     * Summary tab on Voucher Sales (resellerSummary / packageSummary), and
     * building it here meant loading every matching voucher row to produce a
     * breakdown the page no longer rendered — against a table that is six
     * figures deep in production.
     *
     * The route sits inside the role:admin,reseller PPPoE group, so a seller
     * never reaches this method.
     */
    public function pppoeSalesSummary(Request $request): JsonResponse
    {
        $actor = $request->user();
        $from = $request->query('from');
        $to = $request->query('to');
        $resellerId = $request->query('reseller_id');

        // A reseller sees only its own subscribers — matched on either column
        // because a subscriber registered *by* a reseller and one *assigned* to
        // it are both theirs. An admin may narrow to one reseller.
        $scope = function ($query) use ($actor, $resellerId) {
            if ($actor->isReseller()) {
                $query->where(function ($q) use ($actor) {
                    $q->where('pc.reseller_id', $actor->id)
                      ->orWhere('pc.owner_id', $actor->id);
                });
            } elseif ($resellerId) {
                $query->where('pc.reseller_id', $resellerId);
            }

            return $query;
        };

        // New subscribers query for per-plan summary
        $newSubQuery = $scope(
            DB::table('pppoe_customers as pc')->join('internet_plans as p', 'p.id', '=', 'pc.plan_id')
        );
        if ($from) {
            $newSubQuery->whereDate('pc.created_at', '>=', $from);
        }
        if ($to) {
            $newSubQuery->whereDate('pc.created_at', '<=', $to);
        }

        $newSubRows = $newSubQuery
            ->select(
                'p.id as plan_id',
                'p.name as plan_name',
                DB::raw('count(*) as count'),
                DB::raw('sum(COALESCE(pc.contract_price, p.selling_price, 0)) as revenue')
            )
            ->groupBy('p.id', 'p.name')
            ->orderBy('p.name')
            ->get();

        // Recharges query for per-plan summary
        $rechargeQuery = $scope(
            DB::table('pppoe_recharges as pr')
                ->join('pppoe_customers as pc', 'pc.id', '=', 'pr.customer_id')
                ->join('internet_plans as p', 'p.id', '=', 'pr.plan_id')
        );
        if ($from) {
            $rechargeQuery->whereDate('pr.created_at', '>=', $from);
        }
        if ($to) {
            $rechargeQuery->whereDate('pr.created_at', '<=', $to);
        }

        $rechargeRows = $rechargeQuery
            ->select(
                'p.id as plan_id',
                'p.name as plan_name',
                DB::raw('count(*) as count'),
                DB::raw('sum(pr.price) as revenue')
            )
            ->groupBy('p.id', 'p.name')
            ->orderBy('p.name')
            ->get();

        // Detailed new subscribers with created_by
        $newSubDetailQuery = $scope(
            DB::table('pppoe_customers as pc')
                ->join('internet_plans as p', 'p.id', '=', 'pc.plan_id')
                ->join('users as u_owner', 'u_owner.id', '=', 'pc.owner_id')
                ->leftJoin('users as u_reseller', 'u_reseller.id', '=', 'pc.reseller_id')
        );
        if ($from) {
            $newSubDetailQuery->whereDate('pc.created_at', '>=', $from);
        }
        if ($to) {
            $newSubDetailQuery->whereDate('pc.created_at', '<=', $to);
        }

        $newSubscribersList = $newSubDetailQuery
            ->select(
                'pc.id',
                'pc.full_name as subscriber_name',
                'pc.username',
                'pc.customer_code',
                'p.name as plan_name',
                DB::raw('COALESCE(pc.contract_price, p.selling_price, 0) as revenue'),
                DB::raw("COALESCE(NULLIF(u_reseller.name, ''), u_reseller.username, NULLIF(u_owner.name, ''), u_owner.username, 'System') as created_by"),
                'pc.created_at'
            )
            ->orderByDesc('pc.created_at')
            ->get()
            ->map(fn ($r) => [
                'id' => $r->id,
                'subscriber_name' => $r->subscriber_name ?: $r->username,
                'username' => $r->username,
                'customer_code' => $r->customer_code,
                'plan_name' => $r->plan_name,
                'revenue' => round((float) $r->revenue, 2),
                'created_by' => $r->created_by,
                'created_at' => (string) $r->created_at,
            ])
            ->values();

        // Detailed recharges with recharged_by
        $rechargeDetailQuery = $scope(
            DB::table('pppoe_recharges as pr')
                ->join('pppoe_customers as pc', 'pc.id', '=', 'pr.customer_id')
                ->join('internet_plans as p', 'p.id', '=', 'pr.plan_id')
                ->leftJoin('users as u_collector', 'u_collector.id', '=', 'pr.collected_by')
                ->leftJoin('users as u_reseller', 'u_reseller.id', '=', 'pr.reseller_id')
                ->leftJoin('users as u_owner', 'u_owner.id', '=', 'pr.owner_id')
        );
        if ($from) {
            $rechargeDetailQuery->whereDate('pr.created_at', '>=', $from);
        }
        if ($to) {
            $rechargeDetailQuery->whereDate('pr.created_at', '<=', $to);
        }

        $rechargesList = $rechargeDetailQuery
            ->select(
                'pr.id',
                'pc.full_name as subscriber_name',
                'pc.username',
                'pc.customer_code',
                'p.name as plan_name',
                'pr.price as revenue',
                DB::raw("COALESCE(NULLIF(u_collector.name, ''), u_collector.username, NULLIF(u_reseller.name, ''), u_reseller.username, NULLIF(u_owner.name, ''), u_owner.username, 'System') as recharged_by"),
                'pr.created_at'
            )
            ->orderByDesc('pr.created_at')
            ->get()
            ->map(fn ($r) => [
                'id' => $r->id,
                'subscriber_name' => $r->subscriber_name ?: $r->username,
                'username' => $r->username,
                'customer_code' => $r->customer_code,
                'plan_name' => $r->plan_name,
                'revenue' => round((float) $r->revenue, 2),
                'recharged_by' => $r->recharged_by,
                'created_at' => (string) $r->created_at,
            ])
            ->values();

        // Calculate Daily Trend
        $trendMap = [];

        if ($from && $to) {
            try {
                $current = \Carbon\Carbon::parse($from);
                $end = \Carbon\Carbon::parse($to);
                while ($current->lte($end)) {
                    $d = $current->toDateString();
                    $trendMap[$d] = [
                        'date' => $d,
                        'new_subscribers_count' => 0,
                        'new_subscribers_revenue' => 0.0,
                        'recharges_count' => 0,
                        'recharges_revenue' => 0.0,
                    ];
                    $current->addDay();
                }
            } catch (\Throwable $e) {
                $trendMap = [];
            }
        }

        foreach ($newSubscribersList as $item) {
            $d = substr($item['created_at'], 0, 10);
            if (!isset($trendMap[$d])) {
                $trendMap[$d] = [
                    'date' => $d,
                    'new_subscribers_count' => 0,
                    'new_subscribers_revenue' => 0.0,
                    'recharges_count' => 0,
                    'recharges_revenue' => 0.0,
                ];
            }
            $trendMap[$d]['new_subscribers_count']++;
            $trendMap[$d]['new_subscribers_revenue'] += $item['revenue'];
        }

        foreach ($rechargesList as $item) {
            $d = substr($item['created_at'], 0, 10);
            if (!isset($trendMap[$d])) {
                $trendMap[$d] = [
                    'date' => $d,
                    'new_subscribers_count' => 0,
                    'new_subscribers_revenue' => 0.0,
                    'recharges_count' => 0,
                    'recharges_revenue' => 0.0,
                ];
            }
            $trendMap[$d]['recharges_count']++;
            $trendMap[$d]['recharges_revenue'] += $item['revenue'];
        }

        ksort($trendMap);

        $dailyTrend = array_values(array_map(function ($item) {
            $item['new_subscribers_revenue'] = round($item['new_subscribers_revenue'], 2);
            $item['recharges_revenue'] = round($item['recharges_revenue'], 2);
            return $item;
        }, $trendMap));

        // Calculate Performer Breakdown
        $performerMap = [];

        foreach ($newSubscribersList as $item) {
            $p = $item['created_by'];
            if (!isset($performerMap[$p])) {
                $performerMap[$p] = [
                    'performer' => $p,
                    'created_count' => 0,
                    'created_revenue' => 0.0,
                    'recharged_count' => 0,
                    'recharged_revenue' => 0.0,
                    'total_revenue' => 0.0,
                ];
            }
            $performerMap[$p]['created_count']++;
            $performerMap[$p]['created_revenue'] += $item['revenue'];
            $performerMap[$p]['total_revenue'] += $item['revenue'];
        }

        foreach ($rechargesList as $item) {
            $p = $item['recharged_by'];
            if (!isset($performerMap[$p])) {
                $performerMap[$p] = [
                    'performer' => $p,
                    'created_count' => 0,
                    'created_revenue' => 0.0,
                    'recharged_count' => 0,
                    'recharged_revenue' => 0.0,
                    'total_revenue' => 0.0,
                ];
            }
            $performerMap[$p]['recharged_count']++;
            $performerMap[$p]['recharged_revenue'] += $item['revenue'];
            $performerMap[$p]['total_revenue'] += $item['revenue'];
        }

        usort($performerMap, fn ($a, $b) => $b['total_revenue'] <=> $a['total_revenue']);

        $performerBreakdown = array_values(array_map(function ($item) {
            $item['created_revenue'] = round($item['created_revenue'], 2);
            $item['recharged_revenue'] = round($item['recharged_revenue'], 2);
            $item['total_revenue'] = round($item['total_revenue'], 2);
            return $item;
        }, $performerMap));

        $shape = fn ($rows) => $rows->map(fn ($r) => [
            'plan_id' => $r->plan_id,
            'plan_name' => $r->plan_name,
            'count' => (int) $r->count,
            'revenue' => round((float) $r->revenue, 2),
        ])->values();

        $newSubPlans = $shape($newSubRows);
        $rechargePlans = $shape($rechargeRows);

        $newSubRevenue = (float) $newSubPlans->sum('revenue');
        $rechargeRevenue = (float) $rechargePlans->sum('revenue');

        return $this->ok([
            'summary' => [
                'total_revenue' => round($newSubRevenue + $rechargeRevenue, 2),
                'new_subscribers' => [
                    'count' => (int) $newSubPlans->sum('count'),
                    'revenue' => round($newSubRevenue, 2),
                ],
                'recharges' => [
                    'count' => (int) $rechargePlans->sum('count'),
                    'revenue' => round($rechargeRevenue, 2),
                ],
            ],
            'new_subscriber_plans' => $newSubPlans,
            'recharge_plans' => $rechargePlans,
            'new_subscribers' => $newSubscribersList,
            'recharges' => $rechargesList,
            'daily_trend' => $dailyTrend,
            'performer_breakdown' => $performerBreakdown,
        ]);
    }
}
