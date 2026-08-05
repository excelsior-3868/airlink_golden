<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FinancialDashboardTest extends TestCase
{
    use RefreshDatabase;

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
}
