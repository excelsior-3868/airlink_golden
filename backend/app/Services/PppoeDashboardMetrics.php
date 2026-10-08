<?php

namespace App\Services;

use App\Models\User;
use App\Services\Radius\OnlineSession;
use Illuminate\Support\Facades\DB;

/**
 * Operational PPPoE figures for the dashboard: live sessions, expiries, revenue,
 * growth, commission split, a 7-day trend, plan mix, top resellers and the
 * latest recharges. Admins see the whole system; a reseller sees only the
 * subscribers and recharges it owns (owner_id or reseller_id, the same rule
 * PppoeCustomerController::scopedQuery uses).
 *
 * "Today" and "this month" are Nepal-local, while every timestamp is stored UTC.
 */
class PppoeDashboardMetrics
{
    private const TZ = 'Asia/Kathmandu';
    private const TREND_DAYS = 7;
    private const EXPIRING_WITHIN_DAYS = 7;

    public function for(User $actor): array
    {
        $scopeCustomers = fn ($q, string $p = 'pppoe_customers') => $this->scope($q, $actor, $p);
        $scopeRecharges = fn ($q, string $p = 'pppoe_recharges') => $this->scope($q, $actor, $p);

        $todayStart = now(self::TZ)->startOfDay()->utc();
        $monthStart = now(self::TZ)->startOfMonth()->utc();

        $revenue = fn ($since) => $scopeRecharges(DB::table('pppoe_recharges'))
            ->where('created_at', '>=', $since->toDateTimeString())
            ->selectRaw('COUNT(*) as n, COALESCE(SUM(price),0) as revenue, COALESCE(SUM(CASE WHEN reseller_id IS NULL THEN price ELSE admin_share END),0) as admin_share, COALESCE(SUM(CASE WHEN reseller_id IS NULL THEN 0 ELSE reseller_share END),0) as reseller_share')
            ->first();
        $today = $revenue($todayStart);
        $month = $revenue($monthStart);

        $newSince = fn ($since) => (int) $scopeCustomers(DB::table('pppoe_customers'))
            ->where('created_at', '>=', $since->toDateTimeString())
            ->count();

        $metrics = [
            'online_now' => $this->onlineNow($actor),
            'revenue' => [
                'today' => round((float) $today->revenue, 2),
                'month' => round((float) $month->revenue, 2),
                'recharges_today' => (int) $today->n,
                'recharges_month' => (int) $month->n,
            ],
            'new_subscribers' => [
                'today' => $newSince($todayStart),
                'month' => $newSince($monthStart),
            ],
            // For an admin, admin_share is commission earned; for a reseller it is
            // the cut handed to the admin and reseller_share is what it keeps.
            'commission' => [
                'admin_share_today' => round((float) $today->admin_share, 2),
                'admin_share_month' => round((float) $month->admin_share, 2),
                'reseller_share_month' => round((float) $month->reseller_share, 2),
            ],
            'expiring_soon' => $this->expiringSoon($scopeCustomers),
            'daily_trend' => $this->dailyTrend($scopeCustomers, $scopeRecharges),
            'plan_distribution' => $this->planDistribution($scopeCustomers),
            'recent_recharges' => $this->recentRecharges($scopeRecharges),
        ];

        if ($actor->isAdmin()) {
            $metrics['top_resellers'] = $this->topResellers($monthStart);
        }

        return $metrics;
    }

    /** Limit a customers/recharges query to what a reseller owns; admins are unscoped. */
    private function scope($query, User $actor, string $table)
    {
        if ($actor->isReseller()) {
            $query->where(fn ($q) => $q->where("$table.owner_id", $actor->id)->orWhere("$table.reseller_id", $actor->id));
        }

        return $query;
    }

    private function onlineNow(User $actor): int
    {
        $q = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username');

        return (int) $this->scope($q, $actor, 'pppoe_customers')->distinct()->count('radacct.username');
    }

