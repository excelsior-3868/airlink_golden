<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentService
{
    /**
     * Collect payment from a direct downline user.
     * Reduces their wallet_due and records a Payment, paying off oldest invoices first.
     */
    public function collect(User $collector, User $payer, float $amount, ?string $note = null, string $paymentMethod = 'cash'): Payment
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Payment amount must be greater than zero.']);
        }
        if ($payer->parent_id !== $collector->id) {
            throw ValidationException::withMessages(['user_id' => 'You can only collect payment from your own direct downline.']);
        }

        return DB::transaction(function () use ($collector, $payer, $amount, $note, $paymentMethod) {
            $payerUser = User::whereKey($payer->id)->lockForUpdate()->first();
            $collectorUser = User::whereKey($collector->id)->lockForUpdate()->first();

            if ((float) $payerUser->wallet_due < $amount) {
                throw ValidationException::withMessages(['amount' => "Payment amount Rs {$amount} exceeds the user's total due of Rs {$payerUser->wallet_due}."]);
            }

            // Deduct the due balance
            $payerUser->decrement('wallet_due', $amount);
            $payerUser->refresh();

            // Create Payment record
            $payment = Payment::create([
                'sender_id' => $payerUser->id,
                'receiver_id' => $collectorUser->id,
                'amount' => $amount,
                'payment_date' => now(),
                'note' => $note ?? "Payment collected by {$collectorUser->username}",
                'payment_method' => $paymentMethod,
            ]);

            // Allocate payment to outstanding invoices (oldest first)
            $remaining = $amount;
            $invoices = Invoice::where('receiver_id', $payerUser->id)
                ->where('sender_id', $collectorUser->id)
                ->where('status', 'due')
                ->orderBy('created_at', 'asc')
                ->lockForUpdate()
                ->get();

            foreach ($invoices as $invoice) {
                if ($remaining <= 0) {
                    break;
                }

                $owed = (float) $invoice->total_amount - (float) $invoice->paid_amount;
                if ($remaining >= $owed) {
                    $invoice->update([
                        'paid_amount' => $invoice->total_amount,
                        'status' => 'paid',
                    ]);
                    $remaining -= $owed;
                } else {
                    $invoice->update([
                        'paid_amount' => (float) $invoice->paid_amount + $remaining,
                    ]);
                    $remaining = 0;
                }
            }

            return $payment;
        });
    }

    /**
     * Record a real-world commission settlement from a reseller to their
     * admin. Unlike collect(), this never touches wallet_due or Invoice rows
     * — the admin's wallet was already credited at sale time (VoucherController
     * @sell); this only clears the reseller's outstanding commission_due and
     * logs a dated Payment so it can be reported on.
     */
    public function collectCommission(User $collector, User $payer, float $amount, ?string $note = null, string $paymentMethod = 'cash'): Payment
    {
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Payment amount must be greater than zero.']);
        }
        if ($payer->parent_id !== $collector->id) {
            throw ValidationException::withMessages(['user_id' => 'You can only collect commission from your own direct downline.']);
        }

        return DB::transaction(function () use ($collector, $payer, $amount, $note, $paymentMethod) {
            $payerUser = User::whereKey($payer->id)->lockForUpdate()->first();
            $collectorUser = User::whereKey($collector->id)->lockForUpdate()->first();

            if ((float) $payerUser->commission_due < $amount) {
                throw ValidationException::withMessages(['amount' => "Payment amount Rs {$amount} exceeds the user's outstanding commission of Rs {$payerUser->commission_due}."]);
            }

            $payerUser->decrement('commission_due', $amount);

            return Payment::create([
                'sender_id' => $payerUser->id,
                'receiver_id' => $collectorUser->id,
                'type' => 'commission',
                'amount' => $amount,
                'payment_date' => now(),
                'note' => $note ?? "Commission collected by {$collectorUser->username}",
                'payment_method' => $paymentMethod,
            ]);
        });
    }
}
