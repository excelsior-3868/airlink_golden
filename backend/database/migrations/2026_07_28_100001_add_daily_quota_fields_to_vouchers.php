<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->decimal('daily_data_gb', 12, 3)->nullable()->after('data_gb');
            $table->unsignedBigInteger('daily_used_bytes')->default(0)->after('daily_data_gb');
            $table->date('daily_reset_date')->nullable()->after('daily_used_bytes');
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropColumn(['daily_data_gb', 'daily_used_bytes', 'daily_reset_date']);
        });
    }
};
