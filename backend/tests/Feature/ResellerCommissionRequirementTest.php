<?php

namespace Tests\Feature;

use App\Models\BrandingSetting;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** POST /api/resellers — commission % is required, except on PPPoE-only installs. */
class ResellerCommissionRequirementTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();
        $this->admin = $this->makeUser('admin');
    }

    private function payload(string $username, array $extra = []): array
    {
        return array_merge([
            'name' => 'New Reseller',
            'username' => $username,
            'password' => 'secret123',
            'gb_rate' => 100,
        ], $extra);
    }

    private function setPppoeOnly(bool $on): void
    {
        $row = BrandingSetting::find(1) ?? new BrandingSetting();
        $row->id = 1;
        $row->pppoe_only = $on;
        $row->save();
    }

    public function test_commission_is_required_in_the_normal_mode(): void
    {
        $this->setPppoeOnly(false);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/resellers', $this->payload('res_normal'))
            ->assertStatus(422)
            ->assertJsonValidationErrors('commission_percent');
    }

    public function test_commission_is_optional_and_defaults_to_zero_when_pppoe_only(): void
    {
        $this->setPppoeOnly(true);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/resellers', $this->payload('res_pppoe'))
            ->assertStatus(201);

        $this->assertEquals(0, User::where('username', 'res_pppoe')->value('commission_percent'));
    }

    public function test_a_commission_sent_in_pppoe_only_mode_is_still_saved(): void
    {
        $this->setPppoeOnly(true);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/resellers', $this->payload('res_pppoe_pct', ['commission_percent' => 15]))
            ->assertStatus(201);

        $this->assertEquals(15, User::where('username', 'res_pppoe_pct')->value('commission_percent'));
    }
}
