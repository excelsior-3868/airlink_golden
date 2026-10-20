<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('totp_secret')->nullable();            // encrypted (model cast)
            $table->timestamp('totp_confirmed_at')->nullable(); // set once the first code is verified
            $table->text('totp_recovery_codes')->nullable();    // JSON list of HMAC hashes
            $table->unsignedBigInteger('totp_last_step')->nullable(); // replay protection
        });

        Schema::create('security_settings', function (Blueprint $table) {
            $table->id();
            $table->json('totp_required_roles')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_settings');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['totp_secret', 'totp_confirmed_at', 'totp_recovery_codes', 'totp_last_step']);
        });
    }
};
