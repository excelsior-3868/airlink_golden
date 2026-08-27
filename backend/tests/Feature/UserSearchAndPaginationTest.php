<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserSearchAndPaginationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_search_users_and_filter_by_status_and_parent(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'username' => 'sys_admin',
            'status' => 'active',
        ]);

        $reseller = User::factory()->create([
            'role' => 'reseller',
            'parent_id' => $admin->id,
            'name' => 'Alpha Reseller',
            'username' => 'alpha_res',
            'status' => 'active',
        ]);

        $resellerDisabled = User::factory()->create([
            'role' => 'reseller',
            'parent_id' => $admin->id,
            'name' => 'Beta Reseller',
            'username' => 'beta_res',
            'status' => 'disabled',
        ]);

        $seller = User::factory()->create([
            'role' => 'seller',
            'parent_id' => $reseller->id,
            'name' => 'Gamma Seller',
            'username' => 'gamma_sell',
            'status' => 'active',
        ]);

        // Test search by reseller name
        $response = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/users?role=reseller&search=Alpha')
            ->assertOk();

        $this->assertEquals(1, $response->json('data.total'));
        $this->assertEquals('Alpha Reseller', $response->json('data.data.0.name'));

        // Test status filter
        $responseDisabled = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/users?role=reseller&status=disabled')
            ->assertOk();

        $this->assertEquals(1, $responseDisabled->json('data.total'));
        $this->assertEquals('Beta Reseller', $responseDisabled->json('data.data.0.name'));

        // Test parent_id filter for sellers
        $responseSeller = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/users?role=seller&parent_id=' . $reseller->id)
            ->assertOk();

        $this->assertEquals(1, $responseSeller->json('data.total'));
        $this->assertEquals('Gamma Seller', $responseSeller->json('data.data.0.name'));

        // Test pagination per_page = 15
        $responsePage = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/users?per_page=15')
            ->assertOk();

        $this->assertEquals(15, $responsePage->json('data.per_page'));
    }
}
