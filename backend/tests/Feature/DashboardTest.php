<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_role_dashboard_carries_network_metrics_and_no_finance(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['username' => 'reseller1']);

        foreach ([$admin, $reseller] as $user) {
            $response = $this->actingAs($user, 'sanctum')->getJson('/api/dashboard');
            $response->assertOk();
            $this->assertSame($user->role, $response->json('data.role'));
            $this->assertArrayHasKey('subscribers', $response->json('data.network_metrics'));
            $this->assertArrayHasKey('online_now', $response->json('data.network_metrics'));

            foreach (['balances', 'revenue', 'commission_due', 'top_resellers', 'top_sellers', 'wallet_distributed'] as $key) {
                $this->assertNull($response->json("data.$key"), "$key must not be exposed");
            }
        }
    }

    public function test_reseller_subscriber_counts_are_limited_to_own_subscribers(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller');
        $other = $this->makeUser('reseller');
        $plan = InternetPlan::create([
            'name' => 'PPPoE 20Mbps', 'type' => 'pppoe', 'package_type' => 'wallet',
            'plan_type' => 'unlimited', 'validity_days' => 30, 'base_price' => 800,
            'selling_price' => 1000, 'created_by' => $admin->id,
        ]);

        foreach ([[$reseller, 'a1'], [$reseller, 'a2'], [$other, 'b1']] as [$owner, $name]) {
            DB::table('pppoe_customers')->insert([
                'username' => $name, 'password' => 'x', 'plan_id' => $plan->id,
                'owner_id' => $owner->id, 'reseller_id' => $owner->id, 'full_name' => $name,
                'status' => 'active', 'simultaneous_use' => 1, 'mac_bind' => 0,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $own = $this->actingAs($reseller, 'sanctum')->getJson('/api/dashboard');
        $this->assertSame(2, $own->json('data.network_metrics.subscribers.total'));

        $all = $this->actingAs($admin, 'sanctum')->getJson('/api/dashboard');
        $this->assertSame(3, $all->json('data.network_metrics.subscribers.total'));
    }

    public function test_seller_dashboard_is_network_only_and_sees_no_subscribers(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        $response = $this->actingAs($seller, 'sanctum')->getJson('/api/dashboard');
        $response->assertOk();
        $this->assertSame('seller', $response->json('data.role'));
        $this->assertSame(0, $response->json('data.network_metrics.subscribers.total'));
        $this->assertNull($response->json('data.balances'));
        $this->assertNull($response->json('data.voucher_sales'));
    }
}
