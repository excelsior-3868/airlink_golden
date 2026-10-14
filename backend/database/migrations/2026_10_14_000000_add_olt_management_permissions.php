<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $permissions = [
            [
                'feature' => 'view_olts',
                'display_name' => 'View OLT List',
                'category' => 'OLT Management',
                'description' => 'View OLT devices, status, and health metrics on the OLT List page',
                'admin' => 1,
                'reseller' => 1,
                'seller' => 0,
            ],
            [
                'feature' => 'manage_olts',
                'display_name' => 'Manage OLTs',
                'category' => 'OLT Management',
                'description' => 'Add, edit, delete, configure credentials, and sync OLT devices',
                'admin' => 1,
                'reseller' => 0,
                'seller' => 0,
            ],
            [
                'feature' => 'view_registered_onts',
                'display_name' => 'Registered ONTs',
                'category' => 'OLT Management',
                'description' => 'View registered subscriber ONTs, operational state, and active VLANs',
                'admin' => 1,
                'reseller' => 1,
                'seller' => 0,
            ],
            [
                'feature' => 'olt_provisioning',
                'display_name' => 'OLT Provisioning',
                'category' => 'OLT Management',
                'description' => 'Provision new subscriber ONTs, configure service profiles, and assign VLANs',
                'admin' => 1,
                'reseller' => 1,
                'seller' => 0,
            ],
            [
                'feature' => 'view_olt_audit_log',
                'display_name' => 'OLT Audit Log',
                'category' => 'OLT Management',
                'description' => 'View immutable audit log of OLT actions, commands, and provisioning operations',
                'admin' => 1,
                'reseller' => 0,
                'seller' => 0,
            ],
        ];

        foreach ($permissions as $p) {
            if (!DB::table('system_permissions')->where('feature', $p['feature'])->exists()) {
                DB::table('system_permissions')->insert(array_merge($p, [
                    'created_at' => now(),
                    'updated_at' => now(),
                ]));
            }
        }
    }

    public function down(): void
    {
        DB::table('system_permissions')->whereIn('feature', [
            'view_olts',
            'manage_olts',
            'view_registered_onts',
            'olt_provisioning',
            'view_olt_audit_log',
        ])->delete();
    }
};
