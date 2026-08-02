<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class WalletService
{
    /**
     * Move money from $from to $to (admin→reseller or reseller→seller "load",
     * or reseller→seller "transfer"). Deducts the sender, credits the
     * receiver, and records both sides — atomically.
     *
     * Partial payment strategy mirrors GbService::allocate: the receiver's
     * wallet_balance always gets the full amount, but only the unpaid
     * remainder ($amount - $paidAmount) is added to their wallet_due. When
     * $paidAmount is null the load is treated as fully settled (no due),
     * which preserves the original debt-free transfer behavior.
     *
     * Admin→reseller loads are always free: the admin's revenue comes from
     * their commission cut of voucher sales instead, so no due/IOU or
     * Payment record is created for this specific relationship regardless
     * of what $paidAmount is passed.
     */
    public function transfer(User $from, User $to, float $amount, string $type = 'load', ?string $note = null, ?string $reference = null, ?float $paidAmount = null): void
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Amount must be greater than zero.']);
        }
        if ($from->role !== 'admin') {
            throw ValidationException::withMessages(['user_id' => 'Only Admins can load or transfer wallet balance.']);
        }
        $isDirectChild = ($to->parent_id === $from->id);
        $isAdminFundingSeller = ($from->role === 'admin' && $to->role === 'seller');

        if (!$isDirectChild && !$isAdminFundingSeller) {
            throw ValidationException::withMessages(['user_id' => 'You can only load/transfer to your own direct downline.']);
        }

        $isFreeReseller = $from->role === 'admin' && $to->role === 'reseller';
        $paidAmount = $isFreeReseller ? $amount : ($paidAmount ?? $amount);
        if ($paidAmount < 0) {
            throw ValidationException::withMessages(['paid_amount' => 'Paid amount cannot be negative.']);
        }
        if ($paidAmount > $amount) {
            throw ValidationException::withMessages(['paid_amount' => "Paid amount Rs {$paidAmount} cannot exceed the loaded amount of Rs {$amount}."]);
        }

        DB::transaction(function () use ($from, $to, $amount, $type, $note, $reference, $paidAmount, $isFreeReseller) {
            // Lock both rows to prevent concurrent double-spend.
            $sender = User::whereKey($from->id)->lockForUpdate()->first();
            $receiver = User::whereKey($to->id)->lockForUpdate()->first();

            if ((float) $sender->wallet_balance < $amount) {
                throw ValidationException::withMessages(['amount' => 'Not enough wallet balance.']);
            }

            $sender->decrement('wallet_balance', $amount);
            $receiver->increment('wallet_balance', $amount);

            // Only the unpaid remainder becomes outstanding due.
            $dueAmount = round($amount - $paidAmount, 2);
            if ($dueAmount > 0) {
                $receiver->increment('wallet_due', $dueAmount);
            }

            $sender->refresh();
            $receiver->refresh();

            WalletTransaction::create([
                'user_id' => $sender->id, 'type' => 'transfer', 'amount' => $amount,
                'balance_after' => $sender->wallet_balance, 'to_user_id' => $receiver->id,
                'reference' => $reference, 'note' => $note ?? "Sent to {$receiver->username}",
            ]);
            WalletTransaction::create([
                'user_id' => $receiver->id, 'type' => $type, 'amount' => $amount,
                'balance_after' => $receiver->wallet_balance, 'from_user_id' => $sender->id,
                'reference' => $reference, 'note' => $note ?? "Received from {$sender->username}",
            ]);

            // Record the upfront settlement as a payment (receiver pays the sender).
            // Skipped for free admin→reseller loads: no real payment occurred.
            if ($paidAmount > 0 && !$isFreeReseller) {
                Payment::create([
                    'sender_id' => $receiver->id,
                    'receiver_id' => $sender->id,
                    'amount' => $paidAmount,
                    'payment_date' => now(),
                    'note' => $note ?? "Payment for wallet load from {$sender->username}",
                ]);
            }
        });
    }

    /**
     * Refund money from a downline user back up to $by (admin action).
     */
    public function refund(User $by, User $target, float $amount, ?string $note = null): void
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Amount must be greater than zero.']);
        }

        DB::transaction(function () use ($by, $target, $amount, $note) {
            $t = User::whereKey($target->id)->lockForUpdate()->first();
            $b = User::whereKey($by->id)->lockForUpdate()->first();

            if ((float) $t->wallet_balance < $amount) {
                throw ValidationException::withMessages(['amount' => 'Target does not have enough balance to refund.']);
            }

            $t->decrement('wallet_balance', $amount);
            $b->increment('wallet_balance', $amount);
            $t->refresh();
            $b->refresh();

            WalletTransaction::create([
                'user_id' => $t->id, 'type' => 'refund', 'amount' => $amount,
                'balance_after' => $t->wallet_balance, 'to_user_id' => $b->id,
                'note' => $note ?? 'Refunded to upline',
            ]);
            WalletTransaction::create([
                'user_id' => $b->id, 'type' => 'refund', 'amount' => $amount,
                'balance_after' => $b->wallet_balance, 'from_user_id' => $t->id,
                'note' => $note ?? "Refund from {$t->username}",
            ]);
        });
    }

    /** Credit money into $user's wallet (e.g. admin's commission share on a voucher sale). */
    public function credit(User $user, float $amount, string $type, string $reference, ?string $note = null): void
    {
        $u = User::whereKey($user->id)->lockForUpdate()->first();
        $u->increment('wallet_balance', $amount);
        $u->refresh();
        WalletTransaction::create([
            'user_id' => $u->id, 'type' => $type, 'amount' => $amount,
            'balance_after' => $u->wallet_balance, 'reference' => $reference, 'note' => $note,
        ]);
    }

    /** Deduct money for voucher generation (used by VoucherService in M3). */
    public function deduct(User $user, float $amount, string $reference, ?string $note = null): void
    {
        $u = User::whereKey($user->id)->lockForUpdate()->first();
        if ((float) $u->wallet_balance < $amount) {
            throw ValidationException::withMessages(['wallet' => 'Not enough wallet balance.']);
        }
        $u->decrement('wallet_balance', $amount);
        $u->refresh();
        WalletTransaction::create([
            'user_id' => $u->id, 'type' => 'deduct', 'amount' => $amount,
            'balance_after' => $u->wallet_balance, 'reference' => $reference, 'note' => $note,
        ]);
    }
}
