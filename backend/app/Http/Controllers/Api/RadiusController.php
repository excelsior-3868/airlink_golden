<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ClientsConfService;
use App\Services\Radius\OnlineSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Exception;

class RadiusController extends Controller
{
    public function __construct(
        private ClientsConfService $clientsConf,
        private \App\Services\Radius\CoaService $coa,
        private \App\Services\Radius\NasActivityService $nasActivity,
    ) {}

    /** Fetch list of active RADIUS sessions currently connected to Hotspot networks. */
    public function onlineUsers(Request $request): JsonResponse
    {
        $user = $request->user();

        // Both products write to the same radacct table, so one live-session
        // feed covers them. A username belongs to exactly one of them (the
        // unique index on pppoe_customers.username plus the collision check in
        // PppoeCustomerService/VoucherService guarantee it), so the two LEFT
        // JOINs are mutually exclusive and every COALESCE below picks whichever
        // side matched. connection_type tells the UI which badge to show.
        $query = OnlineSession::scopeLive(DB::table('radacct'))
            ->leftJoin('vouchers', 'vouchers.username', '=', 'radacct.username')
            ->leftJoin('internet_plans as p', 'p.id', '=', 'vouchers.plan_id')
            ->leftJoin('users as reseller', 'reseller.id', '=', 'vouchers.reseller_id')
            ->leftJoin('users as seller', 'seller.id', '=', 'vouchers.seller_id')
            ->leftJoin('pppoe_customers as pc', 'pc.username', '=', 'radacct.username')
            ->leftJoin('internet_plans as pp', 'pp.id', '=', 'pc.plan_id')
            ->leftJoin('users as pppoe_reseller', 'pppoe_reseller.id', '=', 'pc.reseller_id')
            ->select(
                'radacct.radacctid',
                'vouchers.id as voucher_id',
                'vouchers.code as voucher_code',
                'radacct.username',
                'pc.id as pppoe_customer_id',
                DB::raw("CASE WHEN pc.id IS NOT NULL THEN 'pppoe' ELSE 'hotspot' END as connection_type"),
                DB::raw('COALESCE(vouchers.customer_username, pc.full_name) as customer_username'),
                DB::raw('COALESCE(vouchers.price, pc.contract_price, pp.selling_price) as price'),
                DB::raw('COALESCE(vouchers.status, pc.status) as voucher_status'),
                DB::raw('COALESCE(radacct.acctstarttime, vouchers.activated_at, pc.activated_at) as start_time'),
                DB::raw('COALESCE(vouchers.expires_at, pc.expires_at) as expires_at'),
                DB::raw('COALESCE(p.name, pp.name) as plan_name'),
                DB::raw('COALESCE(p.package_type, pp.package_type) as package_type'),
                DB::raw('COALESCE(radacct.framedipaddress, vouchers.nas_ip, pc.nas_ip, "Dynamic") as ip_address'),
                DB::raw('COALESCE(radacct.callingstationid, vouchers.mac_address, pc.mac_address, "Active") as mac_address'),
                DB::raw('COALESCE(radacct.nasipaddress, vouchers.nas_ip, pc.nas_ip) as nas_ip'),
                DB::raw('CAST(GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(radacct.acctstarttime, vouchers.activated_at, pc.activated_at, NOW()), NOW())) AS UNSIGNED) as session_time'),
                DB::raw('COALESCE(radacct.acctinputoctets, 0) as input_bytes'),
                DB::raw('COALESCE(radacct.acctoutputoctets, 0) as output_bytes'),
                DB::raw('GREATEST(
                    COALESCE((SELECT SUM(COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0)) FROM radacct r WHERE r.username = radacct.username), 0),
                    COALESCE(radacct.acctinputoctets, 0) + COALESCE(radacct.acctoutputoctets, 0),
                    COALESCE(vouchers.daily_used_bytes, 0)
                ) as total_bytes'),
                DB::raw('COALESCE(reseller.username, pppoe_reseller.username) as reseller_username'),
                DB::raw('COALESCE(reseller.name, pppoe_reseller.name) as reseller_name'),
                'seller.username as seller_username',
                'seller.name as seller_name'
            );

