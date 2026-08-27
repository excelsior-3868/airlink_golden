<?php

namespace App\Console\Commands;

use App\Models\Voucher;
use App\Services\Radius\CoaService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Drives voucher lifecycle from RADIUS accounting + expiry dates.
 * Runs on a schedule (see routes/console.php).
 *   ready/active + cumulative radacct usage ≥ its data cap → used
 *   ready/active + past expires_at → used
 *
 * Lifecycle stages (vouchers.status enum):
 *   ready    generated / in stock, never logged in
 *   active   customer has logged in — the card is in use
 *   used     spent: validity window over, or data quota exhausted
 *   disabled revoked by admin/reseller
 *
 * 'used' is the terminal state, and this command is what writes it.
 * FreeRADIUS post-auth owns the ready → active promotion on first login,
 * and its authorize gate rejects anything already sitting on 'used'.
 *
 * Either transition now also sends a CoA Disconnect-Request for any live
 * session, instead of leaving the user connected until the NAS's own
 * Session-Timeout/Mikrotik-Total-Limit catches up.
 *
 * activated_at/expires_at are normally stamped by a FreeRADIUS post-auth SQL
 * policy on the voucher's first successful login (see
 * docker/freeradius/sites-enabled/default). If that policy is ever
 * missing/misconfigured on the RADIUS server, activated_at stays null forever
 * and step 2 below can never fire — a voucher would keep authenticating past
 * its intended validity with no time-based cutoff. Step 0 is a self-healing
 * fallback: it derives activated_at from the voucher's own real first radacct
 * login so expiry keeps working even if the RADIUS-side trigger regresses.
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
        // 0. Self-healing fallback: backfill activated_at/expires_at for any
        //    voucher that has real login history (radacct rows starting at or
        //    after it was created — guards against a recycled username's stale
        //    old sessions) but never got stamped by the RADIUS-side post-auth
        //    trigger. Without this, step 2 below can never see it to expire it.
        $backfilledActivation = DB::update(
            "UPDATE vouchers v
             SET v.activated_at = (
                 SELECT MIN(r.acctstarttime) FROM radacct r
                 WHERE r.username = v.username AND r.acctstarttime >= v.created_at
             )
             WHERE v.activated_at IS NULL
               AND v.status IN ('ready', 'active')
               AND EXISTS (
                   SELECT 1 FROM radacct r
                   WHERE r.username = v.username AND r.acctstarttime >= v.created_at
               )"
        );

        $backfilledExpiry = DB::update(
            "UPDATE vouchers
             SET expires_at = DATE_ADD(activated_at, INTERVAL validity_days DAY)
             WHERE activated_at IS NOT NULL
               AND expires_at IS NULL
               AND validity_days > 0
               AND status IN ('ready', 'active')"
        );

        // 1. Usernames whose live voucher has a data cap and whose cumulative
        //    radacct usage has met or exceeded it.
        $exhaustedUsernames = collect(DB::select(
            "SELECT v.username
             FROM vouchers v
             JOIN (
                 SELECT username, SUM(acctinputoctets + acctoutputoctets) AS bytes_used
                 FROM radacct
                 GROUP BY username
             ) u ON u.username = v.username
             WHERE v.status IN ('ready', 'active')
               AND v.data_gb IS NOT NULL AND v.data_gb > 0
               AND u.bytes_used >= v.data_gb * 1073741824"
        ))->pluck('username');

        $exhausted = 0;
        if ($exhaustedUsernames->isNotEmpty()) {
            $exhausted = Voucher::whereIn('username', $exhaustedUsernames)
                ->whereIn('status', ['ready', 'active'])
                ->update(['status' => 'used']);
        }

        // 2. Anything past its expiry that has been activated and isn't already terminal.
        $expiredVouchers = Voucher::whereNotNull('expires_at')
            ->whereNotNull('activated_at')
            ->where('expires_at', '<', now())
            ->whereIn('status', ['ready', 'active'])
            ->get(['id', 'username']);

        $expired = $expiredVouchers->count();
        if ($expired > 0) {
            Voucher::whereIn('id', $expiredVouchers->pluck('id'))->update(['status' => 'used']);
        }

        // Landing on 'used' here must reject re-auth the same way the admin
        // "Disable" action does (VoucherController::disable()) — otherwise the
        // CoA disconnect below only kills the *current* session and the same
        // username/password logs straight back in with a fresh Mikrotik-Total-Limit
        // counter, silently undoing the cutoff this command exists to enforce.
        $allUsernames = $exhaustedUsernames->merge($expiredVouchers->pluck('username'))->unique();
        if ($allUsernames->isNotEmpty()) {
            DB::table('radcheck')->whereIn('username', $allUsernames)->delete();
            DB::table('radreply')->whereIn('username', $allUsernames)->delete();
        }

        $allUsernames->each(fn (string $username) => $this->coa->disconnectUsername($username));

        $this->info("Sync complete: {$backfilledActivation} backfilled activation, {$backfilledExpiry} backfilled expiry, {$exhausted} quota-exhausted, {$expired} past expiry — all set to used.");

        return self::SUCCESS;
    }
}
