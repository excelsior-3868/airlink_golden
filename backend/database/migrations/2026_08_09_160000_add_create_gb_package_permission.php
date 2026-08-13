<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Splits GB-package creation out of `create_plan`.
 *
 * `create_plan` covers defining a Wallet Package — the operator's own retail
 * catalogue — and belongs to admin alone. A reseller creating a GB Package is a
 * different act: the plan is owned by them or their downline and can never be a
 * wallet package (PlanController forces package_type to 'gb' for any non-admin
 * owner), so it carries none of the pricing authority `create_plan` implies.
 *
 * Without this split the two were the same switch: turning `create_plan` off
 * for resellers — correct for wallet packages — also blocked them from creating
 * the GB packages they are supposed to manage, and the Plans page offered a
 * "New Plan" button that failed with 403 on save.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('system_permissions')->where('feature', 'create_gb_package')->exists()) {
            return;
        }

        DB::table('system_permissions')->insert([
            'feature' => 'create_gb_package',
            'display_name' => 'Create GB Package',
            'category' => 'System',
            'description' => 'Define GB Packages owned by the reseller or its sellers. Wallet Packages remain under Create Plan.',
            'admin' => 1,
            'reseller' => 1,
            'seller' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('system_permissions')->where('feature', 'create_gb_package')->delete();
    }
};
