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

    public function disconnectUsername(string $username): void
    {
        DB::table('radacct')
            ->select('acctsessionid', 'framedipaddress', 'nasipaddress')
            ->where('username', $username)
            ->whereNull('acctstoptime')
            ->get()
            ->each(fn ($session) => $this->disconnectSession(
                $username,
                $session->acctsessionid,
                $session->framedipaddress,
                $session->nasipaddress,
            ));
    }

    private function disconnectSession(string $username, ?string $acctSessionId, ?string $framedIp, ?string $nasIp): void
    {
        $nas = NasDevice::where('nasname', $nasIp)->where('status', 'active')->first();

        if (!$nas) {
            Log::warning("CoA: no active NAS device registered for radacct NAS IP '{$nasIp}', skipping disconnect for '{$username}'");

            return;
        }

        try {
            $this->client->disconnect($nas->nasname, $nas->secret, [
                'username' => $username,
                'acctSessionId' => $acctSessionId,
                'framedIp' => $framedIp,
            ]);

            Log::info("CoA: disconnected '{$username}' on NAS '{$nas->name}' ({$nas->nasname})");
        } catch (Throwable $e) {
            Log::warning("CoA: failed to disconnect '{$username}' on NAS '{$nas->name}' ({$nas->nasname}): {$e->getMessage()}");
        }
    }
}
