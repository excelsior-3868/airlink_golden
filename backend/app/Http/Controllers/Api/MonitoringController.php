<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NasDevice;
use App\Services\ClientsConfService;
use App\Services\Radius\NasActivityService;
use App\Services\Radius\OnlineSession;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class MonitoringController extends Controller
{
    public function __construct(
        private ClientsConfService $clientsConf,
        private NasActivityService $nasActivity,
    ) {}

    /**
     * Comprehensive system and network monitoring overview.
     */
    public function overview(): JsonResponse
    {
        return $this->ok([
            'system' => $this->getSystemMetrics(),
            'database' => $this->getDatabaseMetrics(),
            'radius' => $this->getRadiusMetrics(),
            'containers' => $this->getContainerMetrics(),
            'queue' => $this->getQueueMetrics(),
            'network_summary' => $this->getNetworkSummary(),
            'timestamp' => now('Asia/Kathmandu')->toIso8601String(),
        ]);
    }

    /**
     * Detailed status for all NAS gateways.
     */
    public function nasStatus(): JsonResponse
    {
        $activity = $this->nasActivity->forDevices();

        // Get session counts per NAS IP
        $sessionCounts = DB::table('radacct')
            ->whereNull('acctstoptime')
            ->select('nasipaddress', DB::raw('count(*) as active_sessions'))
            ->groupBy('nasipaddress')
            ->pluck('active_sessions', 'nasipaddress')
            ->all();

        $devices = NasDevice::with('owner')->orderBy('name')->get()->map(function (NasDevice $d) use ($activity, $sessionCounts) {
            $act = $activity[$d->id] ?? null;
            $nasIp = $d->nasname;
            $activeSessions = $sessionCounts[$nasIp] ?? 0;

            if ($activeSessions === 0 && !empty($act['reported_nas_ips'])) {
                foreach ($act['reported_nas_ips'] as $reportedIp) {
                    if (isset($sessionCounts[$reportedIp])) {
                        $activeSessions += $sessionCounts[$reportedIp];
                    }
                }
            }

            return [
                'id' => $d->id,
                'name' => $d->name,
                'shortname' => $d->shortname,
                'nasname' => $d->nasname,
                'type' => $d->type,
                'status' => $d->status,
                'coa_host' => $d->coa_host,
                'coa_port' => $d->coa_port,
                'owner' => $d->owner ? ['id' => $d->owner->id, 'name' => $d->owner->name, 'username' => $d->owner->username] : null,
                'activity' => $act,
                'active_sessions' => (int) $activeSessions,
            ];
        })->sortBy([
            ['active_sessions', 'desc'],
            ['name', 'asc']
        ])->values();

        return $this->ok($devices);
    }

    /**
     * Execute administrative quick actions with immediate response.
     */
    public function quickAction(Request $request): JsonResponse
    {
        $action = $request->input('action');

        switch ($action) {
            case 'restart_radius':
                try {
                    $this->clientsConf->requestRestart();
                    return $this->ok(['status' => 'success'], 'FreeRADIUS restart signal triggered successfully.');
                } catch (Exception $e) {
                    return $this->fail('Failed to trigger FreeRADIUS restart: ' . $e->getMessage(), 500);
                }

            case 'flush_cache':
                try {
                    Cache::flush();
                    @Artisan::call('cache:clear');
                    @Artisan::call('config:clear');
                    return $this->ok(['status' => 'success'], 'Application cache flushed successfully.');
                } catch (Exception $e) {
                    return $this->fail('Failed to flush cache: ' . $e->getMessage(), 500);
                }

            case 'retry_failed_jobs':
                try {
                    Artisan::call('queue:retry', ['id' => ['all']]);
                    $output = Artisan::output();
                    return $this->ok(['status' => 'success', 'output' => trim($output)], 'Queued failed jobs for retry.');
                } catch (Exception $e) {
                    return $this->fail('Failed to retry queued jobs: ' . $e->getMessage(), 500);
                }

            case 'test_radius':
                $username = $request->input('username', 'testing');
                $password = $request->input('password', 'testing');
                $host = env('RADIUS_HOST', 'host.docker.internal');
                $port = (int) env('RADIUS_PORT', 1812);
                $secret = env('RADIUS_SECRET', 'testing123');

                $online = false;
                try {
                    $fp = @stream_socket_client("udp://$host:$port", $errno, $errstr, 2);
                    if ($fp) {
                        stream_set_timeout($fp, 2);
                        $identifier = rand(0, 255);
                        $authenticator = random_bytes(16);
                        $msgAuthAttr = pack('CC', 80, 18) . str_repeat("\0", 16);
                        $length = 20 + strlen($msgAuthAttr);
                        $packet = pack('CCn', 12, $identifier, $length) . $authenticator . $msgAuthAttr;
                        $hmac = hash_hmac('md5', $packet, $secret, true);
                        $packet = substr($packet, 0, -16) . $hmac;
                        fwrite($fp, $packet);
                        $response = fread($fp, 256);
                        fclose($fp);
                        $online = ($response !== false && strlen($response) >= 4);
                    }
                } catch (Exception $e) {
                    $online = false;
                }

                return $this->ok([
                    'online' => $online,
                    'host' => $host,
                    'port' => $port,
                    'message' => $online ? 'FreeRADIUS responded to probe packet.' : 'No response from FreeRADIUS server.',
                ], $online ? 'FreeRADIUS probe succeeded.' : 'FreeRADIUS probe timed out.');

            default:
                return $this->fail("Unknown quick action '{$action}'.", 422);
        }
    }

    /**
     * Get host and container CPU, RAM, Disk and runtime info.
     */
    private function getSystemMetrics(): array
    {
        // CPU Load Average
        $load = [0, 0, 0];
        if (function_exists('sys_getloadavg')) {
            $load = sys_getloadavg() ?: [0, 0, 0];
        } elseif (file_exists('/proc/loadavg')) {
            $parts = explode(' ', file_get_contents('/proc/loadavg'));
            $load = [(float) ($parts[0] ?? 0), (float) ($parts[1] ?? 0), (float) ($parts[2] ?? 0)];
        }

        // Memory Usage
        $totalMem = 0;
        $freeMem = 0;
        $availMem = 0;
        $buffers = 0;
        $cached = 0;

        if (file_exists('/proc/meminfo')) {
            $meminfo = file_get_contents('/proc/meminfo');
            if (preg_match('/MemTotal:\s+(\d+)\s+kB/', $meminfo, $m)) $totalMem = (int) $m[1] * 1024;
            if (preg_match('/MemFree:\s+(\d+)\s+kB/', $meminfo, $m)) $freeMem = (int) $m[1] * 1024;
            if (preg_match('/MemAvailable:\s+(\d+)\s+kB/', $meminfo, $m)) $availMem = (int) $m[1] * 1024;
            if (preg_match('/Buffers:\s+(\d+)\s+kB/', $meminfo, $m)) $buffers = (int) $m[1] * 1024;
            if (preg_match('/Cached:\s+(\d+)\s+kB/', $meminfo, $m)) $cached = (int) $m[1] * 1024;
        }

        $usedMem = $availMem > 0 ? ($totalMem - $availMem) : ($totalMem - $freeMem - $buffers - $cached);
        $usedMem = max(0, $usedMem);
        $memPercent = $totalMem > 0 ? round(($usedMem / $totalMem) * 100, 1) : 0;

        // Disk Usage
        $diskTotal = @disk_total_space('/') ?: 1;
        $diskFree = @disk_free_space('/') ?: 0;
        $diskUsed = max(0, $diskTotal - $diskFree);
        $diskPercent = round(($diskUsed / $diskTotal) * 100, 1);

        // Uptime
        $uptimeSeconds = 0;
        if (file_exists('/proc/uptime')) {
            $uptimeParts = explode(' ', file_get_contents('/proc/uptime'));
            $uptimeSeconds = (int) ($uptimeParts[0] ?? 0);
        }

        $opcacheEnabled = function_exists('opcache_get_status') && !empty(opcache_get_status(false)['opcache_enabled']);

        return [
            'cpu_load' => [
                '1m' => round($load[0], 2),
                '5m' => round($load[1], 2),
                '15m' => round($load[2], 2),
            ],
            'memory' => [
                'total_bytes' => $totalMem,
                'used_bytes' => $usedMem,
                'free_bytes' => $availMem ?: $freeMem,
                'cached_bytes' => $cached,
                'usage_percent' => $memPercent,
            ],
            'disk' => [
                'total_bytes' => $diskTotal,
                'used_bytes' => $diskUsed,
                'free_bytes' => $diskFree,
                'usage_percent' => $diskPercent,
            ],
            'uptime_seconds' => $uptimeSeconds,
            'php_version' => PHP_VERSION,
            'php_memory_limit' => ini_get('memory_limit'),
            'opcache_enabled' => $opcacheEnabled,
            'server_time' => now('Asia/Kathmandu')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * Database health and performance statistics.
     */
    private function getDatabaseMetrics(): array
    {
        $start = microtime(true);
        $connected = false;
        $version = 'Unknown';
        $threadsConnected = 0;
        $maxConnections = 0;
        $uptime = 0;
        $slowQueries = 0;
        $totalQueries = 0;
        $dbSizeMb = 0;

        try {
            $pdo = DB::connection()->getPdo();
            $connected = true;
            $latencyMs = round((microtime(true) - $start) * 1000, 2);

            $version = $pdo->getAttribute(\PDO::ATTR_SERVER_VERSION);

            $statusRows = DB::select("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Max_used_connections', 'Uptime', 'Slow_queries', 'Questions')");
            foreach ($statusRows as $row) {
                match ($row->Variable_name) {
                    'Threads_connected' => $threadsConnected = (int) $row->Value,
                    'Max_used_connections' => $maxConnections = (int) $row->Value,
                    'Uptime' => $uptime = (int) $row->Value,
                    'Slow_queries' => $slowQueries = (int) $row->Value,
                    'Questions' => $totalQueries = (int) $row->Value,
                    default => null,
                };
            }

            // Approximate DB size
            $dbName = env('DB_DATABASE', 'airlink');
            $sizeRow = DB::selectOne("
                SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb 
                FROM information_schema.tables 
                WHERE table_schema = ?
            ", [$dbName]);

            if ($sizeRow) {
                $dbSizeMb = (float) ($sizeRow->size_mb ?? 0);
            }
        } catch (Exception $e) {
            $latencyMs = 0;
        }

        // Table counts
        $counts = [
            'radacct_total' => (int) DB::table('radacct')->count(),
            'radcheck_total' => (int) DB::table('radcheck')->count(),
            'radpostauth_total' => (int) DB::table('radpostauth')->count(),
            'vouchers_total' => (int) DB::table('vouchers')->count(),
            'pppoe_total' => (int) DB::table('pppoe_customers')->count(),
            'users_total' => (int) DB::table('users')->count(),
        ];

        return [
            'connected' => $connected,
            'latency_ms' => $latencyMs ?? 0,
            'version' => $version,
            'threads_connected' => $threadsConnected,
            'max_used_connections' => $maxConnections,
            'uptime_seconds' => $uptime,
            'slow_queries' => $slowQueries,
            'total_queries' => $totalQueries,
            'size_mb' => $dbSizeMb,
            'table_counts' => $counts,
        ];
    }

    /**
     * FreeRADIUS server statistics and liveness.
     */
    private function getRadiusMetrics(): array
    {
        $host = env('RADIUS_HOST', 'host.docker.internal');
        $port = (int) env('RADIUS_PORT', 1812);
        $secret = env('RADIUS_SECRET', 'testing123');

        $radiusOnline = false;
        try {
            $fp = @stream_socket_client("udp://$host:$port", $errno, $errstr, 2);
            if ($fp) {
                stream_set_timeout($fp, 2);
                $identifier = rand(0, 255);
                $authenticator = random_bytes(16);
                $msgAuthAttr = pack('CC', 80, 18) . str_repeat("\0", 16);
                $length = 20 + strlen($msgAuthAttr);
                $packet = pack('CCn', 12, $identifier, $length) . $authenticator . $msgAuthAttr;
                $hmac = hash_hmac('md5', $packet, $secret, true);
                $packet = substr($packet, 0, -16) . $hmac;
                fwrite($fp, $packet);
                $response = fread($fp, 256);
                fclose($fp);
                $radiusOnline = ($response !== false && strlen($response) >= 4);
            }
        } catch (Exception $e) {
            $radiusOnline = false;
        }

        $activeSessions = OnlineSession::scopeLive(DB::table('radacct'))->distinct()->count('username');
        $credentials = DB::table('radcheck')->count();

        // 24h auth counts
        $accepts24h = DB::table('radpostauth')
            ->where('reply', 'Access-Accept')
            ->where('authdate', '>=', now()->subDay())
            ->count();

        $rejects24h = DB::table('radpostauth')
            ->where('reply', 'Access-Reject')
            ->where('authdate', '>=', now()->subDay())
            ->count();

        return [
            'online' => $radiusOnline,
            'host' => $host,
            'port' => $port,
            'credentials_count' => $credentials,
            'active_sessions_count' => $activeSessions,
            'accepts_24h' => $accepts24h,
            'rejects_24h' => $rejects24h,
        ];
    }

    /**
     * Docker container states, scoped to THIS tenant's compose project.
     *
     * Several Airlink stacks share one host — the Mera prod stack, the
     * Annapurna prod stack and the dev stack — and one Docker socket sees
     * all of them. Filtering on the `com.docker.compose.project` label is
     * what keeps one tenant's System Monitor from listing another tenant's
     * services; MONITOR_COMPOSE_PROJECT is the `name:` at the top of that
     * stack's compose file. A container a tenant uses but does not own —
     * Annapurna's view of the Mera-owned FreeRADIUS — is named in
     * MONITOR_SHARED_CONTAINERS and flagged so the UI can mark it as such.
     *
     * With no project configured (the dev stack) nothing is filtered out.
     */
    private function getContainerMetrics(): array
    {
        $project = trim((string) env('MONITOR_COMPOSE_PROJECT', ''));
        $shared = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('MONITOR_SHARED_CONTAINERS', ''))
        )));

        [$raw, $error] = $this->fetchDockerContainers();

        // Nothing is fabricated on failure. A hardcoded fallback list used
        // to stand in here, which rendered the Mera stack's container names
        // inside every tenant's UI and read as live data, because nothing
        // surfaced that the proxy was never reached.
        if ($raw === null) {
            return [
                'proxy_connected' => false,
                'project' => $project,
                'error' => $error,
                'list' => [],
            ];
        }

        $list = [];

        foreach ($raw as $c) {
            $name = trim($c['Names'][0] ?? '', '/');
            if ($name === '') {
                continue;
            }

            $labels = is_array($c['Labels'] ?? null) ? $c['Labels'] : [];
            $service = (string) ($labels['com.docker.compose.service'] ?? '');
            $image = (string) ($c['Image'] ?? '');
            $owned = $project === '' || ($labels['com.docker.compose.project'] ?? '') === $project;
            $isShared = !$owned && in_array($name, $shared, true);

            if (!$owned && !$isShared) {
                continue;
            }

            $list[] = [
                'name' => $name,
                'image' => $image,
                'service' => $service,
                'role' => $this->containerRole($service, $image),
                'shared' => $isShared,
                'state' => (string) ($c['State'] ?? 'unknown'),
                'status' => (string) ($c['Status'] ?? ''),
                'created' => (int) ($c['Created'] ?? 0),
            ];
        }

        // Owned services first, then shared ones, each in topology order
        // rather than the Docker API's creation order, so the table reads
        // app -> web -> db -> radius -> workers on every refresh.
        usort($list, fn (array $a, array $b) => [$a['shared'], $this->roleRank($a['service']), $a['name']]
            <=> [$b['shared'], $this->roleRank($b['service']), $b['name']]);

        return [
            'proxy_connected' => true,
            'project' => $project,
            'list' => $list,
        ];
    }

    /**
     * Fetch /containers/json from the read-only Docker socket proxy.
     *
     * Returns [containers, null] on success or [null, reason] on failure.
     * The request goes out as HTTP/1.0 deliberately: the Docker API answers
     * HTTP/1.1 with `Transfer-Encoding: chunked`, and the raw chunk-size
     * lines made json_decode() fail — indistinguishable from an unreachable
     * proxy, and it fell straight through to the fallback list. HTTP/1.0
     * gets a plain body; the chunked decode below covers it regardless.
     */
    private function fetchDockerContainers(): array
    {
        $host = (string) env('DOCKER_PROXY_HOST', 'airlink-docker-proxy');
        $port = (int) env('DOCKER_PROXY_PORT', 2375);

        // The dev stack supplies the same endpoint as a URL.
        if ($url = env('DOCKER_PROXY_URL')) {
            $parts = parse_url((string) $url);
            $host = $parts['host'] ?? $host;
            $port = (int) ($parts['port'] ?? $port);
        }

        try {
            $fp = @stream_socket_client("tcp://$host:$port", $errno, $errstr, 2);
            if (!$fp) {
                return [null, "Docker proxy unreachable at $host:$port ($errstr)"];
            }

            stream_set_timeout($fp, 5);
            fwrite($fp, "GET /containers/json?all=1 HTTP/1.0\r\nHost: $host\r\nAccept: application/json\r\n\r\n");

            $response = '';
            while (!feof($fp)) {
                $response .= fgets($fp, 8192);
            }
            fclose($fp);

            $parts = explode("\r\n\r\n", $response, 2);
            if (!isset($parts[1])) {
                return [null, 'Docker proxy returned an empty response'];
            }

            $body = stripos($parts[0], 'transfer-encoding: chunked') !== false
                ? $this->decodeChunked($parts[1])
                : $parts[1];

            $json = json_decode($body, true);
            if (!is_array($json)) {
                return [null, 'Docker proxy returned an unreadable response'];
            }

            return [$json, null];
        } catch (Exception $e) {
            return [null, 'Docker proxy error: ' . $e->getMessage()];
        }
    }

    /**
     * Strip HTTP chunked-transfer framing from a response body.
     */
    private function decodeChunked(string $body): string
    {
        $out = '';

        while ($body !== '') {
            $eol = strpos($body, "\r\n");
            if ($eol === false) {
                break;
            }

            // Chunk header is a hex length, optionally followed by ;extension.
            $size = (int) hexdec(trim(explode(';', substr($body, 0, $eol))[0]));
            if ($size <= 0) {
                break;
            }

            $out .= substr($body, $eol + 2, $size);
            $body = substr($body, $eol + 2 + $size + 2);
        }

        return $out;
    }

    /**
     * Compose service name -> the role label the System Monitor shows.
     *
     * Keyed on the service rather than the container name, because the two
     * prod stacks name containers differently (`airlink-mera-prod-app` vs
     * `airlink-backend-annapurna`) while both run a service called `app`.
     */
    private function containerRole(string $service, string $image = ''): string
    {
        $roles = [
            'app' => 'Laravel Application Backend',
            'backend' => 'Laravel Application Backend',
            'web' => 'Nginx Reverse Proxy & Web Frontend',
            'frontend' => 'Nginx Reverse Proxy & Web Frontend',
            'mariadb' => 'MariaDB Primary Database',
            'db' => 'MariaDB Primary Database',
            'freeradius' => 'FreeRADIUS AAA Daemon',
            'queue' => 'Background Job Queue Worker',
            'scheduler' => 'Automated Tasks & Cron Scheduler',
            'proxy' => 'Docker Socket Proxy (read-only)',
            'phpmyadmin' => 'Database Admin Console',
        ];

        $role = $roles[$service] ?? $roles[$this->serviceKey($service)] ?? null;

        return $role ?? ($image !== '' ? $image : 'Service Container');
    }

    /**
     * Topology sort position for a compose service; unknown services last.
     */
    private function roleRank(string $service): int
    {
        $order = [
            'app' => 0, 'backend' => 0,
            'web' => 1, 'frontend' => 1,
            'mariadb' => 2, 'db' => 2,
            'freeradius' => 3,
            'queue' => 4,
            'scheduler' => 5,
            'proxy' => 6,
            'phpmyadmin' => 7,
        ];

        return $order[$service] ?? $order[$this->serviceKey($service)] ?? 99;
    }

    /**
     * Last dash-separated segment of a compose service name.
     *
     * Annapurna calls its database service `annapurna-mariadb` so that the
     * shared FreeRADIUS cannot resolve a bare `mariadb` ambiguously across
     * the tenant_link network; this collapses that spelling back onto the
     * same role and sort position as Mera's plain `mariadb`.
     */
    private function serviceKey(string $service): string
    {
        $pos = strrpos($service, '-');

        return $pos === false ? $service : substr($service, $pos + 1);
    }

    /**
     * Laravel Queue and Background Job metrics.
     */
    private function getQueueMetrics(): array
    {
        $pendingJobs = 0;
        $failedJobs = 0;
        $recentFailed = [];

        try {
            $pendingJobs = DB::table('jobs')->count();
        } catch (Exception $e) {}

        try {
            $failedJobs = DB::table('failed_jobs')->count();
            $recentFailed = DB::table('failed_jobs')
                ->orderBy('failed_at', 'desc')
                ->limit(5)
                ->get(['id', 'connection', 'queue', 'payload', 'exception', 'failed_at'])
                ->map(function ($j) {
                    $payload = json_decode($j->payload, true);
                    return [
                        'id' => $j->id,
                        'queue' => $j->queue,
                        'name' => $payload['displayName'] ?? 'Job',
                        'failed_at' => $j->failed_at,
                        'error' => substr($j->exception, 0, 180) . '...',
                    ];
                });
        } catch (Exception $e) {}

        return [
            'pending_jobs' => $pendingJobs,
            'failed_jobs' => $failedJobs,
            'recent_failed' => $recentFailed,
        ];
    }

    /**
     * Network and NAS gateway metrics summary.
     */
    private function getNetworkSummary(): array
    {
        $totalDevices = NasDevice::count();
        $activity = $this->nasActivity->forDevices();

        $activeCount = 0;
        $silentCount = 0;
        $neverCount = 0;

        foreach ($activity as $act) {
            $state = $act['state'] ?? 'never';
            if ($state === 'active') $activeCount++;
            elseif ($state === 'silent') $silentCount++;
            else $neverCount++;
        }

        $hotspotCount = OnlineSession::scopeLive(DB::table('radacct'))
            ->leftJoin('pppoe_customers as pc', 'pc.username', '=', 'radacct.username')
            ->whereNull('pc.id')
            ->count();

        $pppoeCount = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers as pc', 'pc.username', '=', 'radacct.username')
            ->count();

        return [
            'total_nas_devices' => $totalDevices,
            'active_nas_devices' => $activeCount,
            'silent_nas_devices' => $silentCount,
            'never_nas_devices' => $neverCount,
            'online_hotspot_users' => $hotspotCount,
            'online_pppoe_users' => $pppoeCount,
            'total_online_subscribers' => $hotspotCount + $pppoeCount,
        ];
    }
}
