<?php

namespace App\Console\Commands;

use App\Models\Voucher;
use App\Services\GbService;
use Illuminate\Console\Command;

/**
 * GB Package accounting only spends the owner's gb_balance and assesses the
 * direct due when a voucher is sold or first used — whichever happens first.
 * "Sold" is an explicit app action (VoucherController::sell), handled
 * synchronously there. "Used" (first login) is stamped directly into
 * activated_at by a raw SQL query FreeRADIUS runs at post-auth (see
 * sites-available/default), completely bypassing the Laravel app — so this
 * command polls for those and settles them the same way sell() does.
 *
 * gb_due_amount is the idempotency guard: a voucher already settled via
 * sell() is simply skipped here.
 */
class SettleActivatedGbVouchers extends Command
{
    protected $signature = 'vouchers:settle-gb';

    protected $description = 'Settle GB Package vouchers activated (first login) outside an explicit sale';

    public function handle(GbService $gb): int
    {
        $settled = 0;

        Voucher::whereHas('plan', fn ($q) => $q->where('package_type', 'gb'))
            ->whereNotNull('activated_at')
            ->whereNull('gb_due_amount')
            ->chunkById(500, function ($vouchers) use ($gb, &$settled) {
                foreach ($vouchers as $voucher) {
                    $gb->settleVoucherConsumption($voucher);
                    $settled++;
                }
            });

        $this->info("Settled {$settled} activated GB Package voucher(s).");

        return self::SUCCESS;
    }
}
