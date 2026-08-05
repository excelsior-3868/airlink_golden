<?php

namespace App\Console\Commands;

use App\Models\Voucher;
use App\Services\Radius\CoaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Drives voucher lifecycle from RADIUS accounting + expiry dates.
 * Runs on a schedule (see routes/console.php).
 *   active/sold + cumulative radacct usage ≥ its data cap → used
 *   any non-terminal + past expires_at → expired
 *
 * Either transition now also sends a CoA Disconnect-Request for any live
 * session, instead of leaving the user connected until the NAS's own
 * Session-Timeout/Mikrotik-Total-Limit catches up.
 */
class SyncVoucherStatus extends Command
{
    protected $signature = 'vouchers:sync-status';

    protected $description = 'Update voucher statuses from radacct usage and expiry dates';

    public function __construct(private readonly CoaService $coa)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        // 1. Usernames whose active/sold voucher has a data cap and whose
        //    cumulative radacct usage has met or exceeded it.
        $usedUsernames = collect(DB::select(
            "SELECT v.username
             FROM vouchers v
             JOIN (
                 SELECT username, SUM(acctinputoctets + acctoutputoctets) AS bytes_used
                 FROM radacct
                 GROUP BY username
             ) u ON u.username = v.username
             WHERE v.status IN ('active', 'sold')
               AND v.data_gb IS NOT NULL AND v.data_gb > 0
               AND u.bytes_used >= v.data_gb * 1073741824"
        ))->pluck('username');

        $used = 0;
        if ($usedUsernames->isNotEmpty()) {
            $used = Voucher::whereIn('username', $usedUsernames)
                ->whereIn('status', ['active', 'sold'])
                ->update(['status' => 'used']);
        }

        // 2. Anything past its expiry that has been activated and isn't already terminal.
        $expiredVouchers = Voucher::whereNotNull('expires_at')
            ->whereNotNull('activated_at')
            ->where('expires_at', '<', now())
            ->whereIn('status', ['active', 'sold', 'used'])
            ->get(['id', 'username']);

        $expired = $expiredVouchers->count();
        if ($expired > 0) {
            Voucher::whereIn('id', $expiredVouchers->pluck('id'))->update(['status' => 'expired']);
        }

        $usedUsernames->merge($expiredVouchers->pluck('username'))
            ->unique()
            ->each(fn (string $username) => $this->coa->disconnectUsername($username));

        $this->info("Sync complete: {$used} used, {$expired} expired.");

        return self::SUCCESS;
    }
}
