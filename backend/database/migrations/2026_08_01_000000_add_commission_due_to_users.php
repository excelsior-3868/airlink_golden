<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks how much commission a reseller still owes their admin. Incremented
 * when a voucher under that reseller sells (VoucherController@sell), and
 * decremented when the admin records an actual commission settlement
 * (PaymentService@collectCommission) — mirrors wallet_due/Invoice for GB
 * loads, but commission is never tied to an Invoice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('commission_due', 14, 2)->default(0.00)->after('commission_percent');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('commission_due');
        });
    }
};
