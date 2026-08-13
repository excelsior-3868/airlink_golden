<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pppoe_customers', function (Blueprint $table) {
            $table->id();
            $table->string('username', 64)->unique();          // matches radcheck.username width
            $table->string('password');
            $table->foreignId('plan_id')->constrained('internet_plans')->restrictOnDelete();
            $table->foreignId('owner_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('customer_code', 40)->nullable()->unique();
            $table->string('full_name');
            $table->string('phone', 30)->nullable()->index();
            $table->string('address')->nullable();
            $table->text('notes')->nullable();
            $table->enum('status', ['pending', 'active', 'expired', 'suspended', 'terminated'])->default('pending')->index();
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamp('last_recharged_at')->nullable();
            $table->string('bandwidth')->nullable();            // per-subscriber override, e.g. "20M/20M"
            $table->unsignedTinyInteger('simultaneous_use')->nullable();
            $table->decimal('contract_price', 12, 2)->nullable();
            $table->boolean('mac_bind')->default(false);
            $table->string('mac_address', 50)->nullable();
            $table->foreignId('nas_device_id')->nullable()->constrained('nas_devices')->nullOnDelete();
            $table->string('nas_ip')->nullable();               // denormalised nas_devices.nasname
            $table->unsignedBigInteger('legacy_id')->nullable()->unique();
            $table->timestamps();

            $table->index(['owner_id', 'status']);
            $table->index(['reseller_id', 'status']);
            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pppoe_customers');
    }
};
