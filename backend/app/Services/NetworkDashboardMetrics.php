<?php

namespace App\Services;

use App\Models\User;
use App\Services\Radius\OnlineSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Network and subscriber figures for the dashboard — nothing financial.
 *
 * Subscriber numbers come from pppoe_customers / radacct. Network numbers come
 * from the NMS tables (devices, interfaces, metrics, alerts, ont_inventory),
 * which live in this same database, so no call to the NMS service is needed.
 *
 * Admins see everything. A reseller (or seller, who in practice has none) sees the subscribers it owns (owner_id or
 * reseller_id, the rule PppoeCustomerController::scopedQuery uses) and the
 * network gear it has been assigned through olt_resellers: those OLTs, the
 * ONTs registered to it, and alerts and interface traffic on those OLTs.
 *
 * "Today" is Nepal-local while timestamps are stored UTC.
 */
class NetworkDashboardMetrics
{
    private const TZ = 'Asia/Kathmandu';
    private const TREND_DAYS = 7;
    private const EXPIRING_WITHIN_DAYS = 7;
    private const TRAFFIC_HOURS = 24;
    private const TRAFFIC_BUCKET_SECONDS = 1800;
    /** An ONT receiving worse than this is close to losing signal. */
    private const WEAK_RX_DBM = -27.0;

    public function for(User $actor): array
    {
        $scopeCustomers = fn ($q, string $p = 'pppoe_customers') => $this->scopeCustomers($q, $actor, $p);

        $todayStart = now(self::TZ)->startOfDay()->utc();
        $monthStart = now(self::TZ)->startOfMonth()->utc();
        $newSince = fn ($since) => (int) $scopeCustomers(DB::table('pppoe_customers'))
            ->where('created_at', '>=', $since->toDateTimeString())
            ->count();

        // Counts only — how many renewals happened, never what they were worth.
        $rechargesSince = fn ($since) => (int) $this->renewals($scopeCustomers(DB::table('pppoe_recharges'), 'pppoe_recharges'))
            ->where('pppoe_recharges.created_at', '>=', $since->toDateTimeString())
            ->count();

        $metrics = [
            'subscribers' => $this->subscriberBreakdown($scopeCustomers),
            'online_now' => $this->onlineNow($scopeCustomers),
            'new_subscribers' => ['today' => $newSince($todayStart), 'month' => $newSince($monthStart)],
            'recharges' => ['today' => $rechargesSince($todayStart), 'month' => $rechargesSince($monthStart)],
            'expiring_soon' => $this->expiringSoon($scopeCustomers),
            'daily_trend' => $this->dailyTrend($scopeCustomers),
            'plan_distribution' => $this->planDistribution($scopeCustomers),
            'sessions_by_nas' => $this->sessionsByNas($scopeCustomers),
            'data_usage' => $this->dataUsage($scopeCustomers),
            'top_consumers' => $this->topConsumers($scopeCustomers),
            'network' => $this->network($actor),
        ];

        if ($actor->isAdmin()) {
            $metrics['top_resellers'] = $this->topResellers($monthStart);
        }

        return $metrics;
    }

    /**
     * Keep only renewals: a customer's first recharge is their activation and is
     * already counted as a new subscriber.
     */
    private function renewals($query)
    {
        return $query->whereRaw('pppoe_recharges.id > (SELECT MIN(f.id) FROM pppoe_recharges f WHERE f.customer_id = pppoe_recharges.customer_id)');
    }

    /** Limit a customers query to what a reseller owns; admins are unscoped. */
    private function scopeCustomers($query, User $actor, string $table)
    {
        if ($actor->isSeller()) {
            // Sellers are barred from PPPoE (PppoeCustomerController::scopedQuery).
            $query->whereRaw('1 = 0');
        } elseif ($actor->isReseller()) {
            $query->where(fn ($q) => $q->where("$table.owner_id", $actor->id)->orWhere("$table.reseller_id", $actor->id));
        }

        return $query;
    }

