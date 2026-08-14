<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('branding_settings', function (Blueprint $table) {
            $table->id();
            $table->string('property_name')->default('Oxygen Restaurant and Home');
            $table->string('primary_color')->default('#1e3a5f');
            $table->longText('logo_url')->nullable();
            $table->string('official_email')->nullable()->default('oxygen@gmail.com');
            $table->string('support_phone')->nullable()->default('+9779851129935');
            $table->string('registered_address')->nullable()->default('kathmandu Barnani');
            $table->string('pan_vat_number')->nullable()->default('601234567');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('branding_settings');
    }
};
