<?php

namespace App\Console\Commands;

use App\Services\Radius\CoaClient;
use App\Services\Radius\CoaService;
use App\Services\Radius\OnlineSession;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
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
 *
 * ---------------------------------------------------------------------------
 * Why there are two passes
 *
 * An abandoned session and a live one are indistinguishable in radacct. These
 * routers interim-update on their own timer — 10 minutes since the hotspot
 * profile was changed on 2026-09-08, 60 minutes for every session started
 * before it, and both cadences run at once until the older ones reconnect —
 * and octet counters only move on an interim or the Stop. So a customer three
 * minutes into a download and one who vanished an hour ago both present as:
 * open, zero octets, acctupdatetime == acctstarttime. Measured over 45 days,
 * 85 sessions ran past 90 minutes with no interim at all while averaging
 * 870 MB of real traffic. Any rule that closes rows on idle time or byte
 * counts alone disconnects those people.
 *
 * Hence: don't guess, ask. Pass 1 sends a CoA-Request — a question that changes
 * nothing — and lets the NAS say whether the session exists. Only a definite
 * "no" (Error-Cause 503) closes a row. A definite "yes" also earns the session
 * an exemption from pass 2, because a blind timeout should never overrule the
 * router's own answer.
 *
 * Pass 2 is the original blind backstop, unchanged, for everything the probe
 * could not settle — an unreachable NAS, CoA not enabled, an ambiguous NAK. It
 * stays deliberately timid (12 hours) precisely because it is guessing.
 */
class CloseStaleRadiusSessions extends Command
{
    protected $signature = 'radius:close-stale-sessions
        {--minutes= : Idle minutes before a session counts as abandoned (default: OnlineSession::CLOSE_AFTER_MINUTES)}
        {--probe-minutes= : Idle minutes before a session is probed via CoA (default: OnlineSession::PROBE_AFTER_MINUTES)}
        {--max-probes=25 : Most sessions to probe in one run, quietest first}
        {--no-probe : Skip the CoA probe and use only the blind idle backstop}
        {--dry-run : Report what would be closed without writing}';

    protected $description = 'Close radacct sessions abandoned without an Accounting-Stop';

    public function __construct(private readonly CoaService $coa)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        // CLOSE_AFTER_MINUTES, not the display window: this writes, and these
        // NASes can go hours between interim updates on a live session.
        $minutes = (int) ($this->option('minutes') ?: OnlineSession::CLOSE_AFTER_MINUTES);
        $probeMinutes = (int) ($this->option('probe-minutes') ?: OnlineSession::PROBE_AFTER_MINUTES);
        $dry = (bool) $this->option('dry-run');

        $confirmedAlive = $this->option('no-probe')
            ? []
            : $this->probePass($probeMinutes, (int) $this->option('max-probes'), $dry);

