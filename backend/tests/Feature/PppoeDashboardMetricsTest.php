<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** GET /api/dashboard — the pppoe_metrics block. */
class PppoeDashboardMetricsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $resA;
    private User $resB;
    private InternetPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin');
        $this->resA = $this->makeUser('reseller', ['name' => 'Alpha']);
        $this->resB = $this->makeUser('reseller', ['name' => 'Beta']);
        $this->plan = InternetPlan::create([
            'name' => 'PPPoE 20Mbps', 'type' => 'pppoe', 'package_type' => 'wallet',
            'plan_type' => 'unlimited', 'validity_days' => 30, 'base_price' => 800,
            'selling_price' => 1000, 'created_by' => $this->admin->id,
        ]);
    }

    private function customer(User $reseller, array $o = []): int
    {
        static $n = 0;
        $n++;

        return DB::table('pppoe_customers')->insertGetId(array_merge([
            'username' => "dm{$n}", 'password' => 'x', 'plan_id' => $this->plan->id,
            'owner_id' => $reseller->id, 'reseller_id' => $reseller->id, 'full_name' => "Sub {$n}",
            'status' => 'active', 'simultaneous_use' => 1, 'mac_bind' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ], $o));
    }

    private function recharge(int $customerId, User $reseller, float $price, float $adminShare, $at = null): void
    {
        static $n = 0;
        $n++;

        DB::table('pppoe_recharges')->insert([
            'reference' => "DM-{$n}", 'customer_id' => $customerId, 'plan_id' => $this->plan->id,
            'owner_id' => $reseller->id, 'reseller_id' => $reseller->id, 'collected_by' => $this->admin->id,
            'price' => $price, 'base_price' => $price, 'admin_share' => $adminShare,
            'reseller_share' => $price - $adminShare, 'validity_days' => 30,
            'period_start' => now(), 'period_end' => now()->addDays(30),
            'created_at' => $at ?? now(), 'updated_at' => $at ?? now(),
        ]);
    }

    public function test_admin_sees_system_wide_revenue_commission_trend_and_top_resellers(): void
    {
        $a = $this->customer($this->resA);
        $b = $this->customer($this->resB);
        $this->recharge($a, $this->resA, 1000, 100);
        $this->recharge($b, $this->resB, 2000, 400);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/dashboard');

        $res->assertOk();
        $m = $res->json('data.pppoe_metrics');
        $this->assertEquals(3000, $m['revenue']['today']);
        $this->assertEquals(3000, $m['revenue']['month']);
        $this->assertSame(2, $m['revenue']['recharges_today']);
        $this->assertEquals(500, $m['commission']['admin_share_month']);
        $this->assertEquals(2500, $m['commission']['reseller_share_month']);
        $this->assertSame(2, $m['new_subscribers']['today']);
        $this->assertCount(7, $m['daily_trend']);
        $this->assertEquals(3000, $m['daily_trend'][6]['revenue']);
        $this->assertSame('Beta', $m['top_resellers'][0]['reseller_name']);
        $this->assertSame(2, $m['plan_distribution'][0]['subscribers']);
    }

    public function test_reseller_only_sees_own_figures_and_no_top_resellers(): void
    {
        $a = $this->customer($this->resA);
        $b = $this->customer($this->resB);
        $this->recharge($a, $this->resA, 1000, 100);
        $this->recharge($b, $this->resB, 2000, 400);

        $res = $this->actingAs($this->resA, 'sanctum')->getJson('/api/dashboard');

        $res->assertOk();
        $m = $res->json('data.pppoe_metrics');
        $this->assertEquals(1000, $m['revenue']['month']);
        $this->assertEquals(100, $m['commission']['admin_share_month']);
        $this->assertEquals(900, $m['commission']['reseller_share_month']);
        $this->assertSame(1, $m['new_subscribers']['month']);
        $this->assertArrayNotHasKey('top_resellers', $m);
        $this->assertCount(1, $m['recent_recharges']);
    }

    public function test_expiring_soon_counts_only_active_subscribers_inside_the_window(): void
    {
        $this->customer($this->resA, ['expires_at' => now()->addDays(2)]);
        $this->customer($this->resA, ['expires_at' => now()->addDays(20)]);
        $this->customer($this->resA, ['expires_at' => now()->addDays(3), 'status' => 'suspended']);
        $this->customer($this->resA, ['expires_at' => now()->subDay()]);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/dashboard');

        $res->assertOk();
        $this->assertSame(1, $res->json('data.pppoe_metrics.expiring_soon.count'));
        $this->assertCount(1, $res->json('data.pppoe_metrics.expiring_soon.items'));
    }

    public function test_online_now_counts_live_pppoe_sessions_only(): void
    {
        $c = $this->customer($this->resA, ['username' => 'live_sub']);
        DB::table('radacct')->insert([
            'acctsessionid' => 'live1', 'acctuniqueid' => 'live1', 'username' => 'live_sub',
            'nasipaddress' => '10.0.0.1', 'acctstarttime' => now()->subMinutes(5),
            'acctupdatetime' => now(), 'acctstoptime' => null,
        ]);
        DB::table('radacct')->insert([
            'acctsessionid' => 'hs1', 'acctuniqueid' => 'hs1', 'username' => 'some_voucher',
            'nasipaddress' => '10.0.0.1', 'acctstarttime' => now()->subMinutes(5),
            'acctupdatetime' => now(), 'acctstoptime' => null,
        ]);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/dashboard');

        $res->assertOk();
        $this->assertSame(1, $res->json('data.pppoe_metrics.online_now'));
    }
}
