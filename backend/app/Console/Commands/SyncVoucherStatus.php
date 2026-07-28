<?php

namespace App\Console\Commands;

use App\Models\Voucher;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Drives voucher lifecycle from RADIUS accounting + expiry dates.
 * Runs on a schedule (see routes/console.php).
 *   active/sold + cumulative radacct usage ≥ its data cap → used
 *   any non-terminal + past expires_at → expired
 *
 * Reconnects are allowed until expiry or quota exhaustion (FreeRADIUS itself
 * enforces both live, per voucher, on every login — see sites-available/default),
 * so an open radacct session no longer means "already used" the way it did
 * before first-login activation replaced generation-time expiry.
 */
class SyncVoucherStatus extends Command
{
    protected $signature = 'vouchers:sync-status';

    protected $description = 'Update voucher statuses from radacct usage and expiry dates';

    public function handle(): int
    {
        // 1. Mark as used any active/sold voucher whose plan has a data cap and
        //    whose cumulative radacct usage has met or exceeded it.
        $used = DB::affectingStatement(
            "UPDATE vouchers v
             JOIN (
                 SELECT UserName AS username, SUM(AcctInputOctets + AcctOutputOctets) AS bytes_used
                 FROM radacct
                 GROUP BY UserName
             ) u ON u.username = v.username
             SET v.status = 'used'
             WHERE v.status IN ('active', 'sold')
               AND v.data_gb IS NOT NULL AND v.data_gb > 0
               AND u.bytes_used >= v.data_gb * 1073741824"
        );

        // 2. Expire anything past its expiry that isn't already terminal.
        $expired = Voucher::whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->whereIn('status', ['active', 'sold', 'used'])
            ->update(['status' => 'expired']);

        $this->info("Sync complete: {$used} used, {$expired} expired.");

        return self::SUCCESS;
    }
}
