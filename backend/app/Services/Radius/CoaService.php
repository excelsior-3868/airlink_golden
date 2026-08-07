<?php

namespace App\Services\Radius;

use App\Models\NasDevice;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Actively disconnects live sessions instead of leaving them connected
 * until the NAS's own Session-Timeout/Mikrotik-Total-Limit fires.
 */
class CoaService
{
    public function __construct(private readonly CoaClient $client)
    {
    }

    /**
     * Disconnect all active sessions for $username via RFC 5176 CoA.
     *
     * Returns an array of per-session result objects, each with:
     *   - status: 'disconnected' | 'skipped' | 'failed'
     *   - reason: human-readable explanation on non-success
     *   - session_id, nas_ip, coa_target
     *
     * @return array<int, array{status: string, session_id: ?string, nas_ip: ?string, coa_target: ?string, reason: ?string}>
     */
    public function disconnectUsername(string $username): array
    {
        $sessions = DB::table('radacct')
            ->select('acctsessionid', 'framedipaddress', 'nasipaddress')
            ->where('username', $username)
            ->whereNull('acctstoptime')
            ->get();

        if ($sessions->isEmpty()) {
            return [[
                'status' => 'skipped',
                'session_id' => null,
                'nas_ip' => null,
                'coa_target' => null,
                'reason' => 'No active sessions found in radacct for this username.',
            ]];
        }

        return $sessions->map(fn ($session) => $this->disconnectSession(
            $username,
            $session->acctsessionid,
            $session->framedipaddress,
            $session->nasipaddress,
        ))->all();
    }

    /**
     * @return array{status: string, session_id: ?string, nas_ip: ?string, coa_target: ?string, reason: ?string}
     */
    private function disconnectSession(string $username, ?string $acctSessionId, ?string $framedIp, ?string $nasIp): array
    {
        $nas = $this->resolveNas($nasIp);

        if (!$nas) {
            $reason = "No active NAS device matches the session's NAS IP '{$nasIp}'. "
                . 'Register the router under NAS Devices, or set its CoA Host to the address this server can reach it on.';
            Log::warning("CoA: {$reason} (user '{$username}')");

            return [
                'status' => 'skipped',
                'session_id' => $acctSessionId,
                'nas_ip' => $nasIp,
                'coa_target' => null,
                'reason' => $reason,
            ];
        }

        $host = $this->coaHost($nas);

        if (!$host) {
            $reason = "NAS '{$nas->name}' is registered as '{$nas->nasname}', which is a subnet rather than a "
                . 'routable address. Set its CoA Host to the router address this server can reach.';
            Log::warning("CoA: {$reason} (user '{$username}')");

            return [
                'status' => 'skipped',
                'session_id' => $acctSessionId,
                'nas_ip' => $nasIp,
                'coa_target' => null,
                'reason' => $reason,
            ];
        }

        $port = (int) ($nas->coa_port ?: 3799);

        try {
            $this->client->disconnect($host, $nas->secret, [
                'username' => $username,
                'acctSessionId' => $acctSessionId,
                'framedIp' => $framedIp,
            ], $port);

            Log::info("CoA: disconnected '{$username}' via NAS '{$nas->name}' at {$host}:{$port}");

            return [
                'status' => 'disconnected',
                'session_id' => $acctSessionId,
                'nas_ip' => $nasIp,
                'coa_target' => "{$host}:{$port}",
                'reason' => null,
            ];
        } catch (Throwable $e) {
            $reason = $e->getMessage();
            Log::warning("CoA: failed to disconnect '{$username}' via NAS '{$nas->name}' at {$host}:{$port}: {$reason}");

            return [
                'status' => 'failed',
                'session_id' => $acctSessionId,
                'nas_ip' => $nasIp,
                'coa_target' => "{$host}:{$port}",
                'reason' => $reason,
            ];
        }
    }

    /**
     * radacct.nasipaddress holds the NAS-IP-Address the router put in its
     * accounting packets. On a NAT'd MikroTik that's its own LAN address, which
     * matches neither the nasname we registered nor anything routable — so an
     * exact hit is the best case, not the common one.
     */
    private function resolveNas(?string $nasIp): ?NasDevice
    {
        $devices = NasDevice::where('status', 'active')->get();

        if ($nasIp) {
            if ($exact = $devices->firstWhere('nasname', $nasIp)) {
                return $exact;
            }

            if ($byCoaHost = $devices->firstWhere('coa_host', $nasIp)) {
                return $byCoaHost;
            }

            if ($inSubnet = $devices->first(fn ($d) => $this->ipInCidr($nasIp, $d->nasname))) {
                return $inSubnet;
            }
        }

        // With one active router there's no ambiguity about who owns the session,
        // whatever address it reported for itself.
        if ($devices->count() === 1) {
            $only = $devices->first();
            Log::info("CoA: session NAS IP '{$nasIp}' matched no registered nasname; using the only active NAS '{$only->name}' ({$only->nasname})");

            return $only;
        }

        return null;
    }

    /** The address to actually send the Disconnect-Request to, or null if unusable. */
    private function coaHost(NasDevice $nas): ?string
    {
        if (!empty($nas->coa_host)) {
            return $nas->coa_host;
        }

        return str_contains($nas->nasname, '/') ? null : $nas->nasname;
    }

    private function ipInCidr(?string $ip, ?string $cidr): bool
    {
        if (!$ip || !$cidr || !str_contains($cidr, '/')) {
            return false;
        }

        [$subnet, $bits] = explode('/', $cidr, 2);
        $ipLong = ip2long($ip);
        $subnetLong = ip2long($subnet);
        $bits = (int) $bits;

        if ($ipLong === false || $subnetLong === false || $bits < 0 || $bits > 32) {
            return false;
        }

        $mask = $bits === 0 ? 0 : (-1 << (32 - $bits)) & 0xFFFFFFFF;

        return ($ipLong & $mask) === ($subnetLong & $mask);
    }
}
