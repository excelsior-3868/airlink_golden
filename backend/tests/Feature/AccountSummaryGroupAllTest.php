<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /api/reports/reseller-summary?group=all — both account tiers in one list.
 *
 * The trap this guards: a reseller's cards hang off vouchers.reseller_id and a
 * seller's off vouchers.seller_id. Putting both tiers in one list and keying the
 * aggregate off a single column reports zeros for half the rows — and reads as
 * "that account has sold nothing" rather than as a bug.
 */
class AccountSummaryGroupAllTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $reseller;
    private User $seller;
    private User $otherReseller;
    private InternetPlan $plan;
    private int $n = 0;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin', ['name' => 'Admin Root']);
        $this->reseller = $this->makeUser('reseller', ['name' => 'Bravo Reseller']);
        $this->otherReseller = $this->makeUser('reseller', ['name' => 'Alpha Reseller']);
        $this->seller = $this->makeUser('seller', ['name' => 'Zulu Seller', 'parent_id' => $this->reseller->id]);

        $this->plan = InternetPlan::create([
            'name' => 'Hotspot 1 Day',
            'type' => 'hotspot',
            'package_type' => 'gb',
            'plan_type' => 'unlimited',
            'validity_days' => 1,
            'base_price' => 40,
            'selling_price' => 50,
            'data_gb' => 2,
            'created_by' => $this->admin->id,
        ]);
    }

    /**
     * A card belonging to a reseller (seller_id null) or to one of its sellers.
     * `$sold` drives whether it counts toward sales or sits in stock.
     */
    private function makeVoucher(User $reseller, ?User $seller, bool $sold): void
    {
        $this->n++;
        $code = 'V' . str_pad((string) $this->n, 7, '0', STR_PAD_LEFT);

        Voucher::create([
            'code' => $code,
            'username' => $code,
            'password' => $code,
            'plan_id' => $this->plan->id,
            'reseller_id' => $reseller->id,
            'seller_id' => $seller?->id,
            'owner_id' => $seller?->id ?? $reseller->id,
            'base_price' => 40,
            'price' => 50,
            'data_gb' => 2,
            'status' => $sold ? 'used' : 'ready',
        ]);
    }

    public function test_each_tier_is_keyed_on_its_own_ownership_column(): void
    {
        // Reseller-held cards: 5 generated, 3 sold. seller_id is null on these,
        // so an aggregate keyed on seller_id would miss all of them.
        for ($i = 0; $i < 3; $i++) {
            $this->makeVoucher($this->reseller, null, true);
        }
        for ($i = 0; $i < 2; $i++) {
            $this->makeVoucher($this->reseller, null, false);
        }

        // Seller-held cards: 3 generated, 2 sold. These carry the same
        // reseller_id, so an aggregate keyed on reseller_id would fold them into
        // the reseller's row instead of the seller's.
        for ($i = 0; $i < 2; $i++) {
            $this->makeVoucher($this->reseller, $this->seller, true);
        }
        $this->makeVoucher($this->reseller, $this->seller, false);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=all');

        $response->assertStatus(200);

        $accounts = collect($response->json('data.accounts'));

        $resellerRow = $accounts->firstWhere('id', $this->reseller->id);
        $this->assertEquals('reseller', $resellerRow['role']);
        $this->assertEquals(5, $resellerRow['cards_generated']);
        $this->assertEquals(3, $resellerRow['cards_sold']);
        $this->assertEquals(2, $resellerRow['cards_in_stock']);
        $this->assertEquals(150, $resellerRow['sales_amount']);

        $sellerRow = $accounts->firstWhere('id', $this->seller->id);
        $this->assertEquals('seller', $sellerRow['role']);
        $this->assertEquals(3, $sellerRow['cards_generated']);
        $this->assertEquals(2, $sellerRow['cards_sold']);
        $this->assertEquals(1, $sellerRow['cards_in_stock']);
        $this->assertEquals(100, $sellerRow['sales_amount']);

        // Neither row is blank — the specific failure a shared group column
        // would produce.
        $this->assertGreaterThan(0, $resellerRow['cards_generated']);
        $this->assertGreaterThan(0, $sellerRow['cards_generated']);
    }

    public function test_results_are_ordered_role_then_name(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=all');

        $labels = collect($response->json('data.accounts'))
            ->map(fn ($a) => "{$a['role']}:{$a['name']}")
            ->all();

        // Resellers alphabetically, then sellers — so the sectioned combo is not
        // interleaving the two tiers.
        $this->assertSame([
            'reseller:Alpha Reseller',
            'reseller:Bravo Reseller',
            'seller:Zulu Seller',
        ], $labels);
    }

    public function test_single_role_and_unknown_group_paths_are_unchanged(): void
    {
        $this->makeVoucher($this->reseller, null, true);
        $this->makeVoucher($this->reseller, $this->seller, true);

        $resellerOnly = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=reseller');
        $resellerOnly->assertJsonPath('data.role_label', 'reseller');
        $this->assertEqualsCanonicalizing(
            ['reseller'],
            collect($resellerOnly->json('data.accounts'))->pluck('role')->unique()->values()->all()
        );

        $sellerOnly = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=seller');
        $sellerOnly->assertJsonPath('data.role_label', 'seller');
        $this->assertEqualsCanonicalizing(
            ['seller'],
            collect($sellerOnly->json('data.accounts'))->pluck('role')->unique()->values()->all()
        );

        // An unrecognised value still falls back to the reseller tier.
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=nonsense')
            ->assertJsonPath('data.role_label', 'reseller');
    }

    public function test_a_reseller_sees_itself_and_its_own_sellers_only(): void
    {
        $foreignSeller = $this->makeUser('seller', ['name' => 'Foreign Seller', 'parent_id' => $this->otherReseller->id]);
        $this->makeVoucher($this->otherReseller, $foreignSeller, true);
        $this->makeVoucher($this->reseller, $this->seller, true);

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->getJson('/api/reports/reseller-summary?group=all');

        $ids = collect($response->json('data.accounts'))->pluck('id')->all();

        $this->assertEqualsCanonicalizing([$this->reseller->id, $this->seller->id], $ids);
        $this->assertNotContains($this->otherReseller->id, $ids);
        $this->assertNotContains($foreignSeller->id, $ids);
    }
}
