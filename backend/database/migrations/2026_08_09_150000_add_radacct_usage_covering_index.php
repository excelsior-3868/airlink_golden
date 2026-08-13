<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Covering index for the quota sums FreeRADIUS runs on every authentication.
 *
 * The authorize section in sites-available/default totals a user's traffic
 * straight out of radacct — once for the lifetime data cap and again for the
 * daily one. 95% of live vouchers carry a data cap, so this runs on nearly
 * every request.
 *
 * radacct_username_index covers only `username`, so the plan located the rows
 * by index and then made one clustered-index lookup per row to fetch the octet
 * columns: 385ms for a user with 7,688 sessions. Requests stopped finishing
 * inside the NAS retransmit window, which surfaced as a flood of
 * "Ignoring duplicate packet ... due to unfinished request" plus
 * "Unresponsive child ... in component authorize module sql" — peaking at 170
 * duplicates an hour.
 *
 * Adding the octet columns (and acctstarttime, for the daily variant) to the
 * index makes both sums readable from the index alone. Measured 385ms -> 5.6ms.
 *
 * INPLACE/NONE so it can be applied to a live server without blocking
 * accounting writes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if ($this->indexExists()) {
            return;
        }

        DB::statement(
            'ALTER TABLE radacct
             ADD INDEX radacct_username_usage_index
                 (username, acctstarttime, acctinputoctets, acctoutputoctets),
             ALGORITHM=INPLACE, LOCK=NONE'
        );
    }

    public function down(): void
    {
        if (! $this->indexExists()) {
            return;
        }

        DB::statement('ALTER TABLE radacct DROP INDEX radacct_username_usage_index');
    }

    private function indexExists(): bool
    {
        return count(DB::select("SHOW INDEX FROM radacct WHERE Key_name = 'radacct_username_usage_index'")) > 0;
    }
};
