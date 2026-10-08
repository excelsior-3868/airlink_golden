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
                'phone' => '9800000002',
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
                'phone' => '9800000003',
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

    public function test_non_numeric_or_malformed_phone_is_rejected(): void
    {
        foreach (['abcdefghij', '12345', '9100000000', '98000000011'] as $bad) {
            $this->actingAs($this->admin, 'sanctum')
                ->postJson('/api/pppoe/customers', [
                    'username' => 'badphone_sub',
                    'password' => 'secret123',
                    'phone' => $bad,
                    'plan_id' => $this->plan->id,
                    'activate_now' => false,
                ])
                ->assertStatus(422)
                ->assertJsonValidationErrors('phone');
        }
        $this->assertDatabaseMissing('pppoe_customers', ['username' => 'badphone_sub']);
    }

    public function test_show_returns_recharge_plan_and_lifetime_usage_totals(): void
    {
        $id = DB::table('pppoe_customers')->insertGetId([
            'username' => 'detail_sub', 'password' => 'secret', 'plan_id' => $this->plan->id,
            'owner_id' => $this->admin->id, 'full_name' => 'Detail Sub', 'phone' => '9800000009',
            'status' => 'active', 'simultaneous_use' => 1, 'mac_bind' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('pppoe_recharges')->insert([
            'reference' => 'RCH-DETAIL', 'customer_id' => $id, 'plan_id' => $this->plan->id,
            'owner_id' => $this->admin->id, 'collected_by' => $this->admin->id,
            'price' => 1100, 'base_price' => 1000, 'validity_days' => 30,
            'period_start' => now(), 'period_end' => now()->addDays(30),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ([[100, 300, 60], [50, 150, 30]] as $i => [$in, $out, $time]) {
            DB::table('radacct')->insert([
                'acctsessionid' => "s{$i}", 'acctuniqueid' => "u{$i}", 'username' => 'detail_sub',
                'nasipaddress' => '10.0.0.1', 'acctstarttime' => now()->subHours(3 - $i),
                'acctinputoctets' => $in, 'acctoutputoctets' => $out, 'acctsessiontime' => $time,
            ]);
        }

        $res = $this->actingAs($this->admin, 'sanctum')->getJson("/api/pppoe/customers/{$id}");

        $res->assertOk();
        $res->assertJsonPath('data.recharges.0.plan.name', $this->plan->name);
        $res->assertJsonPath('data.usage_totals.session_count', 2);
        $res->assertJsonPath('data.usage_totals.input_bytes', 150);
        $res->assertJsonPath('data.usage_totals.output_bytes', 450);
        $res->assertJsonPath('data.usage_totals.total_time', 90);
    }

    public function test_usage_endpoint_returns_zero_filled_daily_totals(): void
    {
        $id = DB::table('pppoe_customers')->insertGetId([
            'username' => 'usage_sub', 'password' => 'secret', 'plan_id' => $this->plan->id,
            'owner_id' => $this->admin->id, 'full_name' => 'Usage Sub', 'phone' => '9800000008',
            'status' => 'active', 'simultaneous_use' => 1, 'mac_bind' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // Two sessions started today (Nepal time), one three days ago.
        $noonToday = now('Asia/Kathmandu')->startOfDay()->addHours(12)->utc();
        foreach ([
            ['a', $noonToday, 100, 400, 60],
            ['b', (clone $noonToday)->addMinutes(5), 50, 100, 30],
            ['c', (clone $noonToday)->subDays(3), 10, 20, 5],
        ] as [$k, $at, $in, $out, $time]) {
            DB::table('radacct')->insert([
                'acctsessionid' => $k, 'acctuniqueid' => "uu{$k}", 'username' => 'usage_sub',
                'nasipaddress' => '10.0.0.1', 'acctstarttime' => $at->toDateTimeString(),
                'acctinputoctets' => $in, 'acctoutputoctets' => $out, 'acctsessiontime' => $time,
            ]);
        }

        $res = $this->actingAs($this->admin, 'sanctum')->getJson("/api/pppoe/customers/{$id}/usage?days=7");

        $res->assertOk();
        $this->assertCount(7, $res->json('data.daily'));
        $last = $res->json('data.daily.6');
        $this->assertSame(now('Asia/Kathmandu')->toDateString(), $last['date']);
        $this->assertSame(2, $last['sessions']);
        $this->assertSame(500, $last['download']);
        $this->assertSame(150, $last['upload']);
        $this->assertSame(30, $res->json('data.daily.3.total'));
        $this->assertSame(0, $res->json('data.daily.0.total'));
        $res->assertJsonPath('data.totals.download', 520);
        $res->assertJsonPath('data.totals.upload', 160);
        $res->assertJsonPath('data.totals.total', 680);
        $res->assertJsonPath('data.totals.sessions', 3);
    }

    public function test_reseller_with_insufficient_balance_cannot_activate_customer(): void
    {
        $brokeReseller = $this->makeUser('reseller', ['wallet_balance' => 50]);

        $response = $this->actingAs($brokeReseller, 'sanctum')
            ->postJson('/api/pppoe/customers', [
                'username' => 'broke_sub',
                'phone' => '9800000004',
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
