<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\Invoice;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FinancialDashboardTest extends TestCase
{
    use RefreshDatabase;

    private function plan(string $packageType): InternetPlan
    {
        return InternetPlan::create([
            'name' => "Plan {$packageType}", 'type' => 'hotspot', 'package_type' => $packageType,
            'plan_type' => 'data', 'bandwidth' => '10M/10M', 'data_gb' => 5, 'validity_days' => 30,
            'base_price' => 100, 'selling_price' => 1000, 'status' => 'active',
        ]);
    }

    public function test_system_load_is_not_reflected_in_financial_dashboard(): void
    {
        $admin = $this->makeUser('admin');

        // Admin performs a System Load of 1,000,000 Wallet Balance and 10,000 GB
        $this->actingAs($admin, 'sanctum')
            ->postJson('/api/users/system-load', [
                'wallet_amount' => 1000000,
                'gb_amount' => 10000,
                'note' => 'Initial system load',
            ])
            ->assertOk();

        // Verify system load updated admin balances
        $this->assertEquals(1000000, $admin->fresh()->wallet_balance);
        $this->assertEquals(10000, $admin->fresh()->gb_balance);

        // Fetch Financial Dashboard
        $response = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk();

        $data = $response->json('data');

        // Total revenue, GB allocation revenue, and Bank asset balance must be 0
        $this->assertEquals(0, $data['summary']['total_revenue']);
        $this->assertEquals(0, $data['income_statement']['gb_allocation_revenue']);
        $this->assertEquals(0, $data['income_statement']['gross_operating_revenue']);
        $this->assertEquals(0, $data['summary']['net_profit']);

        $bankItem = collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1010');
        $this->assertNotNull($bankItem);
        $this->assertEquals(0, $bankItem['balance']);
        $this->assertEquals(0, $data['balance_sheet']['assets']['total']);
    }

    public function test_gb_allocation_revenue_is_zero_when_unpaid_and_reflected_in_accounts_receivable(): void
    {
        $admin = $this->makeUser('admin', ['gb_balance' => 5000]);
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id, 'gb_rate' => 100, 'commission_due' => 2500]);

        // Allocate 1000 GB at rate 100 Rs/GB with 0 upfront paid_amount
        $this->actingAs($admin, 'sanctum')
            ->postJson('/api/gb/allocate', [
                'user_id' => $reseller->id,
                'gb_amount' => 1000,
                'paid_amount' => 0,
            ])
            ->assertOk();

        $response = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk();

        $data = $response->json('data');

        // Realized revenue = 0 (since no payment was made yet)
        $this->assertEquals(0, $data['income_statement']['gb_allocation_revenue']);
        $this->assertEquals(0, $data['summary']['total_revenue']);

        // Accounts Receivable (1100) = 100,000 (total_amount 100,000 - paid_amount 0)
        $arItem = collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1100');
        $this->assertNotNull($arItem);
        $this->assertEquals(100000, $arItem['balance']);

        // Reseller Commission Receivable (1120) = 2500
        $commItem = collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1120');
        $this->assertNotNull($commItem);
        $this->assertEquals(2500, $commItem['balance']);

        // Now simulate a payment of 40,000 on the invoice
        $invoice = Invoice::first();
        $invoice->update(['paid_amount' => 40000]);

        $responseAfterPayment = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk();

        $dataAfter = $responseAfterPayment->json('data');

        // Realized revenue = 40,000
        $this->assertEquals(40000, $dataAfter['income_statement']['gb_allocation_revenue']);
        $this->assertEquals(40000, $dataAfter['summary']['total_revenue']);

        // Accounts Receivable = 100,000 - 40,000 = 60,000
        $arItemAfter = collect($dataAfter['balance_sheet']['assets']['items'])->firstWhere('code', '1100');
        $this->assertEquals(60000, $arItemAfter['balance']);
    }

    public function test_customer_accounts_receivable_is_never_reported(): void
    {
        foreach (['admin', 'reseller', 'seller'] as $role) {
            $user = $this->makeUser($role);

            $data = $this->actingAs($user, 'sanctum')
                ->getJson('/api/accounts/financial-dashboard')
                ->assertOk()
                ->json('data');

            $this->assertNull(
                collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1150'),
                "1150 Customer Accounts Receivable must not be reported for {$role}."
            );
        }
    }

    public function test_reseller_books_own_share_of_wallet_voucher_sales_and_owes_commission(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', [
            'parent_id' => $admin->id, 'commission_percent' => 30, 'commission_due' => 300,
        ]);

        // One wallet-package card sold at Rs 1,000 with a 30% admin cut, and one
        // GB-package card sold at Rs 500 (no split — full price is due upstream).
        Voucher::create([
            'code' => 'WAL1', 'username' => 'WAL1', 'password' => 'WAL1',
            'plan_id' => $this->plan('wallet')->id, 'owner_id' => $reseller->id,
            'reseller_id' => $reseller->id, 'price' => 1000, 'status' => 'active',
            'sold_at' => now(), 'commission_percent' => 30, 'admin_share' => 300, 'reseller_share' => 700,
        ]);
        Voucher::create([
            'code' => 'GB1', 'username' => 'GB1', 'password' => 'GB1',
            'plan_id' => $this->plan('gb')->id, 'owner_id' => $reseller->id,
            'reseller_id' => $reseller->id, 'price' => 500, 'status' => 'active', 'sold_at' => now(),
        ]);

        $data = $this->actingAs($reseller, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk()
            ->json('data');

        // Wallet card contributes only the reseller's own cut; the GB card its full price.
        $this->assertEquals(700, $data['income_statement']['commission_revenue']);
        $this->assertEquals(500, $data['income_statement']['gb_voucher_revenue']);
        $this->assertEquals(1200, $data['income_statement']['gross_operating_revenue']);
        $this->assertTrue($data['income_statement']['commission_revenue_applicable']);

        // Cash still holds the gross takings of both sales.
        $cash = collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1000');
        $this->assertEquals(1500, $cash['balance']);

        // A reseller is never owed commission by a downline — 1120 is not their account.
        $this->assertNull(collect($data['balance_sheet']['assets']['items'])->firstWhere('code', '1120'));

        // What they owe their admin shows as Commission Payable (2200).
        $payable = collect($data['balance_sheet']['liabilities_and_equity']['liabilities'])->firstWhere('code', '2200');
        $this->assertNotNull($payable);
        $this->assertEquals(300, $payable['balance']);
    }

    public function test_seller_has_no_commission_revenue_or_commission_accounts(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id, 'commission_percent' => 30]);
        $seller = $this->makeUser('seller', ['parent_id' => $reseller->id]);

        Voucher::create([
            'code' => 'WAL2', 'username' => 'WAL2', 'password' => 'WAL2',
            'plan_id' => $this->plan('wallet')->id, 'owner_id' => $seller->id,
            'reseller_id' => $reseller->id, 'seller_id' => $seller->id,
            'price' => 1000, 'status' => 'active', 'sold_at' => now(),
            'commission_percent' => 30, 'admin_share' => 300, 'reseller_share' => 700,
        ]);

        $data = $this->actingAs($seller, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk()
            ->json('data');

        // The commission split is admin↔reseller only, so the line is not shown.
        $this->assertFalse($data['income_statement']['commission_revenue_applicable']);
        $this->assertEquals(0, $data['income_statement']['commission_revenue']);
        $this->assertEquals(0, $data['income_statement']['gross_operating_revenue']);

        $items = collect($data['balance_sheet']['assets']['items']);
        $this->assertNull($items->firstWhere('code', '1120'));

        // No commission is payable by a seller either, so the row is not theirs.
        $liabilities = collect($data['balance_sheet']['liabilities_and_equity']['liabilities']);
        $this->assertNull($liabilities->firstWhere('code', '2200'));
        $this->assertNotNull($liabilities->firstWhere('code', '2100'), 'A seller still carries GB dues upstream.');
    }

    public function test_commission_payable_is_a_standing_row_for_a_reseller_even_at_zero(): void
    {
        $admin = $this->makeUser('admin');
        $reseller = $this->makeUser('reseller', ['parent_id' => $admin->id, 'commission_due' => 0]);

        $data = $this->actingAs($reseller, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk()
            ->json('data');

        $payable = collect($data['balance_sheet']['liabilities_and_equity']['liabilities'])->firstWhere('code', '2200');
        $this->assertNotNull($payable, 'A reseller must always see Commission Payable, settled or not.');
        $this->assertEquals(0, $payable['balance']);
        $this->assertEquals('Commission Payable — Upstream Admin', $payable['name']);
    }

    public function test_admin_carries_no_upstream_or_commission_payable_rows(): void
    {
        $admin = $this->makeUser('admin');

        $data = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/accounts/financial-dashboard')
            ->assertOk()
            ->json('data');

        $codes = collect($data['balance_sheet']['liabilities_and_equity']['liabilities'])->pluck('code');
        $this->assertNotContains('2100', $codes);
        $this->assertNotContains('2200', $codes);
    }
}
