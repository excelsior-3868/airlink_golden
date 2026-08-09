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
     * Minutes without an accounting update after which a session is treated as
     * dead. Deliberately many times the 60-second interim interval — erring
     * towards briefly showing a departed user rather than hiding a present one,
     * and leaving room for a NAS that batches or delays its updates.
     */
    public const STALE_AFTER_MINUTES = 15;

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
