<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VoucherStockStatusCountTest extends TestCase
{
    use RefreshDatabase;

    private function plan(User $creator, string $name): InternetPlan
    {
        return InternetPlan::create([
            'name' => $name,
            'plan_type' => 'data',
            'package_type' => 'gb',
            'bandwidth' => '10M/10M',
            'data_gb' => 5,
            'validity_days' => 28,
            'base_price' => 300,
            'selling_price' => 450,
            'status' => 'active',
            'created_by' => $creator->id,
        ]);
    }

    private function createVoucher(InternetPlan $plan, User $reseller, string $status, ?string $voidReason = null): Voucher
    {
        return Voucher::create([
            'code' => 'VCH-' . fake()->unique()->slug(),
            'username' => 'user-' . fake()->unique()->slug(),
            'password' => 'pass123',
            'plan_id' => $plan->id,
            'reseller_id' => $reseller->id,
            'owner_id' => $reseller->id,
            'status' => $status,
            'void_reason' => $voidReason,
            'price' => 450,
            'base_price' => 300,
            'data_gb' => 5,
            'validity_days' => 28,
        ]);
    }

    public function test_plans_index_with_stock_flag_attaches_ready_voucher_count(): void
    {
        $admin = $this->makeUser('admin');
        $plan = $this->plan($admin, 'Test Plan 5GB');

        // Create 3 ready, 2 active, 1 voided ready voucher
        $this->createVoucher($plan, $admin, 'ready');
        $this->createVoucher($plan, $admin, 'ready');
        $this->createVoucher($plan, $admin, 'ready');
        $this->createVoucher($plan, $admin, 'active');
        $this->createVoucher($plan, $admin, 'ready', 'bad_import');

        Sanctum::actingAs($admin, ['plans.read']);

        // Without flag
        $resNormal = $this->getJson('/api/plans?active_only=1');
        $resNormal->assertStatus(200);
        $planNormal = collect($resNormal->json('data'))->firstWhere('id', $plan->id);
        $this->assertArrayNotHasKey('ready_voucher_count', $planNormal);

        // With flag
        $resStock = $this->getJson('/api/plans?active_only=1&with_stock=1');
        $resStock->assertStatus(200);
        $planStock = collect($resStock->json('data'))->firstWhere('id', $plan->id);
        $this->assertArrayHasKey('ready_voucher_count', $planStock);
        $this->assertEquals(3, $planStock['ready_voucher_count']);
    }

    public function test_vouchers_index_with_status_counts_attaches_breakdown_ignoring_status_filter(): void
    {
        $admin = $this->makeUser('admin');
        $plan = $this->plan($admin, 'Voucher Test Plan');

        for ($i = 0; $i < 4; $i++) {
            $this->createVoucher($plan, $admin, 'ready');
        }
        for ($i = 0; $i < 3; $i++) {
            $this->createVoucher($plan, $admin, 'active');
        }
        for ($i = 0; $i < 2; $i++) {
            $this->createVoucher($plan, $admin, 'used');
        }
        $this->createVoucher($plan, $admin, 'disabled');

        Sanctum::actingAs($admin, ['vouchers.read']);

        // Without flag
        $resNormal = $this->getJson('/api/vouchers?per_page=20');
        $resNormal->assertStatus(200);
        $this->assertArrayNotHasKey('status_counts', $resNormal->json('data'));

        // With flag
        $resCounts = $this->getJson('/api/vouchers?per_page=20&with_status_counts=1');
        $resCounts->assertStatus(200);
        $counts = $resCounts->json('data.status_counts');
        $this->assertEquals([
            'ready' => 4,
            'active' => 3,
            'used' => 2,
            'disabled' => 1,
        ], $counts);

        // With status filter (status=ready) + with_status_counts=1
        $resFiltered = $this->getJson('/api/vouchers?status=ready&with_status_counts=1');
        $resFiltered->assertStatus(200);
        // data array should contain only ready vouchers (4 items)
        $this->assertEquals(4, $resFiltered->json('data.total'));
        // status_counts should still report all 4 statuses breakdown for the matching query filters
        $this->assertEquals([
            'ready' => 4,
            'active' => 3,
            'used' => 2,
            'disabled' => 1,
        ], $resFiltered->json('data.status_counts'));
    }
}
