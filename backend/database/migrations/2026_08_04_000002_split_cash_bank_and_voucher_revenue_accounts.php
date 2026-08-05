<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        // Split '1000' Cash & Bank -> '1000' Cash + new '1010' Bank
        DB::table('chart_of_accounts')->where('code', '1000')->update([
            'name' => 'Cash',
            'description' => 'Physical cash held on hand from voucher and PPPoE collections',
            'updated_at' => $now,
        ]);

        if (! DB::table('chart_of_accounts')->where('code', '1010')->exists()) {
            DB::table('chart_of_accounts')->insert([
                'code' => '1010',
                'name' => 'Bank',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Bank balances, digital wallets (eSewa, Khalti, ConnectIPS), and other non-cash receipts',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // Split '4200' Wi-Fi & PPPoE Voucher Sales Revenue -> '4200' GB Voucher Sales Revenue + new '4250' PPPoE Sales Revenue
        DB::table('chart_of_accounts')->where('code', '4200')->update([
            'name' => 'GB Voucher Sales Revenue',
            'description' => 'Direct hotspot GB data voucher sales revenue',
            'updated_at' => $now,
        ]);

        if (! DB::table('chart_of_accounts')->where('code', '4250')->exists()) {
            DB::table('chart_of_accounts')->insert([
                'code' => '4250',
                'name' => 'PPPoE Sales Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'Direct PPPoE internet voucher sales revenue',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        $now = now();

        DB::table('chart_of_accounts')->where('code', '1010')->delete();
        DB::table('chart_of_accounts')->where('code', '1000')->update([
            'name' => 'Cash & Bank',
            'description' => 'Liquid cash, bank balances, and digital wallets (eSewa, Khalti, ConnectIPS)',
            'updated_at' => $now,
        ]);

        DB::table('chart_of_accounts')->where('code', '4250')->delete();
        DB::table('chart_of_accounts')->where('code', '4200')->update([
            'name' => 'Wi-Fi & PPPoE Voucher Sales Revenue',
            'description' => 'Direct hotspot & PPPoE internet voucher sales revenue',
            'updated_at' => $now,
        ]);
    }
};