        return $this->backstopPass($minutes, $confirmedAlive, $dry);
    }

    /**
     * Ask the NAS about every session quiet for longer than $probeMinutes.
     *
     * Capped per run: an unreachable NAS costs a full timeout × retry cycle per
     * session, so an unbounded sweep after a router outage could outlast the
     * 5-minute scheduler tick. Quietest first, and whatever is left over is
     * picked up next tick — the backstop still guarantees an eventual close.
     *
     * @return array<int, int> radacctids the NAS confirmed are still live
     */
    private function probePass(int $probeMinutes, int $maxProbes, bool $dry): array
    {
        $candidates = DB::table('radacct')
            ->whereNull('acctstoptime')
            ->whereRaw(
                'COALESCE(acctupdatetime, acctstarttime) < DATE_SUB(NOW(), INTERVAL ? MINUTE)',
                [$probeMinutes]
            )
            ->orderByRaw('COALESCE(acctupdatetime, acctstarttime) ASC')
            ->limit(max(1, $maxProbes))
            ->get(['radacctid', 'username', 'acctsessionid', 'framedipaddress', 'nasipaddress']);

        if ($candidates->isEmpty()) {
            $this->info("No sessions quiet for more than {$probeMinutes} minutes to probe.");

            return [];
        }

        $this->line("Probing <comment>{$candidates->count()}</comment> session(s) quiet > {$probeMinutes}m via CoA...");

        $alive = [];
        $gone = [];
        $ambiguous = [];
        $unknown = 0;

        foreach ($candidates as $session) {
            $result = $this->coa->probeSession(
                $session->username,
                $session->acctsessionid,
                $session->framedipaddress,
                $session->nasipaddress,
            );

            switch ($result['status']) {
                case CoaClient::PROBE_ALIVE:
                    $alive[] = $session->radacctid;
                    $this->rememberNasAnswersProbes($session->nasipaddress);
                    break;
                case CoaClient::PROBE_NOT_FOUND:
                    $gone[] = $session->radacctid;
                    break;
                case CoaClient::PROBE_REJECTED:
                    $ambiguous[$session->nasipaddress][] = $session->radacctid;
                    break;
                default:
                    $unknown++;
            }

            $this->line(sprintf(
                '  %-20s %-12s %s',
                $session->username,
                $result['status'],
                $result['reason'] ?? $result['coa_target'] ?? '',
            ));
        }

        // A bare NAK only becomes evidence once the same NAS has been seen to
        // ACK a probe for a session it does have. That is what separates "this
        // router says the session is gone" from "this router does not answer
        // probes at all" — without it, a NAS that blanket-NAKs would look like
        // a router reporting every one of its live sessions as dead.
        foreach ($ambiguous as $nasIp => $ids) {
            if ($this->nasAnswersProbes($nasIp)) {
                $gone = array_merge($gone, $ids);

                continue;
            }

            $unknown += count($ids);
            $this->warn("  NAS {$nasIp} rejected ".count($ids).' probe(s) but has never confirmed a live'
                .' session, so its answers are not yet trustworthy — leaving them to the backstop.');
        }

        $this->line(sprintf(
            'Probe result: <info>%d alive</info>, <comment>%d gone</comment>, %d unanswered.',
            count($alive),
            count($gone),
            $unknown,
        ));

        if ($gone === []) {
            return $alive;
        }

        if ($dry) {
            $this->warn('DRY RUN — '.count($gone).' NAS-confirmed dead session(s) left open.');

            return $alive;
        }

        $this->info('Closed '.$this->closeRows(DB::table('radacct')->whereIn('radacctid', $gone))
            .' session(s) the NAS confirmed it no longer has.');

        return $alive;
    }

    /** Cache key recording that a NAS gave a meaningful ACK to a probe. */
    private function nasProbeCacheKey(?string $nasIp): string
    {
        return 'coa:probe-answers:'.($nasIp ?: 'unknown');
    }

    private function rememberNasAnswersProbes(?string $nasIp): void
    {
        Cache::put($this->nasProbeCacheKey($nasIp), true, now()->addDays(30));
    }

    private function nasAnswersProbes(?string $nasIp): bool
    {
        return (bool) Cache::get($this->nasProbeCacheKey($nasIp), false);
    }

    /**
     * Blind idle timeout, for sessions the probe could not settle either way.
     *
     * @param array<int, int> $confirmedAlive radacctids the NAS vouched for this run
     */
    private function backstopPass(int $minutes, array $confirmedAlive, bool $dry): int
    {
        // Mirrors OnlineSession::scopeLive(), negated: open, and no accounting
        // update within the window.
        $stale = DB::table('radacct')
            ->whereNull('acctstoptime')
            ->whereRaw(
                'COALESCE(acctupdatetime, acctstarttime) < DATE_SUB(NOW(), INTERVAL ? MINUTE)',
                [$minutes]
            );

        // The router's own answer outranks a timeout we picked by guesswork.
        if ($confirmedAlive !== []) {
            $stale->whereNotIn('radacctid', $confirmedAlive);
        }

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

        $this->info('Closed '.$this->closeRows($stale).' abandoned sessions.');

        return self::SUCCESS;
    }

    /**
     * Stop the session at its last known sign of life, not at now(), so
     * acctsessiontime stays truthful for reporting. Terminate cause matches
     * what FreeRADIUS itself writes for a NAS that vanished.
     *
     * Safe to apply to a session that turns out to still be running: the
     * accounting stop query matches on AcctUniqueId alone, with no
     * "AND acctstoptime IS NULL" guard, so a later real Accounting-Stop
     * overwrites these values with the NAS's true octets and terminate cause.
     *
     * @param \Illuminate\Database\Query\Builder $rows
     */
    private function closeRows($rows): int
    {
        return $rows->update([
            'acctstoptime' => DB::raw('COALESCE(acctupdatetime, acctstarttime)'),
            'acctsessiontime' => DB::raw('GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctupdatetime, acctstarttime)))'),
            'acctterminatecause' => 'NAS-Error',
        ]);
    }
}
