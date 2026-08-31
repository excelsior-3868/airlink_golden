<?php

namespace Tests\Feature;

use App\Models\Bandwidth;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use App\Services\Radius\CoaService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PppoeSyncStatusTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_status_expires_past_due_active_customers(): void
    {
        // Bound before any Artisan call (including $this->seed() below): the
        // console kernel resolves and caches command instances — with whatever
        // CoaService is bound at that moment — the first time Artisan runs, so
        // rebinding after that point would be too late for SyncPppoeStatus's
        // already-constructed instance to see the mock.
        $coaMock = \Mockery::mock(CoaService::class);
        $coaMock->shouldReceive('disconnectUsername')->once()->with('expired_customer')->andReturn([]);
        $coaMock->shouldNotReceive('disconnectUsername')->with('good_customer');
        $this->app->instance(CoaService::class, $coaMock);

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

        // Both start provisioned in RADIUS, as any active subscriber would be.
        foreach (['good_customer', 'expired_customer'] as $username) {
            DB::table('radcheck')->insert([
                'username' => $username,
                'attribute' => 'Cleartext-Password',
                'op' => ':=',
                'value' => 'x',
            ]);
            DB::table('radreply')->insert([
                'username' => $username,
                'attribute' => 'Mikrotik-Rate-Limit',
                'op' => ':=',
                'value' => '10M/10M',
            ]);
        }

        Artisan::call('pppoe:sync-status');

        $activeGood->refresh();
        $activeExpired->refresh();

        $this->assertEquals('active', $activeGood->status);
        $this->assertEquals('expired', $activeExpired->status);

        // The whole point of this command: an expired subscriber must lose the
        // radcheck/radreply rows that let them re-authenticate. A still-active
        // subscriber's rows must be left alone.
        $this->assertDatabaseMissing('radcheck', ['username' => 'expired_customer']);
        $this->assertDatabaseMissing('radreply', ['username' => 'expired_customer']);
        $this->assertDatabaseHas('radcheck', ['username' => 'good_customer']);
        $this->assertDatabaseHas('radreply', ['username' => 'good_customer']);
    }
}
