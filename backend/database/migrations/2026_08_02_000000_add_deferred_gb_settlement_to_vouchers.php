<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->decimal('gb_cost', 14, 3)->nullable()->after('reseller_share');
            $table->decimal('gb_due_amount', 14, 2)->nullable()->after('gb_cost');
            $table->index(['owner_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropIndex(['owner_id', 'status']);
            $table->dropColumn(['gb_cost', 'gb_due_amount']);
        });
    }
};
