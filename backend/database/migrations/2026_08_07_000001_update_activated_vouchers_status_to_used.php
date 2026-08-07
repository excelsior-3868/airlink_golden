<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Any voucher that has been activated (logged in) but still has status active/sold
        // is updated to 'used' to reflect its actual lifecycle state.
        DB::statement(
            "UPDATE vouchers SET status = 'used' WHERE activated_at IS NOT NULL AND status IN ('active', 'sold')"
        );
    }

    public function down(): void
    {
        // Reverting leaves status as-is since 'used' is a valid status enum value.
    }
};
