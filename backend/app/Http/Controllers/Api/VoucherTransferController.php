<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\VoucherTransfer;
use App\Services\VoucherTransferService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoucherTransferController extends Controller
{
    public function __construct(private VoucherTransferService $transfers) {}

    /**
     * Distribute already-generated "ready" stock from a Reseller to one of
     * their Sellers, by physical serial range (start_serial + quantity — the
     * end serial is derived, not supplied). Reseller-only: not relevant for
     * an Admin account, which only views the resulting transaction history
     * (index() below).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'to_user_id' => ['required', 'integer', 'exists:users,id'],
            'start_serial' => ['required', 'string', 'regex:/^\d{2}-\d{6}$/'],
            'quantity' => ['required', 'integer', 'min:1'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $transfer = $this->transfers->transfer(
            $request->user(),
            (int) $data['to_user_id'],
            $data['start_serial'],
            (int) $data['quantity'],
            $data['note'] ?? null,
        );

        return $this->created(
            $transfer->load(['batch:id,batch_code', 'fromUser:id,username', 'toUser:id,username']),
            "Distributed {$transfer->quantity} voucher(s) (serials {$transfer->start_serial}\u{2013}{$transfer->end_serial}) to {$transfer->toUser->username}.",
        );
    }

    /** Paginated, scoped transfer history. */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();
        $q = VoucherTransfer::query()->with(['batch:id,batch_code', 'fromUser:id,username', 'toUser:id,username', 'createdBy:id,username']);

        if ($actor->isReseller()) {
            $q->where(fn ($x) => $x->where('from_user_id', $actor->id)
                ->orWhereIn('from_user_id', fn ($y) => $y->select('id')->from('users')->where('parent_id', $actor->id))
            );
        } elseif ($actor->isSeller()) {
            $q->where('to_user_id', $actor->id);
        }
        // admin: unrestricted

        if ($batchId = $request->query('batch_id')) {
            $q->where('batch_id', $batchId);
        }
        if ($fromId = $request->query('from_user_id')) {
            $q->where('from_user_id', $fromId);
        }
        if ($toId = $request->query('to_user_id')) {
            $q->where('to_user_id', $toId);
        }
        if ($from = $request->query('from')) {
            $q->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $q->whereDate('created_at', '<=', $to);
        }

        return $this->ok($q->latest()->paginate($request->integer('per_page', 20)));
    }
}
