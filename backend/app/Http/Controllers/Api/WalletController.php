<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WalletController extends Controller
{
    public function __construct(private WalletService $wallet) {}

    /** Load/transfer money to a direct downline user (Admin only). */
    public function load(Request $request): JsonResponse
    {
        if (! $request->user()->isAdmin()) {
            return $this->fail('Only Admins can load wallet balance.', 403);
        }

        $data = $request->validate([
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'paid_amount' => ['nullable', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $to = User::findOrFail($data['user_id']);
        if ($to->role !== 'reseller') {
            return $this->fail('Wallet balance can only be loaded to resellers.', 422);
        }

        $this->wallet->transfer(
            $request->user(),
            $to,
            (float) $data['amount'],
            'load',
            $data['note'] ?? null,
            null,
            isset($data['paid_amount']) ? (float) $data['paid_amount'] : null,
        );

        return $this->ok(['balance' => $to->fresh()->wallet_balance], 'Wallet loaded.');
    }

    /** Admin refunds money from a downline user back upline. */
    public function refund(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $target = User::findOrFail($data['user_id']);
        $this->wallet->refund($request->user(), $target, (float) $data['amount'], $data['note'] ?? null);

        return $this->ok(['balance' => $target->fresh()->wallet_balance], 'Refund processed.');
    }

    /** Transaction history, scoped to the actor's subtree. */
    public function transactions(Request $request): JsonResponse
    {
        $actor = $request->user();
        $visibleIds = User::query()->visibleTo($actor)->pluck('id');

        $userId = $request->input('user_id');
        $query = WalletTransaction::query()
            ->with(['user:id,username', 'fromUser:id,username', 'toUser:id,username'])
            ->latest();

        if ($userId) {
            if (! in_array($userId, $visibleIds->all())) {
                return $this->fail('Unauthorized access to user transaction history.', 403);
            }
            $query->where('user_id', $userId);
        } else {
            $query->whereIn('user_id', $visibleIds);
        }

        $tx = $query->paginate($request->integer('per_page', 20));

        return $this->ok($tx);
    }
}
