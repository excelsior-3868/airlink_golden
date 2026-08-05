<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('chart_of_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->index();
            $table->string('name');
            $table->enum('type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])->index();
            $table->string('category', 50)->index(); // CURRENT_ASSETS, CURRENT_LIABILITIES, OWNER_EQUITY, OPERATING_REVENUE, OPERATING_EXPENSES
            $table->text('description')->nullable();
            $table->boolean('is_system')->default(false);
            $table->foreignId('user_id')->nullable()->constrained('users')->onDelete('cascade');
            $table->timestamps();
        });

        // Seed Default Chart of Accounts for Airlink ISP & Voucher Billing 3.0
        $now = now();
        DB::table('chart_of_accounts')->insert([
            // ASSETS -> CURRENT_ASSETS
            [
                'code' => '1000',
                'name' => 'Cash & Bank',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Liquid cash, bank balances, and digital wallets (eSewa, Khalti, ConnectIPS)',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '1100',
                'name' => 'Accounts Receivable — Resellers & Sellers',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Credit and wallet balance dues owed by resellers and sellers',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '1150',
                'name' => 'Customer Accounts Receivable',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Outstanding dues from direct PPPoE and hotspot subscribers',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '1200',
                'name' => 'Network Equipment & Voucher Inventory',
                'type' => 'ASSET',
                'category' => 'CURRENT_ASSETS',
                'description' => 'Mikrotik NAS routers, ONUs, switches, fiber cables, and printed voucher cards',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],

            // LIABILITIES -> CURRENT_LIABILITIES
            [
                'code' => '2100',
                'name' => 'Accounts Payable — Upstream ISPs',
                'type' => 'LIABILITY',
                'category' => 'CURRENT_LIABILITIES',
                'description' => 'Payables to upstream bandwidth transit providers & hardware suppliers',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '2200',
                'name' => 'Partner & Seller Commission Payable',
                'type' => 'LIABILITY',
                'category' => 'CURRENT_LIABILITIES',
                'description' => 'Accrued voucher sales commission owed to resellers and sellers',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '2300',
                'name' => 'Payroll & Tax Deductions Payable',
                'type' => 'LIABILITY',
                'category' => 'CURRENT_LIABILITIES',
                'description' => 'Accrued network technicians payroll and tax withholdings',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],

            // EQUITY -> OWNER_EQUITY
            [
                'code' => '3100',
                'name' => 'Retained Earnings (Net Profit)',
                'type' => 'EQUITY',
                'category' => 'OWNER_EQUITY',
                'description' => 'Accumulated net profit retained in ISP billing operations',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '3200',
                'name' => 'Owner Capital & Reserves',
                'type' => 'EQUITY',
                'category' => 'OWNER_EQUITY',
                'description' => 'Capital invested into network infrastructure and expansion',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],

            // INCOME -> OPERATING_REVENUE
            [
                'code' => '4000',
                'name' => 'Wallet Voucher Commission Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'Commission earned on voucher card sales and wallet top-ups',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '4100',
                'name' => 'GB Allocation Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'Revenue from bulk GB bandwidth quota allocations to downline nodes',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '4200',
                'name' => 'Wi-Fi & PPPoE Voucher Sales Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'Direct hotspot & PPPoE internet voucher sales revenue',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '4300',
                'name' => 'Hardware & Router Sales Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'Sales of ONUs, Wi-Fi routers, and CPE network hardware',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '4400',
                'name' => 'Installation & Service Fee Revenue',
                'type' => 'INCOME',
                'category' => 'OPERATING_REVENUE',
                'description' => 'New line connection, fiber setup, and service charges',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],


            // EXPENSES -> OPERATING_EXPENSES
            [
                'code' => '5000',
                'name' => 'Bandwidth Transit & Upstream ISP Costs',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Upstream internet transit connection & fiber backhaul bandwidth fees',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5100',
                'name' => 'Staff Salaries & Technical Support',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Network engineers, support staff, and admin payroll',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5200',
                'name' => 'Tower & POP Location Rent',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Rental costs for wireless towers, POP sites, and server racks',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5300',
                'name' => 'Network Infrastructure & Equipment Repairs',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Fiber cable maintenance, router repairs, and hardware replacements',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5400',
                'name' => 'Utilities & Power Backup',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Electricity, solar/UPS batteries, and generator fuel for POP sites',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5500',
                'name' => 'Marketing & Reseller Commissions',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Commission payouts to resellers/sellers and promotional ads',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'code' => '5900',
                'name' => 'General Operational Expenses',
                'type' => 'EXPENSE',
                'category' => 'OPERATING_EXPENSES',
                'description' => 'Miscellaneous office and administrative expenses',
                'is_system' => true,
                'user_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('chart_of_accounts');
    }
};
