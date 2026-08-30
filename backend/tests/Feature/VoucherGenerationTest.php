<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VoucherGenerationTest extends TestCase
{
    use RefreshDatabase;

    private function plan(): InternetPlan
    {
        return InternetPlan::create([
            'name' => '5GB', 'plan_type' => 'data', 'bandwidth' => '10M/10M',
            'data_gb' => 5, 'validity_days' => 30, 'base_price' => 100, 'selling_price' => 150, 'status' => 'active',
        ]);
    }

    public function test_generation_deducts_both_balances_and_writes_radcheck(): void
    {
        $admin = $this->makeUser('admin', ['wallet_balance' => 1000, 'gb_balance' => 100]);
        $plan = $this->plan();

        Sanctum::actingAs($admin, ['*']);
        $res = $this->postJson('/api/vouchers/generate', ['plan_id' => $plan->id, 'quantity' => 4]);

        $res->assertStatus(201);

        // 4 × 5GB = 20 GB. Wallet is not deducted under credit billing.
        $this->assertEquals(1000, $admin->fresh()->wallet_balance);
        $this->assertEquals(80, $admin->fresh()->gb_balance);

        $this->assertDatabaseCount('vouchers', 4);
        // Each voucher has a Cleartext-Password radcheck row.
        $this->assertEquals(4, DB::table('radcheck')->where('attribute', 'Cleartext-Password')->count());
        // Data plan >0 → a rate limit reply row per voucher.
        $this->assertEquals(4, DB::table('radreply')->where('attribute', 'Mikrotik-Rate-Limit')->count());
    }

    public function test_generation_supports_custom_prices(): void
    {
        $admin = $this->makeUser('admin', ['wallet_balance' => 1000, 'gb_balance' => 100]);
        $plan = $this->plan();

        Sanctum::actingAs($admin, ['*']);
        $res = $this->postJson('/api/vouchers/generate', [
                'plan_id' => $plan->id, 
                'quantity' => 1,
                'custom_price' => 180.00,
                'custom_base_price' => 120.00
            ]);

        $res->assertStatus(201);

        $voucher = \App\Models\Voucher::first();
        $this->assertEquals(180.00, (float) $voucher->price);
        $this->assertEquals(180.00, (float) $voucher->base_price);
    }

    public function test_generation_rejects_when_gb_insufficient_and_rolls_back(): void
    {
        $admin = $this->makeUser('admin', ['wallet_balance' => 100000, 'gb_balance' => 10]);
        $plan = $this->plan(); // 5 GB each

        // 3 × 5 = 15 GB > 10 available.
        Sanctum::actingAs($admin, ['*']);
        $this->postJson('/api/vouchers/generate', ['plan_id' => $plan->id, 'quantity' => 3])
            ->assertStatus(422);

        // Nothing created, nothing deducted.
        $this->assertDatabaseCount('vouchers', 0);
        $this->assertEquals(10, $admin->fresh()->gb_balance);
        $this->assertEquals(0, DB::table('radcheck')->count());
    }

    public function test_seller_generation_sets_ownership_chain(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id, 'wallet_balance' => 1000, 'gb_balance' => 100]);
        $plan = $this->plan();

        Sanctum::actingAs($seller, ['*']);
        $this->postJson('/api/vouchers/generate', ['plan_id' => $plan->id, 'quantity' => 1])->assertStatus(201);

        $v = DB::table('vouchers')->first();
        $this->assertEquals($seller->id, $v->seller_id);
        $this->assertEquals($reseller->id, $v->reseller_id);
        $this->assertEquals($seller->id, $v->owner_id);
    }

    public function test_change_password_updates_voucher_and_radcheck(): void
    {
        $admin = $this->makeUser('admin');
        $seller = $this->makeUser('seller', ['parent_id' => $admin->id]);
        $plan = $this->plan();

        $voucher = \App\Models\Voucher::create([
            'code' => 'TESTCODE', 'username' => 'TESTCODE', 'password' => 'TESTCODE',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready',
        ]);
        DB::table('radcheck')->insert([
            'username' => 'TESTCODE', 'attribute' => 'Cleartext-Password', 'op' => ':=', 'value' => 'TESTCODE',
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->patchJson("/api/vouchers/{$voucher->id}/change-password");

        $res->assertStatus(200);
        $newPassword = $res->json('data.new_password');
        $this->assertNotEmpty($newPassword);
        $this->assertNotEquals('TESTCODE', $newPassword);
        $this->assertEquals($newPassword, $voucher->fresh()->password);
        // Username/code are untouched — only the password changed.
        $this->assertEquals('TESTCODE', $voucher->fresh()->username);
        $this->assertEquals(
            $newPassword,
            DB::table('radcheck')->where('username', 'TESTCODE')->where('attribute', 'Cleartext-Password')->value('value')
        );
    }

    public function test_change_password_accepts_a_caller_supplied_value(): void
    {
        $admin = $this->makeUser('admin');
        $seller = $this->makeUser('seller', ['parent_id' => $admin->id]);
        $plan = $this->plan();

        $voucher = \App\Models\Voucher::create([
            'code' => 'TESTCODE2', 'username' => 'TESTCODE2', 'password' => 'TESTCODE2',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready',
        ]);
        DB::table('radcheck')->insert([
            'username' => 'TESTCODE2', 'attribute' => 'Cleartext-Password', 'op' => ':=', 'value' => 'TESTCODE2',
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->patchJson("/api/vouchers/{$voucher->id}/change-password", ['new_password' => 'mynewpass1']);

        $res->assertStatus(200);
        $this->assertEquals('mynewpass1', $res->json('data.new_password'));
        $this->assertEquals('mynewpass1', $voucher->fresh()->password);
        $this->assertEquals(
            'mynewpass1',
            DB::table('radcheck')->where('username', 'TESTCODE2')->where('attribute', 'Cleartext-Password')->value('value')
        );
    }

    public function test_sell_voucher_succeeds(): void
    {
        $admin = $this->makeUser('admin');
        $seller = $this->makeUser('seller', ['parent_id' => $admin->id]);
        $plan = $this->plan();
        
        $voucher = \App\Models\Voucher::create([
            'code' => 'TESTCODE', 'username' => 'TESTCODE', 'password' => 'TESTCODE',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready'
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->postJson("/api/vouchers/{$voucher->id}/sell", ['customer_username' => 'john_doe']);

        $res->assertStatus(200);
        $this->assertEquals('active', $voucher->fresh()->status);
        $this->assertEquals('john_doe', $voucher->fresh()->customer_username);
        $this->assertNotNull($voucher->fresh()->sold_at);
    }

    public function test_sell_non_ready_voucher_fails(): void
    {
        $admin = $this->makeUser('admin');
        $plan = $this->plan();
        
        $voucher = \App\Models\Voucher::create([
            'code' => 'TESTCODE', 'username' => 'TESTCODE', 'password' => 'TESTCODE',
            'plan_id' => $plan->id, 'owner_id' => $admin->id,
            'price' => 150, 'status' => 'used'
        ]);

        Sanctum::actingAs($admin, ['*']);
        $res = $this->postJson("/api/vouchers/{$voucher->id}/sell", ['customer_username' => 'john_doe']);

        $res->assertStatus(422);
    }

    public function test_redeem_voucher_succeeds(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['gb_balance' => 0]);
        $plan = $this->plan();

        $voucher = \App\Models\Voucher::create([
            'code' => 'REDEEM123', 'username' => 'REDEEM123', 'password' => 'REDEEM123',
            'plan_id' => $plan->id, 'owner_id' => $admin->id,
            'data_gb' => 50.0, 'price' => 150, 'status' => 'ready'
        ]);

        DB::table('radcheck')->insert([
            'username' => 'REDEEM123', 'attribute' => 'Cleartext-Password', 'op' => ':=', 'value' => 'REDEEM123'
        ]);

        Sanctum::actingAs($reseller, ['*']);
        $res = $this->postJson('/api/vouchers/redeem', ['code' => 'REDEEM123']);

        $res->assertStatus(200);
        $this->assertEquals(50.0, $reseller->fresh()->gb_balance);
        $this->assertEquals('used', $voucher->fresh()->status);
        $this->assertEquals(0, DB::table('radcheck')->where('username', 'REDEEM123')->count());
    }

    public function test_redeem_already_used_fails(): void
    {
        $reseller = $this->makeUser('reseller', ['gb_balance' => 0]);
        $plan = $this->plan();

        $voucher = \App\Models\Voucher::create([
            'code' => 'REDEEM123', 'username' => 'REDEEM123', 'password' => 'REDEEM123',
            'plan_id' => $plan->id, 'owner_id' => $reseller->id, 'data_gb' => 50.0, 'price' => 150, 'status' => 'used'
        ]);

        Sanctum::actingAs($reseller, ['*']);
        $res = $this->postJson('/api/vouchers/redeem', ['code' => 'REDEEM123']);

        $res->assertStatus(422);
    }

    public function test_activated_voucher_counts_as_sold_and_used_in_reports(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id]);
        $plan = $this->plan();

        $voucher = \App\Models\Voucher::create([
            'code' => 'LOGGEDIN1', 'username' => 'LOGGEDIN1', 'password' => 'LOGGEDIN1',
            'plan_id' => $plan->id, 'owner_id' => $reseller->id, 'reseller_id' => $reseller->id,
            'price' => 1200, 'status' => 'used', 'activated_at' => now(),
        ]);

        Sanctum::actingAs($admin, ['*']);
        $res = $this->getJson("/api/reports/package-summary?reseller_id={$reseller->id}");

        $res->assertStatus(200);
        $packages = $res->json('data.packages');
        $this->assertNotEmpty($packages);
        $pkg = $packages[0];
        $this->assertEquals(1, $pkg['generated']);
        $this->assertEquals(1, $pkg['sold']);
        $this->assertEquals(1, $pkg['used']);
        $this->assertEquals(0, $pkg['remaining']);
    }

    public function test_generated_voucher_codes_and_batch_codes_exclude_zero_and_letter_o(): void
    {
        $admin = $this->makeUser('admin', ['wallet_balance' => 10000, 'gb_balance' => 500]);
        $plan = $this->plan();

        Sanctum::actingAs($admin, ['*']);
        $res = $this->postJson('/api/vouchers/generate', [
            'plan_id' => $plan->id,
            'quantity' => 50,
        ]);

        $res->assertStatus(201);
        $batchCode = $res->json('data.batch_code');
        $this->assertMatchesRegularExpression('/^BAT\d{6}[1-9A-HJ-NP-Z]{4}$/', $batchCode);
        $this->assertDoesNotMatchRegularExpression('/[0OoIi]/', substr($batchCode, 9));

        $batch = \App\Models\Batch::where('batch_code', $batchCode)->first();
        $this->assertNotNull($batch);

        $vouchers = \App\Models\Voucher::where('batch_id', $batch->id)->get();
        $this->assertCount(50, $vouchers);

        foreach ($vouchers as $v) {
            $this->assertEquals(6, strlen($v->code));
            $this->assertDoesNotMatchRegularExpression('/[0Oo]/', $v->code);
            $this->assertMatchesRegularExpression('/^[1-9A-HJ-NP-Z]{6}$/', $v->code);
        }
    }

    public function test_export_csv_has_owner_column_and_drops_customer_status_expiry(): void
    {
        $admin = $this->makeUser('admin');
        $seller = $this->makeUser('seller', ['parent_id' => $admin->id, 'username' => 'exportseller']);
        $plan = $this->plan();

        \App\Models\Voucher::create([
            'code' => 'EXPORT1', 'username' => 'EXPORT1', 'password' => 'EXPORT1',
            'plan_id' => $plan->id, 'owner_id' => $seller->id, 'seller_id' => $seller->id,
            'price' => 150, 'status' => 'ready',
        ]);

        Sanctum::actingAs($admin, ['*']);
        $res = $this->get('/api/vouchers/export');
        $res->assertStatus(200);

        $lines = array_filter(explode("\n", str_replace("\r\n", "\n", $res->streamedContent())));
        $header = str_getcsv($lines[0]);
        $this->assertEquals(['Serial Number', 'Code', 'Username', 'Password', 'Plan', 'Data GB', 'Validity Days', 'Price', 'Owner'], $header);
        $this->assertNotContains('Customer Name', $header);
        $this->assertNotContains('Status', $header);
        $this->assertNotContains('Expires At', $header);

        $row = str_getcsv($lines[1]);
        $this->assertEquals('exportseller', $row[array_search('Owner', $header)]);
    }
}
