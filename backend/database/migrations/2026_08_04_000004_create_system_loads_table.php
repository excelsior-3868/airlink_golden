<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_loads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->decimal('wallet_amount', 14, 2)->default(0);
            $table->decimal('gb_amount', 14, 3)->default(0);
            $table->decimal('wallet_balance_after', 14, 2)->default(0);
            $table->decimal('gb_balance_after', 14, 3)->default(0);
            $table->string('note')->nullable();
            $table->timestamps();

            $table->index(['created_at']);
            $table->index(['user_id']);
            $table->index(['created_by']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_loads');
    }
};
