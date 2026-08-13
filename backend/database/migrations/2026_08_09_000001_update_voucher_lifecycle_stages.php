<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Update voucher lifecycle stages to:
     * - ready: newly generated vouchers in stock
     * - active: sold to customer / activated
     * - used: validity or data volume expired
     * - disabled: disabled by admin/reseller
     */
    public function up(): void
    {
        // 1. Expand ENUM to temporarily accept old and new statuses during migration
        DB::statement(
            "ALTER TABLE vouchers MODIFY COLUMN status "
            . "ENUM('ready', 'new', 'sold', 'active', 'used', 'expired', 'disabled') "
            . "NOT NULL DEFAULT 'ready'"
        );

        // 2. Migrate existing status values
        DB::statement("UPDATE vouchers SET status = 'active' WHERE status != 'disabled' AND (activated_at IS NOT NULL OR sold_at IS NOT NULL) AND (expires_at IS NULL OR expires_at > NOW())");
        DB::statement("UPDATE vouchers SET status = 'ready' WHERE status != 'disabled' AND activated_at IS NULL AND sold_at IS NULL");
        DB::statement("UPDATE vouchers SET status = 'used' WHERE status != 'disabled' AND expires_at IS NOT NULL AND expires_at <= NOW()");

        // 3. Constrain ENUM to the four target stages
        DB::statement(
            "ALTER TABLE vouchers MODIFY COLUMN status "
            . "ENUM('ready', 'active', 'used', 'disabled') "
            . "NOT NULL DEFAULT 'ready'"
        );
    }

    public function down(): void
    {
        // 1. Expand ENUM to accept legacy statuses
        DB::statement(
            "ALTER TABLE vouchers MODIFY COLUMN status "
            . "ENUM('ready', 'new', 'sold', 'active', 'used', 'expired', 'disabled') "
            . "NOT NULL DEFAULT 'new'"
        );

        // 2. Revert statuses back to legacy equivalents
        DB::statement("UPDATE vouchers SET status = 'new' WHERE status = 'ready'");

        // 3. Revert ENUM definition
        DB::statement(
            "ALTER TABLE vouchers MODIFY COLUMN status "
            . "ENUM('new', 'sold', 'active', 'used', 'expired', 'disabled') "
            . "NOT NULL DEFAULT 'new'"
        );
    }
};
