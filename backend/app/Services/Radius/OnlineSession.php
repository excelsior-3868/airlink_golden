<?php

namespace App\Services\Radius;

use Illuminate\Database\Query\Builder;

/**
 * One definition of "this radacct session is still live".
 *
 * acctstoptime IS NULL alone is not enough. A NAS only closes a session by
 * sending Accounting-Stop, and that packet is regularly lost — the client walks
 * out of range, the link drops, the NAS reboots without an Accounting-Off. The
 * row then stays open forever and is counted as online for good.
 *
 * On this deployment that is not a rare event: sessions stop updating at a
 * steady trickle (every minute or two), which is why the dashboard drifted to
 * 57 "online" while the NAS itself reported 37.
 *
 * A live session announces itself instead: it interim-updates on a fixed timer,
 * so anything that has not written an accounting update in a couple of those
 * intervals is gone regardless of what acctstoptime says.
 */
class OnlineSession
{
    /**
     * How the display window is derived, and why it is not a fixed number.
     *
     * The window has to be a multiple of how often the session actually
     * reports, and that is not one number across the fleet. The routers here
     * set the cadence themselves — Acct-Interim-Interval in the RADIUS reply is
     * ignored unless the hotspot profile is set to radius-interim-update=received —
     * so the interval changes when someone edits a router, and existing sessions
     * keep the old one until the customer reconnects. On 2026-09-08 the hotspot
     * profile moved from 60 minutes to 10, which left both live at once:
     * sessions started before the edit carry acctinterval 3600, ones after it
     * carry 600, and a single constant cannot serve both. Sized for 600 it hides
     * every hourly session; sized for 3600 it holds disconnected users on the
     * list for over two hours.
     *
     * So read the cadence off the session. radacct.acctinterval is exactly that
     * value, written by FreeRADIUS from the NAS's own packets, which makes the
     * window self-tuning: it narrows on its own as the last hourly sessions roll
     * over, with no follow-up edit here.
     *
     * MULTIPLIER 2 means one lost interim is survivable — the measured failure
     * mode on this link, where a 172ms RTT to the NAS and real packet loss cost
     * roughly three accounting packets a day before the router's RADIUS timeout
     * was raised from 300ms to 10s. GRACE covers the few seconds of jitter that
     * put a punctual update just past an exact multiple.
     *
     * Read-side only. Getting this wrong briefly mis-states a count, and the
     * next accounting packet corrects it.
     */
    public const STALE_INTERVAL_MULTIPLIER = 2;

    /** Seconds of slack on top, for jitter around an otherwise punctual update. */
    public const STALE_GRACE_SECONDS = 300;

    /**
     * Floor for the derived window, in seconds.
     *
     * acctinterval is null until a session sends its first interim, and 0 on a
     * NAS that does not report one at all. Both would collapse the window to
     * GRACE alone and hide a perfectly healthy session, so treat anything below
     * the current 10-minute cadence as if it were that.
     */
    public const MIN_INTERIM_SECONDS = 600;

    /**
     * Ceiling for the derived window, in seconds.
     *
     * Guards against an implausible acctinterval — 7200 shows up in the history
     * where two intervals were merged by a lost update — turning into a
     * five-hour window. Well under CLOSE_AFTER_MINUTES, so the display window
     * still lapses long before anything is written.
     */
    public const MAX_STALE_SECONDS = 10800; // 3 hours

    /**
     * Minutes after which a session may be CLOSED for real. Deliberately far
     * larger than the display window, because this one writes.
     *
     * The NASes here do not honour Acct-Interim-Interval on sessions that
     * predate it: measured across properly-closed sessions, the gap between the
     * last interim and the actual stop averages 3-4.5 hours and reaches 38.
     * Anything shorter closes sessions that are still up — they are not
     * disconnected, but they vanish from the online list and stop accruing
     * usage until the NAS next reports.
     *
     * REVISIT: those measurements were taken while every router interim-updated
     * hourly, which is why the fallback had to be this timid. Since 2026-09-08
     * the hotspot profile reports every 10 minutes and the routers' RADIUS
     * timeout went from 300ms to 10s (the old value sat below the 172ms RTT
     * floor to the NAS, costing ~8.7% of accounting packets that day). Once
     * that cadence has held for a few days AND the last acctinterval=3600
     * sessions have reconnected, an hour of silence is near-certain proof of
     * death and this can come down to ~60-90 minutes. That matters because
     * this is the only backstop when the CoA probe cannot reach the router,
     * and 9,800 radcheck rows carry Simultaneous-Use = 1 — every one of them
     * is locked out of its own next login for as long as a phantom session
     * stays open. Do not lower it before both conditions hold: the mixed
     * fleet would have live hourly sessions closed underneath it.
     */
    public const CLOSE_AFTER_MINUTES = 720; // 12 hours

    /**
     * Minutes of silence after which a session is worth ASKING the NAS about.
     *
     * Much smaller than CLOSE_AFTER_MINUTES because a CoA probe is a question,
     * not a write: getting it wrong costs one UDP round-trip, not a customer's
     * connection. That is what lets this be aggressive where the blind close
     * has to be timid.
     *
     * Sized just above the 10-minute interim cadence: a session that has missed
     * its slot is worth asking about, one that is merely between updates is not.
     * At 10 — equal to the cadence — every healthy session sat on the threshold
     * and was probed on most ticks, moments before its update landed.
     *
     * Paired with the 5-minute scheduler tick, worst case a genuinely dead
     * session blocks its voucher for ~20 minutes instead of the 12 hours the
     * blind backstop alone would take.
     */
    public const PROBE_AFTER_MINUTES = 15;

    /**
     * Restrict a radacct query to sessions that are genuinely still connected.
     *
     * COALESCE covers a session that has not yet sent its first interim update:
     * its acctupdatetime is null (or equal to acctstarttime), so it is judged on
     * when it started and stays visible immediately after connecting.
     */
    public static function scopeLive(Builder $query, string $table = 'radacct'): Builder
    {
        return $query
            ->whereNull($table.'.acctstoptime')
            ->whereRaw(
                "COALESCE({$table}.acctupdatetime, {$table}.acctstarttime) >= DATE_SUB(NOW(), INTERVAL "
                    ."LEAST(GREATEST(COALESCE({$table}.acctinterval, 0), ?) * ? + ?, ?) SECOND)",
                [
                    self::MIN_INTERIM_SECONDS,
                    self::STALE_INTERVAL_MULTIPLIER,
                    self::STALE_GRACE_SECONDS,
                    self::MAX_STALE_SECONDS,
                ]
            );
    }
}
