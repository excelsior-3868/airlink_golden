<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A third-party integration (e.g. Trekkers Inn) is bound to one specific reseller/seller
 * account via a scoped Sanctum token (see IntegrationTokenController). That binding must never
 * leak a reseller's downline sellers' own voucher stock — only vouchers the bound account itself
 * owns. The reseller's own SPA session (abilities ['*']) is unaffected: it still sees its whole
 * downline, same as before.
 */
class VoucherApiTokenScopingTest extends TestCase
{
    use RefreshDatabase;

    private function plan(): InternetPlan
    {
        return InternetPlan::create([
            'name' => '5GB', 'plan_type' => 'data', 'bandwidth' => '10M/10M',
            'data_gb' => 5, 'validity_days' => 30, 'base_price' => 100, 'selling_price' => 150, 'status' => 'active',
        ]);
    }

    private function voucherFor(User $owner, User $reseller, ?User $seller, InternetPlan $plan, string $code): Voucher
    {
        return Voucher::create([
            'code' => $code, 'username' => $code, 'password' => $code,
            'plan_id' => $plan->id,
            'owner_id' => $owner->id, 'reseller_id' => $reseller->id, 'seller_id' => $seller?->id,
            'validity_days' => 30, 'status' => 'active',
        ]);
    }

    public function test_scoped_integration_token_only_sees_the_bound_resellers_own_vouchers(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();

        $this->voucherFor($reseller, $reseller, null, $plan, 'RESOWN01');
        $this->voucherFor($seller, $reseller, $seller, $plan, 'SELLSTOCK1');

        Sanctum::actingAs($reseller, ['vouchers.read']);

        $res = $this->getJson('/api/vouchers');
        $res->assertStatus(200);

        $codes = collect($res->json('data.data'))->pluck('code');
        $this->assertTrue($codes->contains('RESOWN01'));
        $this->assertFalse($codes->contains('SELLSTOCK1'), 'A scoped integration token must not see a downline seller\'s own voucher stock.');
    }

    public function test_full_access_spa_token_still_sees_whole_downline(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();

        $this->voucherFor($reseller, $reseller, null, $plan, 'RESOWN02');
        $this->voucherFor($seller, $reseller, $seller, $plan, 'SELLSTOCK2');

        Sanctum::actingAs($reseller, ['*']);

        $res = $this->getJson('/api/vouchers');
        $res->assertStatus(200);

        $codes = collect($res->json('data.data'))->pluck('code');
        $this->assertTrue($codes->contains('RESOWN02'));
        $this->assertTrue($codes->contains('SELLSTOCK2'), 'The reseller\'s own SPA session should still see its downline sellers\' vouchers.');
    }

    public function test_scoped_integration_token_cannot_sell_a_downline_sellers_voucher(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();

        $sellerVoucher = $this->voucherFor($seller, $reseller, $seller, $plan, 'SELLSTOCK3');

        Sanctum::actingAs($reseller, ['vouchers.read', 'vouchers.sell']);

        $res = $this->postJson("/api/vouchers/{$sellerVoucher->id}/sell", []);
        $res->assertStatus(404);
    }
}
