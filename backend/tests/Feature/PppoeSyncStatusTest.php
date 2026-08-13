<?php

namespace Tests\Feature;

use App\Models\Bandwidth;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class PppoeSyncStatusTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_status_expires_past_due_active_customers(): void
    {
        $this->seed();

        $admin = $this->makeUser('admin');
        $bw = Bandwidth::create([
            'name' => '10M',
            'rate_down' => 10,
            'rate_down_unit' => 'Mbps',
            'rate_up' => 10,
            'rate_up_unit' => 'Mbps',
        ]);
        $plan = InternetPlan::create([
            'name' => '10M Plan',
            'type' => 'pppoe',
            'plan_type' => 'unlimited',
            'package_type' => 'wallet',
            'bandwidth_id' => $bw->id,
            'bandwidth' => '10M/10M',
            'validity_days' => 30,
            'selling_price' => 500,
            'status' => 'active',
            'created_by' => $admin->id,
        ]);

        $activeGood = PppoeCustomer::create([
            'username' => 'good_customer',
            'password' => 'pass1',
            'full_name' => 'Good Customer',
            'plan_id' => $plan->id,
            'owner_id' => $admin->id,
            'status' => 'active',
            'expires_at' => now()->addDays(10),
            'bandwidth' => '10M/10M',
        ]);

        $activeExpired = PppoeCustomer::create([
            'username' => 'expired_customer',
            'password' => 'pass2',
            'full_name' => 'Expired Customer',
            'plan_id' => $plan->id,
            'owner_id' => $admin->id,
            'status' => 'active',
            'expires_at' => now()->subDay(),
            'bandwidth' => '10M/10M',
        ]);

        Artisan::call('pppoe:sync-status');

        $activeGood->refresh();
        $activeExpired->refresh();

        $this->assertEquals('active', $activeGood->status);
        $this->assertEquals('expired', $activeExpired->status);
    }
}
