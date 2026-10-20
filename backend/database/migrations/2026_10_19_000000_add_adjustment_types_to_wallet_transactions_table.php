<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::statement(
            "ALTER TABLE wallet_transactions MODIFY COLUMN type "
            . "ENUM('load', 'transfer', 'deduct', 'refund', 'opening', 'commission', 'package_adjustment', 'commission_reversal') "
            . "NOT NULL"
        );
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement(
            "ALTER TABLE wallet_transactions MODIFY COLUMN type "
            . "ENUM('load', 'transfer', 'deduct', 'refund', 'opening', 'commission') "
            . "NOT NULL"
        );
    }
};
