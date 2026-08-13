<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChartOfAccount;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Payment;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;


class AccountController extends Controller
{
    /**
     * Sales Ledger breakdown per Reseller and Seller.
     */
    /**
     * Sales Ledger breakdown per Reseller and Seller.
     */
    public function salesLedger(Request $request): JsonResponse
    {
        $actor = $request->user();
        $roleFilter = $request->query('role'); // 'reseller', 'seller', or null
        $targetUserId = $request->query('user_id');
        $fromDate = $request->query('from_date');
        $toDate = $request->query('to_date');
        $search = $request->query('search');

        $userQuery = User::query();

        if ($actor->isAdmin()) {
            if ($targetUserId) {
                $userQuery->where('id', (int) $targetUserId);
            } else {
                // Admin transacts directly with resellers only — seller activity
                // is the reseller's own downline business, not the admin's ledger.
                $userQuery->where('role', $roleFilter ?: 'reseller');
            }
        } elseif ($actor->isReseller()) {
            if ($targetUserId) {
                // Ensure targetUserId belongs to reseller or self
                $userQuery->where(function ($q) use ($actor, $targetUserId) {
                    $q->where('id', (int) $targetUserId)->where('parent_id', $actor->id)
                      ->orWhere('id', $actor->id);
                });
            } else {
                $userQuery->where(function ($q) use ($actor) {
                    $q->where('parent_id', $actor->id)->orWhere('id', $actor->id);
                });
                if ($roleFilter) {
                    $userQuery->where('role', $roleFilter);
                }
            }
        } else {
            $userQuery->where('id', $actor->id);
        }

        if ($search) {
            $userQuery->where(fn ($q) => $q->where('name', 'like', "%{$search}%")->orWhere('username', 'like', "%{$search}%"));
        }

        $users = $userQuery->orderBy('name')->get();
        $userIds = $users->pluck('id')->all();

        // Invoices Query (GB Sales)
        $invoiceQuery = Invoice::query();
        if ($actor->isAdmin()) {
            if ($targetUserId) {
                $invoiceQuery->where(fn ($q) => $q->where('sender_id', $targetUserId)->orWhere('receiver_id', $targetUserId));
            } else {
                $invoiceQuery->where(fn ($q) => $q->where('sender_id', $actor->id)->orWhereIn('receiver_id', $userIds));
            }
        } elseif ($actor->isReseller()) {
            if ($targetUserId) {
                $invoiceQuery->where(fn ($q) => $q->where('sender_id', $targetUserId)->orWhere('receiver_id', $targetUserId));
            } else {
                $invoiceQuery->where(fn ($q) => $q->where('sender_id', $actor->id)->orWhereIn('receiver_id', $userIds));
            }
        } else {
            $invoiceQuery->where(fn ($q) => $q->where('sender_id', $actor->id)->orWhere('receiver_id', $actor->id));
        }

        if ($fromDate) {
            $invoiceQuery->whereDate('created_at', '>=', $fromDate);
        }
        if ($toDate) {
            $invoiceQuery->whereDate('created_at', '<=', $toDate);
        }

        $invoices = $invoiceQuery->with(['sender:id,name,username', 'receiver:id,name,username'])->latest()->get();

        // Payments Query (Cash Collections)
        $paymentQuery = Payment::query();
        if ($actor->isAdmin()) {
            if ($targetUserId) {
                $paymentQuery->where(fn ($q) => $q->where('sender_id', $targetUserId)->orWhere('receiver_id', $targetUserId));
            } else {
                $paymentQuery->where(fn ($q) => $q->where('receiver_id', $actor->id)->orWhereIn('sender_id', $userIds));
            }
        } elseif ($actor->isReseller()) {
            if ($targetUserId) {
                $paymentQuery->where(fn ($q) => $q->where('sender_id', $targetUserId)->orWhere('receiver_id', $targetUserId));
            } else {
                $paymentQuery->where(fn ($q) => $q->where('receiver_id', $actor->id)->orWhereIn('sender_id', $userIds));
            }
        } else {
            $paymentQuery->where(fn ($q) => $q->where('sender_id', $actor->id)->orWhere('receiver_id', $actor->id));
        }

        if ($fromDate) {
            $paymentQuery->whereDate('payment_date', '>=', $fromDate);
        }
        if ($toDate) {
            $paymentQuery->whereDate('payment_date', '<=', $toDate);
        }

        $payments = $paymentQuery->with(['sender:id,name,username', 'receiver:id,name,username'])->latest()->get();

        // Voucher Sales Query — cards sold by a reseller directly, or by one of
        // their sellers. Attributed to seller_id when set, else reseller_id.
        // Only the reseller/seller's own cut (reseller_share) counts as paid —
        // they already pocketed that cash from the end customer. The admin_share
        // is owed up the chain and stays in wallet_due until a real Payment is
        // recorded, even though it's auto-credited into the admin's wallet balance.
        $voucherQuery = Voucher::query()
            ->where(function ($q) {
                $q->whereNotNull('sold_at')
                  ->orWhereNotNull('activated_at')
                  ->orWhereIn('status', ['active', 'used']);
            })
            ->where(function ($q) use ($userIds) {
                $q->whereIn('seller_id', $userIds)
                  ->orWhere(function ($q2) use ($userIds) {
                      $q2->whereNull('seller_id')->whereIn('reseller_id', $userIds);
                  });
            });

        if ($fromDate) {
            $voucherQuery->whereRaw('COALESCE(sold_at, activated_at) >= ?', [$fromDate]);
        }
        if ($toDate) {
            $voucherQuery->whereRaw('COALESCE(sold_at, activated_at) <= ?', [$toDate . ' 23:59:59']);
        }

        $vouchers = $voucherQuery->with(['plan:id,name,package_type', 'seller:id,name,username', 'reseller:id,name,username'])->latest('sold_at')->get();

        // Calculate User Summaries
        $userSummaries = $users->map(function ($u) use ($invoices, $payments, $vouchers) {
            $uInvoices = $invoices->filter(fn ($i) => $i->receiver_id === $u->id || $i->sender_id === $u->id);
            $uPayments = $payments->filter(fn ($p) => $p->sender_id === $u->id || $p->receiver_id === $u->id);
            $uVouchers = $vouchers->filter(fn ($v) => ($v->seller_id ?? $v->reseller_id) === $u->id);

            $totalInvoiced = (float) $uInvoices->sum('total_amount');
            $totalGb = (float) $uInvoices->sum('gb_amount');
            $totalPaid = (float) $uPayments->sum('amount');
            $totalVoucherSales = (float) $uVouchers->sum('price');
            $totalVoucherGb = (float) $uVouchers->sum('data_gb');
            $isGbVoucher = fn ($v) => ($v->plan->package_type ?? null) === 'gb';
            // Commission columns are null for vouchers sold before this feature —
            // fall back to the full price going to the reseller/seller (0% admin cut),
            // matching what actually happened for those historical sales. GB Package
            // vouchers never carry a commission split at all — their full price is a
            // direct due (see total_gb_due below), not a reseller/admin split.
            $totalAdminShare = (float) $uVouchers->sum(fn ($v) => $isGbVoucher($v) ? 0.0 : ($v->admin_share ?? 0.0));
            $totalResellerShare = (float) $uVouchers->sum(fn ($v) => $isGbVoucher($v) ? 0.0 : ($v->reseller_share ?? (float) $v->price));
            $totalGbDue = (float) $uVouchers->sum(fn ($v) => $isGbVoucher($v) ? (float) ($v->gb_due_amount ?? 0.0) : 0.0);
            // The reseller/seller's own cut never touches the admin's books at all —
            // it's their retail profit, not something owed to or collected by admin.
            // Only admin_share is a receivable. Outstanding commission is read from
            // the persisted commission_due balance (kept in sync by VoucherController
            // @sell and PaymentService@collectCommission) rather than recomputed from
            // this request's date-filtered vouchers/payments, which would drift
            // whenever a from/to date filter is applied.
            $totalInvoicedAll = $totalInvoiced + $totalVoucherSales;

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'role' => $u->role,
                'parent_id' => $u->parent_id,
                'gb_rate' => (float) $u->gb_rate,
                'commission_percent' => (float) $u->commission_percent,
                'total_gb_sales' => $totalGb + $totalVoucherGb,
                'total_voucher_sales' => $totalVoucherSales,
                'total_admin_share' => $totalAdminShare,
                'total_reseller_share' => $totalResellerShare,
                'total_gb_due' => $totalGbDue,
                'total_invoiced' => $totalInvoicedAll,
                'total_paid' => $totalPaid,
                // Real GB/wallet due (allocations + settled GB voucher sales) — was
                // previously mislabeled here as $u->commission_due, which made the
                // ledger's "Outstanding Balance" show the wrong number entirely.
                'wallet_due' => (float) $u->wallet_due,
                'commission_due' => (float) $u->commission_due,
                'invoices_count' => $uInvoices->count(),
                'payments_count' => $uPayments->count(),
                'vouchers_sold_count' => $uVouchers->count(),
            ];
        });

