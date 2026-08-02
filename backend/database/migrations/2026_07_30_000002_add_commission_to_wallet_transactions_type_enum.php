<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add 'commission' to the wallet_transactions.type enum, for the admin-side
 * credit recorded when a voucher sells and the reseller's commission split
 * is applied (VoucherController@sell).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            "ALTER TABLE wallet_transactions MODIFY COLUMN type "
            . "ENUM('load', 'transfer', 'deduct', 'refund', 'opening', 'commission') "
            . "NOT NULL"
        );
    }

    public function down(): void
    {
        DB::statement("DELETE FROM wallet_transactions WHERE type = 'commission'");
        DB::statement(
            "ALTER TABLE wallet_transactions MODIFY COLUMN type "
            . "ENUM('load', 'transfer', 'deduct', 'refund', 'opening') "
            . "NOT NULL"
        );
    }
};
