<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Same leak as VoucherApiTokenScopingTest, in PlanController::index instead: a scoped
 * third-party integration token bound to a reseller must not surface that reseller's downline
 * sellers' own plans (e.g. Trekkers Inn seeing a plan a downline seller created for their own
 * retail stock). The reseller's own SPA session (['*']) still sees its whole downline, unchanged.
 */
class PlanApiTokenScopingTest extends TestCase
{
    use RefreshDatabase;

    private function plan(User $creator, string $name): InternetPlan
    {
        return InternetPlan::create([
            'name' => $name, 'plan_type' => 'data', 'bandwidth' => '10M/10M',
            'data_gb' => 1, 'validity_days' => 1, 'base_price' => 100, 'selling_price' => 150,
            'status' => 'active', 'created_by' => $creator->id,
        ]);
    }

    public function test_scoped_integration_token_does_not_see_downline_sellers_own_plan(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        $this->plan($reseller, 'Reseller Own Plan');
        $this->plan($seller, 'Seller Own Plan');

        Sanctum::actingAs($reseller, ['plans.read']);

        $res = $this->getJson('/api/plans?active_only=1');
        $res->assertStatus(200);

        $names = collect($res->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Reseller Own Plan'));
        $this->assertFalse($names->contains('Seller Own Plan'), 'A scoped integration token must not see a downline seller\'s own plan.');
    }

    public function test_full_access_spa_token_still_sees_downline_sellers_plan(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        $this->plan($reseller, 'Reseller Own Plan 2');
        $this->plan($seller, 'Seller Own Plan 2');

        Sanctum::actingAs($reseller, ['*']);

        $res = $this->getJson('/api/plans?active_only=1');
        $res->assertStatus(200);

        $names = collect($res->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Reseller Own Plan 2'));
        $this->assertTrue($names->contains('Seller Own Plan 2'), 'The reseller\'s own SPA session should still see its downline sellers\' plans.');
    }
}
