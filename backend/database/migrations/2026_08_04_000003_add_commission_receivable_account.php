<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (! DB::table('chart_of_accounts')->where('code', '1120')->exists()) {
            DB::table('chart_of_accounts')->insert([
                'code' => '1120',
                'name' => 'Commission Receivable',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Uncollected voucher sales commission accrued by resellers, pending settlement',
                'is_system' => true,
                'user_id' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('chart_of_accounts')->where('code', '1120')->delete();
    }
};
