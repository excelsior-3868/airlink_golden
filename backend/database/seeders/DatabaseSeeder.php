<?php

namespace Database\Seeders;

use App\Models\GbTransaction;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed a default admin, reseller, and seller with initial balances
     * aligning with the Airlink 3.0 specification diagrams.
     */
    public function run(): void
    {
        $openingGb = (float) env('ADMIN_OPENING_GB', 100000);
        $openingWallet = (float) env('ADMIN_OPENING_WALLET', 10000000);

        // 1. Seed Admin
        $admin = User::firstOrCreate(
            ['username' => 'admin'],
            [
                'name' => 'Administrator',
                'email' => 'admin@airlink.local',
                'password' => Hash::make('admin@123'),
                'role' => 'admin',
                'status' => 'active',
                'wallet_balance' => $openingWallet,
                'gb_balance' => $openingGb,
            ]
        );

        if ($admin->wasRecentlyCreated && $openingGb > 0) {
            GbTransaction::create([
                'user_id' => $admin->id,
                'type' => 'opening',
                'gb_amount' => $openingGb,
                'balance_after' => $openingGb,
                'reference' => 'seed:opening-pool',
            ]);
        }



        // 4. Seed default System Permissions matrix
        $perms = [
            ['feature' => 'create_plan', 'display_name' => 'Create Plan', 'category' => 'System', 'description' => 'Define new internet plans and pricing from the Plans page', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'create_voucher_plan', 'display_name' => 'Create Plan (Voucher)', 'category' => 'Voucher', 'description' => 'Create a custom package inline while generating vouchers', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'create_reseller', 'display_name' => 'Create Reseller', 'category' => 'User Management', 'description' => 'Register top-level resellers parented to admin', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
            ['feature' => 'create_seller', 'display_name' => 'Create Seller', 'category' => 'User Management', 'description' => 'Register retail seller accounts under a reseller', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'wallet_load', 'display_name' => 'Wallet Load', 'category' => 'Wallet', 'description' => 'Load monetary balance to downline user accounts', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
            ['feature' => 'allocate_gb', 'display_name' => 'Allocate GB', 'category' => 'GB Allocation', 'description' => 'Allocate internet data quota to downline user accounts', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'generate_voucher', 'display_name' => 'Generate Voucher', 'category' => 'Voucher', 'description' => 'Generate printable hotspot access vouchers', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'delete_voucher', 'display_name' => 'Delete Voucher', 'category' => 'Voucher', 'description' => 'Completely delete and void generated vouchers', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
            ['feature' => 'transfer_voucher', 'display_name' => 'Allocate Voucher', 'category' => 'Voucher', 'description' => 'Allocate already-generated voucher stock from a Reseller to one of their Sellers', 'admin' => 0, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'reports', 'display_name' => 'Reports', 'category' => 'Reports', 'description' => 'View usage, sales summaries and packages statistics', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'dashboard', 'display_name' => 'Dashboard', 'category' => 'Dashboard', 'description' => 'View statistics, balances and charts', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'customize_plan_bandwidth', 'display_name' => 'Customize Plan Bandwidth', 'category' => 'System', 'description' => 'Allow customizing plan bandwidth speed limit', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'customize_plan_data_limit', 'display_name' => 'Customize Plan Data Limit', 'category' => 'System', 'description' => 'Allow customizing plan data/GB quota limits', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'customize_plan_validity', 'display_name' => 'Customize Plan Validity', 'category' => 'System', 'description' => 'Allow customizing plan validity duration in days', 'admin' => 1, 'reseller' => 1, 'seller' => 1],

            // Navigation / menu visibility. Controls whether the sidebar entry is shown
            // for a role. Defaults mirror the previous hardcoded role rules.
            ['feature' => 'view_plans', 'display_name' => 'Plans Menu', 'category' => 'Navigation', 'description' => 'Show the Plans menu (Hotspot, PPPOE, Bandwidth)', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'view_resellers', 'display_name' => 'Resellers Menu', 'category' => 'Navigation', 'description' => 'Show the Resellers management menu', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
            ['feature' => 'view_sellers', 'display_name' => 'Sellers Menu', 'category' => 'Navigation', 'description' => 'Show the Sellers management menu', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'view_transactions', 'display_name' => 'Transactions Menu', 'category' => 'Navigation', 'description' => 'Show the Transactions history menu', 'admin' => 1, 'reseller' => 1, 'seller' => 1],
            ['feature' => 'view_settings', 'display_name' => 'Settings Menu', 'category' => 'Navigation', 'description' => 'Show the Settings menu (System Load, NAS, Permissions, Logs)', 'admin' => 1, 'reseller' => 0, 'seller' => 0],

            ['feature' => 'manage_api_tokens', 'display_name' => 'Manage API Tokens', 'category' => 'Integrations', 'description' => 'Create and revoke API tokens for third-party integrations (e.g. a PMS selling vouchers)', 'admin' => 1, 'reseller' => 0, 'seller' => 0],

            ['feature' => 'view_pppoe', 'display_name' => 'PPPoE Menu', 'category' => 'Navigation', 'description' => 'Show the PPPoE management menu (Subscribers, Sessions, Plans)', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'create_pppoe_plan', 'display_name' => 'Create PPPoE Plan', 'category' => 'PPPoE', 'description' => 'Define PPPoE broadband subscription packages on the PPPoE Plans page', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
            ['feature' => 'create_pppoe_customer', 'display_name' => 'Create PPPoE Subscriber', 'category' => 'PPPoE', 'description' => 'Register and configure new PPPoE subscribers', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'recharge_pppoe_customer', 'display_name' => 'Recharge PPPoE Subscriber', 'category' => 'PPPoE', 'description' => 'Process prepaid recharges for PPPoE subscribers', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'suspend_pppoe_customer', 'display_name' => 'Suspend/Resume PPPoE Subscriber', 'category' => 'PPPoE', 'description' => 'Suspend, resume, or disconnect active PPPoE subscribers', 'admin' => 1, 'reseller' => 1, 'seller' => 0],
            ['feature' => 'delete_pppoe_customer', 'display_name' => 'Delete PPPoE Subscriber', 'category' => 'PPPoE', 'description' => 'Permanently delete or terminate PPPoE subscriber accounts', 'admin' => 1, 'reseller' => 0, 'seller' => 0],
        ];

        foreach ($perms as $p) {
            $existing = \App\Models\SystemPermission::where('feature', $p['feature'])->first();
            if ($existing) {
                $updates = [
                    'display_name' => $p['display_name'],
                    'category' => $p['category'],
                    'description' => $p['description'],
                ];
                if ($p['feature'] === 'view_plans') {
                    $updates['reseller'] = 1;
                    $updates['seller'] = 1;
                }
                $existing->update($updates);
            } else {
                \App\Models\SystemPermission::create($p);
            }
        }
    }
}
