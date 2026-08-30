<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Distribution was revised after client consultation: a reseller picks the
 * physical cards they're handing over by their printed starting serial number
 * plus a quantity, not an abstract "any N ready cards" draw — the ending
 * serial is derived automatically (start + quantity - 1), mirroring how a
 * batch's own serial range is presented at generation time. These columns
 * record exactly what the reseller entered, alongside the item rows already
 * recording exactly which vouchers matched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('voucher_transfers', function (Blueprint $table) {
            $table->string('start_serial', 9)->nullable()->after('quantity');
            $table->string('end_serial', 9)->nullable()->after('start_serial');
        });
    }

    public function down(): void
    {
        Schema::table('voucher_transfers', function (Blueprint $table) {
            $table->dropColumn(['start_serial', 'end_serial']);
        });
    }
};
