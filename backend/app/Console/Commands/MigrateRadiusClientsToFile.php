<?php

namespace App\Console\Commands;

use App\Models\NasDevice;
use App\Services\ClientsConfService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One-off: write every existing nas_devices row into clients.conf as its own
 * client{} stanza (via ClientsConfService), then clear the FreeRADIUS `nas`
 * SQL table — it's retired as a client source now that clients.conf is the
 * single source of truth (read_clients is set to `no` on the host).
 */
class MigrateRadiusClientsToFile extends Command
{
    protected $signature = 'radius:migrate-clients-to-file {--dry-run : List what would happen without writing}';

    protected $description = 'Write nas_devices into clients.conf and retire the FreeRADIUS nas SQL table';

    public function handle(ClientsConfService $clientsConf): int
    {
        $devices = NasDevice::orderBy('id')->get();

        if ($devices->isEmpty()) {
            $this->info('No NAS devices to migrate.');
        }

        foreach ($devices as $device) {
            $block = $clientsConf->blockName($device);
            $this->line("Writing client {$block} ({$device->nasname}) for \"{$device->name}\"");

            if (!$this->option('dry-run')) {
                $clientsConf->upsert($device);
            }
        }

        if ($this->option('dry-run')) {
            $this->info('Dry run — clients.conf and the nas table were not modified.');

            return self::SUCCESS;
        }

        if (Schema::hasTable('nas')) {
            $count = DB::table('nas')->count();
            DB::table('nas')->truncate();
            $this->info("Cleared {$count} row(s) from the retired 'nas' table.");
        }

        $this->info('Requesting a FreeRADIUS restart to apply the migrated clients.');
        $clientsConf->requestRestart();

        return self::SUCCESS;
    }
}