    /** Resellers ranked by subscribers owned — size of base and live activity, no money. */
    private function topResellers($monthStart): array
    {
        $online = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers as oc', 'oc.username', '=', 'radacct.username')
            ->whereNotNull('oc.reseller_id')
            ->groupBy('oc.reseller_id')
            ->selectRaw('oc.reseller_id, COUNT(DISTINCT radacct.username) as online');

        return DB::table('pppoe_customers as pc')
            ->join('users as u', 'u.id', '=', 'pc.reseller_id')
            ->leftJoinSub($online, 'ol', 'ol.reseller_id', '=', 'pc.reseller_id')
            ->groupBy('pc.reseller_id', 'u.name', 'u.username', 'ol.online')
            ->orderByDesc('subscribers')
            ->limit(5)
            ->get([
                'pc.reseller_id',
                DB::raw("COALESCE(NULLIF(u.name, ''), u.username) as reseller_name"),
                DB::raw('COUNT(*) as subscribers'),
                DB::raw("COALESCE(SUM(pc.status = 'active'),0) as active"),
                DB::raw("COALESCE(SUM(pc.created_at >= '{$monthStart->toDateTimeString()}'),0) as new_this_month"),
                DB::raw('COALESCE(ol.online,0) as online'),
            ])
            ->map(fn ($r) => [
                'reseller_id' => (int) $r->reseller_id,
                'reseller_name' => $r->reseller_name,
                'subscribers' => (int) $r->subscribers,
                'active' => (int) $r->active,
                'online' => (int) $r->online,
                'new_this_month' => (int) $r->new_this_month,
            ])->all();
    }

