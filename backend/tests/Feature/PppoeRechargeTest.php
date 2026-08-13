<?php

namespace Tests\Feature;

use App\Models\Bandwidth;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PppoeRechargeTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $reseller;
    private InternetPlan $plan;
    private PppoeCustomer $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();

        $this->admin = $this->makeUser('admin', ['wallet_balance' => 10000]);
        $this->reseller = $this->makeUser('reseller', [
            'wallet_balance' => 5000,
            'parent_id' => $this->admin->id,
            'commission_percent' => 10,
        ]);

        $bw = Bandwidth::create([
            'name' => '100M',
            'rate_down' => 100,
            'rate_down_unit' => 'Mbps',
            'rate_up' => 100,
            'rate_up_unit' => 'Mbps',
        ]);

        $this->plan = InternetPlan::create([
            'name' => '100Mbps Unlimited',
            'type' => 'pppoe',
            'plan_type' => 'unlimited',
            'package_type' => 'wallet',
            'bandwidth_id' => $bw->id,
            'bandwidth' => '100M/100M',
            'validity_days' => 30,
            'selling_price' => 2000,
            'base_price' => 0,
            'status' => 'active',
            'created_by' => $this->admin->id,
        ]);

        $this->customer = PppoeCustomer::create([
            'username' => 'recharge_test_user',
            'password' => 'secretpass',
            'full_name' => 'Recharge Test User',
            'plan_id' => $this->plan->id,
            'owner_id' => $this->reseller->id,
            'reseller_id' => $this->reseller->id,
            'status' => 'active',
            'expires_at' => now()->addDays(5),
            'bandwidth' => '100M/100M',
        ]);
    }

    public function test_recharge_extends_expiry_from_existing_date_if_active(): void
    {
        $existingExpiry = $this->customer->expires_at;

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->postJson("/api/pppoe/customers/{$this->customer->id}/recharge", [
                'plan_id' => $this->plan->id,
                'periods' => 1,
                'payment_method' => 'wallet',
            ]);

        $response->assertStatus(201);
        $this->customer->refresh();

        // 30 days added to existing 5 days = ~35 days from now
        $this->assertEquals(
            $existingExpiry->copy()->addDays(30)->toDateString(),
            $this->customer->expires_at->toDateString()
        );

        $this->assertDatabaseHas('pppoe_recharges', [
            'customer_id' => $this->customer->id,
            'price' => 2000,
            'reseller_id' => $this->reseller->id,
        ]);
    }

    public function test_recharge_starts_from_now_if_expired(): void
    {
        $this->customer->update([
            'status' => 'expired',
            'expires_at' => now()->subDays(10),
        ]);

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->postJson("/api/pppoe/customers/{$this->customer->id}/recharge", [
                'plan_id' => $this->plan->id,
                'periods' => 2, // 60 days
                'payment_method' => 'wallet',
            ]);

        $response->assertStatus(201);
        $this->customer->refresh();

        $this->assertEquals('active', $this->customer->status);
        $this->assertEquals(now()->addDays(60)->toDateString(), $this->customer->expires_at->toDateString());
    }

    public function test_reseller_commission_accounting_on_recharge(): void
    {
        $initialResellerBalance = $this->reseller->wallet_balance;

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->postJson("/api/pppoe/customers/{$this->customer->id}/recharge", [
                'plan_id' => $this->plan->id,
                'periods' => 1,
                'payment_method' => 'wallet',
            ]);

        $response->assertStatus(201);
        $this->reseller->refresh();

        // Wallet deducted full price
        $this->assertEquals($initialResellerBalance - 2000, $this->reseller->wallet_balance);

        // Commission share
        $recharge = $this->customer->recharges()->latest()->first();
        $this->assertNotNull($recharge);
        $this->assertEquals(2000, $recharge->price);
    }
}
