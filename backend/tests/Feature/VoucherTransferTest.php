<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VoucherTransferTest extends TestCase
{
    use RefreshDatabase;

    private function plan(): InternetPlan
    {
        return InternetPlan::create([
            'name' => '5GB', 'plan_type' => 'data', 'bandwidth' => '10M/10M',
            'data_gb' => 5, 'validity_days' => 30, 'base_price' => 100, 'selling_price' => 150, 'status' => 'active',
        ]);
    }

    /** Create $count 'ready' vouchers already owned by $reseller, unassigned to any seller, serials 26-000001.. */
    private function stockFor($reseller, InternetPlan $plan, int $count): void
    {
        for ($i = 1; $i <= $count; $i++) {
            Voucher::create([
                'code' => 'STK'.$reseller->id.'-'.$i, 'username' => 'STK'.$reseller->id.'-'.$i, 'password' => 'x',
                'serial_number' => sprintf('26-%06d', $i),
                'plan_id' => $plan->id,
                'owner_id' => $reseller->id, 'reseller_id' => $reseller->id, 'seller_id' => null,
                'price' => 150, 'status' => 'ready',
            ]);
        }
    }

    public function test_reseller_allocates_a_serial_range_to_own_seller(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 30);

        Sanctum::actingAs($reseller, ['*']);
        $res = $this->postJson('/api/vouchers/transfers', [
            'to_user_id' => $seller->id,
            'start_serial' => '26-000001',
            'quantity' => 20,
        ]);

        $res->assertStatus(201);
        $this->assertEquals('26-000001', $res->json('data.start_serial'));
        $this->assertEquals('26-000020', $res->json('data.end_serial'));
        $this->assertEquals(20, Voucher::where('seller_id', $seller->id)->where('owner_id', $seller->id)->count());
        $this->assertEquals(10, Voucher::where('reseller_id', $reseller->id)->whereNull('seller_id')->count());
        // The allocated range is exactly 26-000001..26-000020.
        $this->assertEquals(0, Voucher::where('seller_id', $seller->id)->where('serial_number', '>', '26-000020')->count());
    }

    public function test_end_serial_is_derived_and_can_start_mid_range(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 30);

        Sanctum::actingAs($reseller, ['*']);
        $res = $this->postJson('/api/vouchers/transfers', [
            'to_user_id' => $seller->id,
            'start_serial' => '26-000011',
            'quantity' => 5,
        ]);

        $res->assertStatus(201);
        $this->assertEquals('26-000015', $res->json('data.end_serial'));
        $moved = Voucher::where('seller_id', $seller->id)->orderBy('serial_number')->pluck('serial_number');
        $this->assertEquals(['26-000011', '26-000012', '26-000013', '26-000014', '26-000015'], $moved->all());
    }

    public function test_rejects_invalid_serial_format(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => 'not-a-serial', 'quantity' => 5])
            ->assertStatus(422);
    }

    public function test_rejects_transfer_to_non_child_seller(): void
    {
        $admin = $this->makeUser('admin');
        $resellerA = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $resellerB = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $otherSeller = $this->makeUser('seller', ['parent_id' => $resellerB->id]);
        $plan = $this->plan();
        $this->stockFor($resellerA, $plan, 10);

        Sanctum::actingAs($resellerA, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $otherSeller->id, 'start_serial' => '26-000001', 'quantity' => 5])
            ->assertStatus(422);

        $this->assertDatabaseCount('voucher_transfers', 0);
    }

    public function test_rejects_when_range_extends_past_available_stock(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 5);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 10])
            ->assertStatus(422);

        $this->assertEquals(0, Voucher::where('seller_id', $seller->id)->count());
    }

    public function test_rejects_when_a_card_in_the_range_is_not_ready(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 5);

        // Card 3 of the intended 1..5 range has already been sold — the whole
        // allocation must be rejected, not silently short.
        Voucher::where('serial_number', '26-000003')->update(['status' => 'active']);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 5])
            ->assertStatus(422);

        $this->assertDatabaseCount('voucher_transfers', 0);
        $this->assertEquals(0, Voucher::where('seller_id', $seller->id)->count());
    }

    public function test_seller_role_forbidden_from_allocating(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $otherSeller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        Sanctum::actingAs($seller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $otherSeller->id, 'start_serial' => '26-000001', 'quantity' => 1])
            ->assertStatus(403);
    }

    public function test_admin_forbidden_from_allocating(): void
    {
        // Confirmed with the client: allocation is not relevant for an Admin
        // account — only a Reseller may create one. Admin can still view history.
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 5);

        Sanctum::actingAs($admin, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 1])
            ->assertStatus(403);
    }

    public function test_next_serial_starts_at_the_first_card_on_a_fresh_batch(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 30);

        Sanctum::actingAs($reseller, ['*']);
        $res = $this->getJson('/api/vouchers/next-serial');

        $res->assertStatus(200);
        $this->assertEquals('26-000001', $res->json('data.next_serial'));
        $this->assertEquals(30, $res->json('data.available'));
    }

    public function test_next_serial_advances_past_already_allocated_cards(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 30);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 10])
            ->assertStatus(201);

        $res = $this->getJson('/api/vouchers/next-serial');
        $this->assertEquals('26-000011', $res->json('data.next_serial'));
        $this->assertEquals(20, $res->json('data.available'));
    }

    public function test_next_serial_forbidden_for_non_reseller(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        Sanctum::actingAs($seller, ['*']);
        $this->getJson('/api/vouchers/next-serial')->assertStatus(403);

        Sanctum::actingAs($admin, ['*']);
        $this->getJson('/api/vouchers/next-serial')->assertStatus(403);
    }

    public function test_history_is_scoped_per_role(): void
    {
        $admin = $this->makeUser('admin');
        $resellerA = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $resellerB = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $sellerA = $this->makeUser('seller', ['parent_id' => $resellerA->id]);
        $sellerB = $this->makeUser('seller', ['parent_id' => $resellerB->id]);
        $plan = $this->plan();
        $this->stockFor($resellerA, $plan, 5);

        Sanctum::actingAs($resellerA, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $sellerA->id, 'start_serial' => '26-000001', 'quantity' => 2])->assertStatus(201);

        // Separate serial space per reseller in this test only matters within
        // one reseller's own pool, so give resellerB its own untouched stock too.
        foreach (range(1, 5) as $i) {
            Voucher::create([
                'code' => 'B'.$i, 'username' => 'B'.$i, 'password' => 'x',
                'serial_number' => sprintf('27-%06d', $i),
                'plan_id' => $plan->id, 'owner_id' => $resellerB->id, 'reseller_id' => $resellerB->id,
                'price' => 150, 'status' => 'ready',
            ]);
        }
        Sanctum::actingAs($resellerB, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $sellerB->id, 'start_serial' => '27-000001', 'quantity' => 3])->assertStatus(201);

        Sanctum::actingAs($resellerA, ['*']);
        $res = $this->getJson('/api/vouchers/transfers');
        $res->assertStatus(200);
        $this->assertCount(1, $res->json('data.data'));
        $this->assertEquals(2, $res->json('data.data.0.quantity'));

        Sanctum::actingAs($admin, ['*']);
        $res = $this->getJson('/api/vouchers/transfers');
        $this->assertCount(2, $res->json('data.data'));
    }

    /**
     * The Voucher Sales -> Vouchers List summary tiles need to distinguish a
     * seller's allocated stock from stock they generated themselves, same as
     * the dashboard's Allocated Voucher card.
     */
    public function test_package_summary_reports_allocated_count_for_seller(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 10);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 4])
            ->assertStatus(201);

        // One of the 4 allocated cards has since been sold — the breakdown must
        // reflect that split (3 ready, 1 active), not just a flat total.
        Voucher::where('serial_number', '26-000001')->update(['status' => 'active']);

        Voucher::create([
            'code' => 'SELFGEN1', 'username' => 'SELFGEN1', 'password' => 'x',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'reseller_id' => $reseller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready',
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->getJson('/api/reports/package-summary');
        $res->assertStatus(200);
        $this->assertEquals(4, $res->json('data.totals.allocated'));
        $this->assertEquals(5, $res->json('data.totals.generated'));
        $this->assertEquals(3, $res->json('data.totals.by_allocation.allocated.by_status.ready'));
        $this->assertEquals(1, $res->json('data.totals.by_allocation.allocated.by_status.active'));
        $this->assertEquals(0, $res->json('data.totals.by_allocation.allocated.by_status.used'));
        $this->assertEquals(0, $res->json('data.totals.by_allocation.allocated.by_status.disabled'));
    }

    /**
     * The Vouchers List row Actions menu hides Sell/Disable for a seller's
     * own allocated cards — it needs the listing itself to say which rows
     * are allocated, since the vouchers table alone can't tell (a transfer
     * just overwrites seller_id/owner_id the same way self-generation does).
     */
    public function test_voucher_listing_flags_allocated_cards(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $plan = $this->plan();
        $this->stockFor($reseller, $plan, 5);

        Sanctum::actingAs($reseller, ['*']);
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 2])
            ->assertStatus(201);

        Voucher::create([
            'code' => 'SELFGEN2', 'username' => 'SELFGEN2', 'password' => 'x',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'reseller_id' => $reseller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready',
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->getJson('/api/vouchers?per_page=100');
        $res->assertStatus(200);

        $rows = collect($res->json('data.data'));
        $this->assertEquals(2, $rows->where('is_allocated', true)->count());
        $this->assertFalse((bool) $rows->firstWhere('code', 'SELFGEN2')['is_allocated']);
    }

    /**
     * Allocation is a Wallet Voucher concept — a GB Voucher is a Seller's own
     * self-purchased stock, never a Reseller's to hand off. Serials are one
     * global sequence shared by both package types, so a GB card interleaved
     * in the reseller's stock must be excluded from next-serial and must not
     * be silently swept into a transfer that spans its serial number.
     */
    public function test_next_serial_and_transfer_exclude_gb_package_vouchers(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);
        $walletPlan = $this->plan(); // package_type defaults to 'wallet'
        $gbPlan = InternetPlan::create([
            'name' => '5GB-GB', 'plan_type' => 'data', 'bandwidth' => '10M/10M',
            'data_gb' => 5, 'validity_days' => 30, 'base_price' => 100, 'selling_price' => 150,
            'status' => 'active', 'package_type' => 'gb',
        ]);

        $this->stockFor($reseller, $walletPlan, 3); // 26-000001..003, wallet

        // A GB-package card interleaved right after the wallet stock.
        Voucher::create([
            'code' => 'GBCARD1', 'username' => 'GBCARD1', 'password' => 'x',
            'serial_number' => '26-000004',
            'plan_id' => $gbPlan->id,
            'owner_id' => $reseller->id, 'reseller_id' => $reseller->id, 'seller_id' => null,
            'price' => 150, 'status' => 'ready',
        ]);

        Sanctum::actingAs($reseller, ['*']);

        $res = $this->getJson('/api/vouchers/next-serial');
        $this->assertEquals('26-000001', $res->json('data.next_serial'));
        $this->assertEquals(3, $res->json('data.available'));

        // A range spanning into the GB card must fail (count mismatch), not silently skip it.
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 4])
            ->assertStatus(422);
        $this->assertEquals(0, Voucher::where('seller_id', $seller->id)->count());

        // The wallet-only range still works.
        $this->postJson('/api/vouchers/transfers', ['to_user_id' => $seller->id, 'start_serial' => '26-000001', 'quantity' => 3])
            ->assertStatus(201);
        $this->assertEquals(3, Voucher::where('seller_id', $seller->id)->count());
        $this->assertNull(Voucher::where('code', 'GBCARD1')->value('seller_id'));
    }
}
