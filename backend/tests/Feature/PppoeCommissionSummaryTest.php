<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** GET /api/reports/pppoe-commission-summary */
class PppoeCommissionSummaryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $resellerA;
    private User $resellerB;
    private User $seller;
    private InternetPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin');
        $this->resellerA = $this->makeUser('reseller', ['name' => 'Alpha']);
        $this->resellerB = $this->makeUser('reseller', ['name' => 'Beta']);
        $this->seller = $this->makeUser('seller', ['parent_id' => $this->resellerA->id]);

        $this->plan = InternetPlan::create([
            'name' => 'PPPoE 20Mbps', 'type' => 'pppoe', 'package_type' => 'wallet',
            'plan_type' => 'unlimited', 'validity_days' => 30, 'base_price' => 800,
            'selling_price' => 1000, 'created_by' => $this->admin->id,
        ]);
    }

    private function recharge(?User $reseller, float $price, float $adminShare, $createdAt = null): void
    {
        static $n = 0;
        $n++;

        $customerId = DB::table('pppoe_customers')->insertGetId([
            'username' => "csub{$n}", 'password' => 'secret', 'plan_id' => $this->plan->id,
            'owner_id' => $reseller?->id ?? $this->admin->id, 'reseller_id' => $reseller?->id,
            'full_name' => "Sub {$n}", 'status' => 'active', 'simultaneous_use' => 1,
            'mac_bind' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('pppoe_recharges')->insert([
            'reference' => "CRG-{$n}", 'customer_id' => $customerId, 'plan_id' => $this->plan->id,
            'owner_id' => $reseller?->id ?? $this->admin->id, 'reseller_id' => $reseller?->id,
            'collected_by' => $this->admin->id, 'price' => $price, 'base_price' => $price,
            'commission_percent' => $price > 0 ? round($adminShare / $price * 100, 2) : 0,
            'admin_share' => $adminShare, 'reseller_share' => $price - $adminShare,
            'validity_days' => 30, 'period_start' => now(), 'period_end' => now()->addDays(30),
            'created_at' => $createdAt ?? now(), 'updated_at' => $createdAt ?? now(),
        ]);
    }

    public function test_admin_sees_one_row_per_reseller_with_split_sums(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerA, 500, 50);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/reports/pppoe-commission-summary');

        $res->assertOk();
        $rows = collect($res->json('data.rows'))->keyBy('reseller_name');
        $this->assertSame(2, $rows['Alpha']['recharges']);
        $this->assertEquals(1500, $rows['Alpha']['total_sales']);
        $this->assertEquals(150, $rows['Alpha']['admin_share']);
        $this->assertEquals(1350, $rows['Alpha']['reseller_share']);
        $this->assertEquals(10, $rows['Alpha']['commission_percent']);
        $this->assertEquals(20, $rows['Beta']['commission_percent']);
        $res->assertJsonPath('data.totals.recharges', 3);
        $this->assertEquals(3500, $res->json('data.totals.total_sales'));
        $this->assertEquals(550, $res->json('data.totals.admin_share'));
        $this->assertEquals(2950, $res->json('data.totals.reseller_share'));
    }

    public function test_reseller_filter_narrows_rows_and_detail(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary?reseller_id=' . $this->resellerB->id);

        $res->assertOk();
        $this->assertCount(1, $res->json('data.rows'));
        $res->assertJsonPath('data.rows.0.reseller_id', $this->resellerB->id);
        $this->assertCount(1, $res->json('data.recharges'));
        $this->assertEquals(2000, $res->json('data.totals.total_sales'));
    }

    public function test_date_range_is_inclusive(): void
    {
        $this->recharge($this->resellerA, 1000, 100, now()->subDays(10));
        $this->recharge($this->resellerA, 300, 30, now());

        $today = now()->toDateString();
        $res = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/reports/pppoe-commission-summary?from={$today}&to={$today}");

        $res->assertOk();
        $this->assertEquals(300, $res->json('data.totals.total_sales'));
        $res->assertJsonPath('data.totals.recharges', 1);
    }

    public function test_reseller_only_sees_own_row_and_cannot_widen_scope(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->resellerA, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary?reseller_id=' . $this->resellerB->id);

        $res->assertOk();
        $this->assertCount(1, $res->json('data.rows'));
        $res->assertJsonPath('data.rows.0.reseller_id', $this->resellerA->id);
        $this->assertEquals(1000, $res->json('data.totals.total_sales'));
    }

    public function test_recharges_without_a_reseller_go_in_the_direct_bucket(): void
    {
        $this->recharge(null, 700, 0);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/reports/pppoe-commission-summary');

        $res->assertOk();
        $res->assertJsonPath('data.rows.0.reseller_id', null);
        $res->assertJsonPath('data.rows.0.reseller_name', 'Direct (no reseller)');
        $this->assertEquals(700, $res->json('data.rows.0.reseller_share'));
    }

    public function test_a_seller_is_refused(): void
    {
        $this->actingAs($this->seller, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary')
            ->assertStatus(403);
    }
}