        if ($user) {
            if ($user->role === 'reseller') {
                // Resellers see online sessions for vouchers generated for/by the reseller (seller_id IS NULL) + PPPoE subscribers owned by/attributed to the reseller.
                $query->where(function ($q) use ($user) {
                    $q->where(function ($vq) use ($user) {
                        $vq->where(function ($inner) use ($user) {
                            $inner->where('vouchers.reseller_id', $user->id)
                                  ->orWhere('vouchers.owner_id', $user->id);
                        })->whereNull('vouchers.seller_id');
                    })
                    ->orWhere('pc.reseller_id', $user->id)
                    ->orWhere('pc.owner_id', $user->id);
                });
            } elseif ($user->role === 'seller') {
                // Sellers see online sessions for vouchers generated for/by the seller (seller_id = seller.id).
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
                  ->orWhere('p.name', 'like', "%{$search}%")
                  ->orWhere('pc.full_name', 'like', "%{$search}%")
                  ->orWhere('pc.phone', 'like', "%{$search}%")
                  ->orWhere('pp.name', 'like', "%{$search}%");
            });
        }

        // radacct only ever stores the NAS's self-reported address (nas_ip
        // above), which can differ from the address it's registered under
        // behind NAT — see NasActivityService's docblock. Resolve it to a
        // device name the same way the NAS page's "last seen" status does,
        // rather than showing the raw, potentially-private IP.
        $nasNames = $this->nasActivity->deviceNamesByIp();

        $sessions = $query->orderBy('radacct.acctstarttime', 'desc')->get()->map(function ($s) use ($nasNames) {
            $s->session_time = (int) ($s->session_time ?? 0);
            $s->input_bytes = (int) ($s->input_bytes ?? 0);
            $s->output_bytes = (int) ($s->output_bytes ?? 0);
            $s->total_bytes = (int) ($s->total_bytes ?? 0);
            $s->nas_name = $s->nas_ip ? ($nasNames[$s->nas_ip] ?? null) : null;
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

        $user = $request->user();
        if ($user && !$user->isAdmin()) {
            $username = $data['username'];
            $isAuthorized = false;

            if ($user->isReseller()) {
                $isAuthorized = DB::table('vouchers')
                    ->where('username', $username)
                    ->where(function ($q) use ($user) {
                        $q->where('reseller_id', $user->id)
                          ->orWhere('owner_id', $user->id);
                    })
                    ->whereNull('seller_id')
                    ->exists()
                    || DB::table('pppoe_customers')
                    ->where('username', $username)
                    ->where(function ($q) use ($user) {
                        $q->where('reseller_id', $user->id)
                          ->orWhere('owner_id', $user->id);
                    })
                    ->exists();
            } elseif ($user->isSeller()) {
                $isAuthorized = DB::table('vouchers')
                    ->where('username', $username)
                    ->where('seller_id', $user->id)
                    ->exists();
            }

            if (!$isAuthorized) {
                return $this->fail('You are not authorized to disconnect this session.', 403);
            }
        }

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
        // Same liveness rule as the online-users list, so the status badge and
        // the list it links to can never disagree.
        $activeSessionsCount = OnlineSession::scopeLive(DB::table('radacct'))->distinct()->count('username');

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
            $result = $this->radiusAuthenticate($host, $port, $secret, $data['username'], $data['password']);
            if ($result['accepted']) {
                return $this->ok([
                    'status' => 'Access-Accept',
                    'message' => $result['reply_message'] ?? 'Authentication succeeded.'
                ], 'Authentication succeeded (Access-Accept).');
            } else {
                return $this->ok([
                    'status' => 'Access-Reject',
                    'message' => $result['reply_message'] ?? 'Authentication failed.'
                ], 'Authentication failed (Access-Reject).');
            }
        } catch (Exception $e) {
            return $this->fail('RADIUS authentication test failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Real, live voucher diagnosis — no log-scraping guesswork. Checks the
     * voucher's DB record, whether FreeRADIUS actually has credentials for
     * it (radcheck/radreply), its real connection history (radacct), a
     * targeted grep of the full radius.log for this exact username (not
     * just whatever happens to be in the last N generic lines), and — when
     * safe — fires a real Access-Request at the live RADIUS server to get
     * its actual, current Reply-Message straight from the policy engine.
     *
     * "When safe": the site's post-auth policy stamps activated_at/expires_at
     * and flips status to 'used' on a voucher's FIRST successful login. A
     * live probe against a never-activated voucher would burn its validity
     * window for real, so that case is skipped and explained instead.
     */
    public function diagnoseVoucher(string $code): JsonResponse
    {
        $code = trim($code);

        $voucher = DB::table('vouchers')
            ->leftJoin('internet_plans', 'internet_plans.id', '=', 'vouchers.plan_id')
            ->whereRaw('UPPER(vouchers.code) = ?', [strtoupper($code)])
            ->select('vouchers.*', 'internet_plans.name as plan_name')
            ->first();

        if (!$voucher) {
            return $this->ok([
                'code' => $code,
                'db' => ['exists' => false],
                'overall_status' => 'error',
                'summary' => 'Voucher code does not exist in the database. Please verify the code.',
            ]);
        }

        $username = $voucher->username;
        $reasons = [];
        $overallStatus = 'success';

        // Ground truth: does FreeRADIUS actually have credentials for this
        // username at all? A missing radcheck row means it can never
        // authenticate regardless of what the vouchers table says.
        $radcheck = DB::table('radcheck')->where('username', $username)->get(['attribute', 'op', 'value']);
        $radreply = DB::table('radreply')->where('username', $username)->get(['attribute', 'op', 'value']);
        $hasCredentials = $radcheck->contains('attribute', 'Cleartext-Password');

        // Real connection history — has this voucher ever actually reached a NAS?
        $recentSessions = DB::table('radacct')
            ->where('username', $username)
            ->orderByDesc('acctstarttime')
            ->limit(5)
            ->get(['acctstarttime', 'acctstoptime', 'acctsessiontime', 'nasipaddress', 'framedipaddress', 'callingstationid', 'acctinputoctets', 'acctoutputoctets']);
        $isOnlineNow = OnlineSession::scopeLive(DB::table('radacct'))->where('username', $username)->exists();

        $isExpired = $voucher->expires_at && now()->greaterThan($voucher->expires_at);

        if ($voucher->status === 'disabled') {
            $overallStatus = 'error';
            $reasons[] = 'Voucher is disabled — it will not authenticate until re-enabled.';
        } elseif ($isExpired) {
            $overallStatus = 'error';
            $reasons[] = 'Voucher has expired (past its validity window).';
        }

        if (!$hasCredentials) {
            $overallStatus = 'error';
            $reasons[] = "No RADIUS credentials found for '{$username}' in radcheck — FreeRADIUS has nothing to check this login against. Regenerate credentials for this voucher.";
        }

        // Live probe — only when it can't cost the voucher its validity window.
        $liveTest = ['ran' => false, 'skipped_reason' => null, 'accepted' => null, 'reply_message' => null];
        if (!$hasCredentials) {
            $liveTest['skipped_reason'] = 'No radcheck credentials to test against.';
        } elseif (!$voucher->activated_at) {
            $liveTest['skipped_reason'] = "Voucher hasn't been activated yet — testing it live would start its validity clock for real (first successful login stamps activated_at/expires_at), consuming the customer's window before they've ever connected. Skipped to avoid that.";
        } else {
            try {
                $host = env('RADIUS_HOST', 'host.docker.internal');
                $port = (int) env('RADIUS_PORT', 1812);
                $secret = env('RADIUS_SECRET', 'testing123');
                $result = $this->radiusAuthenticate($host, $port, $secret, $username, $voucher->password);

                $liveTest['ran'] = true;
                $liveTest['accepted'] = $result['accepted'];
                $liveTest['reply_message'] = $result['reply_message'];

                if ($result['accepted']) {
                    $reasons[] = 'Live test just now: RADIUS ACCEPTED this voucher'
                        . ($result['reply_message'] ? " — \"{$result['reply_message']}\"" : '') . '.';
                } else {
                    $overallStatus = 'error';
                    $msg = $result['reply_message'] ?? 'no reason given by the server';
                    $reasons[] = "Live test just now: RADIUS REJECTED this voucher — \"{$msg}\".";
                    if (($voucher->mac_bind || $voucher->nas_ip)
                        && $result['reply_message']
                        && (str_contains($result['reply_message'], 'different device') || str_contains($result['reply_message'], 'not valid on this hotspot'))) {
                        $reasons[] = 'Note: this voucher is locked to a specific device/NAS, and this diagnostic probe doesn\'t send a real MAC address or NAS IP — the customer\'s actual device may authenticate fine even though this specific test didn\'t.';
                    }
                }
            } catch (Exception $e) {
                $liveTest['skipped_reason'] = 'Could not reach the RADIUS server: ' . $e->getMessage();
                $overallStatus = $overallStatus === 'success' ? 'warning' : $overallStatus;
            }
        }

        // Targeted history — grep the WHOLE log for this exact username,
        // not just whatever happens to be in the last N generic lines.
        $logPath = '/var/log/radius/radius.log';
        if (!file_exists($logPath)) {
            $logPath = '/var/log/freeradius/radius.log';
        }
        $logMatches = [];
        if (file_exists($logPath) && is_readable($logPath)) {
            $scan = $this->scanLogFile($logPath, $username, 20);
            $logMatches = array_map(fn ($l) => $this->parseLogLine($l), array_reverse($scan['lines']));
        }

        if (!$reasons) {
            $reasons[] = 'No issues found — voucher is active, has valid RADIUS credentials'
                . ($liveTest['ran'] ? ', and the live authentication test just succeeded.' : '.');
        }

        return $this->ok([
            'code' => $voucher->code,
            'username' => $username,
            'db' => [
                'exists' => true,
                'status' => $voucher->status,
                'is_expired' => $isExpired,
                'plan_name' => $voucher->plan_name,
                'price' => $voucher->price,
                'activated_at' => $voucher->activated_at,
                'expires_at' => $voucher->expires_at,
                'mac_bind' => (bool) $voucher->mac_bind,
                'nas_ip' => $voucher->nas_ip,
            ],
            'radius_tables' => [
                'has_credentials' => $hasCredentials,
                'radcheck' => $radcheck,
                'radreply' => $radreply,
            ],
            'live_test' => $liveTest,
            'sessions' => [
                'is_online_now' => $isOnlineNow,
                'recent' => $recentSessions,
            ],
            'log_matches' => $logMatches,
            'overall_status' => $overallStatus,
            'summary' => implode(' ', $reasons),
        ]);
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

    /**
     * @return array{accepted: bool, code: int, reply_message: ?string}
     */
    private function radiusAuthenticate(string $host, int $port, string $secret, string $username, string $password): array
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
        $code = $responseHeader['Code'];
        $totalLen = min($responseHeader['Length'], strlen($buf));

        // Walk the reply's attribute TLVs looking for Reply-Message (type 18)
        // — the actual, human-readable reason the site's policy set, straight
        // from sites-enabled/default (e.g. "This voucher has expired.").
        $replyMessages = [];
        $offset = 20;
        while ($offset + 2 <= $totalLen) {
            $attrType = ord($buf[$offset]);
            $attrLen = ord($buf[$offset + 1]);
            if ($attrLen < 2 || $offset + $attrLen > $totalLen) {
                break;
            }
            if ($attrType === 18) {
                $replyMessages[] = substr($buf, $offset + 2, $attrLen - 2);
            }
            $offset += $attrLen;
        }

        // Code 2 = Access-Accept, Code 3 = Access-Reject
        return [
            'accepted' => $code === 2,
            'code' => $code,
            'reply_message' => $replyMessages ? implode(' ', $replyMessages) : null,
        ];
    }

    /**
     * Case-insensitive scan of the whole log file for $search, keeping only
     * the most recent $limit matching lines (oldest-of-the-kept-set first
     * dropped) — streamed so a multi-gigabyte log never lands in memory.
     *
     * @return array{lines: array<int,string>, total_lines: int, match_count: int}
     *   lines are raw matched text, oldest to newest.
     */
    private function scanLogFile(string $path, string $search, int $limit): array
    {
        $lines = [];
        $totalLines = 0;
        $matchCount = 0;
        $handle = fopen($path, 'r');
        if ($handle === false) {
            return ['lines' => [], 'total_lines' => 0, 'match_count' => 0];
        }

        while (($line = fgets($handle)) !== false) {
            $totalLines++;
            $line = trim($line);
            if ($line === '' || stripos($line, $search) === false) {
                continue;
            }
            $matchCount++;
            $lines[] = $line;
            if (count($lines) > $limit) {
                array_shift($lines);
            }
        }
        fclose($handle);

        return ['lines' => $lines, 'total_lines' => $totalLines, 'match_count' => $matchCount];
    }

    /**
     * Parse one raw FreeRADIUS log line into a structured event.
     * Example: "Sat Jul 18 12:30:15 2026 : Auth: (12) Login OK: [ASMRWRHR] (from client localhost port 0)"
     *
     * @return array{raw:string,timestamp:?string,module:?string,id:?string,status_message:string,username:?string,client:?string,type:string}
     */
    private function parseLogLine(string $rawLine): array
    {
        $pattern = '/^([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*:\s*([A-Za-z]+):\s*(?:\((\d+)\)\s+)?(.*?)(?::\s*\[(.*?)\])?\s*(\(from client.*?\))?$/';
        if (!preg_match($pattern, $rawLine, $matches)) {
            return [
                'raw' => $rawLine,
                'timestamp' => null,
                'module' => 'System',
                'id' => null,
                'status_message' => $rawLine,
                'username' => null,
                'client' => null,
                'type' => 'system',
            ];
        }

        $statusMsg = $matches[4] ?? '';
        $client = ($matches[6] ?? '') ?: null;

        $type = 'info';
        if (str_contains($statusMsg, 'Login OK') || str_contains($statusMsg, 'OK')) {
            $type = 'success';
        } elseif (str_contains($statusMsg, 'Login incorrect') || str_contains($statusMsg, 'Reject') || str_contains($statusMsg, 'mismatch') || str_contains($statusMsg, 'not found')) {
            $type = 'reject';
        }

        return [
            'raw' => $rawLine,
            'timestamp' => $matches[1] ?? null,
            'module' => $matches[2] ?? null,
            'id' => ($matches[3] ?? '') ?: null,
            'status_message' => $statusMsg,
            'username' => ($matches[5] ?? '') ?: null,
            'client' => $client ? trim(str_replace(['(from client ', ')'], '', $client)) : null,
            'type' => $type,
        ];
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
        $search = trim((string) $request->query('search', ''));
        $lines = [];
        $matchCount = 0;

        try {
            if ($search !== '') {
                // Case-insensitive scan of the whole file, equivalent to
                // `grep -i "<search>" radius.log` — streamed so a
                // multi-gigabyte log never lands in memory; only the most
                // recent $limit matches are kept.
                $scan = $this->scanLogFile($path, $search, $limit);
                $lines = $scan['lines'];
                $totalLines = $scan['total_lines'];
                $matchCount = $scan['match_count'];
            } else {
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
            }
        } catch (Exception $e) {
            return $this->fail('Failed reading log file: ' . $e->getMessage(), 500);
        }

        // Parse lines into structured log events
        $parsedLogs = array_map(fn ($rawLine) => $this->parseLogLine($rawLine), array_reverse($lines));

        return $this->ok([
            'exists' => true,
            'path' => $path,
            'total_lines' => $totalLines,
            'search' => $search !== '' ? $search : null,
            'match_count' => $search !== '' ? $matchCount : null,
            'truncated' => $search !== '' && $matchCount > count($lines),
            'content' => implode("\n", $lines),
            'logs' => $parsedLogs
        ]);
    }
}
