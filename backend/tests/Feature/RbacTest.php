<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use RefreshDatabase;

    private function planPayload(): array
    {
        return ['name' => 'X', 'plan_type' => 'data', 'data_gb' => 1, 'validity_days' => 1, 'base_price' => 1, 'selling_price' => 1];
    }

    /**
     * Plan creation was split: a non-admin can only ever produce a GB Package
     * (package_type is forced to 'gb' for non-admin owners), so PlanController
     * gates them on `create_gb_package` — seeded reseller=1, seller=0 — while
     * Wallet Packages stay under `create_plan`. A reseller creating a plan is
     * therefore allowed; a seller is not.
     *
     * This previously asserted 403 for the reseller and passed only because
     * actingAs() attached no token, so the tokenCan('plans.write') guard above
     * rejected every request before any role check ran.
     */
    public function test_reseller_can_create_gb_package_but_seller_cannot(): void
    {
        $this->actingAs($this->makeUser('reseller'), 'sanctum')
            ->postJson('/api/plans', $this->planPayload())->assertStatus(201);

        $this->actingAs($this->makeUser('seller'), 'sanctum')
            ->postJson('/api/plans', $this->planPayload())->assertStatus(403);
    }

    public function test_admin_can_create_plan(): void
    {
        $this->actingAs($this->makeUser('admin'), 'sanctum')
            ->postJson('/api/plans', $this->planPayload())->assertStatus(201);
    }

    public function test_seller_cannot_create_seller(): void
    {
        $this->actingAs($this->makeUser('seller'), 'sanctum')
            ->postJson('/api/sellers', ['name' => 'S', 'username' => 'x1', 'password' => 'secret1'])->assertStatus(403);
    }

    public function test_seller_cannot_load_wallet(): void
    {
        $this->actingAs($this->makeUser('seller'), 'sanctum')
            ->postJson('/api/wallet/load', ['user_id' => 1, 'amount' => 100])->assertStatus(403);
    }
}
