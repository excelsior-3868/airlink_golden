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
            ->select('p.id as plan_id', 'p.name as plan', 'vouchers.status', DB::raw('count(*) as c'), DB::raw('sum(vouchers.price) as revenue'), DB::raw('sum(vouchers.data_gb) as gb'))
            ->groupBy('p.id', 'p.name', 'vouchers.status')
            ->get();

        $summary = [];
        foreach ($rows as $r) {
            $summary[$r->plan_id] ??= [
                'plan_id' => $r->plan_id, 'plan' => $r->plan,
                'generated' => 0, 'used' => 0, 'remaining' => 0, 'revenue' => 0, 'gb_sold' => 0,
                'by_status' => ['new' => 0, 'sold' => 0, 'active' => 0, 'used' => 0, 'expired' => 0, 'disabled' => 0],
            ];
            $summary[$r->plan_id]['generated'] += (int) $r->c;
            $summary[$r->plan_id]['by_status'][$r->status] = (int) $r->c;
            if (in_array($r->status, ['sold', 'active', 'used', 'expired'], true)) {
                $summary[$r->plan_id]['revenue'] += (float) $r->revenue;
                $summary[$r->plan_id]['gb_sold'] += (float) $r->gb;
            }
            // "Used" = vouchers that are fully used/redeemed or expired.
            if (in_array($r->status, ['used', 'expired'], true)) {
                $summary[$r->plan_id]['used'] += (int) $r->c;
            }
        }
        $totalsByStatus = ['new' => 0, 'sold' => 0, 'active' => 0, 'used' => 0, 'expired' => 0, 'disabled' => 0];
        foreach ($summary as &$s) {
            $s['remaining'] = $s['generated'] - $s['used'];
            // "Sold" = handed off to a customer in any downstream state (mirrors reseller-summary's stock math).
            $s['sold'] = $s['by_status']['sold'] + $s['by_status']['active'] + $s['by_status']['used'] + $s['by_status']['expired'];
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
            ],
        ]);
    }

    /**
     * Sales Summary Report: per-account (reseller, or seller under a reseller)
     * rollup of wallet balance, card generation/sales, GB sold, and dues —
     * feeds the "Sales Summary" tab on the Voucher Sales page. Admin sees
     * their resellers; a reseller sees their own sellers.
     */
    public function resellerSummary(Request $request): JsonResponse
    {
        $actor = $request->user();

        if ($actor->isAdmin()) {
            $userQuery = User::query()->where('role', 'reseller');
            $groupColumn = 'reseller_id';
            $roleLabel = 'reseller';
        } elseif ($actor->isReseller()) {
            $userQuery = User::query()->where('role', 'seller')->where('parent_id', $actor->id);
            $groupColumn = 'seller_id';
            $roleLabel = 'seller';
        } else {
            return $this->ok(['role_label' => null, 'accounts' => [], 'totals' => $this->emptyResellerSummaryTotals()]);
        }

        if ($search = $request->query('search')) {
            $userQuery->where(fn ($q) => $q->where('name', 'like', "%{$search}%")->orWhere('username', 'like', "%{$search}%"));
        }

        $users = $userQuery->orderBy('name')->get();
        $userIds = $users->pluck('id')->all();

        $soldSet = "'sold', 'active', 'used', 'expired'";
        $voucherStats = Voucher::query()
            ->whereIn($groupColumn, $userIds)
            ->select(
                "{$groupColumn} as uid",
                DB::raw('count(*) as generated'),
                DB::raw("sum(case when status in ({$soldSet}) then 1 else 0 end) as sold"),
                DB::raw("sum(case when status in ({$soldSet}) then data_gb else 0 end) as gb_sold"),
                DB::raw("sum(case when status in ({$soldSet}) then price else 0 end) as sales_amount")
            )
            ->groupBy($groupColumn)
            ->get()
            ->keyBy('uid');

        $accounts = $users->map(function ($u) use ($voucherStats) {
            $s = $voucherStats->get($u->id);
            $generated = (int) ($s->generated ?? 0);
            $sold = (int) ($s->sold ?? 0);
            $salesAmount = round((float) ($s->sales_amount ?? 0), 2);
            $due = round((float) $u->wallet_due, 2);

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'role' => $u->role,
                'wallet_balance' => round((float) $u->wallet_balance, 2),
                'cards_generated' => $generated,
                'cards_sold' => $sold,
                'cards_in_stock' => max(0, $generated - $sold),
                'gb_sold' => round((float) ($s->gb_sold ?? 0), 3),
                'sales_amount' => $salesAmount,
                'amount_collected' => round(max(0.0, $salesAmount - $due), 2),
                'amount_due' => $due,
            ];
        })->values();

        $totals = [
            'wallet_balance' => round((float) $accounts->sum('wallet_balance'), 2),
            'cards_generated' => (int) $accounts->sum('cards_generated'),
            'cards_sold' => (int) $accounts->sum('cards_sold'),
            'cards_in_stock' => (int) $accounts->sum('cards_in_stock'),
            'gb_sold' => round((float) $accounts->sum('gb_sold'), 3),
            'sales_amount' => round((float) $accounts->sum('sales_amount'), 2),
            'amount_collected' => round((float) $accounts->sum('amount_collected'), 2),
            'amount_due' => round((float) $accounts->sum('amount_due'), 2),
        ];

        return $this->ok(['role_label' => $roleLabel, 'accounts' => $accounts, 'totals' => $totals]);
    }

    private function emptyResellerSummaryTotals(): array
    {
        return [
            'wallet_balance' => 0, 'cards_generated' => 0, 'cards_sold' => 0, 'cards_in_stock' => 0,
            'gb_sold' => 0, 'sales_amount' => 0, 'amount_collected' => 0, 'amount_due' => 0,
        ];
    }

    /** Base voucher query scoped to the actor + shared report filters. */
    private function scoped(Request $request)
    {
        $actor = $request->user();
        $q = Voucher::query();

        if ($actor->isReseller()) {
            $q->where('reseller_id', $actor->id);
        } elseif ($actor->isSeller()) {
            $q->where('seller_id', $actor->id);
        }

        if ($p = $request->query('plan_id')) {
            $q->where('plan_id', $p);
        }
        if ($s = $request->query('status')) {
            $q->where('status', $s);
        }
        if (($rid = $request->query('reseller_id')) && $actor->isAdmin()) {
            $q->where('reseller_id', $rid);
        }
        if ($sid = $request->query('seller_id')) {
            $q->where('seller_id', $sid);
        }
        if ($code = $request->query('code')) {
            $q->where('code', 'like', "%$code%");
        }
        if ($batch = $request->query('batch')) {
            $q->whereHas('batch', fn ($x) => $x->where('batch_code', 'like', "%$batch%"));
        }
        if ($cu = $request->query('customer_username')) {
            $q->where('customer_username', 'like', "%$cu%");
        }
        if ($from = $request->query('from')) {
            $q->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $q->whereDate('created_at', '<=', $to);
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
                            (MONTH(created_at) > ? OR (MONTH(created_at) = ? AND DAY(created_at) >= ?))
                            AND
                            (MONTH(created_at) < ? OR (MONTH(created_at) = ? AND DAY(created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    } else {
                        $query->whereRaw("
                            (MONTH(created_at) > ? OR (MONTH(created_at) = ? AND DAY(created_at) >= ?))
                            OR
                            (MONTH(created_at) < ? OR (MONTH(created_at) = ? AND DAY(created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    }
                });
            }
        }

        return $q;
    }
}
