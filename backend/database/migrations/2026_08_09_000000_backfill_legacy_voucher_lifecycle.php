<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Legacy vouchers were imported on status 'new', which is outside the set the
 * FreeRADIUS post-auth hook stamps — sites-available/default runs its
 * activation UPDATE only `WHERE status IN ('active','sold','used')`. So
 * activated_at and expires_at stayed NULL forever, the authorize gate's
 * `expires_at IS NOT NULL AND expires_at < NOW()` test could never fire, and no
 * imported card could ever expire on time. Only its data cap could end it, and
 * 1,625 of them carry no cap at all.
 *
 * The clock is rebuilt from what actually happened rather than from now(): a
 * card's life starts at its FIRST accounting session, so a 90-day card first
 * used in March 2025 is expired today rather than being handed a fresh 90 days
 * by its next login.
 *
 * The same derivation lives in LegacyImport::stampVoucherLifecycle() for fresh
 * re-imports. The duplication is deliberate — a migration has to stay frozen
 * against the schema it shipped with, not follow that command as it evolves.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Cards with accounting history: real activation, real expiry.
        DB::statement(
            "UPDATE vouchers v
             JOIN (
                 SELECT username, MIN(acctstarttime) AS first_login
                 FROM radacct
                 GROUP BY username
             ) a ON a.username = v.username
             SET v.activated_at = a.first_login,
                 v.expires_at   = DATE_ADD(a.first_login, INTERVAL v.validity_days DAY),
                 v.status       = CASE
                     WHEN DATE_ADD(a.first_login, INTERVAL v.validity_days DAY) < NOW()
                         THEN 'expired'
                     ELSE 'used'
                 END,
                 v.updated_at   = NOW()
             WHERE v.legacy_id IS NOT NULL
               AND v.status = 'new'
               AND v.validity_days > 0"
        );

        // Never-used stock. 'active' is what post-auth recognises, so these
        // start their clock on first login exactly like an app-generated card.
        DB::statement(
            "UPDATE vouchers
             SET status = 'active', updated_at = NOW()
             WHERE legacy_id IS NOT NULL
               AND status = 'new'"
        );
    }

    public function down(): void
    {
        // Only imported vouchers were touched, and only out of 'new' —
        // 'disabled' was left alone. A card genuinely sold after this ran sits
        // on 'sold' and is likewise untouched here.
        DB::statement(
            "UPDATE vouchers
             SET status = 'new', activated_at = NULL, expires_at = NULL
             WHERE legacy_id IS NOT NULL
               AND status IN ('active', 'used', 'expired')"
        );
    }
};