    private function subscriberBreakdown(callable $scopeCustomers): array
    {
        $byStatus = $scopeCustomers(DB::table('pppoe_customers'))
            ->select('status', DB::raw('COUNT(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        return [
            'total' => (int) $byStatus->sum(),
            'active' => (int) ($byStatus['active'] ?? 0),
            'expired' => (int) ($byStatus['expired'] ?? 0),
            'suspended' => (int) ($byStatus['suspended'] ?? 0),
            'pending' => (int) ($byStatus['pending'] ?? 0),
        ];
    }

    private function onlineNow(callable $scopeCustomers): int
    {
        $q = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username');

        return (int) $scopeCustomers($q)->distinct()->count('radacct.username');
    }

    private function expiringSoon(callable $scopeCustomers): array
    {
        $count = $scopeCustomers(DB::table('pppoe_customers as pc'), 'pc')
            ->where('pc.status', 'active')
            ->whereNotNull('pc.expires_at')
            ->where('pc.expires_at', '>=', now()->toDateTimeString())
            ->where('pc.expires_at', '<=', now()->addDays(self::EXPIRING_WITHIN_DAYS)->toDateTimeString())
            ->count();

        return ['within_days' => self::EXPIRING_WITHIN_DAYS, 'count' => (int) $count];
    }

    /** New subscribers, lapsed subscribers and renewal counts per Nepal-local day. */
    private function dailyTrend(callable $scopeCustomers): array
    {
        $startLocal = now(self::TZ)->startOfDay()->subDays(self::TREND_DAYS - 1);
        $since = (clone $startLocal)->utc()->toDateTimeString();
        $offset = $startLocal->format('P');
        $day = fn (string $col) => "DATE(CONVERT_TZ($col, '+00:00', ?))";

        $joined = $scopeCustomers(DB::table('pppoe_customers'))
            ->where('created_at', '>=', $since)
            ->selectRaw($day('created_at').' as day, COUNT(*) as n', [$offset])
            ->groupBy('day')->get()->keyBy('day');

        $lapsed = $scopeCustomers(DB::table('pppoe_customers'))
            ->whereNotNull('expires_at')
            ->where('expires_at', '>=', $since)
            ->where('expires_at', '<=', now()->toDateTimeString())
            ->where('status', '<>', 'active')
            ->selectRaw($day('expires_at').' as day, COUNT(*) as n', [$offset])
            ->groupBy('day')->get()->keyBy('day');

        // Count of recharges only — no amounts.
        $recharged = $this->renewals($scopeCustomers(DB::table('pppoe_recharges'), 'pppoe_recharges'))
            ->where('pppoe_recharges.created_at', '>=', $since)
            ->selectRaw($day('pppoe_recharges.created_at').' as day, COUNT(*) as n', [$offset])
            ->groupBy('day')->get()->keyBy('day');

        $trend = [];
        for ($i = 0; $i < self::TREND_DAYS; $i++) {
            $key = (clone $startLocal)->addDays($i)->toDateString();
            $trend[] = [
                'date' => $key,
                'new_subscribers' => (int) ($joined->get($key)->n ?? 0),
                'expired' => (int) ($lapsed->get($key)->n ?? 0),
                'recharges' => (int) ($recharged->get($key)->n ?? 0),
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

    /** Live sessions per NAS, to show load imbalance across BRAS/routers. */
    private function sessionsByNas(callable $scopeCustomers): array
    {
        $q = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username')
            ->leftJoin('nas_devices', 'nas_devices.nasname', '=', 'radacct.nasipaddress');

        return $scopeCustomers($q)
            ->groupBy('radacct.nasipaddress', 'nas_devices.name')
            ->orderByDesc('sessions')
            ->limit(8)
            ->get([
                'radacct.nasipaddress as nas_ip',
                DB::raw("COALESCE(nas_devices.name, radacct.nasipaddress) as nas_name"),
                DB::raw('COUNT(DISTINCT radacct.username) as sessions'),
            ])
            ->map(fn ($r) => ['nas_ip' => $r->nas_ip, 'nas_name' => $r->nas_name, 'sessions' => (int) $r->sessions])
            ->all();
    }

    /**
     * Total transferred per Nepal-local day, attributed to the day the session
     * started. Download is what the subscriber received (the NAS's output).
     */
    private function dataUsage(callable $scopeCustomers): array
    {
        $startLocal = now(self::TZ)->startOfDay()->subDays(self::TREND_DAYS - 1);
        $since = (clone $startLocal)->utc()->toDateTimeString();
        $offset = $startLocal->format('P');

        $q = DB::table('radacct')
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username')
            ->where('radacct.acctstarttime', '>=', $since);

        $rows = $scopeCustomers($q)
            ->selectRaw(
                "DATE(CONVERT_TZ(radacct.acctstarttime, '+00:00', ?)) as day,
                 COALESCE(SUM(radacct.acctoutputoctets),0) as download,
                 COALESCE(SUM(radacct.acctinputoctets),0) as upload",
                [$offset]
            )
            ->groupBy('day')->get()->keyBy('day');

        $gb = fn ($bytes) => round(((float) $bytes) / 1073741824, 2);
        $out = [];
        for ($i = 0; $i < self::TREND_DAYS; $i++) {
            $key = (clone $startLocal)->addDays($i)->toDateString();
            $out[] = [
                'date' => $key,
                'download_gb' => $gb($rows->get($key)->download ?? 0),
                'upload_gb' => $gb($rows->get($key)->upload ?? 0),
            ];
        }

        return $out;
    }

    /** Top 5 heaviest subscribers over the last 24 hours. */
    private function topConsumers(callable $scopeCustomers): array
    {
        $q = DB::table('radacct')
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username')
            ->where('radacct.acctstarttime', '>=', now()->subDay()->toDateTimeString());

        return $scopeCustomers($q)
            ->groupBy('pppoe_customers.id', 'pppoe_customers.username', 'pppoe_customers.full_name')
            ->orderByRaw('SUM(COALESCE(radacct.acctinputoctets,0) + COALESCE(radacct.acctoutputoctets,0)) DESC')
            ->limit(5)
            ->get([
                'pppoe_customers.username',
                'pppoe_customers.full_name',
                DB::raw('COALESCE(SUM(radacct.acctoutputoctets),0) as download'),
                DB::raw('COALESCE(SUM(radacct.acctinputoctets),0) as upload'),
            ])
            ->map(fn ($r) => [
                'username' => $r->username,
                'full_name' => $r->full_name,
                'download_gb' => round(((float) $r->download) / 1073741824, 2),
                'upload_gb' => round(((float) $r->upload) / 1073741824, 2),
            ])->all();
    }

    /**
     * Device, ONT, alert and traffic figures from the NMS tables. Returns null
     * when this install has no NMS schema, so the dashboard degrades instead of
     * failing.
     */
    private function network(User $actor): ?array
    {
        foreach (['devices', 'interfaces', 'metrics', 'alerts', 'ont_inventory', 'olt_resellers'] as $table) {
            if (! Schema::hasTable($table)) {
                return null;
            }
        }

        $reseller = ! $actor->isAdmin();
        $oltIds = $reseller
            ? DB::table('olt_resellers')->where('reseller_id', $actor->id)->pluck('olt_id')->map(fn ($v) => (int) $v)->all()
            : null;

        // OLTs only: the dashboard tile and list are about the access network.
        $devices = fn () => DB::table('devices')->where('enabled', 1)
            ->whereIn('id', DB::table('olts')->select('device_id'))
            ->when($reseller, fn ($q) => $q->whereIn('id', $oltIds ?: [0]));
        $onts = fn () => DB::table('ont_inventory')
            ->when($reseller, fn ($q) => $q->whereIn('olt_id', $oltIds ?: [0])->where('reseller_id', $actor->id));
        $interfaces = fn () => DB::table('interfaces')->where('monitored', 1)
            ->when($reseller, fn ($q) => $q->whereIn('device_id', $oltIds ?: [0]));

        $deviceTotals = $devices()->selectRaw(
            "COUNT(*) as total, COALESCE(SUM(status='up'),0) as up, COALESCE(SUM(status='down'),0) as down, COALESCE(SUM(status='unknown'),0) as unknown_"
        )->first();

        $ontTotals = $onts()->selectRaw(
            "COUNT(*) as total, COALESCE(SUM(run_state='online'),0) as online, COALESCE(SUM(run_state<>'online'),0) as offline,
             COALESCE(SUM(run_state='online' AND rx_power_dbm IS NOT NULL AND rx_power_dbm < ?),0) as weak_signal",
            [self::WEAK_RX_DBM]
        )->first();

        return [
            'scope' => $reseller ? $actor->role : 'all',
            'devices' => [
                'total' => (int) $deviceTotals->total,
                'up' => (int) $deviceTotals->up,
                'down' => (int) $deviceTotals->down,
                'unknown' => (int) $deviceTotals->unknown_,
            ],
            'onts' => [
                'total' => (int) $ontTotals->total,
                'online' => (int) $ontTotals->online,
                'offline' => (int) $ontTotals->offline,
                'weak_signal' => (int) $ontTotals->weak_signal,
                'weak_threshold_dbm' => self::WEAK_RX_DBM,
            ],
            'olts' => $this->oltBreakdown($actor, $oltIds),
            'alerts' => $this->alerts($oltIds),
            'top_interfaces' => $interfaces()
                ->join('devices', 'devices.id', '=', 'interfaces.device_id')
                ->whereNotNull('interfaces.util_pct')
                ->orderByDesc('interfaces.util_pct')
                ->limit(6)
                ->get(['devices.name as device', 'interfaces.name', 'interfaces.speed_bps', 'interfaces.in_bps', 'interfaces.out_bps', 'interfaces.util_pct'])
                ->map(fn ($r) => [
                    'device' => $r->device,
                    'name' => $r->name,
                    'speed_bps' => (int) $r->speed_bps,
                    'in_bps' => (float) $r->in_bps,
                    'out_bps' => (float) $r->out_bps,
                    'util_pct' => round((float) $r->util_pct, 1),
                ])->all(),
            'traffic' => $this->traffic($reseller ? ($oltIds ?: [0]) : null),
        ];
    }

    /** Per-OLT ONT counts, so a PON problem shows up against the OLT it is on. */
    private function oltBreakdown(User $actor, ?array $oltIds): array
    {
        $reseller = ! $actor->isAdmin();

        return DB::table('devices as d')
            ->join('olts as o', 'o.device_id', '=', 'd.id')
            ->leftJoin('ont_inventory as i', function ($j) use ($reseller, $actor) {
                $j->on('i.olt_id', '=', 'd.id');
                if ($reseller) {
                    $j->where('i.reseller_id', '=', $actor->id);
                }
            })
            ->where('d.enabled', 1)
            ->when($reseller, fn ($q) => $q->whereIn('d.id', $oltIds ?: [0]))
            ->groupBy('d.id', 'd.name', 'd.status')
            ->orderBy('d.name')
            ->get([
                'd.id', 'd.name', 'd.status',
                DB::raw('COUNT(i.id) as onts'),
                DB::raw("COALESCE(SUM(i.run_state='online'),0) as online"),
            ])
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'name' => $r->name,
                'status' => $r->status,
                'onts' => (int) $r->onts,
                'online' => (int) $r->online,
            ])->all();
    }

    private function alerts(?array $oltIds): array
    {
        $active = fn () => DB::table('alerts as a')
            ->leftJoin('devices as d', 'd.id', '=', 'a.device_id')
            ->where('a.state', '<>', 'resolved')
            ->whereNull('a.suppressed_by')
            ->when($oltIds !== null, fn ($q) => $q->whereIn('a.device_id', $oltIds ?: [0]));

        $totals = $active()->selectRaw(
            "COALESCE(SUM(a.severity='P1'),0) as p1, COALESCE(SUM(a.severity='P2'),0) as p2,
             COALESCE(SUM(a.severity='P3'),0) as p3, COALESCE(SUM(a.state='open'),0) as unacknowledged"
        )->first();

        return [
            'p1' => (int) $totals->p1,
            'p2' => (int) $totals->p2,
            'p3' => (int) $totals->p3,
            'unacknowledged' => (int) $totals->unacknowledged,
            'recent' => $active()->orderBy('a.severity')->orderByDesc('a.opened_at')->limit(6)
                ->get(['a.id', 'a.severity', 'a.title', 'a.state', 'a.opened_at', 'd.name as device'])
                ->map(fn ($r) => [
                    'id' => (int) $r->id,
                    'severity' => $r->severity,
                    'title' => $r->title,
                    'state' => $r->state,
                    'device' => $r->device,
                    'opened_at' => $r->opened_at,
                ])->all(),
        ];
    }

    /**
     * Aggregate in/out bps over the last day across monitored interfaces:
     * each interface is averaged within a bucket first, then the interfaces
     * are summed, so a bucket holding more polls is not read as more traffic.
     * Timestamps are epoch seconds (UNIX_TIMESTAMP and the NOW() window use the
     * same session time zone the NMS wrote them in).
     *
     * @param  int[]|null  $deviceIds  null = every device
     */
    private function traffic(?array $deviceIds): array
    {
        $b = self::TRAFFIC_BUCKET_SECONDS;

        $per = DB::table('metrics as m')
            ->join('interfaces as i', function ($j) {
                $j->on('i.id', '=', 'm.interface_id')->where('i.monitored', 1);
            })
            ->whereIn('m.name', ['in_bps', 'out_bps'])
            ->whereRaw('m.ts >= NOW() - INTERVAL '.self::TRAFFIC_HOURS.' HOUR')
            ->when($deviceIds !== null, fn ($q) => $q->whereIn('m.device_id', $deviceIds))
            ->groupBy('bucket', 'm.interface_id')
            ->selectRaw("FLOOR(UNIX_TIMESTAMP(m.ts)/$b)*$b as bucket, m.interface_id,
                AVG(CASE WHEN m.name='in_bps' THEN m.value END) as in_bps,
                AVG(CASE WHEN m.name='out_bps' THEN m.value END) as out_bps");

        return DB::query()->fromSub($per, 't')
            ->groupBy('bucket')->orderBy('bucket')
            ->selectRaw('bucket, COALESCE(SUM(in_bps),0) as in_bps, COALESCE(SUM(out_bps),0) as out_bps')
            ->get()
            ->map(fn ($r) => [
                'ts' => (int) $r->bucket,
                'in_bps' => round((float) $r->in_bps),
                'out_bps' => round((float) $r->out_bps),
            ])->all();
    }
}
