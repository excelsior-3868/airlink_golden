<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SessionUsageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_session_usage_returns_live_metadata_and_chart_points(): void
    {
        $admin = $this->makeUser('admin', ['username' => 'admin_user']);
        $reseller = $this->makeUser('reseller', ['username' => 'reseller_user']);

        $plan = InternetPlan::create([
            'name' => '50 Mbps Fiber',
            'plan_type' => 'time',
            'selling_price' => 1200,
            'validity_days' => 30,
            'status' => 'active',
        ]);

        $pppoe = PppoeCustomer::create([
            'full_name' => 'Subin Bajracharya',
            'username' => 'NTFTTH301001219',
            'password' => 'pass123',
            'plan_id' => $plan->id,
            'owner_id' => $reseller->id,
            'reseller_id' => $reseller->id,
            'mac_address' => '00:11:22:33:44:55',
            'contract_price' => 1200,
            'status' => 'active',
            'activated_at' => now()->subDays(10),
        ]);

        // Insert radacct sessions
        $now = now();
        DB::table('radacct')->insert([
            [
                'radacctid' => 101,
                'acctsessionid' => 'sess_01',
                'acctuniqueid' => 'uniq_01',
                'username' => 'NTFTTH301001219',
                'nasipaddress' => '10.133.45.1',
                'framedipaddress' => '10.133.45.100',
                'callingstationid' => 'SND_NE40-X8A_MSG-01',
                'acctstarttime' => $now->copy()->subDays(2),
                'acctstoptime' => $now->copy()->subDays(2)->addHours(4),
                'acctsessiontime' => 14400,
                'acctinputoctets' => 1073741824, // 1 GB upload
                'acctoutputoctets' => 5368709120, // 5 GB download
                'acctterminatecause' => 'User-Request',
            ],
            [
                'radacctid' => 102,
                'acctsessionid' => 'sess_02',
                'acctuniqueid' => 'uniq_02',
                'username' => 'NTFTTH301001219',
                'nasipaddress' => '10.133.45.1',
                'framedipaddress' => '10.133.45.100',
                'callingstationid' => 'SND_NE40-X8A_MSG-01',
                'acctstarttime' => $now->copy()->subHours(2),
                'acctstoptime' => null, // Live open session
                'acctsessiontime' => 7200,
                'acctinputoctets' => 536870912, // 0.5 GB upload
                'acctoutputoctets' => 2147483648, // 2 GB download
                'acctterminatecause' => '',
            ],
        ]);

        // Test with 35d range
        $response = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/session-usage?username=NTFTTH301001219&range=35d')
            ->assertStatus(200);

        $data = $response->json('data');
        $this->assertEquals('Subin Bajracharya', $data['customer']);
        $this->assertEquals('NTFTTH301001219', $data['user_id']);
        $this->assertEquals('50 Mbps Fiber', $data['plan']);
        $this->assertEquals('10.133.45.100', $data['login_ip']);
        $this->assertEquals('SND_NE40-X8A_MSG-01', $data['caller_id']);
        $this->assertTrue($data['is_online']);
        $this->assertCount(35, $data['points']);
        $this->assertGreaterThan(0, $data['totals']['download_bytes']);
        $this->assertCount(2, $data['sessions']);

        // Test with today range (24 hourly points)
        $responseToday = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/radius/session-usage?username=NTFTTH301001219&range=today')
            ->assertStatus(200);

        $dataToday = $responseToday->json('data');
        $this->assertCount(24, $dataToday['points']);
    }

    public function test_session_usage_scoping_reseller_and_seller(): void
    {
        $admin = $this->makeUser('admin', ['username' => 'admin_user']);
        $reseller1 = $this->makeUser('reseller', ['username' => 'reseller_1']);
        $reseller2 = $this->makeUser('reseller', ['username' => 'reseller_2']);
        $seller = $this->makeUser('seller', ['username' => 'seller_1', 'parent_id' => $reseller1->id]);

        $plan = InternetPlan::create([
            'name' => 'Hotspot 1GB',
            'plan_type' => 'data',
            'selling_price' => 50,
            'validity_days' => 1,
            'status' => 'active',
        ]);

        $vReseller = Voucher::create([
            'code' => 'RES_VC_01',
            'username' => 'RES_VC_01',
            'password' => 'pass123',
            'plan_id' => $plan->id,
            'owner_id' => $reseller1->id,
            'reseller_id' => $reseller1->id,
            'seller_id' => null,
            'price' => 50,
            'base_price' => 50,
            'validity_days' => 1,
            'status' => 'active',
        ]);

        $vSeller = Voucher::create([
            'code' => 'SEL_VC_01',
            'username' => 'SEL_VC_01',
            'password' => 'pass123',
            'plan_id' => $plan->id,
            'owner_id' => $seller->id,
            'reseller_id' => $reseller1->id,
            'seller_id' => $seller->id,
            'price' => 50,
            'base_price' => 50,
            'validity_days' => 1,
            'status' => 'active',
        ]);

        // Reseller 1 can access RES_VC_01
        $this->actingAs($reseller1, 'sanctum')
            ->getJson('/api/radius/session-usage?username=RES_VC_01')
            ->assertStatus(200);

        // Reseller 2 cannot access RES_VC_01
        $this->actingAs($reseller2, 'sanctum')
            ->getJson('/api/radius/session-usage?username=RES_VC_01')
            ->assertStatus(403);

        // Seller can access SEL_VC_01
        $this->actingAs($seller, 'sanctum')
            ->getJson('/api/radius/session-usage?username=SEL_VC_01')
            ->assertStatus(200);

        // Seller cannot access RES_VC_01
        $this->actingAs($seller, 'sanctum')
            ->getJson('/api/radius/session-usage?username=RES_VC_01')
            ->assertStatus(403);
    }
}
