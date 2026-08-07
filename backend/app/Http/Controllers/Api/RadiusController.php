<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ClientsConfService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Exception;

class RadiusController extends Controller
{
    public function __construct(
        private ClientsConfService $clientsConf,
        private \App\Services\Radius\CoaService $coa,
    ) {}

    /** Fetch list of active RADIUS sessions currently connected to Hotspot networks. */
    public function onlineUsers(Request $request): JsonResponse
    {
        $user = $request->user();

        $query = DB::table('radacct')
            ->whereNull('radacct.acctstoptime')
            ->leftJoin('vouchers', 'vouchers.username', '=', 'radacct.username')
            ->leftJoin('internet_plans as p', 'p.id', '=', 'vouchers.plan_id')
            ->leftJoin('users as reseller', 'reseller.id', '=', 'vouchers.reseller_id')
            ->leftJoin('users as seller', 'seller.id', '=', 'vouchers.seller_id')
            ->select(
                'radacct.radacctid',
                'vouchers.id as voucher_id',
                'vouchers.code as voucher_code',
                'radacct.username',
                'vouchers.customer_username',
                'vouchers.price',
                'vouchers.status as voucher_status',
                DB::raw('COALESCE(radacct.acctstarttime, vouchers.activated_at) as start_time'),
                'vouchers.expires_at',
                'p.name as plan_name',
                'p.package_type',
                DB::raw('COALESCE(radacct.framedipaddress, vouchers.nas_ip, "Dynamic") as ip_address'),
                DB::raw('COALESCE(radacct.callingstationid, vouchers.mac_address, "Active") as mac_address'),
                DB::raw('COALESCE(radacct.nasipaddress, vouchers.nas_ip) as nas_ip'),
                DB::raw('CAST(GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(radacct.acctstarttime, vouchers.activated_at, NOW()), NOW())) AS UNSIGNED) as session_time'),
                DB::raw('COALESCE(radacct.acctinputoctets, 0) as input_bytes'),
                DB::raw('COALESCE(radacct.acctoutputoctets, 0) as output_bytes'),
                DB::raw('GREATEST(
                    COALESCE((SELECT SUM(COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0)) FROM radacct r WHERE r.username = radacct.username), 0),
                    COALESCE(radacct.acctinputoctets, 0) + COALESCE(radacct.acctoutputoctets, 0),
                    COALESCE(vouchers.daily_used_bytes, 0)
                ) as total_bytes'),
                'reseller.username as reseller_username',
                'reseller.name as reseller_name',
                'seller.username as seller_username',
                'seller.name as seller_name'
            );

