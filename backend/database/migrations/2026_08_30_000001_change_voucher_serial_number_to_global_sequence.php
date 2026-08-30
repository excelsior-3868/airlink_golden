<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Serial numbering was revised after client consultation: the running count is
 * no longer scoped to a batch. It is now one continuous sequence per calendar
 * year, shared across every batch generated that year — "{2-digit year}-{6-digit
 * running count}", e.g. 26-000001, 26-000002, ... incrementing irrespective of
 * which batch a voucher belongs to, and resetting to 000001 on the next year.
 *
 * `voucher_serial_counters` holds the last-issued number per year so a batch
 * generation can atomically reserve its slice of the sequence (row-locked in
 * VoucherService::generate()) without racing concurrent batches.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            // The composite unique index we're about to drop is currently the only
            // index covering batch_id, and its FK constraint needs one to fall back
            // on — add a plain index first so dropping the composite doesn't fail
            // with "needed in a foreign key constraint".
            $table->index('batch_id', 'vouchers_batch_id_index');
            $table->dropUnique(['batch_id', 'serial_number']);
            $table->unique('serial_number');
        });

        Schema::create('voucher_serial_counters', function (Blueprint $table) {
            $table->id();
            $table->string('year_key', 4)->unique(); // 2-digit year, e.g. "26"
            $table->unsignedBigInteger('last_serial')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('voucher_serial_counters');

        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropUnique(['serial_number']);
            $table->unique(['batch_id', 'serial_number']);
            $table->dropIndex('vouchers_batch_id_index');
        });
    }
};
