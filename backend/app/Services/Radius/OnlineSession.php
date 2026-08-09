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
 * A live session announces itself instead: RadiusService sends
 * Acct-Interim-Interval = 60, so anything that has not written an accounting
 * update recently is gone regardless of what acctstoptime says.
 */
class OnlineSession
{
    /**
     * Minutes without an accounting update after which a session is HIDDEN from
     * the online list. Many times the 60-second Acct-Interim-Interval that
     * RadiusService sends, so a voucher session that is genuinely up keeps
     * announcing itself well inside the window.
     *
     * Read-side only. Getting this wrong briefly mis-states a count, and the
     * next accounting packet corrects it.
     */
    public const STALE_AFTER_MINUTES = 15;

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
     */
    public const CLOSE_AFTER_MINUTES = 720; // 12 hours

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
                "COALESCE({$table}.acctupdatetime, {$table}.acctstarttime) >= DATE_SUB(NOW(), INTERVAL ? MINUTE)",
                [self::STALE_AFTER_MINUTES]
            );
    }
}
