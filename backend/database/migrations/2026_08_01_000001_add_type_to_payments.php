<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Distinguishes GB-invoice settlements (PaymentService@collect) from
 * commission settlements (PaymentService@collectCommission) so the two
 * receivables — wallet_due and commission_due — can be reported on
 * separately even though they share the same payments table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->string('type')->default('invoice')->after('receiver_id');
            $table->index('type');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex(['type']);
            $table->dropColumn('type');
        });
    }
};
