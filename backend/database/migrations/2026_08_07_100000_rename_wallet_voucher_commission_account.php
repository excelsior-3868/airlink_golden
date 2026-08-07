<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Renames account 4000 to match the "Card Voucher" terminology now used across
 * the dashboards. The seed in 2026_08_04_000000_create_chart_of_accounts_table
 * was updated for fresh installs; this migration carries the change to databases
 * that already ran it.
 *
 * Safe because nothing keys off the name — AccountController resolves 4000 by
 * `code` only.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('chart_of_accounts')
            ->where('code', '4000')
            ->update(['name' => 'Card Voucher Commission Revenue']);
    }

    public function down(): void
    {
        DB::table('chart_of_accounts')
            ->where('code', '4000')
            ->update(['name' => 'Wallet Voucher Commission Revenue']);
    }
};
