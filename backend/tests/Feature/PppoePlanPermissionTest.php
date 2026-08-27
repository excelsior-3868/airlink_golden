<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `create_pppoe_plan` — the matrix row that replaced a hardcoded isAdmin()
 * check on PPPoE plan authoring.
 *
 * The interesting cases are not "does the gate work" but the two things that
 * made granting it a no-op before: the wallet-ownership clause in
 * PlanController::update(), and the route middleware on PUT/DELETE /plans.
 */
class PppoePlanPermissionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $reseller;
    private User $seller;

    protected function setUp(): void
    {
        parent::setUp();

        // The real matrix, not the isAllowed() fallbacks — these tests are about
        // what the shipped rows say.
        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin');
        $this->reseller = $this->makeUser('reseller');
        $this->seller = $this->makeUser('seller', ['parent_id' => $this->reseller->id]);
    }

    private function grant(string $feature, string $role): void
    {
        SystemPermission::where('feature', $feature)->update([$role => 1]);
        SystemPermission::flushCache();
    }

    private function pppoePayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'PPPoE Unlimited',
            'type' => 'pppoe',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 800,
            'selling_price' => 1000,
            'status' => 'active',
        ], $overrides);
    }

    private function makePppoePlan(int $ownerId, array $overrides = []): InternetPlan
    {
        return InternetPlan::create(array_merge([
            'name' => 'Existing PPPoE',
            'type' => 'pppoe',
            'package_type' => 'wallet',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 800,
            'selling_price' => 1000,
            'created_by' => $ownerId,
        ], $overrides));
    }

    public function test_it_ships_admin_only(): void
    {
        $row = SystemPermission::where('feature', 'create_pppoe_plan')->first();

        $this->assertNotNull($row, 'create_pppoe_plan should be a matrix row, not a hardcoded check.');
        $this->assertTrue((bool) $row->admin);
        $this->assertFalse((bool) $row->reseller);
        $this->assertFalse((bool) $row->seller);
    }

    public function test_admin_can_create_a_pppoe_plan(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/plans', $this->pppoePayload())
            ->assertStatus(201);

        $this->assertDatabaseHas('internet_plans', [
            'name' => 'PPPoE Unlimited',
            'type' => 'pppoe',
            'package_type' => 'wallet',
        ]);
    }

    public function test_downline_roles_are_refused_by_default(): void
    {
        // The create_plan / create_gb_package grants a reseller does hold must
        // not stand in for this one.
        $this->actingAs($this->reseller, 'sanctum')
            ->postJson('/api/plans', $this->pppoePayload())
            ->assertStatus(403);

        $this->actingAs($this->seller, 'sanctum')
            ->postJson('/api/plans', $this->pppoePayload())
            ->assertStatus(403);

        $this->assertDatabaseMissing('internet_plans', ['name' => 'PPPoE Unlimited']);
    }

    public function test_granting_it_enables_create_edit_and_delete(): void
    {
        $this->grant('create_pppoe_plan', 'reseller');

        // Create.
        $created = $this->actingAs($this->reseller, 'sanctum')
            ->postJson('/api/plans', $this->pppoePayload())
            ->assertStatus(201);

        $planId = $created->json('data.id');

        // Edit. This is the case the wallet-ownership clause used to break: a
        // PPPoE plan is always package_type = 'wallet', which that clause
        // refuses to any non-admin — so without the PPPoE branch running first,
        // the grantee could create a plan and then never touch it again.
        $this->actingAs($this->reseller, 'sanctum')
            ->putJson("/api/plans/{$planId}", $this->pppoePayload(['selling_price' => 1500]))
            ->assertStatus(200);

        $this->assertEquals(1500, (int) InternetPlan::find($planId)->selling_price);

        // Delete.
        $this->actingAs($this->reseller, 'sanctum')
            ->deleteJson("/api/plans/{$planId}")
            ->assertStatus(200);

        $this->assertDatabaseMissing('internet_plans', ['id' => $planId]);
    }

    public function test_seller_is_refused_even_with_the_row_forced_on(): void
    {
        // Not a default but a rule: canManagePppoePlans() refuses the seller tier
        // before consulting the matrix, so a row edited straight in the database
        // still grants nothing.
        $this->grant('create_pppoe_plan', 'seller');

        $this->actingAs($this->seller, 'sanctum')
            ->postJson('/api/plans', $this->pppoePayload())
            ->assertStatus(403);

        $plan = $this->makePppoePlan($this->seller->id);

        $this->actingAs($this->seller, 'sanctum')
            ->putJson("/api/plans/{$plan->id}", $this->pppoePayload(['selling_price' => 5]))
            ->assertStatus(403);

        $this->actingAs($this->seller, 'sanctum')
            ->deleteJson("/api/plans/{$plan->id}")
            ->assertStatus(403);

        $this->assertDatabaseMissing('internet_plans', ['name' => 'PPPoE Unlimited']);
        $this->assertEquals(1000, (int) $plan->fresh()->selling_price);
    }

    public function test_permission_api_drops_a_seller_grant_on_pppoe_features(): void
    {
        $row = SystemPermission::where('feature', 'create_pppoe_plan')->first();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/permissions', [
                'permissions' => [
                    ['id' => $row->id, 'admin' => true, 'reseller' => true, 'seller' => true],
                ],
            ]);

        $response->assertStatus(200);
        // Reported rather than saved silently — a toggle that vanishes on reload
        // with no explanation reads as a bug.
        $response->assertJsonPath('data.dropped_seller_grants', ['Create PPPoE Plan']);

        $row->refresh();
        $this->assertTrue((bool) $row->reseller, 'The reseller grant in the same request must still save.');
        $this->assertFalse((bool) $row->seller);
    }

    public function test_the_type_flip_back_door_is_shut(): void
    {
        // Converting an owned hotspot plan into a PPPoE plan is authoring a
        // PPPoE plan, so it needs the same feature.
        $plan = InternetPlan::create([
            'name' => 'Reseller GB Plan',
            'type' => 'hotspot',
            'package_type' => 'gb',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
            'created_by' => $this->reseller->id,
        ]);

        $this->grant('create_plan', 'reseller');

        $this->actingAs($this->reseller, 'sanctum')
            ->putJson("/api/plans/{$plan->id}", [
                'name' => 'Reseller GB Plan',
                'type' => 'pppoe',
                'plan_type' => 'unlimited',
                'validity_days' => 30,
                'selling_price' => 1000,
            ])
            ->assertStatus(403);

        $this->assertEquals('hotspot', $plan->fresh()->type);
    }

    public function test_pppoe_only_grant_does_not_reach_hotspot_plans(): void
    {
        // The counterweight to widening the route gate to
        // `permission:create_plan,create_pppoe_plan`. The route now admits a
        // PPPoE-only grantee, so update()/destroy() must re-assert create_plan
        // for anything that is not a PPPoE plan.
        $this->grant('create_pppoe_plan', 'reseller');
        SystemPermission::where('feature', 'create_plan')->update(['reseller' => 0]);
        SystemPermission::where('feature', 'create_gb_package')->update(['reseller' => 0]);
        SystemPermission::flushCache();

        $hotspot = InternetPlan::create([
            'name' => 'Own Hotspot Plan',
            'type' => 'hotspot',
            'package_type' => 'gb',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
            'created_by' => $this->reseller->id,
        ]);

        $this->actingAs($this->reseller, 'sanctum')
            ->putJson("/api/plans/{$hotspot->id}", [
                'name' => 'Own Hotspot Plan',
                'type' => 'hotspot',
                'plan_type' => 'unlimited',
                'validity_days' => 30,
                'selling_price' => 999,
            ])
            ->assertStatus(403);

        $this->actingAs($this->reseller, 'sanctum')
            ->deleteJson("/api/plans/{$hotspot->id}")
            ->assertStatus(403);

        $this->assertEquals(120, (int) $hotspot->fresh()->selling_price);
        $this->assertDatabaseHas('internet_plans', ['id' => $hotspot->id]);
    }

    public function test_the_or_gate_did_not_widen_the_create_plan_route(): void
    {
        // A role holding neither feature is still refused at the middleware, so
        // the variadic gate has not loosened the single-feature behaviour.
        SystemPermission::where('feature', 'create_plan')->update(['reseller' => 0]);
        SystemPermission::flushCache();

        $plan = InternetPlan::create([
            'name' => 'Admin Wallet Plan',
            'type' => 'hotspot',
            'package_type' => 'wallet',
            'plan_type' => 'unlimited',
            'validity_days' => 30,
            'base_price' => 100,
            'selling_price' => 120,
            'created_by' => $this->admin->id,
        ]);

        $this->actingAs($this->reseller, 'sanctum')
            ->putJson("/api/plans/{$plan->id}", [
                'name' => 'Admin Wallet Plan',
                'type' => 'hotspot',
                'plan_type' => 'unlimited',
                'validity_days' => 30,
                'selling_price' => 1,
            ])
            ->assertStatus(403);

        $this->assertEquals(120, (int) $plan->fresh()->selling_price);
    }
}
