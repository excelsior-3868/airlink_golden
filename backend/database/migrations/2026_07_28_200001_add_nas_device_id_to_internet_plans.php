<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            $table->foreignId('nas_device_id')->nullable()->after('bandwidth_id')->constrained('nas_devices')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            $table->dropConstrainedForeignId('nas_device_id');
        });
    }
};
