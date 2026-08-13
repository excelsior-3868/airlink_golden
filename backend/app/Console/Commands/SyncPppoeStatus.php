<?php

namespace App\Console\Commands;

use App\Models\PppoeCustomer;
use App\Services\Radius\CoaService;
use Illuminate\Console\Command;

/**
 * Synchronizes PPPoE subscriber statuses based on expiry dates.
 * Runs on a schedule (see routes/console.php).
 *
 * Any active subscriber past expires_at is transitioned to 'expired'.
 * Note: radcheck rows are deliberately KEPT so the subscriber receives the
 * specific 'subscription has expired' Reply-Message in their PPP log.
 * A CoA Disconnect-Request is issued for any active sessions.
 */
class SyncPppoeStatus extends Command
{
    protected $signature = 'pppoe:sync-status';

    protected $description = 'Update PPPoE subscriber statuses from expiry dates and disconnect expired sessions';

    public function __construct(private readonly CoaService $coa)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $expiredCustomers = PppoeCustomer::where('status', 'active')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->get();

        $count = $expiredCustomers->count();

        if ($count === 0) {
            $this->info('PPPoE status sync complete: 0 subscribers expired.');
            return self::SUCCESS;
        }

        foreach ($expiredCustomers as $customer) {
            $customer->update(['status' => 'expired']);

            try {
                $this->coa->disconnectUsername($customer->username);
            } catch (\Throwable $e) {
                // Ignore CoA failures on sweep
            }
        }

        $this->info("PPPoE status sync complete: {$count} subscriber(s) transitioned to expired.");

        return self::SUCCESS;
    }
}
