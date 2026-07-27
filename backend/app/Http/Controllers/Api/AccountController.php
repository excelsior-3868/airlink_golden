<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Payment;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
        // Vouchers are treated as fully paid at sale (cash collected from the
        // end customer up front), so they add straight to invoiced + paid,
        // never to wallet_due.
        $voucherQuery = Voucher::query()
            ->whereIn('status', ['sold', 'active', 'used', 'expired'])
            ->where(function ($q) use ($userIds) {
                $q->whereIn('seller_id', $userIds)
                  ->orWhere(function ($q2) use ($userIds) {
                      $q2->whereNull('seller_id')->whereIn('reseller_id', $userIds);
                  });
            });

        if ($fromDate) {
            $voucherQuery->whereRaw('COALESCE(sold_at, created_at) >= ?', [$fromDate]);
        }
        if ($toDate) {
            $voucherQuery->whereRaw('COALESCE(sold_at, created_at) <= ?', [$toDate . ' 23:59:59']);
        }

        $vouchers = $voucherQuery->with(['plan:id,name', 'seller:id,name,username', 'reseller:id,name,username'])->latest('sold_at')->get();

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
            $due = (float) $u->wallet_due;

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'role' => $u->role,
                'parent_id' => $u->parent_id,
                'gb_rate' => (float) $u->gb_rate,
                'total_gb_sales' => $totalGb + $totalVoucherGb,
                'total_voucher_sales' => $totalVoucherSales,
                'total_invoiced' => $totalInvoiced + $totalVoucherSales,
                'total_paid' => $totalPaid + $totalVoucherSales,
                'wallet_due' => $due,
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
                'paid' => 0.00,
                'paid_amount' => (float) $inv->paid_amount,
                'due_amount' => (float) ($inv->total_amount - $inv->paid_amount),
                'status' => strtoupper($inv->status),
                'date' => $inv->created_at->toIso8601String(),
                'created_at' => $inv->created_at->toIso8601String(),
                'note' => "GB Allocation ({$inv->gb_amount} GB)",
            ]);
        }

        foreach ($payments as $pay) {
            $ledgerItems->push([
                'id' => "pay-{$pay->id}",
                'type' => 'payment',
                'title' => 'Payment Received',
                'reference' => "PAY-{$pay->id}",
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
                'note' => $pay->note ?? 'Payment Received',
            ]);
        }

        foreach ($vouchers as $v) {
            $owner = $v->seller ?? $v->reseller;
            $ownerId = $v->seller_id ?? $v->reseller_id;
            $planName = $v->plan->name ?? 'Package';
            $customer = $v->customer_username ?: 'Walk-in Customer';

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
                'paid' => (float) $v->price,
                'paid_amount' => (float) $v->price,
                'due_amount' => 0.00,
                'status' => 'PAID',
                'date' => ($v->sold_at ?? $v->created_at)->toIso8601String(),
                'created_at' => ($v->sold_at ?? $v->created_at)->toIso8601String(),
                'note' => "Voucher Sale ({$planName}) to {$customer}",
            ]);
        }

        // Calculate running balance chronologically. Every item now carries both
        // 'invoiced' and 'paid' (zero where not applicable), so a fully-settled
        // item (invoiced === paid, e.g. a voucher sale) nets to no due change.
        $chronologicalItems = $ledgerItems->sortBy('created_at')->values();
        $running = 0.0;
        $itemsWithBalance = $chronologicalItems->map(function ($item) use (&$running) {
            $running += $item['invoiced'] - $item['paid'];
            $item['running_balance'] = max(0.0, $running);
            return $item;
        });

        $sortedItems = $itemsWithBalance->sortByDesc('created_at')->values();

        // Paginate ledger items manually
        $page = (int) $request->query('page', 1);
        $perPage = (int) $request->query('per_page', 20);
        $total = $sortedItems->count();
        $pagedData = $sortedItems->slice(($page - 1) * $perPage, $perPage)->values();

        $overallTotalInvoiced = (float) $userSummaries->sum('total_invoiced');
        $overallTotalPaid = (float) $userSummaries->sum('total_paid');
        $overallTotalDue = (float) $users->sum('wallet_due');
        $overallTotalGb = (float) $userSummaries->sum('total_gb_sales');

        return $this->ok([
            'summary' => [
                'total_invoiced' => $overallTotalInvoiced,
                'total_paid' => $overallTotalPaid,
                'total_due' => $overallTotalDue,
                'total_gb' => $overallTotalGb,
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
}
