<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_dashboard_excludes_legacy_and_unsold_vouchers_from_top_resellers_and_sellers(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', [
            'username' => 'reseller1',
            'commission_percent' => 10,
        ]);
        $seller = $this->makeUser('seller', [
            'parent_id' => $reseller->id,
            'username' => 'seller1',
        ]);
        $plan = InternetPlan::create([
            'name' => 'Test Plan',
            'plan_type' => 'time',
            'selling_price' => 500,
            'package_type' => 'wallet',
            'validity_days' => 30,
            'status' => 'active',
        ]);

        // 1. Legacy vouchers (legacy_id set) — should NOT appear in top resellers/sellers
        Voucher::create([
            'code' => 'LEGACY01',
            'username' => 'LEGACY01',
            'password' => 'LEGACY01',
            'reseller_id' => $reseller->id,
            'seller_id' => $seller->id,
            'plan_id' => $plan->id,
            'owner_id' => $reseller->id,
            'legacy_id' => 999001,
            'price' => 10000,
            'base_price' => 10000,
            'status' => 'used',
            'sold_at' => now(),
            'validity_days' => 30,
        ]);

        // 2. Unsold v3 voucher (status: ready, sold_at/activated_at: null) — should NOT appear
        Voucher::create([
            'code' => 'V3READY01',
            'username' => 'V3READY01',
            'password' => 'V3READY01',
            'reseller_id' => $reseller->id,
            'seller_id' => $seller->id,
            'plan_id' => $plan->id,
            'owner_id' => $reseller->id,
            'legacy_id' => null,
            'price' => 500,
            'base_price' => 500,
            'status' => 'ready',
            'sold_at' => null,
            'activated_at' => null,
            'validity_days' => 30,
        ]);

        $response = $this->actingAs($admin, 'sanctum')->getJson('/api/dashboard');
        $response->assertOk();
        $this->assertEmpty($response->json('data.top_resellers'));
        $this->assertEmpty($response->json('data.top_sellers'));

        // 3. Genuine v3 sold voucher — SHOULD appear now
        Voucher::create([
            'code' => 'V3SOLD01',
            'username' => 'V3SOLD01',
            'password' => 'V3SOLD01',
            'reseller_id' => $reseller->id,
            'seller_id' => $seller->id,
            'plan_id' => $plan->id,
            'owner_id' => $seller->id,
            'legacy_id' => null,
            'price' => 500,
            'base_price' => 500,
            'status' => 'active',
            'sold_at' => now(),
            'admin_share' => 50,
            'reseller_share' => 450,
            'validity_days' => 30,
        ]);

        $response2 = $this->actingAs($admin, 'sanctum')->getJson('/api/dashboard');
        $response2->assertOk();

        $topResellers = $response2->json('data.top_resellers');
        $this->assertCount(1, $topResellers);
        $this->assertEquals('reseller1', $topResellers[0]['user']);
        $this->assertEquals(1, $topResellers[0]['vouchers']);
        $this->assertEquals(500, $topResellers[0]['revenue']);
        $this->assertEquals(50, $topResellers[0]['commission']);

        $topSellers = $response2->json('data.top_sellers');
        $this->assertCount(1, $topSellers);
        $this->assertEquals('seller1', $topSellers[0]['user']);
        $this->assertEquals(1, $topSellers[0]['vouchers']);
        $this->assertEquals(500, $topSellers[0]['revenue']);
    }
}
