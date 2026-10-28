<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Keep radacct and radpostauth from growing without bound.
 *
 * radacct only ever grows: one row per PPPoE/hotspot session, and a PPPoE fleet
 * reconnects several times a day. FreeRADIUS reads and writes this table on
 * every request, so its size sets how much of it fits in the InnoDB buffer pool.
 *
 * What is moved, and why only that:
 *
 *   - Closed sessions (acctstoptime set) older than --days ...
 *   - ... belonging to PPPoE subscribers that are NOT also vouchers.
 *
 * Voucher quotas are enforced by FreeRADIUS summing a username's whole radacct
 * history on every login (sites-enabled/default, and SyncVoucherStatus), so a
 * voucher's old rows must stay. PPPoE is unlimited-only: nothing enforces on its
 * history, it is only shown. Those rows are moved into radacct_archive, and their
 * octet/session totals are folded into radacct_usage_rollup first, in the same
 * transaction, so the lifetime figures the UI shows do not change.
 *
 * Without --apply this only reports what it would do.
 */
class PruneAccounting extends Command
{
    protected $signature = 'radius:prune-accounting
        {--days=90 : Archive closed PPPoE sessions that stopped more than this many days ago}
        {--postauth-days=30 : Delete radpostauth (login attempt log) rows older than this many days}
        {--batch=5000 : Rows moved per transaction}
        {--max-batches=200 : Most batches per run, so one run cannot hold the database for long}
        {--apply : Actually move/delete rows (default is a dry run)}';

    protected $description = 'Archive old PPPoE accounting rows (keeping lifetime totals) and trim the login log';

    public function handle(): int
    {
        $days = max(7, (int) $this->option('days'));
        $postAuthDays = max(7, (int) $this->option('postauth-days'));
        $batch = max(100, min(20000, (int) $this->option('batch')));
        $maxBatches = max(1, (int) $this->option('max-batches'));
        $apply = (bool) $this->option('apply');
        $cutoff = now()->subDays($days);

        $eligible = fn () => DB::table('radacct')
            ->whereNotNull('acctstoptime')
            ->where('acctstoptime', '<', $cutoff)
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('pppoe_customers')
                ->whereColumn('pppoe_customers.username', 'radacct.username'))
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('vouchers')
                ->whereColumn('vouchers.username', 'radacct.username'));

        $pending = $eligible()->count();
        $this->line("radacct: <comment>{$pending}</comment> closed PPPoE session(s) stopped before {$cutoff->toDateTimeString()}.");

        $moved = 0;
        if ($apply) {
            for ($i = 0; $i < $maxBatches; $i++) {
                $n = $this->moveBatch($eligible()->orderBy('radacctid')->limit($batch)->pluck('radacctid')->all());
                if ($n === 0) {
                    break;
                }
                $moved += $n;
            }
            $this->info("Archived {$moved} radacct row(s).");
        }

        $postAuthCutoff = now()->subDays($postAuthDays);
        $stale = DB::table('radpostauth')->where('authdate', '<', $postAuthCutoff)->count();
        $this->line("radpostauth: <comment>{$stale}</comment> row(s) older than {$postAuthDays} days.");

        $deleted = 0;
        if ($apply) {
            for ($i = 0; $i < $maxBatches; $i++) {
                $n = DB::table('radpostauth')->where('authdate', '<', $postAuthCutoff)->limit($batch)->delete();
                if ($n === 0) {
                    break;
                }
                $deleted += $n;
            }
            $this->info("Deleted {$deleted} radpostauth row(s).");
        } else {
            $this->warn('DRY RUN — nothing written. Re-run with --apply.');
        }

        return self::SUCCESS;
    }

    /** @param array<int, int> $ids */
    private function moveBatch(array $ids): int
    {
        if ($ids === []) {
            return 0;
        }

        return DB::transaction(function () use ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));

            // Roll the totals up first; if anything below fails the whole
            // transaction rolls back and nothing is double-counted.
            DB::statement(
                "INSERT INTO radacct_usage_rollup
                    (username, session_count, input_octets, output_octets, session_time, first_start, last_start, last_stop, updated_at)
                 SELECT username, COUNT(*), SUM(COALESCE(acctinputoctets, 0)), SUM(COALESCE(acctoutputoctets, 0)),
                        SUM(COALESCE(acctsessiontime, 0)), MIN(acctstarttime), MAX(acctstarttime), MAX(acctstoptime), NOW()
                 FROM radacct WHERE radacctid IN ({$in}) GROUP BY username
                 ON DUPLICATE KEY UPDATE
                    session_count = session_count + VALUES(session_count),
                    input_octets  = input_octets  + VALUES(input_octets),
                    output_octets = output_octets + VALUES(output_octets),
                    session_time  = session_time  + VALUES(session_time),
                    first_start = LEAST(COALESCE(first_start, VALUES(first_start)), COALESCE(VALUES(first_start), first_start)),
                    last_start  = GREATEST(COALESCE(last_start, VALUES(last_start)), COALESCE(VALUES(last_start), last_start)),
                    last_stop   = GREATEST(COALESCE(last_stop, VALUES(last_stop)), COALESCE(VALUES(last_stop), last_stop)),
                    updated_at = NOW()",
                $ids
            );

            DB::statement("INSERT INTO radacct_archive SELECT * FROM radacct WHERE radacctid IN ({$in})", $ids);

            return DB::table('radacct')->whereIn('radacctid', $ids)->delete();
        });
    }
}
