<?php

namespace Tests\Feature;

use App\Models\Bandwidth;
use App\Models\InternetPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BandwidthAndPlanTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $seller;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = $this->makeUser('admin');
        $this->seller = $this->makeUser('seller');
    }

    public function test_admin_can_manage_bandwidths(): void
    {
        // 1. Create
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/bandwidths', [
                'name' => '100Mbps',
                'rate_down' => 100,
                'rate_down_unit' => 'Mbps',
                'rate_up' => 50,
                'rate_up_unit' => 'Mbps',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('bandwidths', ['name' => '100Mbps']);

        $bandwidthId = $response->json('data.id');

        // 2. Update
        $response = $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/bandwidths/{$bandwidthId}", [
                'name' => '120Mbps',
                'rate_down' => 120,
                'rate_down_unit' => 'Mbps',
                'rate_up' => 60,
                'rate_up_unit' => 'Mbps',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('bandwidths', ['name' => '120Mbps']);

        // 3. Delete
        $response = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/bandwidths/{$bandwidthId}");

        $response->assertStatus(200);
        $this->assertDatabaseMissing('bandwidths', ['id' => $bandwidthId]);
    }

    public function test_seller_cannot_manage_bandwidths(): void
    {
        $response = $this->actingAs($this->seller, 'sanctum')
            ->postJson('/api/bandwidths', [
                'name' => '100Mbps',
                'rate_down' => 100,
                'rate_down_unit' => 'Mbps',
                'rate_up' => 50,
                'rate_up_unit' => 'Mbps',
            ]);

        $response->assertStatus(403);
    }

    public function test_cannot_delete_bandwidth_in_use(): void
    {
        $bw = Bandwidth::create([
            'name' => '10M',
            'rate_down' => 10,
            'rate_down_unit' => 'Mbps',
            'rate_up' => 10,
            'rate_up_unit' => 'Mbps',
        ]);

        $plan = InternetPlan::create([
            'name' => 'Plan A',
            'type' => 'hotspot',
            'plan_type' => 'unlimited',
            'bandwidth_id' => $bw->id,
            'bandwidth' => '10M/10M',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/bandwidths/{$bw->id}");

        $response->assertStatus(422);
        $this->assertDatabaseHas('bandwidths', ['id' => $bw->id]);
    }

    public function test_plan_index_filters_by_type(): void
    {
        // package_type defaults to 'wallet', and a seller's index deliberately
        // hides wallet plans (they mint vouchers out of a GB allocation), so a
        // seller-visible fixture has to be a GB package.
        InternetPlan::create([
            'name' => 'Hotspot Plan',
            'type' => 'hotspot',
            'package_type' => 'gb',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
        ]);

        InternetPlan::create([
            'name' => 'PPPOE Plan',
            'type' => 'pppoe',
            'package_type' => 'gb',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
        ]);

        $response = $this->actingAs($this->seller, 'sanctum')
            ->getJson('/api/plans?type=hotspot');

        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data');
        $this->assertEquals('Hotspot Plan', $response->json('data.0.name'));

        // No seller touches PPPoE: a PPPoE plan must never surface in a
        // seller's voucher-generation picker, where it cannot be used.
        $response = $this->actingAs($this->seller, 'sanctum')
            ->getJson('/api/plans?type=pppoe');

        $response->assertStatus(200);
        $response->assertJsonCount(0, 'data');
    }

    public function test_admin_can_set_creator_to_any_owner(): void
    {
        (new \Database\Seeders\DatabaseSeeder())->run();
        $reseller = $this->makeUser('reseller');

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Custom Reseller Plan',
                'plan_type' => 'data',
                'data_gb' => 10,
                'validity_days' => 30,
                'base_price' => 100,
                'selling_price' => 150,
                'status' => 'active',
                'owner_id' => $reseller->id,
            ]);

        $response->assertStatus(201);
        $this->assertEquals($reseller->id, $response->json('data.created_by'));
    }

    public function test_reseller_can_set_creator_to_themselves_or_their_sellers(): void
    {
        (new \Database\Seeders\DatabaseSeeder())->run();
        $reseller = $this->makeUser('reseller');
        $downlineSeller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        // Reseller setting it to their seller
        $response = $this->actingAs($reseller, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Custom Seller Plan',
                'plan_type' => 'data',
                'data_gb' => 5,
                'validity_days' => 30,
                'base_price' => 50,
                'selling_price' => 70,
                'status' => 'active',
                'owner_id' => $downlineSeller->id,
            ]);

        $response->assertStatus(201);
        $this->assertEquals($downlineSeller->id, $response->json('data.created_by'));

        // Reseller setting it to themselves
        $response2 = $this->actingAs($reseller, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Custom Self Plan',
                'plan_type' => 'data',
                'data_gb' => 5,
                'validity_days' => 30,
                'base_price' => 50,
                'selling_price' => 70,
                'status' => 'active',
                'owner_id' => $reseller->id,
            ]);

        $response2->assertStatus(201);
        $this->assertEquals($reseller->id, $response2->json('data.created_by'));
    }

    public function test_reseller_cannot_set_creator_to_unauthorized_owners(): void
    {
        (new \Database\Seeders\DatabaseSeeder())->run();
        $reseller = $this->makeUser('reseller');
        $otherSeller = $this->makeUser('seller'); // parent is not $reseller

        $response = $this->actingAs($reseller, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Invalid Plan',
                'plan_type' => 'data',
                'data_gb' => 5,
                'validity_days' => 30,
                'base_price' => 50,
                'selling_price' => 70,
                'status' => 'active',
                'owner_id' => $otherSeller->id,
            ]);

        $response->assertStatus(403);
    }

    public function test_seller_cannot_set_creator_to_anyone_else(): void
    {
        (new \Database\Seeders\DatabaseSeeder())->run();
        $otherSeller = $this->makeUser('seller');

        $response = $this->actingAs($this->seller, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Invalid Plan',
                'plan_type' => 'data',
                'data_gb' => 5,
                'validity_days' => 30,
                'base_price' => 50,
                'selling_price' => 70,
                'status' => 'active',
                'owner_id' => $otherSeller->id,
            ]);

        $response->assertStatus(403);
    }

    public function test_non_existent_owner_id_fails_validation(): void
    {
        (new \Database\Seeders\DatabaseSeeder())->run();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/plans', [
                'name' => 'Invalid Plan',
                'plan_type' => 'data',
                'data_gb' => 5,
                'validity_days' => 30,
                'base_price' => 50,
                'selling_price' => 70,
                'status' => 'active',
                'owner_id' => 9999,
            ]);

        $response->assertStatus(422);
    }
}