        if ($user) {
            if ($user->role === 'reseller') {
                $query->where(function ($q) use ($user) {
                    $q->where('vouchers.reseller_id', $user->id)
                      ->orWhere('vouchers.owner_id', $user->id);
                });
            } elseif ($user->role === 'seller') {
                $query->where('vouchers.seller_id', $user->id);
            }
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('vouchers.code', 'like', "%{$search}%")
                  ->orWhere('radacct.username', 'like', "%{$search}%")
                  ->orWhere('vouchers.customer_username', 'like', "%{$search}%")
                  ->orWhere('radacct.callingstationid', 'like', "%{$search}%")
                  ->orWhere('radacct.framedipaddress', 'like', "%{$search}%")
                  ->orWhere('radacct.nasipaddress', 'like', "%{$search}%")
                  ->orWhere('p.name', 'like', "%{$search}%");
            });
        }

        $sessions = $query->orderBy('radacct.acctstarttime', 'desc')->get()->map(function ($s) {
            $s->session_time = (int) ($s->session_time ?? 0);
            $s->input_bytes = (int) ($s->input_bytes ?? 0);
            $s->output_bytes = (int) ($s->output_bytes ?? 0);
            $s->total_bytes = (int) ($s->total_bytes ?? 0);
            return $s;
        });

        return $this->ok([
            'count' => $sessions->count(),
            'sessions' => $sessions,
        ]);
    }

    /** Disconnect a live session by username using CoA. */
    public function disconnectUser(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string'],
        ]);

        $results = $this->coa->disconnectUsername($data['username']);

        $disconnected = array_filter($results, fn ($r) => $r['status'] === 'disconnected');
        $skipped      = array_filter($results, fn ($r) => $r['status'] === 'skipped');
        $failed       = array_filter($results, fn ($r) => $r['status'] === 'failed');

        // All sessions were skipped (NAS not registered) or failed (CoA NAK/timeout)
        if (count($disconnected) === 0) {
            $firstBadResult = array_values(array_merge($skipped, $failed))[0] ?? [];
            $reason = $firstBadResult['reason'] ?? 'CoA disconnect did not succeed.';
            $status = !empty($skipped) ? 'skipped' : 'failed';

            return $this->fail(
                "Disconnect {$status} for '{$data['username']}': {$reason}",
                422,
                ['results' => $results]
            );
        }

        // Partial success — some sessions disconnected, others failed
        if (count($failed) > 0 || count($skipped) > 0) {
            return $this->ok(
                ['results' => $results],
                "Partial disconnect for '{$data['username']}': "
                    . count($disconnected) . ' disconnected, '
                    . count($failed) . ' failed, '
                    . count($skipped) . ' skipped.'
            );
        }

        // The row stays in radacct until the NAS sends its Accounting-Stop, so the
        // session can linger in this list for a few seconds after a confirmed ACK.
        return $this->ok(
            ['results' => $results],
            "Disconnected '{$data['username']}' — the router acknowledged the request. "
                . 'It clears from this list once the router reports the session stop.'
        );
    }

    /** Get FreeRADIUS server status and stats (admin only). */
    public function status(): JsonResponse
    {
        $dbConnected = false;
        try {
            DB::table('radcheck')->count();
            $dbConnected = true;
        } catch (Exception $e) {}

        $credentialsCount = DB::table('radcheck')->count();
        $activeSessionsCount = DB::table('radacct')->whereNull('acctstoptime')->distinct()->count('username');

        // FreeRADIUS runs on the Docker host (systemd), not as a compose
        // service, since 2026-07-25 — reach it via the host-gateway alias.
        $host = env('RADIUS_HOST', 'host.docker.internal');
        $port = (int) env('RADIUS_PORT', 1812);

        // We'll perform a quick socket-level check.
        $radiusOnline = false;
        $socket = @fsockopen("udp://$host", $port, $errno, $errstr, 1);
        if ($socket) {
            $radiusOnline = true;
            fclose($socket);
        }

        return $this->ok([
            'database_connected' => $dbConnected,
            'radius_host' => $host,
            'radius_port' => $port,
            'radius_online' => $radiusOnline,
            'stats' => [
                'credentials' => $credentialsCount,
                'active_sessions' => $activeSessionsCount,
            ]
        ]);
    }

    /** Run a mock Access-Request to test credentials (admin only). */
    public function testAuth(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $host = env('RADIUS_HOST', 'host.docker.internal');
        $port = (int) env('RADIUS_PORT', 1812);
        // Must match the `docker_networks` client's secret in clients.conf —
        // that's the client covering the Docker bridge range this request
        // actually arrives from.
        $secret = env('RADIUS_SECRET', 'testing123');

        try {
            $success = $this->radiusAuthenticate($host, $port, $secret, $data['username'], $data['password']);
            if ($success) {
                return $this->ok([
                    'status' => 'Access-Accept',
                    'message' => 'Authentication succeeded.'
                ], 'Authentication succeeded (Access-Accept).');
            } else {
                return $this->ok([
                    'status' => 'Access-Reject',
                    'message' => 'Authentication failed.'
                ], 'Authentication failed (Access-Reject).');
            }
        } catch (Exception $e) {
            return $this->fail('RADIUS authentication test failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Request a FreeRADIUS restart so newly added/edited NAS clients take
     * effect. FreeRADIUS now runs as a host systemd service, not a
     * container we can reach via the Docker API — instead we touch a
     * trigger file that a host-side systemd path-unit watches, which runs
     * `systemctl restart freeradius` on our behalf. The backend never gets
     * more host access than write permission on that one file (plus
     * clients.conf), via a shared group on the bind-mounted paths.
     */
    public function restart(): JsonResponse
    {
        try {
            $this->clientsConf->requestRestart();

            return $this->ok(['restarted' => true], 'FreeRADIUS restart requested.');
        } catch (Exception $e) {
            return $this->fail('Failed to request FreeRADIUS restart: ' . $e->getMessage(), 500);
        }
    }

    private function radiusAuthenticate(string $host, int $port, string $secret, string $username, string $password): bool
    {
        $server = "udp://$host:$port";
        $fp = @stream_socket_client($server, $errno, $errstr, 2);
        if (!$fp) {
            throw new Exception("Could not connect to RADIUS server: $errstr ($errno)");
        }

        // Set short timeout so the API doesn't hang if FreeRADIUS is dead.
        stream_set_timeout($fp, 1, 500000);

        $identifier = rand(0, 255);
        $authenticator = random_bytes(16);

        // PAP Password encryption (RFC 2865)
        $passwordLen = strlen($password);
        $paddedPassword = str_pad($password, ceil(max($passwordLen, 1) / 16) * 16, "\0");
        
        $encryptedPassword = '';
        $lastRound = $authenticator;
        for ($i = 0; $i < strlen($paddedPassword); $i += 16) {
            $segment = substr($paddedPassword, $i, 16);
            $hash = md5($secret . $lastRound, true);
            $encryptedSegment = $segment ^ $hash;
            $encryptedPassword .= $encryptedSegment;
            $lastRound = $encryptedSegment;
        }

        // Attributes
        // User-Name (Type 1)
        $userNameAttr = pack('CC', 1, 2 + strlen($username)) . $username;
        // User-Password (Type 2)
        $userPasswordAttr = pack('CC', 2, 2 + strlen($encryptedPassword)) . $encryptedPassword;
        // Message-Authenticator (Type 80, length 18, 16 bytes HMAC-MD5 value)
        $msgAuthAttr = pack('CC', 80, 18) . str_repeat("\0", 16);

        $attrs = $userNameAttr . $userPasswordAttr . $msgAuthAttr;
        $length = 20 + strlen($attrs);

        // Access-Request Code is 1
        $packet = pack('CCn', 1, $identifier, $length) . $authenticator . $attrs;

        // Calculate HMAC-MD5 over the whole packet with the shared secret
        $hmac = hash_hmac('md5', $packet, $secret, true);

        // Replace the last 16 bytes of the packet (which is the Message-Authenticator value) with the calculated HMAC
        $packet = substr($packet, 0, -16) . $hmac;

        $sent = @fwrite($fp, $packet);
        if ($sent === false) {
            fclose($fp);
            throw new Exception('Socket send failed.');
        }

        $buf = @fread($fp, 1024);
        fclose($fp);

        if ($buf === false || strlen($buf) < 20) {
            throw new Exception('No response from RADIUS server.');
        }

        $responseHeader = unpack('CCode/CIdentifier/nLength', substr($buf, 0, 4));
        
        // Code 2 = Access-Accept, Code 3 = Access-Reject
        return $responseHeader['Code'] === 2;
    }

    /** Fetch FreeRADIUS authentication logs with brute-force warnings (admin only). */
    public function authLogs(Request $request): JsonResponse
    {
        $query = DB::table('radpostauth');

        // Filter by username
        if ($request->filled('username')) {
            $query->where('username', 'like', '%' . $request->input('username') . '%');
        }

        // Filter by reply status (Access-Accept, Access-Reject)
        if ($request->filled('reply')) {
            $query->where('reply', $request->input('reply'));
        }

        // Failed attempts in last 24h
        $failed24h = DB::table('radpostauth')
            ->where('reply', 'Access-Reject')
            ->where('authdate', '>=', now()->subDay())
            ->count();

        // Brute-force warnings (usernames with > 5 failures in last 5 minutes)
        $bruteForce = DB::table('radpostauth')
            ->select('username', DB::raw('count(*) as failures'))
            ->where('reply', 'Access-Reject')
            ->where('authdate', '>=', now()->subMinutes(5))
            ->groupBy('username')
            ->having('failures', '>', 5)
            ->get();

        $logs = $query->orderBy('authdate', 'desc')->paginate(10);

        return $this->ok([
            'failed_24h' => $failed24h,
            'brute_force' => $bruteForce,
            'logs' => $logs->items(),
            'meta' => [
                'current_page' => $logs->currentPage(),
                'last_page' => $logs->lastPage(),
                'from' => $logs->firstItem(),
                'to' => $logs->lastItem(),
                'total' => $logs->total(),
            ]
        ]);
    }

    /** Retrieve the real, live clients.conf contents and parsed clients (admin only). */
    public function clientsConfig(): JsonResponse
    {
        $path = $this->clientsConf->path();
        $content = file_exists($path) ? file_get_contents($path) : '';

        // Admin-managed devices (from the NAS Devices tab) carry a
        // "{name}_{id}" block name; anything else is a hand-maintained
        // static client (localhost, docker_networks, Mikrotik test clients).
        $parsed = array_map(
            fn ($c) => $c + ['source' => preg_match('/_\d+$/', $c['name']) ? 'database' : 'config_file'],
            $this->clientsConf->parse(),
        );

        return $this->ok([
            'raw' => $content,
            'parsed' => $parsed,
        ]);
    }

    /** Fetch freeradius server log file contents. */
    public function serverLog(Request $request): JsonResponse
    {
        $path = '/var/log/radius/radius.log';
        if (!file_exists($path)) {
            $path = '/var/log/freeradius/radius.log';
        }

        if (!file_exists($path) || !is_readable($path)) {
            return $this->ok([
                'exists' => false,
                'path' => $path,
                'content' => '',
                'message' => 'FreeRADIUS log file not found or not readable.'
            ]);
        }

        $limit = $request->integer('limit', 500);
        $lines = [];
        
        try {
            $file = new \SplFileObject($path, 'r');
            $file->seek(PHP_INT_MAX);
            $totalLines = $file->key();
            
            $start = max(0, $totalLines - $limit);
            $file->seek($start);
            
            while (!$file->eof()) {
                $line = $file->fgets();
                if ($line !== false && trim($line) !== '') {
                    $lines[] = trim($line);
                }
            }
        } catch (Exception $e) {
            return $this->fail('Failed reading log file: ' . $e->getMessage(), 500);
        }

        // Parse lines into structured log events
        $parsedLogs = [];
        foreach (array_reverse($lines) as $rawLine) {
            // Regex to parse: Day Month Date Time Year : Module: (ID) Status: [Username] (client details)
            // Example: Sat Jul 18 12:30:15 2026 : Auth: (12) Login OK: [ASMRWRHR] (from client localhost port 0)
            $pattern = '/^([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*:\s*([A-Za-z]+):\s*(?:\((\d+)\)\s+)?(.*?)(?::\s*\[(.*?)\])?\s*(\(from client.*?\))?$/';
            if (preg_match($pattern, $rawLine, $matches)) {
                $timestamp = $matches[1] ?? null;
                $module = $matches[2] ?? null;
                $id = ($matches[3] ?? '') ?: null;
                $statusMsg = $matches[4] ?? '';
                $username = ($matches[5] ?? '') ?: null;
                $client = ($matches[6] ?? '') ?: null;

                $type = 'info';
                if (str_contains($statusMsg, 'Login OK') || str_contains($statusMsg, 'OK')) {
                    $type = 'success';
                } elseif (str_contains($statusMsg, 'Login incorrect') || str_contains($statusMsg, 'Reject') || str_contains($statusMsg, 'mismatch') || str_contains($statusMsg, 'not found')) {
                    $type = 'reject';
                }

                $parsedLogs[] = [
                    'raw' => $rawLine,
                    'timestamp' => $timestamp,
                    'module' => $module,
                    'id' => $id,
                    'status_message' => $statusMsg,
                    'username' => $username,
                    'client' => $client ? trim(str_replace(['(from client ', ')'], '', $client)) : null,
                    'type' => $type
                ];
            } else {
                $parsedLogs[] = [
                    'raw' => $rawLine,
                    'timestamp' => null,
                    'module' => 'System',
                    'id' => null,
                    'status_message' => $rawLine,
                    'username' => null,
                    'client' => null,
                    'type' => 'system'
                ];
            }
        }

        return $this->ok([
            'exists' => true,
            'path' => $path,
            'total_lines' => $totalLines,
            'content' => implode("\n", $lines),
            'logs' => $parsedLogs
        ]);
    }
}
