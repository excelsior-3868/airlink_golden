<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exact set of vouchers moved by one voucher_transfers row. Recorded per-card
 * rather than as a serial range because a reseller's remaining "ready" pool
 * inside a batch can be non-contiguous by the time a transfer happens (earlier
 * transfers/sales may have already taken some cards out of the middle of the
 * range) — this also lets a single card's full custody history be queried by
 * voucher_id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('voucher_transfer_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('voucher_transfer_id')->constrained('voucher_transfers')->cascadeOnDelete();
            $table->foreignId('voucher_id')->constrained('vouchers')->cascadeOnDelete();
            $table->timestamps();

            $table->index('voucher_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('voucher_transfer_items');
    }
};
