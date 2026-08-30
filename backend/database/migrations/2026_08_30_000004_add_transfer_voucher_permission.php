<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * New feature row for the "distribute already-generated voucher stock to a
 * Seller" action (VoucherTransferController). insertOrIgnore so this is safe
 * to run against an already-seeded system_permissions table on an existing
 * deployment, not just a fresh install (which picks it up from
 * DatabaseSeeder instead).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('system_permissions')->insertOrIgnore([
            'feature' => 'transfer_voucher',
            'display_name' => 'Transfer Voucher',
            'category' => 'Voucher',
            'description' => 'Distribute already-generated voucher stock from a Reseller to one of their Sellers',
            'admin' => 1,
            'reseller' => 1,
            'seller' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('system_permissions')->where('feature', 'transfer_voucher')->delete();
    }
};