        // Combined Detailed Ledger Items
        $ledgerItems = collect();

        foreach ($invoices as $inv) {
            $ledgerItems->push([
                'id' => "inv-{$inv->id}",
                'type' => 'invoice',
                'title' => "GB Allocation ({$inv->gb_amount} GB)",
                'reference' => $inv->invoice_number,
                'party_name' => $inv->receiver->name ?? $inv->receiver->username ?? 'User',
                'user_name' => $inv->receiver->name ?? $inv->receiver->username ?? 'User',
                'user_role' => $inv->receiver->role ?? '',
                'user_id' => $inv->receiver_id,
                'amount' => (float) $inv->total_amount,
                'invoiced' => (float) $inv->total_amount,
                'paid' => (float) $inv->paid_amount,
                'paid_amount' => (float) $inv->paid_amount,
                'due_amount' => (float) ($inv->total_amount - $inv->paid_amount),
                'status' => strtoupper($inv->status),
                'created_at' => $inv->created_at ? $inv->created_at->toDateTimeString() : now()->toDateTimeString(),
                'date' => $inv->invoice_date ?? ($inv->created_at ? $inv->created_at->toDateString() : date('Y-m-d')),
                'note' => $inv->notes ?? "GB Allocation ({$inv->gb_amount} GB)",
            ]);
        }

        foreach ($payments as $pay) {
            $ledgerItems->push([
                'id' => "pay-{$pay->id}",
                'type' => 'payment',
                'payment_type' => $pay->type,
                'title' => "Payment Collection ({$pay->payment_method})",
                'reference' => $pay->reference_number ?? "PAY-{$pay->id}",
                'party_name' => $pay->sender->name ?? $pay->sender->username ?? 'User',
                'user_name' => $pay->sender->name ?? $pay->sender->username ?? 'User',
                'user_role' => $pay->sender->role ?? '',
                'user_id' => $pay->sender_id,
                'amount' => (float) $pay->amount,
                'invoiced' => 0.00,
                'paid' => (float) $pay->amount,
                'paid_amount' => (float) $pay->amount,
                'due_amount' => 0.00,
                'status' => 'PAID',
                'date' => $pay->payment_date ? $pay->payment_date->toIso8601String() : $pay->created_at->toIso8601String(),
                'created_at' => $pay->created_at->toIso8601String(),
                'note' => $pay->note ?? "Payment Received via {$pay->payment_method}",
            ]);
        }

