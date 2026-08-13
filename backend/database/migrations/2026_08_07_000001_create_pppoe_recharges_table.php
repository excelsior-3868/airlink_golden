<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pppoe_recharges', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 40)->unique();          // e.g. RCH260807ABCD
            $table->foreignId('customer_id')->constrained('pppoe_customers')->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('internet_plans')->restrictOnDelete();
            $table->foreignId('owner_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('collected_by')->constrained('users')->restrictOnDelete();
            $table->decimal('price', 12, 2)->default(0);
            $table->decimal('base_price', 12, 2)->default(0);
            $table->decimal('commission_percent', 5, 2)->nullable();
            $table->decimal('admin_share', 12, 2)->nullable();
            $table->decimal('reseller_share', 12, 2)->nullable();
            $table->string('payment_method', 40)->nullable();
            $table->unsignedInteger('validity_days')->default(0);   // snapshot — a plan edit never rewrites history
            $table->timestamp('period_start');
            $table->timestamp('period_end');
            $table->string('note')->nullable();
            $table->unsignedBigInteger('legacy_id')->nullable()->unique();
            $table->timestamps();

            $table->index(['customer_id', 'created_at']);
            $table->index(['owner_id', 'created_at']);
            $table->index(['reseller_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pppoe_recharges');
    }
};
