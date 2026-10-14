<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pppoe_customers', function (Blueprint $table) {
            // Optional: the customer's ONU (fibre terminal) as recorded at install.
            $table->string('onu_serial_number', 64)->nullable()->after('nas_ip');
            $table->string('onu_id', 32)->nullable()->after('onu_serial_number');
        });
    }

    public function down(): void
    {
        Schema::table('pppoe_customers', function (Blueprint $table) {
            $table->dropColumn(['onu_serial_number', 'onu_id']);
        });
    }
};
