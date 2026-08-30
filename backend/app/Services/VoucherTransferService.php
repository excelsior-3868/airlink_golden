<?php

namespace App\Services;

use App\Models\User;
use App\Models\Voucher;
use App\Models\VoucherTransfer;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class VoucherTransferService
{
    /** Matches the "{2-digit year}-{6-digit running count}" format from VoucherService::generate. */
    private const SERIAL_PATTERN = '/^(\d{2})-(\d{6})$/';

    /**
     * Hand off already-generated, unassigned "ready" voucher stock from a
     * Reseller to one of their own Sellers — a pure custody/tracking move, not
     * a sale: no wallet or GB balance is touched (the money already changed
     * hands when the batch was generated into the reseller's ownership via
     * VoucherService::generate's owner_id delegation). Confirmed with the
     * client: the Seller settles later, at the point an individual card is
     * actually sold (VoucherController::sell), not at hand-off time.
     *
     * Reseller-only (confirmed with the client: not relevant for an Admin
     * account, which only views the resulting transaction history). The
     * reseller picks the physical cards by their printed serial number: they
     * enter the starting serial and a quantity, and the ending serial is
     * derived automatically — mirroring how a batch's own serial range is
     * presented at generation time. Every serial in that inclusive range must
     * currently be this reseller's own "ready", unassigned stock or the whole
     * transfer is rejected (nothing is partially moved).
     */
    public function transfer(
        User $actor,
        int $toUserId,
        string $startSerial,
        int $quantity,
        ?string $note = null,
    ): VoucherTransfer {
        if ($quantity < 1) {
            throw ValidationException::withMessages(['quantity' => 'Quantity must be at least 1.']);
        }
        if (! $actor->isReseller()) {
            throw ValidationException::withMessages(['user_id' => 'Only a Reseller can distribute voucher stock to a Seller.']);
        }
        if (! preg_match(self::SERIAL_PATTERN, $startSerial, $m)) {
            throw ValidationException::withMessages(['start_serial' => 'Invalid serial number format. Expected e.g. 26-000001.']);
        }

        $to = User::findOrFail($toUserId);
        if (! $to->isSeller() || $to->parent_id !== $actor->id) {
            throw ValidationException::withMessages(['to_user_id' => 'Target must be a Seller directly under this Reseller.']);
        }

        $yearKey = $m[1];
        $startNum = (int) $m[2];
        $endSerial = sprintf('%s-%06d', $yearKey, $startNum + $quantity - 1);

        return DB::transaction(function () use ($actor, $to, $startSerial, $endSerial, $quantity, $note) {
            // Wallet Vouchers only — a GB Voucher is a Seller's own
            // self-purchased stock, never a Reseller's to allocate (see
            // VoucherController::nextSerial). Serials are one global sequence
            // shared by both package types, so this must be enforced here too,
            // not just in the Start Serial picker: a GB card interleaved in
            // the requested range must not be silently swept into the transfer.
            $vouchers = Voucher::where('owner_id', $actor->id)
                ->where('reseller_id', $actor->id)
                ->whereNull('seller_id')
                ->where('status', 'ready')
                ->whereBetween('serial_number', [$startSerial, $endSerial])
                ->whereHas('plan', fn ($p) => $p->where('package_type', 'wallet'))
                ->orderBy('serial_number')
                ->lockForUpdate()
                ->get(['id', 'batch_id']);

            if ($vouchers->count() !== $quantity) {
                throw ValidationException::withMessages([
                    'quantity' => "Expected {$quantity} ready, unassigned Wallet Voucher(s) from {$startSerial} to {$endSerial}, but found {$vouchers->count()}. Some cards in that range may already be sold, assigned to another seller, disabled, or a GB Voucher (not allocatable).",
                ]);
            }

            $ids = $vouchers->pluck('id');
            // Purely informational grouping on the ledger row: only set when every
            // card in the range came from the same batch (the common case).
            $batchIds = $vouchers->pluck('batch_id')->unique()->filter();
            $batchId = $batchIds->count() === 1 ? $batchIds->first() : null;

            Voucher::whereIn('id', $ids)->update([
                'owner_id' => $to->id,
                'seller_id' => $to->id,
                'updated_at' => now(),
            ]);

            $transfer = VoucherTransfer::create([
                'batch_id' => $batchId,
                'from_user_id' => $actor->id,
                'to_user_id' => $to->id,
                'quantity' => $ids->count(),
                'start_serial' => $startSerial,
                'end_serial' => $endSerial,
                'created_by' => $actor->id,
                'note' => $note,
            ]);

            $transfer->items()->createMany(
                $ids->map(fn ($id) => ['voucher_id' => $id])->all()
            );

            return $transfer->fresh('items');
        });
    }
}