        foreach ($vouchers as $v) {
            $owner = $v->seller ?? $v->reseller;
            $ownerId = $v->seller_id ?? $v->reseller_id;
            $planName = $v->plan->name ?? 'Package';
            $customer = $v->customer_username ?: 'Walk-in Customer';

            if (($v->plan->package_type ?? null) === 'gb') {
                // Exclude GB voucher sales from Sales and Revenue Ledger
                continue;
            }

            // Null on vouchers sold before this feature — treat as 0% admin cut,
            // matching what actually happened for those historical sales.
            $adminShare = (float) ($v->admin_share ?? 0.0);
            $resellerShare = (float) ($v->reseller_share ?? $v->price);

            $ledgerItems->push([
                'id' => "vch-{$v->id}",
                'type' => 'voucher_sale',
                'title' => "Voucher Sale ({$planName})",
                'reference' => $v->code,
                'party_name' => $owner->name ?? $owner->username ?? 'User',
                'user_name' => $owner->name ?? $owner->username ?? 'User',
                'user_role' => $owner->role ?? '',
                'user_id' => $ownerId,
                'amount' => (float) $v->price,
                'invoiced' => (float) $v->price,
                // Only the reseller/seller's own cut is settled at sale time — the
                // admin_share is owed up the chain until a real Payment is recorded,
                // even though it was already auto-credited into the admin's wallet.
                'paid' => $resellerShare,
                'paid_amount' => $resellerShare,
                'due_amount' => $adminShare,
                'admin_share' => $adminShare,
                'reseller_share' => $resellerShare,
                'commission_percent' => (float) ($v->commission_percent ?? 0.0),
                'status' => $adminShare > 0 ? 'PARTIAL' : 'PAID',
                'date' => ($v->sold_at ?? $v->created_at)->toIso8601String(),
                'created_at' => ($v->sold_at ?? $v->created_at)->toIso8601String(),
                'note' => "Voucher Sale ({$planName}) to {$customer}",
            ]);
        }

        // Calculate running balance chronologically. Every item now carries both
        // 'invoiced' and 'paid' (zero where not applicable) — a fully-settled
        // item (invoiced === paid) nets to no due change, while a voucher sale
        // (paid = reseller_share only) leaves its admin_share as running debt.
        $chronologicalItems = $ledgerItems->sortBy('created_at')->values();
        $running = 0.0;
        $itemsWithBalance = $chronologicalItems->map(function ($item) use (&$running) {
            $running += $item['invoiced'] - $item['paid'];
            $item['running_balance'] = max(0.0, $running);
            return $item;
        });

        $sortedItems = $itemsWithBalance->sortByDesc('created_at')->values();

        // Optional row-type filter, driven by clicking a summary KPI card on the
        // frontend. 'due' is synthetic — it doesn't match a single ledger item
        // `type`, it means "anything still outstanding" regardless of type.
        $typeFilter = $request->query('type');
        if ($typeFilter === 'due') {
            $sortedItems = $sortedItems->filter(fn ($item) => ($item['due_amount'] ?? 0) > 0)->values();
        } elseif ($typeFilter === 'commission_paid') {
            $sortedItems = $sortedItems->filter(fn ($item) => ($item['payment_type'] ?? null) === 'commission')->values();
        } elseif ($typeFilter) {
            $sortedItems = $sortedItems->where('type', $typeFilter)->values();
        }

        // Paginate ledger items manually
        $page = (int) $request->query('page', 1);
        $perPage = (int) $request->query('per_page', 20);
        $total = $sortedItems->count();
        $pagedData = $sortedItems->slice(($page - 1) * $perPage, $perPage)->values();

        $overallTotalInvoiced = (float) $userSummaries->sum('total_invoiced');
        // Summing each user's own total_paid double-counts every payment that
        // occurs BETWEEN two users who are both in scope (e.g. a seller paying
        // their reseller shows up once as the seller's payment and again as the
        // reseller's) — sum the underlying unique $payments collection instead.
        // Commission settlements are excluded here: this figure is specifically
        // GB/wallet-due collections, and commission has its own due/report.
        //
        // For a reseller/seller viewing their own scope, "collected" means money
        // that flowed INTO them from their own downline — not the payment they
        // themselves sent upward to their parent (Admin), which would otherwise
        // get swept in via the sender_id-in-scope half of $paymentQuery above.
        $overallTotalPaid = $actor->isAdmin()
            ? (float) $payments->where('type', '!=', 'commission')->sum('amount')
            : (float) $payments->where('type', '!=', 'commission')->where('receiver_id', $actor->id)->sum('amount');
        // Commission the actor has actually settled with their own parent (Admin)
        // — only resellers carry commission_due, so this is 0 for sellers.
        $overallCommissionPaid = (float) $payments->where('type', 'commission')->sum('amount');
        // Outstanding Balance is a receivable — what the actor's downline still
        // owes THEM — not a net of two different debt directions. Summing every
        // row including the actor's own would add the actor's own payable to
        // their parent (e.g. a reseller's due to admin) on top of what their
        // sellers owe the reseller, overstating it. Admin is never in $users
        // here (it queries resellers, not itself), so this exclusion only
        // matters for a reseller/seller viewing their own scope.
        $overallTotalDue = (float) $userSummaries->where('id', '!=', $actor->id)->sum('wallet_due');
        $overallTotalGb = (float) $userSummaries->sum('total_gb_sales');
        $overallAdminCommission = (float) $userSummaries->sum('total_admin_share');
        $overallResellerCommission = (float) $userSummaries->sum('total_reseller_share');
        $overallCommissionDue = (float) $userSummaries->sum('commission_due');
        // Cash a reseller/seller actually collected from end customers by selling
        // GB Package vouchers directly (settled sold/used ones — see gb_due_amount).
        // Distinct from total_paid: that's Payment records for GB allocations
        // between hierarchy levels, this is retail cash at the point of sale that
        // hasn't been remitted upward yet (it sits in wallet_due until it is).
        $overallGbVoucherSales = (float) $vouchers->filter(fn ($v) => ($v->plan->package_type ?? null) === 'gb')->sum('price');
        $walletVouchers = $vouchers->filter(fn ($v) => ($v->plan->package_type ?? null) === 'wallet');
        $overallWalletVoucherSales = (float) $walletVouchers->sum('price');
        // Commission actually earned on those wallet sales — the gross above is
        // retail cash at the counter, most of which is owed upstream as the
        // admin's cut. Null shares mean a pre-commission sale (0% admin cut).
        $overallWalletVoucherCommission = (float) $walletVouchers->sum(fn ($v) => (float) ($v->reseller_share ?? $v->price));

