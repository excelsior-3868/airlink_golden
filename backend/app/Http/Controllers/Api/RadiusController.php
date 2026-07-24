<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Exception;

class RadiusController extends Controller
{
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

        $host = env('RADIUS_HOST', 'freeradius');
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

        $host = env('RADIUS_HOST', 'freeradius');
        $port = (int) env('RADIUS_PORT', 1812);
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
     * Restart the FreeRADIUS container so newly added/edited NAS clients
     * (loaded from the `nas` table only at process startup) take effect.
     * Goes through a docker-socket-proxy scoped to container restart only,
     * never the raw Docker socket, so a compromised backend can't do more
     * than restart the one named container.
     */
    public function restart(): JsonResponse
    {
        $proxyUrl = env('DOCKER_PROXY_URL');
        $container = env('FREERADIUS_CONTAINER');

        if (!$proxyUrl || !$container) {
            return $this->fail('Docker proxy is not configured (DOCKER_PROXY_URL / FREERADIUS_CONTAINER missing).', 500);
        }

        try {
            $response = Http::timeout(15)->post("{$proxyUrl}/containers/{$container}/restart");

            if ($response->status() === 204) {
                return $this->ok(['restarted' => true], 'FreeRADIUS server restarted successfully.');
            }

            return $this->fail('Docker API returned status ' . $response->status() . ': ' . $response->body(), 502);
        } catch (Exception $e) {
            return $this->fail('Failed to restart FreeRADIUS: ' . $e->getMessage(), 500);
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

    /** Retrieve allowable NAS configuration from clients.conf file and nas database table (admin only). */
    public function clientsConfig(): JsonResponse
    {
        $path = base_path('clients.conf');
        $staticClients = [];
        $content = '';
        if (file_exists($path)) {
            $content = file_get_contents($path);
            
            // Match client block header e.g. client localhost { or client docker_net {
            preg_match_all('/client\s+([a-zA-Z0-9_\-]+)\s*\{([^}]+)\}/', $content, $matches, PREG_SET_ORDER);
            
            foreach ($matches as $match) {
                $name = $match[1];
                $body = $match[2];
                
                $client = [
                    'name' => $name,
                    'ipaddr' => '',
                    'secret' => '',
                    'source' => 'config_file',
                ];
                
                // Extract lines inside the body
                $lines = explode("\n", $body);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (empty($line) || str_starts_with($line, '#')) {
                        continue;
                    }
                    
                    if (str_contains($line, '=')) {
                        [$key, $val] = explode('=', $line, 2);
                        $key = trim($key);
                        $val = trim($val);
                        if ($key === 'ipaddr') {
                            $client['ipaddr'] = $val;
                        } elseif ($key === 'secret') {
                            $client['secret'] = $val;
                        }
                    }
                }
                
                $staticClients[] = $client;
            }
        }

        // Fetch dynamic clients from the nas database table
        $dbClients = DB::table('nas')
            ->select('nasname', 'shortname', 'secret', 'type', 'description')
            ->get()
            ->map(function ($row) {
                return [
                    'name' => $row->shortname ?: $row->nasname,
                    'ipaddr' => $row->nasname,
                    'secret' => $row->secret,
                    'source' => 'database',
                    'type' => $row->type,
                    'description' => $row->description
                ];
            })
            ->toArray();

        // Merge both static and dynamic clients
        $allClients = array_merge($staticClients, $dbClients);

        return $this->ok([
            'raw' => $content,
            'parsed' => $allClients
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
