<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Turns PPPoE plan authoring from a hardcoded isAdmin() check into a matrix row.
 *
 * PlanController previously gated store/update/destroy of a `type = pppoe` plan
 * on isAdmin() — a constant that could not be moved without editing code. As a
 * row it can be widened from the Permissions page instead.
 *
 * It ships admin-only on purpose. Every PPPoE sale books to the admin with no
 * commission split (PppoeRechargeService@recharge), so a downline authoring
 * PPPoE pricing would be setting rates on revenue that is not theirs. The
 * seller tier is excluded unconditionally rather than by default — there is no
 * PPPoE concept for sellers at all, and PermissionController drops any seller
 * tick on a PPPoE feature before it can be saved.
 *
 * Note the fallbacks in SystemPermission::isAllowed(): with this row absent an
 * admin is allowed and everyone else refused, so behaviour is already correct
 * pre-migration. What the row adds is visibility on the Permissions page — and
 * therefore the ability to change it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('system_permissions')->where('feature', 'create_pppoe_plan')->exists()) {
            return;
        }

        DB::table('system_permissions')->insert([
            'feature' => 'create_pppoe_plan',
            'display_name' => 'Create PPPoE Plan',
            'category' => 'PPPoE',
            'description' => 'Define PPPoE broadband subscription packages on the PPPoE Plans page',
            'admin' => 1,
            'reseller' => 0,
            'seller' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('system_permissions')->where('feature', 'create_pppoe_plan')->delete();
    }
};
