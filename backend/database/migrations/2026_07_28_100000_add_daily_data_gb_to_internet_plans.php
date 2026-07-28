<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            $table->decimal('daily_data_gb', 12, 3)->nullable()->after('data_gb');
        });

        DB::statement("ALTER TABLE internet_plans MODIFY plan_type ENUM('data', 'time', 'unlimited', 'daily_data') NOT NULL");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE internet_plans MODIFY plan_type ENUM('data', 'time', 'unlimited') NOT NULL");

        Schema::table('internet_plans', function (Blueprint $table) {
            $table->dropColumn('daily_data_gb');
        });
    }
};
