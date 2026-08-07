<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\GbController;
use App\Http\Controllers\Api\NasController;
use App\Http\Controllers\Api\PlanController;
use App\Http\Controllers\Api\BandwidthController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VoucherController;
use App\Http\Controllers\Api\WalletController;
use App\Http\Controllers\Api\BatchController;
use App\Http\Controllers\Api\LoginLogController;
use App\Http\Controllers\Api\RadiusController;
use App\Http\Controllers\Api\PermissionController;
use App\Http\Controllers\Api\VoucherTemplateController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\TransactionController;
use App\Http\Controllers\Api\SeasonController;
use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\IntegrationTokenController;
use App\Http\Controllers\Api\PaymentMethodController;
use Illuminate\Support\Facades\Route;

// --- Public ---
Route::post('/login', [AuthController::class, 'login']);

// --- Authenticated ---
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
    Route::get('/dashboard', [DashboardController::class, 'index'])->middleware('permission:dashboard');

    // Plans — read for all, writes gated by permission.
    Route::get('/plans', [PlanController::class, 'index']);
    Route::get('/plans/{plan}', [PlanController::class, 'show']);
    // Permission checked inside store(): create_plan (Plans page) vs create_voucher_plan (voucher inline).
    Route::post('/plans', [PlanController::class, 'store']);
    Route::put('/plans/{plan}', [PlanController::class, 'update'])->middleware('permission:create_plan');
    Route::delete('/plans/{plan}', [PlanController::class, 'destroy'])->middleware('permission:create_plan');

    // Bandwidths — read for all, writes gated by permission.
    Route::get('/bandwidths', [BandwidthController::class, 'index']);
    Route::get('/bandwidths/{bandwidth}', [BandwidthController::class, 'show']);
    Route::post('/bandwidths', [BandwidthController::class, 'store'])->middleware('permission:create_plan');
    Route::put('/bandwidths/{bandwidth}', [BandwidthController::class, 'update'])->middleware('permission:create_plan');
    Route::delete('/bandwidths/{bandwidth}', [BandwidthController::class, 'destroy'])->middleware('permission:create_plan');

    // Batches
    Route::get('/batches', [BatchController::class, 'index']);

    // Users / hierarchy.
    Route::get('/users', [UserController::class, 'index']);
    Route::get('/users/{user}', [UserController::class, 'show']);
    Route::put('/users/{user}', [UserController::class, 'update']);
    Route::patch('/users/{user}/status', [UserController::class, 'setStatus'])->middleware('role:admin,reseller');
    Route::post('/resellers', [UserController::class, 'storeReseller'])->middleware('permission:create_reseller');
    Route::post('/sellers', [UserController::class, 'storeSeller'])->middleware('permission:create_seller');

    // Wallet — load/transfer admin+reseller; refund admin-only.
    Route::get('/wallet/transactions', [WalletController::class, 'transactions']);
    Route::post('/wallet/load', [WalletController::class, 'load'])->middleware('permission:wallet_load');
    Route::post('/wallet/refund', [WalletController::class, 'refund'])->middleware('role:admin');

    // GB allocation — admin+reseller.
    Route::get('/gb/transactions', [GbController::class, 'transactions']);
    Route::post('/gb/allocate', [GbController::class, 'allocate'])->middleware('permission:allocate_gb');

    // Unified transaction feed (wallet + GB + invoices + payments), role-scoped.
    Route::get('/transactions', [TransactionController::class, 'index']);

    // Billing & Invoices
    Route::get('/billing/invoices', [BillingController::class, 'invoices']);
    Route::get('/billing/payments', [BillingController::class, 'payments']);
    Route::post('/billing/payments/collect', [BillingController::class, 'collect'])->middleware('permission:wallet_load');
    Route::post('/billing/commission/collect', [BillingController::class, 'collectCommission'])->middleware('permission:wallet_load');

    // Accounts Module (Sales Ledger, Financial Dashboard, COA & Expenses)
    Route::get('/accounts/financial-dashboard', [AccountController::class, 'financialDashboard']);
    // Chart of Accounts is the system-wide GL master list — admin only. Resellers
    // and sellers read their own role-scoped figures off the financial dashboard.
    Route::middleware('role:admin')->group(function () {
        Route::get('/accounts/chart-of-accounts', [AccountController::class, 'chartOfAccountsIndex']);
        Route::post('/accounts/chart-of-accounts', [AccountController::class, 'chartOfAccountsStore']);
        Route::put('/accounts/chart-of-accounts/{account}', [AccountController::class, 'chartOfAccountsUpdate']);
        Route::delete('/accounts/chart-of-accounts/{account}', [AccountController::class, 'chartOfAccountsDestroy']);
    });

    Route::get('/accounts/sales-ledger', [AccountController::class, 'salesLedger']);
    Route::get('/accounts/commission-report', [AccountController::class, 'commissionReport']);
    Route::get('/accounts/expenses', [AccountController::class, 'expensesIndex']);
    Route::post('/accounts/expenses', [AccountController::class, 'expenseStore']);
    Route::put('/accounts/expenses/{expense}', [AccountController::class, 'expenseUpdate']);
    Route::delete('/accounts/expenses/{expense}', [AccountController::class, 'expenseDestroy']);

    Route::get('/accounts/parties', [AccountController::class, 'partiesIndex']);
    Route::post('/accounts/parties', [AccountController::class, 'partyStore']);
    Route::put('/accounts/parties/{party}', [AccountController::class, 'partyUpdate']);
    Route::delete('/accounts/parties/{party}', [AccountController::class, 'partyDestroy']);


    // Payment Methods
    Route::get('/payment-methods', [PaymentMethodController::class, 'index']);
    Route::get('/admin/payment-methods', [PaymentMethodController::class, 'adminIndex'])->middleware('role:admin');
    Route::post('/admin/payment-methods', [PaymentMethodController::class, 'store'])->middleware('role:admin');
    Route::put('/admin/payment-methods/{id}', [PaymentMethodController::class, 'update'])->middleware('role:admin');
    Route::delete('/admin/payment-methods/{id}', [PaymentMethodController::class, 'destroy'])->middleware('role:admin');


    Route::get('/parties', [AccountController::class, 'partiesIndex']);
    Route::post('/parties', [AccountController::class, 'partyStore']);
    Route::put('/parties/{party}', [AccountController::class, 'partyUpdate']);
    Route::delete('/parties/{party}', [AccountController::class, 'partyDestroy']);

    // Vouchers — generate, list/show scoped, export; lifecycle.
    Route::get('/vouchers', [VoucherController::class, 'index']);
    Route::get('/vouchers/export', [VoucherController::class, 'exportCsv']);
    Route::get('/vouchers/export-xlsx', [VoucherController::class, 'exportXlsx']);
    Route::get('/vouchers/print', [VoucherController::class, 'printSheet']);
    Route::post('/vouchers/generate', [VoucherController::class, 'generate'])->middleware('permission:generate_voucher');
    Route::post('/vouchers/redeem', [VoucherController::class, 'redeem']);
    Route::post('/vouchers/{voucher}/sell', [VoucherController::class, 'sell']);
    Route::get('/vouchers/{voucher}', [VoucherController::class, 'show']);
    Route::get('/vouchers/{voucher}/card', [VoucherController::class, 'card']);
    Route::delete('/vouchers/{voucher}', [VoucherController::class, 'destroy'])->middleware('permission:delete_voucher');
    Route::patch('/vouchers/{voucher}/disable', [VoucherController::class, 'disable']);
    Route::patch('/vouchers/{voucher}/enable', [VoucherController::class, 'enable']);

    // Reports — used-voucher package summary (scoped); drill-down via /vouchers.
    Route::get('/reports/package-summary', [ReportController::class, 'packageSummary'])->middleware('permission:reports');
    Route::get('/reports/reseller-summary', [ReportController::class, 'resellerSummary'])->middleware('permission:reports');

    // System Permissions Configuration Matrix
    Route::get('/permissions', [PermissionController::class, 'index']);
    Route::post('/permissions', [PermissionController::class, 'update'])->middleware('role:admin');

    // Voucher card design template — read, save, and reset.
    Route::get('/voucher-template', [VoucherTemplateController::class, 'index']);
    Route::post('/voucher-template', [VoucherTemplateController::class, 'save']);
    Route::delete('/voucher-template', [VoucherTemplateController::class, 'reset']);

    // NAS / router management (admin only). List is readable by all authed users.
    Route::get('/nas', [NasController::class, 'index']);

    // Voucher Diagnostics log — readable by all authenticated roles.
    Route::get('/radius/server-log', [RadiusController::class, 'serverLog']);

    // Seasons lookup readable by all authenticated roles
    Route::get('/seasons', [SeasonController::class, 'index']);

    // Integration API tokens — named, ability-scoped Sanctum tokens a user issues for a
    // third-party app (e.g. a PMS selling vouchers through their reseller/seller account).
    // Scoped to the caller's own tokens only (no route-model binding across users).
    Route::get('/api-tokens/abilities', [IntegrationTokenController::class, 'abilities']);
    Route::middleware('permission:manage_api_tokens')->group(function () {
        Route::get('/api-tokens', [IntegrationTokenController::class, 'index']);
        Route::post('/api-tokens', [IntegrationTokenController::class, 'store']);
        Route::delete('/api-tokens/{id}', [IntegrationTokenController::class, 'destroy']);
    });

    Route::middleware('role:admin')->group(function () {
        Route::get('/admin/system-loads', [UserController::class, 'systemLoadHistory']);
        Route::post('/admin/system-load', [UserController::class, 'systemLoad']);
        Route::patch('/users/{user}/gb-rate', [UserController::class, 'updateGbRate']);
        Route::post('/nas', [NasController::class, 'store']);
        Route::put('/nas/{nas}', [NasController::class, 'update']);
        Route::delete('/nas/{nas}', [NasController::class, 'destroy']);

        Route::get('/login-logs', [LoginLogController::class, 'index']);
        Route::get('/radius/status', [RadiusController::class, 'status']);
        Route::get('/radius/online-users', [RadiusController::class, 'onlineUsers']);
        Route::post('/radius/disconnect-user', [RadiusController::class, 'disconnectUser']);
        Route::get('/radius/auth-logs', [RadiusController::class, 'authLogs']);
        Route::get('/radius/clients-config', [RadiusController::class, 'clientsConfig']);
        Route::post('/radius/test-auth', [RadiusController::class, 'testAuth']);
        Route::post('/radius/restart', [RadiusController::class, 'restart']);

        // Seasons management (admin only)
        Route::put('/seasons/{season}', [SeasonController::class, 'update']);
    });
});
