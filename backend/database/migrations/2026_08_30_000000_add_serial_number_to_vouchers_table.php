<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-voucher serial number: "{2-digit year}-{4-digit running count within
     * the batch}", e.g. 26-0001 .. 26-0010 for a 10-voucher batch generated in
     * 2026. Restarts at 0001 for every batch, so it is unique per batch but not
     * globally — hence the composite unique index rather than a plain unique
     * column (mirrors how `code` already is the globally-unique identifier).
     */
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->string('serial_number')->nullable()->after('code');
            $table->unique(['batch_id', 'serial_number']);
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropUnique(['batch_id', 'serial_number']);
            $table->dropColumn('serial_number');
        });
    }
};
