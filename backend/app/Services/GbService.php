<?php

namespace App\Services;

use App\Models\GbTransaction;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class GbService
{
    /**
     * Allocate GB quota down the chain (admin→reseller or reseller→seller).
     * Deducts the allocator, credits the receiver, and creates an invoice for the total cost.
     *
     * Partial payment strategy: the allocator may record an upfront payment ($paidAmount)
     * settled at allocation time. Only the unpaid remainder is added to the receiver's
     * wallet_due, the invoice is stamped with the paid amount (marked 'paid' when fully
     * settled), and a Payment record is created so it appears in the payment history.
     *
     * Admin→reseller allocations are always free: the admin's revenue comes from
     * their commission cut of voucher sales instead, so no due/IOU or Payment
     * record is created for this specific relationship regardless of $paidAmount.
     * The invoice is still recorded (for allocation history) but stamped fully paid.
     */
    public function allocate(User $from, User $to, float $gb, ?string $note = null, float $paidAmount = 0.0): void
    {
        if ($gb <= 0) {
            throw ValidationException::withMessages(['gb_amount' => 'GB amount must be greater than zero.']);
        }
        if ($paidAmount < 0) {
            throw ValidationException::withMessages(['paid_amount' => 'Paid amount cannot be negative.']);
        }
        $isDirectChild = ($to->parent_id === $from->id);
        $isAdminFundingSeller = ($from->role === 'admin' && $to->role === 'seller');

        if (!$isDirectChild && !$isAdminFundingSeller) {
            throw ValidationException::withMessages(['user_id' => 'You can only allocate GB to your own direct downline.']);
        }

        $isFreeReseller = $from->role === 'admin' && $to->role === 'reseller';

        DB::transaction(function () use ($from, $to, $gb, $note, $paidAmount, $isFreeReseller) {
            $allocator = User::whereKey($from->id)->lockForUpdate()->first();
            $receiver = User::whereKey($to->id)->lockForUpdate()->first();

            if ((float) $allocator->gb_balance < $gb) {
                throw ValidationException::withMessages(['gb_amount' => 'Not enough GB balance.']);
            }

            // Stacking financial invoice & due
            $rate = (float) $receiver->gb_rate;
            $totalAmount = round($gb * $rate, 2);

            if ($paidAmount > $totalAmount) {
                throw ValidationException::withMessages([
                    'paid_amount' => "Paid amount Rs {$paidAmount} cannot exceed the allocation total of Rs {$totalAmount}.",
                ]);
            }

            // Deduct / Credit GB balance
            $allocator->decrement('gb_balance', $gb);
            $receiver->increment('gb_balance', $gb);

            // Only the unpaid remainder becomes outstanding due. Admin→reseller
            // allocations are always free, so no due ever accrues for them.
            $dueAmount = $isFreeReseller ? 0.0 : round($totalAmount - $paidAmount, 2);
            if ($dueAmount > 0) {
                $receiver->increment('wallet_due', $dueAmount);
            }

            $allocator->refresh();
            $receiver->refresh();

            // Create Invoice (kept for allocation history even when free).
            $invoiceNumber = 'INV-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6));
            Invoice::create([
                'invoice_number' => $invoiceNumber,
                'sender_id' => $allocator->id,
                'receiver_id' => $receiver->id,
                'gb_amount' => $gb,
                'rate' => $rate,
                'total_amount' => $totalAmount,
                'status' => $isFreeReseller || $paidAmount >= $totalAmount ? 'paid' : 'due',
                'paid_amount' => $isFreeReseller ? $totalAmount : $paidAmount,
            ]);

            // Record the upfront settlement as a payment (receiver pays the allocator).
            // Skipped for free admin→reseller allocations: no real payment occurred.
            if ($paidAmount > 0 && !$isFreeReseller) {
                Payment::create([
                    'sender_id' => $receiver->id,
                    'receiver_id' => $allocator->id,
                    'amount' => $paidAmount,
                    'payment_date' => now(),
                    'note' => "Partial payment on GB allocation ({$invoiceNumber})",
                ]);
            }

            GbTransaction::create([
                'user_id' => $allocator->id, 'type' => 'allocate', 'gb_amount' => $gb,
                'balance_after' => $allocator->gb_balance, 'to_user_id' => $receiver->id,
                'note' => $note ?? "Allocated to {$receiver->username} at Rs {$rate}/GB",
            ]);
            GbTransaction::create([
                'user_id' => $receiver->id, 'type' => 'allocate', 'gb_amount' => $gb,
                'balance_after' => $receiver->gb_balance, 'from_user_id' => $allocator->id,
                'note' => $note ?? "Allocated from {$allocator->username} at Rs {$rate}/GB",
            ]);
        });
    }

    /** Deduct GB for voucher generation (used by VoucherService in M3). */
    public function deduct(User $user, float $gb, string $reference, ?string $note = null): void
    {
        $u = User::whereKey($user->id)->lockForUpdate()->first();
        if ((float) $u->gb_balance < $gb) {
            throw ValidationException::withMessages(['gb' => 'Not enough GB balance.']);
        }
        $u->decrement('gb_balance', $gb);
        $u->refresh();
        GbTransaction::create([
            'user_id' => $u->id, 'type' => 'deduct', 'gb_amount' => $gb,
            'balance_after' => $u->gb_balance, 'reference' => $reference, 'note' => $note,
        ]);
    }
}
