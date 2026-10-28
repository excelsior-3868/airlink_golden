<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class OnlineUsersPaginationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ensureNmsTables();
    }

    /**
     * The online-users query joins ont_inventory and devices, which the Go NMS
     * service creates (nms-backend/migrations), not Laravel; RefreshDatabase
     * tests drop them. Give the query minimal stand-ins when they are absent.
     *
     * DDL commits the open transaction, so it goes over a separate connection:
     * the test's own transaction (and its rollback) is left untouched.
     */
    private function ensureNmsTables(): void
    {
        $conn = DB::connectUsing('nms_stub', config('database.connections.'.config('database.default')), true);
        $schema = $conn->getSchemaBuilder();

        if (! $schema->hasTable('devices')) {
            $schema->create('devices', function ($t) {
                $t->unsignedBigInteger('id')->primary();
                $t->string('name')->nullable();
                $t->string('vendor')->nullable();
            });
        }
        if (! $schema->hasTable('ont_inventory')) {
            $schema->create('ont_inventory', function ($t) {
                $t->id();
                $t->string('serial_number')->nullable();
                $t->unsignedBigInteger('olt_id')->nullable();
                $t->double('rx_power_dbm')->nullable();
                $t->string('run_state')->nullable();
                $t->dateTime('last_seen_at')->nullable();
                $t->string('description')->nullable();
                $t->integer('frame')->nullable();
                $t->integer('slot')->nullable();
                $t->integer('pon_port')->nullable();
                $t->integer('ont_id')->nullable();
            });
        }
    }

    private function seedSessions(int $count): void
    {
        $admin = $this->makeUser('admin', ['username' => 'admin_user']);
        $plan = InternetPlan::create([
            'name' => '50 Mbps Fiber', 'plan_type' => 'time', 'selling_price' => 1200,
            'validity_days' => 30, 'status' => 'active',
        ]);

        for ($i = 1; $i <= $count; $i++) {
            $username = sprintf('NTTEST%04d', $i);
            PppoeCustomer::create([
                'full_name' => "Customer $i", 'username' => $username, 'password' => 'pass123',
                'plan_id' => $plan->id, 'owner_id' => $admin->id, 'reseller_id' => $admin->id,
                'contract_price' => 1200, 'status' => 'active', 'activated_at' => now()->subDays(5),
            ]);
            DB::table('radacct')->insert([
                'acctsessionid' => "s$i", 'acctuniqueid' => "u$i", 'username' => $username,
                'nasipaddress' => $i % 2 ? '10.0.0.1' : '10.0.0.2',
                'framedipaddress' => "10.1.0.$i", 'callingstationid' => sprintf('AA:BB:CC:00:00:%02X', $i),
                'acctstarttime' => now()->subMinutes($i), 'acctupdatetime' => now()->subMinutes(1),
                'acctstoptime' => null, 'acctinputoctets' => 100, 'acctoutputoctets' => 200,
            ]);
            // Earlier, closed session: counts toward the lifetime total.
            DB::table('radacct')->insert([
                'acctsessionid' => "old$i", 'acctuniqueid' => "uold$i", 'username' => $username,
                'nasipaddress' => '10.0.0.1', 'acctstarttime' => now()->subDays(3),
                'acctstoptime' => now()->subDays(3)->addHour(), 'acctinputoctets' => 1000, 'acctoutputoctets' => 2000,
            ]);
        }
    }

    public function test_per_page_returns_one_page_with_summary_and_facets(): void
    {
        $this->seedSessions(12);
        $admin = \App\Models\User::where('username', 'admin_user')->first();

        $res = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/online-users?per_page=5&page=2')->assertOk();

        $data = $res->json('data');
        $this->assertCount(5, $data['sessions']);
        $this->assertSame(12, $data['pagination']['total']);
        $this->assertSame(3, $data['pagination']['last_page']);
        $this->assertSame(12, $data['summary']['pppoe']);
        $this->assertSame(2, $data['summary']['unique_nas']);
        // Lifetime usage = live session (300) + closed session (3000), on every row.
        $this->assertSame(3300, $data['sessions'][0]['total_bytes']);
        $this->assertSame(12 * 3300, $data['summary']['volume_bytes']);
        $this->assertCount(2, $data['facets']['nas']);
    }

    public function test_nas_filter_and_prefix_search_narrow_the_page(): void
    {
        $this->seedSessions(10);
        $admin = \App\Models\User::where('username', 'admin_user')->first();

        $byNas = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/online-users?per_page=50&nas=10.0.0.2')->assertOk()->json('data');
        $this->assertSame(5, $byNas['pagination']['total']);

        $bySearch = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/online-users?per_page=50&search=NTTEST0003')->assertOk()->json('data');
        $this->assertSame(1, $bySearch['pagination']['total']);

        // Identifiers match from the start only.
        $mid = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/online-users?per_page=50&search=TEST0003')->assertOk()->json('data');
        $this->assertSame(0, $mid['pagination']['total']);
    }

    public function test_without_per_page_the_full_list_is_still_returned(): void
    {
        $this->seedSessions(7);
        $admin = \App\Models\User::where('username', 'admin_user')->first();

        $data = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/online-users')->assertOk()->json('data');

        $this->assertCount(7, $data['sessions']);
        $this->assertSame(7, $data['count']);
        $this->assertArrayNotHasKey('pagination', $data);
        $this->assertSame(3300, $data['sessions'][0]['total_bytes']);
    }
}
