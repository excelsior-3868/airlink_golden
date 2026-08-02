<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->decimal('commission_percent', 5, 2)->nullable()->after('base_price');
            $table->decimal('admin_share', 12, 2)->nullable()->after('commission_percent');
            $table->decimal('reseller_share', 12, 2)->nullable()->after('admin_share');
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropColumn(['commission_percent', 'admin_share', 'reseller_share']);
        });
    }
};
