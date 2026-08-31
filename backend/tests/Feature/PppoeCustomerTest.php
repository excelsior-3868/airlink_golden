<?php

namespace Tests\Feature;

use App\Models\Bandwidth;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PppoeCustomerTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $reseller;
    private InternetPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();

        $this->admin = $this->makeUser('admin', ['wallet_balance' => 10000]);
        $this->reseller = $this->makeUser('reseller', ['wallet_balance' => 5000]);

        $bw = Bandwidth::create([
            'name' => '50M',
            'rate_down' => 50,
            'rate_down_unit' => 'Mbps',
            'rate_up' => 50,
            'rate_up_unit' => 'Mbps',
        ]);

        $this->plan = InternetPlan::create([
            'name' => '50Mbps Unlimited',
            'type' => 'pppoe',
            'plan_type' => 'unlimited',
            'package_type' => 'wallet',
            'bandwidth_id' => $bw->id,
            'bandwidth' => '50M/50M',
            'validity_days' => 30,
            'selling_price' => 1200,
            'base_price' => 0,
            'status' => 'active',
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_admin_can_create_active_pppoe_customer(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/pppoe/customers', [
                'username' => 'test_sub_1',
                'password' => 'secret123',
                'full_name' => 'Test Subscriber One',
                'phone' => '9800000001',
                'plan_id' => $this->plan->id,
                'activate_now' => true,
                'periods' => 1,
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('pppoe_customers', [
            'username' => 'test_sub_1',
            'status' => 'active',
            'password' => 'secret123',
        ]);

        // Verify radcheck rows
        $this->assertDatabaseHas('radcheck', [
            'username' => 'test_sub_1',
            'attribute' => 'Cleartext-Password',
            'value' => 'secret123',
        ]);
        $this->assertDatabaseHas('radcheck', [
            'username' => 'test_sub_1',
            'attribute' => 'Simultaneous-Use',
            'value' => '1',
        ]);

        // Verify radreply rows
        $this->assertDatabaseHas('radreply', [
            'username' => 'test_sub_1',
            'attribute' => 'Mikrotik-Rate-Limit',
            'value' => '50M/50M',
        ]);
        $this->assertDatabaseHas('radreply', [
            'username' => 'test_sub_1',
            'attribute' => 'Acct-Interim-Interval',
            'value' => '300',
        ]);

        // Verify recharge record
        $this->assertDatabaseHas('pppoe_recharges', [
            'customer_id' => $response->json('data.id'),
            'price' => 1200,
        ]);
    }

    public function test_admin_can_create_pending_customer_without_radcheck(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/pppoe/customers', [
                'username' => 'pending_sub',
                'password' => 'pass456',
                'full_name' => 'Pending Subscriber',
                'plan_id' => $this->plan->id,
                'activate_now' => false,
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('pppoe_customers', [
            'username' => 'pending_sub',
            'status' => 'pending',
            'expires_at' => null,
        ]);

        // Radcheck must NOT exist for pending subscriber
        $this->assertDatabaseMissing('radcheck', [
            'username' => 'pending_sub',
        ]);
    }

    public function test_reseller_can_create_customer_with_wallet_deduction(): void
    {
        $initialBalance = $this->reseller->wallet_balance;

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->postJson('/api/pppoe/customers', [
                'username' => 'reseller_sub',
                'password' => 'secret789',
                'full_name' => 'Reseller Subscriber',
                'plan_id' => $this->plan->id,
                'activate_now' => true,
                'periods' => 1,
            ]);

        $response->assertStatus(201);
        $this->reseller->refresh();

        // 1200 should be deducted
        $this->assertEquals($initialBalance - 1200, $this->reseller->wallet_balance);
        $this->assertDatabaseHas('pppoe_customers', [
            'username' => 'reseller_sub',
            'reseller_id' => $this->reseller->id,
            'status' => 'active',
        ]);
    }

    public function test_reseller_with_insufficient_balance_cannot_activate_customer(): void
    {
        $brokeReseller = $this->makeUser('reseller', ['wallet_balance' => 50]);

        $response = $this->actingAs($brokeReseller, 'sanctum')
            ->postJson('/api/pppoe/customers', [
                'username' => 'broke_sub',
                'password' => 'secret999',
                'full_name' => 'Broke Subscriber',
                'plan_id' => $this->plan->id,
                'activate_now' => true,
                'periods' => 1,
            ]);

        $response->assertStatus(422);
        $this->assertDatabaseMissing('pppoe_customers', [
            'username' => 'broke_sub',
        ]);
    }

    public function test_suspend_and_resume_pppoe_customer(): void
    {
        $customer = PppoeCustomer::create([
            'username' => 'suspend_test',
            'password' => 'pass123',
            'full_name' => 'Suspend Test',
            'plan_id' => $this->plan->id,
            'owner_id' => $this->admin->id,
            'status' => 'active',
            'expires_at' => now()->addDays(30),
            'bandwidth' => '50M/50M',
        ]);

        // An active subscriber is provisioned in RADIUS; the model was built
        // directly here, so stand the row up to match that invariant.
        DB::table('radcheck')->insert([
            'username' => 'suspend_test',
            'attribute' => 'Cleartext-Password',
            'op' => ':=',
            'value' => 'pass123',
        ]);

        // Suspend
        $res = $this->actingAs($this->admin, 'sanctum')
            ->patchJson("/api/pppoe/customers/{$customer->id}/suspend");

        $res->assertStatus(200);
        $this->assertDatabaseHas('pppoe_customers', [
            'id' => $customer->id,
            'status' => 'suspended',
        ]);

        // No FreeRADIUS-side status gate exists — radcheck/radreply MUST be
        // deleted on suspend, or the subscriber can simply re-authenticate
        // with their existing credentials while "suspended".
        $this->assertDatabaseMissing('radcheck', [
            'username' => 'suspend_test',
        ]);
        $this->assertDatabaseMissing('radreply', [
            'username' => 'suspend_test',
        ]);

        // Resume
        $res = $this->actingAs($this->admin, 'sanctum')
            ->patchJson("/api/pppoe/customers/{$customer->id}/resume");

        $res->assertStatus(200);
        $this->assertDatabaseHas('pppoe_customers', [
            'id' => $customer->id,
            'status' => 'active',
        ]);

        // Resume must rebuild radius rows so the customer can authenticate again.
        $this->assertDatabaseHas('radcheck', [
            'username' => 'suspend_test',
            'attribute' => 'Cleartext-Password',
            'value' => 'pass123',
        ]);
    }

    public function test_delete_customer_cleans_radius_rows(): void
    {
        $customer = PppoeCustomer::create([
            'username' => 'delete_test',
            'password' => 'pass123',
            'full_name' => 'Delete Test',
            'plan_id' => $this->plan->id,
            'owner_id' => $this->admin->id,
            'status' => 'active',
            'expires_at' => now()->addDays(30),
            'bandwidth' => '50M/50M',
        ]);

        // Ensure radcheck rows exist
        DB::table('radcheck')->insert([
            'username' => 'delete_test',
            'attribute' => 'Cleartext-Password',
            'op' => ':=',
            'value' => 'pass123',
        ]);

        $res = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/pppoe/customers/{$customer->id}");

        $res->assertStatus(200);
        $this->assertDatabaseMissing('pppoe_customers', ['id' => $customer->id]);
        $this->assertDatabaseMissing('radcheck', ['username' => 'delete_test']);
    }
}
