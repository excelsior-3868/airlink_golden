<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Custody hand-off ledger for a Reseller distributing already-generated voucher
 * stock to one of their own Sellers (e.g. "20 cards of batch 26-000001..100 to
 * Seller A"). This is distinct from VoucherService::generate()'s owner_id
 * delegation, which only assigns ownership once, at generation time, and
 * immediately debits the target's balance — a transfer moves already-owned,
 * already-paid-for "ready" stock and is a pure custody/tracking move (no wallet
 * or GB impact, confirmed with the client). See VoucherTransferService.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('voucher_transfers', function (Blueprint $table) {
            $table->id();
            // Null when the quantity was drawn from the sender's stock across
            // multiple batches rather than one specific batch.
            $table->foreignId('batch_id')->nullable()->constrained('batches')->nullOnDelete();
            $table->foreignId('from_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('to_user_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            // Usually === from_user_id; differs only when an admin performs the
            // hand-off on the reseller's behalf.
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note')->nullable();
            $table->timestamps();

            $table->index(['from_user_id', 'to_user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('voucher_transfers');
    }
};
