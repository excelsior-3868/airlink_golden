<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * GET /api/reports/pppoe-sales-summary — what is left after the voucher half was
 * removed from the old combined Sales Summary report.
 */
class PppoeSalesSummaryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $reseller;
    private User $otherReseller;
    private User $seller;
    private InternetPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin');
        $this->reseller = $this->makeUser('reseller');
        $this->otherReseller = $this->makeUser('reseller');
        $this->seller = $this->makeUser('seller', ['parent_id' => $this->reseller->id]);

        $this->plan = InternetPlan::create([
            'name' => 'PPPoE 20Mbps',
            'type' => 'pppoe',
            'package_type' => 'wallet',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 800,
            'selling_price' => 1000,
            'created_by' => $this->admin->id,
        ]);
    }

    private function makeCustomer(User $reseller, array $overrides = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('pppoe_customers')->insertGetId(array_merge([
            'username' => "sub{$n}",
            'password' => 'secret',
            'plan_id' => $this->plan->id,
            'owner_id' => $reseller->id,
            'reseller_id' => $reseller->id,
            'full_name' => "Subscriber {$n}",
            'status' => 'active',
            'simultaneous_use' => 1,
            'contract_price' => 1200,
            'mac_bind' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function makeRecharge(int $customerId, User $reseller, float $price): void
    {
        static $n = 0;
        $n++;

        DB::table('pppoe_recharges')->insert([
            'reference' => "RCG-{$n}",
            'customer_id' => $customerId,
            'plan_id' => $this->plan->id,
            'owner_id' => $reseller->id,
            'reseller_id' => $reseller->id,
            'collected_by' => $this->admin->id,
            'price' => $price,
            'base_price' => $price,
            'validity_days' => 30,
            'period_start' => now(),
            'period_end' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_it_reports_pppoe_only_and_never_leaks_voucher_revenue(): void
    {
        $customer = $this->makeCustomer($this->reseller);
        $this->makeRecharge($customer, $this->reseller, 1500);

        // A voucher sold the same day, against a plan of its own. The old
        // combined report would have folded its price into the total.
        $voucherPlan = InternetPlan::create([
            'name' => 'Hotspot 1 Day',
            'type' => 'hotspot',
            'package_type' => 'wallet',
            'plan_type' => 'unlimited',
            'validity_days' => 1,
            'base_price' => 40,
            'selling_price' => 50,
            'created_by' => $this->admin->id,
        ]);

        Voucher::create([
            'code' => 'VCHR0001',
            'username' => 'VCHR0001',
            'password' => 'VCHR0001',
            'plan_id' => $voucherPlan->id,
            'reseller_id' => $this->reseller->id,
            'owner_id' => $this->reseller->id,
            'base_price' => 40,
            'price' => 50,
            'status' => 'used',
            'activated_at' => now(),
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary?from=' . now()->toDateString() . '&to=' . now()->toDateString());

        $response->assertStatus(200);

        // 1200 contract price + 1500 recharge, and not a rupee of the voucher.
        $response->assertJsonPath('data.summary.new_subscribers.count', 1);
        $response->assertJsonPath('data.summary.new_subscribers.revenue', 1200);
        $response->assertJsonPath('data.summary.recharges.count', 1);
        $response->assertJsonPath('data.summary.recharges.revenue', 1500);
        $response->assertJsonPath('data.summary.total_revenue', 2700);

        // The voucher half is gone from the payload, not merely hidden in the UI.
        $data = $response->json('data');
        $this->assertArrayNotHasKey('voucher_plans', $data);
        $this->assertArrayNotHasKey('wallet_voucher_sales', $data['summary']);
        $this->assertArrayNotHasKey('gb_voucher_sales', $data['summary']);
    }

    public function test_a_seller_is_refused(): void
    {
        // The page is PPPoE-only and PPPoE is admin + reseller, so a seller now
        // gets 403 rather than a page of zeroes with two empty tabs.
        $this->actingAs($this->seller, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary')
            ->assertStatus(403);
    }

    public function test_one_reseller_cannot_see_another_resellers_subscribers(): void
    {
        $mine = $this->makeCustomer($this->reseller);
        $this->makeRecharge($mine, $this->reseller, 900);

        $theirs = $this->makeCustomer($this->otherReseller);
        $this->makeRecharge($theirs, $this->otherReseller, 4000);

        $response = $this->actingAs($this->reseller, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary');

        $response->assertStatus(200);
        $response->assertJsonPath('data.summary.new_subscribers.count', 1);
        $response->assertJsonPath('data.summary.recharges.revenue', 900);

        // The admin, unfiltered, sees both.
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary')
            ->assertJsonPath('data.summary.new_subscribers.count', 2)
            ->assertJsonPath('data.summary.recharges.revenue', 4900);

        // And can narrow to one of them.
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary?reseller_id=' . $this->otherReseller->id)
            ->assertJsonPath('data.summary.recharges.revenue', 4000);
    }

    public function test_the_date_range_bounds_both_halves(): void
    {
        $old = $this->makeCustomer($this->reseller, [
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);
        $this->makeRecharge($old, $this->reseller, 700);
        DB::table('pppoe_recharges')->update(['created_at' => now()->subDays(10)]);

        $recent = $this->makeCustomer($this->reseller);
        $this->makeRecharge($recent, $this->reseller, 300);

        $today = now()->toDateString();

        $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/reports/pppoe-sales-summary?from={$today}&to={$today}")
            ->assertJsonPath('data.summary.new_subscribers.count', 1)
            ->assertJsonPath('data.summary.recharges.revenue', 300);

        $from = now()->subDays(30)->toDateString();

        $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/reports/pppoe-sales-summary?from={$from}&to={$today}")
            ->assertJsonPath('data.summary.new_subscribers.count', 2)
            ->assertJsonPath('data.summary.recharges.revenue', 1000);
    }

    public function test_it_includes_created_by_recharged_by_daily_trend_and_performer_breakdown(): void
    {
        $customer = $this->makeCustomer($this->reseller, ['full_name' => 'Alice Smith']);
        $this->makeRecharge($customer, $this->reseller, 1200);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-sales-summary?from=' . now()->toDateString() . '&to=' . now()->toDateString());

        $response->assertStatus(200);
        $response->assertJsonPath('data.new_subscribers.0.created_by', $this->reseller->name);
        $response->assertJsonPath('data.recharges.0.recharged_by', $this->admin->name);
        $response->assertJsonPath('data.daily_trend.0.new_subscribers_count', 1);
        $response->assertJsonPath('data.daily_trend.0.recharges_count', 1);
        $response->assertJsonStructure([
            'data' => [
                'daily_trend',
                'performer_breakdown',
                'new_subscribers',
                'recharges',
            ],
        ]);
    }
}
