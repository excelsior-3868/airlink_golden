<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Revised after client consultation: distributing/allocating voucher stock to
 * a Seller is not relevant for an Admin account — an admin only needs to view
 * the resulting transaction history (GET /vouchers/transfers, which carries
 * no permission gate). Only a Reseller may create a distribution.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('system_permissions')->where('feature', 'transfer_voucher')->update([
            'admin' => 0,
            'display_name' => 'Allocate Voucher',
            'description' => 'Allocate already-generated voucher stock from a Reseller to one of their Sellers',
        ]);
    }

    public function down(): void
    {
        DB::table('system_permissions')->where('feature', 'transfer_voucher')->update([
            'admin' => 1,
            'display_name' => 'Transfer Voucher',
            'description' => 'Distribute already-generated voucher stock from a Reseller to one of their Sellers',
        ]);
    }
};
