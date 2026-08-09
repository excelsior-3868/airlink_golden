<?php

namespace App\Console\Commands;

use App\Services\Radius\OnlineSession;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Close radacct sessions the NAS abandoned without sending Accounting-Stop.
 *
 * FreeRADIUS only closes a session on Accounting-Stop, or in bulk on
 * Accounting-On when a NAS reboots. Neither arrives when a client simply walks
 * out of range or the link drops, so the row stays open forever. Two things
 * then go wrong:
 *
 *   1. Every stale row is counted as an online user. OnlineSession::scopeLive()
 *      hides them from the UI, but the rows are still there.
 *   2. Worse, they are counted by FreeRADIUS's own simul_count_query. With
 *      Simultaneous-Use = 1 written per voucher, one abandoned session is
 *      enough to reject that voucher's next login with "You are already logged
 *      in - access denied".
 *
 * Point 2 is why this needs to write, not just filter on read.
 */
class CloseStaleRadiusSessions extends Command
{
    protected $signature = 'radius:close-stale-sessions
        {--minutes= : Idle minutes before a session counts as abandoned (default: OnlineSession::CLOSE_AFTER_MINUTES)}
        {--dry-run : Report what would be closed without writing}';

    protected $description = 'Close radacct sessions abandoned without an Accounting-Stop';

    public function handle(): int
    {
        // CLOSE_AFTER_MINUTES, not the display window: this writes, and these
        // NASes can go hours between interim updates on a live session.
        $minutes = (int) ($this->option('minutes') ?: OnlineSession::CLOSE_AFTER_MINUTES);
        $dry = (bool) $this->option('dry-run');

        // Mirrors OnlineSession::scopeLive(), negated: open, and no accounting
        // update within the window.
        $stale = DB::table('radacct')
            ->whereNull('acctstoptime')
            ->whereRaw(
                'COALESCE(acctupdatetime, acctstarttime) < DATE_SUB(NOW(), INTERVAL ? MINUTE)',
                [$minutes]
            );

        $count = (clone $stale)->count();
        $users = (clone $stale)->distinct()->count('username');

        if ($count === 0) {
            $this->info("No sessions idle for more than {$minutes} minutes.");

            return self::SUCCESS;
        }

        $this->line("Sessions idle > {$minutes}m: <comment>{$count}</comment> across <comment>{$users}</comment> usernames.");

        if ($dry) {
            $this->table(
                ['username', 'started', 'last update', 'idle minutes'],
                (clone $stale)
                    ->select('username', 'acctstarttime', 'acctupdatetime')
                    ->selectRaw('TIMESTAMPDIFF(MINUTE, COALESCE(acctupdatetime, acctstarttime), NOW()) AS idle')
                    ->orderByDesc('idle')->limit(15)
                    ->get()
                    ->map(fn ($r) => [$r->username, $r->acctstarttime, $r->acctupdatetime, $r->idle])
                    ->all()
            );
            $this->warn('DRY RUN — nothing written.');

            return self::SUCCESS;
        }

        // Stop the session at its last known sign of life, not at now(), so
        // acctsessiontime stays truthful for reporting. Terminate cause matches
        // what FreeRADIUS itself writes for a NAS that vanished.
        $closed = $stale->update([
            'acctstoptime' => DB::raw('COALESCE(acctupdatetime, acctstarttime)'),
            'acctsessiontime' => DB::raw('GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctupdatetime, acctstarttime)))'),
            'acctterminatecause' => 'NAS-Error',
        ]);

        $this->info("Closed {$closed} abandoned sessions.");

        return self::SUCCESS;
    }
}