    private function expiringSoon(callable $scopeCustomers): array
    {
        $base = fn () => $scopeCustomers(DB::table('pppoe_customers as pc'), 'pc')
            ->where('pc.status', 'active')
            ->whereNotNull('pc.expires_at')
            ->where('pc.expires_at', '>=', now()->toDateTimeString())
            ->where('pc.expires_at', '<=', now()->addDays(self::EXPIRING_WITHIN_DAYS)->toDateTimeString());

        $items = $base()
            ->join('internet_plans as p', 'p.id', '=', 'pc.plan_id')
            ->orderBy('pc.expires_at')
            ->limit(8)
            ->get(['pc.id', 'pc.username', 'pc.full_name', 'pc.phone', 'pc.expires_at', 'p.name as plan_name'])
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'username' => $r->username,
                'full_name' => $r->full_name,
                'phone' => $r->phone,
                'plan_name' => $r->plan_name,
                'expires_at' => $r->expires_at,
            ])->all();

        return [
            'within_days' => self::EXPIRING_WITHIN_DAYS,
            'count' => (int) $base()->count(),
            'items' => $items,
        ];
    }

    private function dailyTrend(callable $scopeCustomers, callable $scopeRecharges): array
    {
        $startLocal = now(self::TZ)->startOfDay()->subDays(self::TREND_DAYS - 1);
        $since = (clone $startLocal)->utc()->toDateTimeString();
        $offset = $startLocal->format('P');
        $dayExpr = "DATE(CONVERT_TZ(created_at, '+00:00', ?))";

        $sales = $scopeRecharges(DB::table('pppoe_recharges'))
            ->where('created_at', '>=', $since)
            ->selectRaw("$dayExpr as day, COUNT(*) as n, COALESCE(SUM(price),0) as revenue", [$offset])
            ->groupBy('day')->get()->keyBy('day');

        $joined = $scopeCustomers(DB::table('pppoe_customers'))
            ->where('created_at', '>=', $since)
            ->selectRaw("$dayExpr as day, COUNT(*) as n", [$offset])
            ->groupBy('day')->get()->keyBy('day');

        $trend = [];
        for ($i = 0; $i < self::TREND_DAYS; $i++) {
            $key = (clone $startLocal)->addDays($i)->toDateString();
            $trend[] = [
                'date' => $key,
                'revenue' => round((float) ($sales->get($key)->revenue ?? 0), 2),
                'recharges' => (int) ($sales->get($key)->n ?? 0),
                'new_subscribers' => (int) ($joined->get($key)->n ?? 0),
            ];
        }

        return $trend;
    }

    private function planDistribution(callable $scopeCustomers): array
    {
        return $scopeCustomers(DB::table('pppoe_customers as pc'), 'pc')
            ->join('internet_plans as p', 'p.id', '=', 'pc.plan_id')
            ->whereNotIn('pc.status', ['terminated'])
            ->groupBy('p.id', 'p.name')
            ->orderByDesc('subscribers')
            ->limit(6)
            ->get(['p.name as plan_name', DB::raw('COUNT(*) as subscribers')])
            ->map(fn ($r) => ['plan_name' => $r->plan_name, 'subscribers' => (int) $r->subscribers])
            ->all();
    }

    private function recentRecharges(callable $scopeRecharges): array
    {
        return $scopeRecharges(DB::table('pppoe_recharges as pr'), 'pr')
            ->join('pppoe_customers as pc', 'pc.id', '=', 'pr.customer_id')
            ->join('internet_plans as p', 'p.id', '=', 'pr.plan_id')
            ->leftJoin('users as u', 'u.id', '=', 'pr.reseller_id')
            ->orderByDesc('pr.created_at')
            ->limit(8)
            ->get([
                'pr.id', 'pr.reference', 'pr.price', 'pr.created_at', 'pc.username', 'pc.full_name',
                'p.name as plan_name', DB::raw("COALESCE(NULLIF(u.name, ''), u.username) as reseller_name"),
            ])
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'reference' => $r->reference,
                'username' => $r->username,
                'subscriber_name' => $r->full_name ?: $r->username,
                'plan_name' => $r->plan_name,
                'price' => round((float) $r->price, 2),
                'reseller_name' => $r->reseller_name,
                'created_at' => $r->created_at,
            ])->all();
    }

    private function topResellers($monthStart): array
    {
        return DB::table('pppoe_recharges as pr')
            ->join('users as u', 'u.id', '=', 'pr.reseller_id')
            ->where('pr.created_at', '>=', $monthStart->toDateTimeString())
            ->groupBy('pr.reseller_id', 'u.name', 'u.username')
            ->orderByDesc('revenue')
            ->limit(5)
            ->get([
                'pr.reseller_id',
                DB::raw("COALESCE(NULLIF(u.name, ''), u.username) as reseller_name"),
                DB::raw('COUNT(*) as recharges'),
                DB::raw('COALESCE(SUM(pr.price),0) as revenue'),
                DB::raw('COALESCE(SUM(pr.admin_share),0) as admin_share'),
            ])
            ->map(fn ($r) => [
                'reseller_id' => (int) $r->reseller_id,
                'reseller_name' => $r->reseller_name,
                'recharges' => (int) $r->recharges,
                'revenue' => round((float) $r->revenue, 2),
                'admin_share' => round((float) $r->admin_share, 2),
            ])->all();
    }
}
