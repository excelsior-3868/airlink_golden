<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            $table->boolean('enforce_physical_mac')->default(true)->after('mac_bind');
        });

        Schema::table('vouchers', function (Blueprint $table) {
            $table->boolean('enforce_physical_mac')->default(true)->after('mac_bind');
        });
    }

    public function down(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            $table->dropColumn('enforce_physical_mac');
        });

        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropColumn('enforce_physical_mac');
        });
    }
};
