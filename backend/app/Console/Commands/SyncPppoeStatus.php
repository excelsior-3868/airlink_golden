<?php

namespace App\Console\Commands;

use App\Models\PppoeCustomer;
use App\Services\Radius\CoaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Synchronizes PPPoE subscriber statuses based on expiry dates.
 * Runs on a schedule (see routes/console.php).
 *
 * Any active subscriber past expires_at is transitioned to 'expired'.
 * radcheck/radreply rows are deleted so the account actually can't
 * re-authenticate — the comment this replaced claimed a FreeRADIUS-side
 * "subscription expired" state machine handled rejection instead; that
 * mechanism does not exist on this server. Credentials are rebuilt on the
 * next recharge by PppoeRechargeService::recharge() (always calls
 * rebuildRadiusRows(), regardless of prior status).
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
            DB::table('radcheck')->where('username', $customer->username)->delete();
            DB::table('radreply')->where('username', $customer->username)->delete();

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