        return $this->ok([
            'summary' => [
                'total_invoiced' => $overallTotalInvoiced,
                'total_paid' => $overallTotalPaid,
                'total_due' => $overallTotalDue,
                'total_gb' => $overallTotalGb,
                'total_admin_commission' => $overallAdminCommission,
                'total_reseller_commission' => $overallResellerCommission,
                'total_commission_due' => $overallCommissionDue,
                'total_commission_paid' => $overallCommissionPaid,
                // Every voucher sale in scope, whatever the package type. Without
                // this the seller view fell back to total_invoiced, which folds GB
                // allocation invoices in with card sales and reads far too high.
                'total_voucher_sales' => (float) $vouchers->sum('price'),
                'total_gb_voucher_sales' => $overallGbVoucherSales,
                'total_wallet_voucher_sales' => $overallWalletVoucherSales,
                'total_wallet_voucher_commission' => $overallWalletVoucherCommission,
                'reseller_count' => $userSummaries->where('role', 'reseller')->count(),
                'seller_count' => $userSummaries->where('role', 'seller')->count(),
            ],
            'user_summaries' => $userSummaries,
            'ledger' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $perPage)),
                'data' => $pagedData,
            ],
        ]);
    }

    /**
     * Commission earned vs. actually collected, grouped by day/week/month/year.
     * "Earned" comes from vouchers.admin_share (accrued at sale time).
     * "Collected" comes from real Payment rows of type='commission'
     * (PaymentService@collectCommission) — never from the automatic wallet
     * credit, which is a bookkeeping accrual, not a settlement.
     */
    public function commissionReport(Request $request): JsonResponse
    {
        $actor = $request->user();
        $groupBy = in_array($request->query('group_by'), ['weekly', 'monthly', 'yearly']) ? $request->query('group_by') : 'daily';
        $targetUserId = $request->query('user_id');

        $userQuery = User::query();
        if ($actor->isAdmin()) {
            if ($targetUserId) {
                $userQuery->where('id', (int) $targetUserId);
            } else {
                $userQuery->where('role', 'reseller');
            }
        } elseif ($actor->isReseller()) {
            $userQuery->where('id', $actor->id);
        } else {
            $userQuery->where('id', -1); // Sellers never carry commission_due.
        }
        $userIds = $userQuery->pluck('id')->all();

        [$dateExpr, $periods] = match ($groupBy) {
            'yearly' => ["DATE_FORMAT(%s, '%%Y')", collect(range(4, 0))->map(fn ($i) => now()->subYears($i)->format('Y'))],
            'monthly' => ["DATE_FORMAT(%s, '%%Y-%%m')", collect(range(11, 0))->map(fn ($i) => now()->subMonths($i)->format('Y-m'))],
            // ISO year-week (Monday-start) — matches PHP's 'o'/'W' format so trailing-window
            // labels line up with MySQL's %x/%v for the same week.
            'weekly' => ["DATE_FORMAT(%s, '%%x-W%%v')", collect(range(11, 0))->map(fn ($i) => now()->subWeeks($i)->format('o-\WW'))],
            default => ['DATE(%s)', collect(range(29, 0))->map(fn ($i) => now()->subDays($i)->toDateString())],
        };

        $fromDate = $request->query('from_date');
        $toDate = $request->query('to_date');

        $earnedQuery = Voucher::query()
            ->whereIn('reseller_id', $userIds)
            ->whereNotNull('sold_at')
            ->whereNotNull('admin_share');
        if ($fromDate) {
            $earnedQuery->whereDate('sold_at', '>=', $fromDate);
        }
        if ($toDate) {
            $earnedQuery->whereDate('sold_at', '<=', $toDate);
        }
        $earnedByPeriod = $earnedQuery
            ->selectRaw(sprintf($dateExpr, 'sold_at') . ' as period, SUM(admin_share) as total')
            ->groupBy('period')
            ->pluck('total', 'period');

        $collectedQuery = Payment::query()
            ->whereIn('sender_id', $userIds)
            ->where('type', 'commission');
        if ($fromDate) {
            $collectedQuery->whereDate('payment_date', '>=', $fromDate);
        }
        if ($toDate) {
            $collectedQuery->whereDate('payment_date', '<=', $toDate);
        }
        $collectedByPeriod = $collectedQuery
            ->selectRaw(sprintf($dateExpr, 'payment_date') . ' as period, SUM(amount) as total')
            ->groupBy('period')
            ->pluck('total', 'period');

        // When an explicit date range is given, report every period it touches
        // instead of the default trailing window.
        $periodKeys = ($fromDate || $toDate)
            ? $earnedByPeriod->keys()->merge($collectedByPeriod->keys())->unique()->sort()->values()
            : $periods;

        $rows = $periodKeys->map(fn ($period) => [
            'period' => $period,
            'earned' => (float) ($earnedByPeriod[$period] ?? 0),
            'collected' => (float) ($collectedByPeriod[$period] ?? 0),
        ])->values();

        $outstanding = (float) User::whereIn('id', $userIds)->sum('commission_due');

        // Per-reseller breakdown, so the admin can collect against a specific
        // account directly from this report. Not date-filtered — commission_due
        // is a live balance, and total_earned_all_time gives context for it.
        $byReseller = $actor->isAdmin()
            ? User::whereIn('id', $userIds)->get(['id', 'name', 'username', 'commission_due'])
                ->map(fn ($u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'username' => $u->username,
                    'commission_due' => (float) $u->commission_due,
                    'total_earned_all_time' => (float) Voucher::where('reseller_id', $u->id)->sum('admin_share'),
                ])
                ->sortByDesc('commission_due')
                ->values()
            : [];

        return $this->ok([
            'group_by' => $groupBy,
            'rows' => $rows,
            'by_reseller' => $byReseller,
            'total_earned' => (float) $rows->sum('earned'),
            'total_collected' => (float) $rows->sum('collected'),
            'total_outstanding' => $outstanding,
        ]);
    }

    /** Expenses List with Category and Party Summaries. */
    public function expensesIndex(Request $request): JsonResponse
    {
        $actor = $request->user();
        $query = Expense::query()->with(['party', 'creator:id,name,username']);

        // Scope by user: Admin sees own expenses; Reseller sees own & direct sellers; Seller sees own
        if ($actor->isAdmin()) {
            $query->where(function ($q) use ($actor) {
                $q->where('created_by', $actor->id)
                  ->orWhere('party_id', $actor->id);
            });
        } elseif ($actor->isReseller()) {
            $directSellerIds = User::where('parent_id', $actor->id)->pluck('id')->all();
            $allowedIds = array_merge([$actor->id], $directSellerIds);
            $query->where(function ($q) use ($allowedIds) {
                $q->whereIn('created_by', $allowedIds)
                  ->orWhereIn('party_id', $allowedIds);
            });
        } else {
            $query->where(function ($q) use ($actor) {
                $q->where('created_by', $actor->id)
                  ->orWhere('party_id', $actor->id);
            });
        }

        if ($partyId = $request->query('party_id')) {
            $user = User::find($partyId);
            if ($user) {
                $query->where(function ($q) use ($partyId, $user) {
                    $q->where('party_id', (int) $partyId)->orWhere('party_name', 'like', "%{$user->name}%");
                });
            } else {
                $query->where('party_id', (int) $partyId);
            }
        }
        if ($category = $request->query('category')) {
            $query->where('category', $category);
        }
        if ($fromDate = $request->query('from_date')) {
            $query->whereDate('expense_date', '>=', $fromDate);
        }
        if ($toDate = $request->query('to_date')) {
            $query->whereDate('expense_date', '<=', $toDate);
        }
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('party_name', 'like', "%{$search}%")
                  ->orWhere('reference', 'like', "%{$search}%")
                  ->orWhere('note', 'like', "%{$search}%");
            });
        }

        $allExpenses = (clone $query)->get();
        $totalAmount = (float) $allExpenses->sum('amount');

        $categoryBreakdown = $allExpenses->groupBy('category')->map(function ($group, $cat) {
            return [
                'category' => $cat,
                'amount' => (float) $group->sum('amount'),
                'count' => $group->count(),
            ];
        })->values();

        $partyBreakdown = $allExpenses->groupBy(fn ($e) => $e->party_name ?: 'General')->map(function ($group, $pName) {
            return [
                'party_name' => $pName,
                'amount' => (float) $group->sum('amount'),
                'count' => $group->count(),
            ];
        })->values()->sortByDesc('amount')->values();

        $byCategory = $categoryBreakdown->pluck('amount', 'category')->all();

        $expenses = $query->orderByDesc('expense_date')->orderByDesc('id')->paginate($request->integer('per_page', 20));

        return $this->ok([
            'summary' => [
                'total_amount' => $totalAmount,
                'total_count' => $allExpenses->count(),
                'count' => $allExpenses->count(),
                'by_category' => $byCategory,
                'categories' => $categoryBreakdown,
                'parties' => $partyBreakdown,
            ],
            'expenses' => $expenses,
        ]);
    }

    /** Create new expense entry. */
    public function expenseStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'party_id' => ['nullable'],
            'party_name' => ['nullable', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:50'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'expense_date' => ['required', 'date'],
            'payment_method' => ['required', 'string', 'max:50'],
            'reference' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string'],
        ]);

        if (empty($data['party_id'])) {
            $data['party_id'] = null;
        }

        if (! empty($data['party_id']) && empty($data['party_name'])) {
            $user = User::find($data['party_id']);
            if ($user) {
                $data['party_name'] = $user->name;
            } else {
                $party = Party::find($data['party_id']);
                if ($party) {
                    $data['party_name'] = $party->name;
                }
            }
        }

        $expense = Expense::create($data + [
            'created_by' => $request->user()->id,
        ]);

        return $this->created($expense->load('party'), 'Expense recorded successfully.');
    }

    /** Update existing expense. */
    public function expenseUpdate(Request $request, Expense $expense): JsonResponse
    {
        $data = $request->validate([
            'party_id' => ['nullable'],
            'party_name' => ['nullable', 'string', 'max:255'],
            'category' => ['required', 'string', 'max:50'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'expense_date' => ['required', 'date'],
            'payment_method' => ['required', 'string', 'max:50'],
            'reference' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string'],
        ]);

        if (empty($data['party_id'])) {
            $data['party_id'] = null;
        }

        if (! empty($data['party_id']) && empty($data['party_name'])) {
            $user = User::find($data['party_id']);
            if ($user) {
                $data['party_name'] = $user->name;
            } else {
                $party = Party::find($data['party_id']);
                if ($party) {
                    $data['party_name'] = $party->name;
                }
            }
        }

        $expense->update($data);

        return $this->ok($expense->fresh()->load('party'), 'Expense updated successfully.');
    }

    /** Delete an expense. */
    public function expenseDestroy(Request $request, Expense $expense): JsonResponse
    {
        $expense->delete();

        return $this->ok(null, 'Expense deleted successfully.');
    }

    /** List Parties/Vendors. */
    public function partiesIndex(Request $request): JsonResponse
    {
        $parties = Party::query()
            ->withCount('expenses')
            ->withSum('expenses', 'amount')
            ->orderBy('name')
            ->get();

        return $this->ok($parties);
    }

    /** Create Party. */
    public function partyStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'max:50'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]);

        $party = Party::create($data);

        return $this->created($party, 'Party added successfully.');
    }

    /** Update Party. */
    public function partyUpdate(Request $request, Party $party): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'max:50'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]);

        $party->update($data);

        return $this->ok($party->fresh(), 'Party updated successfully.');
    }

    /** Delete Party. */
    public function partyDestroy(Request $request, Party $party): JsonResponse
    {
        $party->delete();

        return $this->ok(null, 'Party deleted successfully.');
    }

    /**
     * Financial Dashboard API - returns summary, income statement, balance sheet assets, and liabilities/equity.
     */
    public function financialDashboard(Request $request): JsonResponse
    {
        $actor = $request->user();
        $period = $request->query('period', 'all_time'); // 'all_time', 'this_month', 'last_month', 'this_year', 'custom'
        $fromDate = $request->query('from_date');
        $toDate = $request->query('to_date');

        // Resolve date boundaries
        if ($period === 'this_month') {
            $startDate = Carbon::now()->startOfMonth();
            $endDate = Carbon::now()->endOfMonth();
        } elseif ($period === 'last_month') {
            $startDate = Carbon::now()->subMonth()->startOfMonth();
            $endDate = Carbon::now()->subMonth()->endOfMonth();
        } elseif ($period === 'this_year') {
            $startDate = Carbon::now()->startOfYear();
            $endDate = Carbon::now()->endOfYear();
        } elseif ($fromDate && $toDate) {
            $startDate = Carbon::parse($fromDate)->startOfDay();
            $endDate = Carbon::parse($toDate)->endOfDay();
        } else {
            $startDate = null;
            $endDate = null;
        }

        // 1. Calculate Revenue Breakdown
        // A. GB Voucher (hotspot) & PPPoE Voucher Direct Sales Revenue
        $applyVoucherScope = function ($query) use ($actor, $startDate, $endDate) {
            // Only cards this system actually generated count as v3.0 financial
            // activity. Legacy-imported cards (legacy_id set) and credentials
            // recovered from legacy radcheck (no batch of ours) were sold — if
            // at all — under the old system, and their money was collected
            // there. Booking their retail price here would invent revenue v3.0
            // never earned, and would swing with every lifecycle change, since
            // revenue is recognised on status rather than on payment.
            //
            // Historic figures are deliberately out of scope for now and will be
            // brought in separately once legacy settlement is modelled.
            $query->whereNull('vouchers.legacy_id')->whereNotNull('vouchers.batch_id');

            if ($actor->isAdmin()) {
                // Admin's own direct sales only — vouchers owned by a reseller/seller
                // are that reseller's revenue, not admin's.
                $query->whereNull('reseller_id')->whereIn('status', ['active', 'used']);
            } elseif ($actor->isReseller()) {
                $query->where('reseller_id', $actor->id)->whereIn('status', ['active', 'used']);
            } else {
                $query->where('seller_id', $actor->id)->whereIn('status', ['active', 'used']);
            }

            if ($startDate && $endDate) {
                $query->whereBetween('created_at', [$startDate, $endDate]);
            }
        };

        // GB Voucher Sales Revenue (4200) covers GB-package hotspot cards only —
        // those carry no commission split, so the full price is the owner's
        // revenue. Wallet-package cards are commission-based and are reported
        // separately under Card Voucher Commission Revenue (4000) below.
        $gbVoucherRevenue = (float) Voucher::query()
            ->tap($applyVoucherScope)
            ->whereHas('plan', fn ($q) => $q->where('type', 'hotspot')->where('package_type', 'gb'))
            ->sum('price');
        $pppoeRevenue = (float) Voucher::query()
            ->tap($applyVoucherScope)
            ->whereHas('plan', fn ($q) => $q->where('type', 'pppoe'))
            ->sum('price');

        // Gross cash taken from end customers on wallet-package card sales. Only
        // part of it is the seller's own revenue (see below) — the rest is owed
        // upstream — but the whole amount lands in the till.
        $walletVoucherQuery = fn () => Voucher::query()
            ->tap($applyVoucherScope)
            ->whereHas('plan', fn ($q) => $q->where('type', 'hotspot')->where('package_type', 'wallet'));
        $walletVoucherGross = (float) $walletVoucherQuery()->sum('price');

        // B. Card Voucher Commission Revenue (4000) — whose money this is
        // depends on where the actor sits in the chain:
        //  - Admin: their cut of downline wallet sales (admin_share), recognized
        //    only once actually remitted (Payment type='commission'); until then
        //    it sits on commission_due and shows as Commission Receivable (1120).
        //    Plus admin's own direct card sales, which have no split at all.
        //  - Reseller: their own cut (reseller_share) of every wallet card they
        //    own, earned at the moment of sale.
        //  - Seller: nothing. The commission split is strictly admin↔reseller
        //    (see VoucherController@sell) — a seller collects on behalf of their
        //    reseller and holds no commission of their own.
        if ($actor->isAdmin()) {
            $commissionPaymentQuery = Payment::query()->where('type', 'commission')->where('receiver_id', $actor->id);
            if ($startDate && $endDate) {
                $commissionPaymentQuery->whereBetween('payment_date', [$startDate, $endDate]);
            }
            $commissionRevenue = (float) $commissionPaymentQuery->sum('amount') + $walletVoucherGross;
        } elseif ($actor->isReseller()) {
            // Cards sold before the commission split existed have null shares —
            // fall back to the full price (0% admin cut), same as the sales ledger.
            $commissionRevenue = (float) $walletVoucherQuery()
                ->sum(DB::raw('COALESCE(reseller_share, price)'));
        } else {
            $commissionRevenue = 0.0;
        }

        // Outstanding commission accrued by downline resellers but not yet
        // remitted. Only resellers accrue commission_due (to their admin), so
        // this is meaningful for an admin alone — a reseller's own sellers never
        // owe them commission, and the 1120 row is hidden for non-admins.
        $commissionReceivable = $actor->isAdmin()
            ? (float) User::where('parent_id', $actor->id)->sum('commission_due')
            : 0.0;

        // C. GB Allocation Revenue (Realized revenue from GB allocations collected via payments)
        $gbInvoiceQuery = Invoice::query();
        if ($actor->isAdmin()) {
            $gbInvoiceQuery->where('sender_id', $actor->id);
        } elseif ($actor->isReseller()) {
            $gbInvoiceQuery->where('sender_id', $actor->id);
        } else {
            $gbInvoiceQuery->where('sender_id', $actor->id);
        }
        if ($startDate && $endDate) {
            $gbInvoiceQuery->whereBetween('created_at', [$startDate, $endDate]);
        }
        $gbAllocationRevenue = (float) $gbInvoiceQuery->sum('paid_amount');


        $otherInvoiceRevenue = 0.0;
        $totalOperatingRevenue = $gbVoucherRevenue + $pppoeRevenue + $commissionRevenue + $gbAllocationRevenue + $otherInvoiceRevenue;

        // 2. Calculate Operating Expenses
        $expenseQuery = Expense::query();
        if ($actor->isAdmin()) {
            // System-wide expenses
        } elseif ($actor->isReseller()) {
            $downlineIds = User::where('parent_id', $actor->id)->pluck('id')->all();
            $allowedIds = array_merge([$actor->id], $downlineIds);
            $expenseQuery->whereIn('created_by', $allowedIds);
        } else {
            $expenseQuery->where('created_by', $actor->id);
        }

        if ($startDate && $endDate) {
            $expenseQuery->whereBetween('expense_date', [$startDate->toDateString(), $endDate->toDateString()]);
        }

        $totalOperatingExpenses = (float) $expenseQuery->sum('amount');
        $netOperatingProfit = $totalOperatingRevenue - $totalOperatingExpenses;

        // 3. Balance Sheet Assets
        // Cash (payment_method = cash) vs Bank (everything else + non-system-load wallet balance)
        $paymentQuery = Payment::query()->where('receiver_id', $actor->id);
        if ($startDate && $endDate) {
            $paymentQuery->whereBetween('payment_date', [$startDate, $endDate]);
        }
        $cashPaymentsCollected = (float) (clone $paymentQuery)->where('payment_method', 'cash')->sum('amount');
        $bankPaymentsCollected = (float) (clone $paymentQuery)->where('payment_method', '!=', 'cash')->sum('amount');
        // Wallet card takings are excluded for a seller: the system models no
        // seller-side due on them (nothing increments the seller's wallet_due on
        // a wallet sale), so booking the cash would leave an asset with no
        // matching payable. Admin/reseller keep the gross — the reseller's
        // upstream cut is carried as Commission Payable (2200) below.
        $directVoucherSalesCash = $gbVoucherRevenue + $pppoeRevenue
            + ($actor->isSeller() ? 0.0 : $walletVoucherGross);
        $cashBalance = (float) ($cashPaymentsCollected + $directVoucherSalesCash);
        $bankBalance = (float) $bankPaymentsCollected;

        // Accounts Receivable (Outstanding unpaid GB Allocation invoices owed by resellers/sellers to actor)
        $arInvoiceQuery = Invoice::query();
        if ($actor->isAdmin()) {
            $arInvoiceQuery->where('sender_id', $actor->id);
        } else {
            $arInvoiceQuery->where('sender_id', $actor->id);
        }
        if ($startDate && $endDate) {
            $arInvoiceQuery->whereBetween('created_at', [$startDate, $endDate]);
        }
        $accountsReceivable = (float) max(0.0, $arInvoiceQuery->sum('total_amount') - $arInvoiceQuery->sum('paid_amount'));


        // Asset Accounts from COA. Two are never reportable here:
        //  - 1150 Customer Accounts Receivable: end customers pay cash up front
        //    for cards, so no role (admin, reseller or seller) carries customer AR.
        //  - 1120 Commission Receivable: only an admin is owed commission by a
        //    downline, so it is dropped for resellers and sellers.
        $hiddenAssetCodes = ['1150'];
        if (! $actor->isAdmin()) {
            $hiddenAssetCodes[] = '1120';
        }

        $assetAccounts = ChartOfAccount::where('type', 'ASSET')
            ->whereNotIn('code', $hiddenAssetCodes)
            ->orderBy('code')
            ->get()->map(function ($acct) use ($cashBalance, $bankBalance, $accountsReceivable, $commissionReceivable) {
            $bal = 0.00;
            if ($acct->code === '1000') {
                $bal = $cashBalance;
            } elseif ($acct->code === '1010') {
                $bal = $bankBalance;
            } elseif ($acct->code === '1100') {
                $bal = $accountsReceivable;
            } elseif ($acct->code === '1120') {
                $bal = $commissionReceivable;
            }
            return [
                'id' => $acct->id,
                'code' => $acct->code,
                'name' => $acct->name,
                'balance' => $bal,
            ];
        })->values();


        $totalAssets = $assetAccounts->sum('balance');

        // Accounts Payable (Owed by actor to upstream admin/parent for GB allocations)
        $accountsPayable = $actor->isAdmin() ? 0.0 : (float) ($actor->wallet_due ?? 0);

        // Commission Payable (2200) — a reseller's accrued but unremitted cut of
        // wallet card sales owed upstream to their admin. Sellers never accrue
        // commission and an admin sits at the top of the chain, so both are 0.
        $commissionPayable = $actor->isReseller() ? (float) ($actor->commission_due ?? 0) : 0.0;

        // 4. Balance Sheet Liabilities & Equity
        // Liability rows are role-scoped like the asset rows above: a row is
        // reported only when the actor can actually carry a balance on it, and
        // is then always listed — including at zero — so a reseller's sheet
        // shows Commission Payable as a standing line rather than having it
        // appear and vanish as settlements clear it.
        $hiddenLiabilityCodes = ['2300']; // payroll accruals have no data source yet
        if ($actor->isAdmin()) {
            // An admin sits at the top of the chain: nothing owed upstream, and
            // a reseller keeps their own share at the moment of sale, so the
            // admin never carries a commission payable either.
            $hiddenLiabilityCodes[] = '2100';
            $hiddenLiabilityCodes[] = '2200';
        } elseif ($actor->isSeller()) {
            $hiddenLiabilityCodes[] = '2200'; // the split is admin↔reseller only
        }

        $liabilityAccounts = ChartOfAccount::where('type', 'LIABILITY')
            ->whereNotIn('code', $hiddenLiabilityCodes)
            ->orderBy('code')
            ->get()->map(function ($acct) use ($actor, $accountsPayable, $commissionPayable) {
            $bal = 0.00;
            $name = $acct->name;
            if ($acct->code === '2100') {
                $bal = $accountsPayable;
            } elseif ($acct->code === '2200') {
                $bal = $commissionPayable;
                // The stored label reads from the admin's side (owed *to* partners);
                // for a reseller the same account is what they owe their admin.
                if (! $actor->isAdmin()) {
                    $name = 'Commission Payable — Upstream Admin';
                }
            }
            return [
                'id' => $acct->id,
                'code' => $acct->code,
                'name' => $name,
                'balance' => $bal,
            ];
        })->values();

        $equityAccounts = ChartOfAccount::where('type', 'EQUITY')->orderBy('code')->get()->map(function ($acct) use ($netOperatingProfit) {
            $bal = 0.00;
            if ($acct->code === '3100') {
                $bal = $netOperatingProfit;
            }
            return [
                'id' => $acct->id,
                'code' => $acct->code,
                'name' => $acct->name,
                'balance' => $bal,
            ];
        })->values();

        $totalLiabilities = $liabilityAccounts->sum('balance');
        $totalEquity = $equityAccounts->sum('balance');
        $totalLiabilitiesAndEquity = $totalLiabilities + $totalEquity;

        return $this->ok([
            'summary' => [
                'total_revenue' => $totalOperatingRevenue,
                'total_expenses' => $totalOperatingExpenses,
                'net_profit' => $netOperatingProfit,
                'is_profitable' => $netOperatingProfit >= 0,
            ],
            'income_statement' => [
                'gross_operating_revenue' => $totalOperatingRevenue,
                'operating_expenses' => $totalOperatingExpenses,
                'net_operating_profit' => $netOperatingProfit,
                'gb_voucher_revenue' => $gbVoucherRevenue,
                'pppoe_revenue' => $pppoeRevenue,
                'commission_revenue' => $commissionRevenue,
                // Sellers hold no commission of their own — hide the line for them
                // rather than reporting a permanent zero.
                'commission_revenue_applicable' => ! $actor->isSeller(),
                'gb_allocation_revenue' => $gbAllocationRevenue,
                'other_revenue' => $otherInvoiceRevenue,
            ],
            'balance_sheet' => [
                'assets' => [
                    'items' => $assetAccounts,
                    'total' => $totalAssets,
                ],
                'liabilities_and_equity' => [
                    'liabilities' => $liabilityAccounts,
                    'equity' => $equityAccounts,
                    'total_liabilities' => $totalLiabilities,
                    'total_equity' => $totalEquity,
                    'total_liabilities_and_equity' => $totalLiabilitiesAndEquity,
                ],
            ],
        ]);

    }

    /**
     * Chart of Accounts Index - returns hierarchy grouped by type & category.
     */
    public function chartOfAccountsIndex(Request $request): JsonResponse
    {
        $accounts = ChartOfAccount::orderBy('code')->get();

        // Group by Type (ASSET, LIABILITY, EQUITY, INCOME, EXPENSE)
        $grouped = [
            'ASSETS' => $accounts->where('type', 'ASSET')->values(),
            'LIABILITIES' => $accounts->where('type', 'LIABILITY')->values(),
            'EQUITY' => $accounts->where('type', 'EQUITY')->values(),
            'INCOME' => $accounts->where('type', 'INCOME')->values(),
            'EXPENSES' => $accounts->where('type', 'EXPENSE')->values(),
        ];

        return $this->ok([
            'accounts' => $accounts,
            'grouped' => $grouped,
        ]);
    }

    /**
     * Store new Chart of Account.
     */
    public function chartOfAccountsStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:20', 'unique:chart_of_accounts,code'],
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'in:ASSET,LIABILITY,EQUITY,INCOME,EXPENSE'],
            'category' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string'],
        ]);

        $account = ChartOfAccount::create($data + [
            'is_system' => false,
            'user_id' => $request->user()->id,
        ]);

        return $this->created($account, 'Account created successfully in Chart of Accounts.');
    }

    /**
     * Update Chart of Account.
     */
    public function chartOfAccountsUpdate(Request $request, ChartOfAccount $account): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:20', 'unique:chart_of_accounts,code,' . $account->id],
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'in:ASSET,LIABILITY,EQUITY,INCOME,EXPENSE'],
            'category' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string'],
        ]);

        $account->update($data);

        return $this->ok($account->fresh(), 'Account updated successfully.');
    }

    /**
     * Destroy Chart of Account.
     */
    public function chartOfAccountsDestroy(Request $request, ChartOfAccount $account): JsonResponse
    {
        if ($account->is_system) {
            return $this->error('System default accounts cannot be deleted.', 422);
        }

        $account->delete();

        return $this->ok(null, 'Account deleted successfully.');
    }
}

