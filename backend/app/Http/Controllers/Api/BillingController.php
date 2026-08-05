<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BillingController extends Controller
{
    public function __construct(private PaymentService $paymentService) {}

    /** List invoices visible to the authenticated user. */
    public function invoices(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Invoice::query()->with(['sender:id,username,name', 'receiver:id,username,name']);
        $userId = $request->input('user_id');

        if ($userId) {
            $visibleIds = User::query()->visibleTo($user)->pluck('id');
            if (! in_array($userId, $visibleIds->all())) {
                return $this->fail('Unauthorized access to user invoices.', 403);
            }
            $query->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
            });
        } else {
            if ($user->role === 'reseller') {
                $query->where(function ($q) use ($user) {
                    $q->where('sender_id', $user->id)->orWhere('receiver_id', $user->id);
                });
            } elseif ($user->role === 'seller') {
                $query->where('receiver_id', $user->id);
            }
        }

        $invoices = $query->latest()->paginate($request->integer('per_page', 20));
        return $this->ok($invoices);
    }

    /** List payments visible to the authenticated user. */
    public function payments(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Payment::query()->with(['sender:id,username,name', 'receiver:id,username,name']);
        $userId = $request->input('user_id');

        if ($userId) {
            $visibleIds = User::query()->visibleTo($user)->pluck('id');
            if (! in_array($userId, $visibleIds->all())) {
                return $this->fail('Unauthorized access to user payments.', 403);
            }
            $query->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
            });
        } else {
            if ($user->role === 'reseller') {
                $query->where(function ($q) use ($user) {
                    $q->where('sender_id', $user->id)->orWhere('receiver_id', $user->id);
                });
            } elseif ($user->role === 'seller') {
                $query->where('sender_id', $user->id);
            }
        }

        $payments = $query->latest()->paginate($request->integer('per_page', 20));
        return $this->ok($payments);
    }

    /** Collect a payment from a direct downline user. */
    public function collect(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:255'],
            'payment_method' => ['nullable', 'string', 'max:50'],
        ]);

        $payer = User::findOrFail($data['user_id']);
        $payment = $this->paymentService->collect(
            $request->user(),
            $payer,
            (float) $data['amount'],
            $data['note'] ?? null,
            $data['payment_method'] ?? 'cash'
        );

        return $this->ok([
            'payment' => $payment,
            'wallet_due' => $payer->fresh()->wallet_due
        ], 'Payment collected successfully.');
    }

    /** Collect a real commission settlement from a direct downline reseller. */
    public function collectCommission(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:255'],
            'payment_method' => ['nullable', 'string', 'max:50'],
        ]);

        $payer = User::findOrFail($data['user_id']);
        $payment = $this->paymentService->collectCommission(
            $request->user(),
            $payer,
            (float) $data['amount'],
            $data['note'] ?? null,
            $data['payment_method'] ?? 'cash'
        );

        return $this->ok([
            'payment' => $payment,
            'commission_due' => $payer->fresh()->commission_due,
        ], 'Commission payment collected successfully.');
    }
}
