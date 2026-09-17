<?php

namespace App\Services;

use App\Models\Batch;
use App\Models\InternetPlan;
use App\Models\User;
use App\Models\Voucher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class VoucherService
{
    public function __construct(
        private WalletService $wallet,
        private GbService $gb,
        private RadiusService $radius,
    ) {}

    public const MAX_BATCH = 20000;

    /**
     * Generate one or many vouchers for $actor from $plan.
     *
     * Both balances are checked up front, then — inside a single DB
     * transaction — vouchers + radcheck/radreply are inserted and the wallet
     * and GB are deducted. A failure anywhere rolls the whole thing back, so
     * we can never leave orphaned credentials or a double-spent balance.
     */
    public function generate(
        User $actor,
        InternetPlan $plan,
        int $quantity,
        ?int $validityDays = null,
        ?string $note = null,
        ?float $customPrice = null,
        ?int $ownerId = null,
        string $purchaseSource = 'gb',
        ?string $customBatchCode = null
    ): Batch {
        if ($quantity < 1 || $quantity > self::MAX_BATCH) {
            throw ValidationException::withMessages(['quantity' => 'Quantity must be between 1 and '.self::MAX_BATCH.'.']);
        }
        if ($plan->status !== 'active') {
            throw ValidationException::withMessages(['plan_id' => 'Plan is not active.']);
        }
        if ($plan->type === 'pppoe') {
            // A voucher's credential lives in `vouchers`/radcheck with no record of which
            // app table "owns" it, so FreeRADIUS will happily authenticate it on a PPPoE
            // NAS port too. That already happened for real on the sibling airlink_3.0
            // tenant (legacy-import rows, plus vouchers minted off PPPoE-typed plans like
            // staff/FOC packages) and produces vouchers.* rows that behave like PPPoE
            // subscribers with none of the pppoe_customers bookkeeping. PPPoE plans must
            // only be provisioned through PppoeCustomerService, never through a voucher batch.
            throw ValidationException::withMessages(['plan_id' => 'This plan is PPPoE-only and cannot be used to generate vouchers.']);
        }

        // Determine target user (owner)
        $owner = $actor;
        if ($ownerId && $ownerId !== $actor->id) {
            $owner = User::findOrFail($ownerId);
            if (!$actor->isAdmin() && $owner->parent_id !== $actor->id) {
                throw ValidationException::withMessages(['owner_id' => 'Target user must be a direct downline user.']);
            }
        }

        $validity = $validityDays ?: (int) $plan->validity_days;
        $pricePer = $customPrice !== null ? (float) $customPrice : (float) $plan->selling_price;
        $totalCost = $pricePer * $quantity;

        $planGb = (float) ($plan->data_gb ?? 0);
        if ($planGb > 0) {
            $totalGb = $planGb * $quantity;
            $gbPer = $planGb;
        } else {
            $rate = (float) ($owner->gb_rate ?? 1.00);
            $totalGb = $rate > 0 ? round($totalCost / $rate, 3) : 0.000;
            $gbPer = $rate > 0 ? round($pricePer / $rate, 3) : 0.000;
        }

        // GB Package plans defer the actual balance spend to sell/first-use
        // time (see GbService::settleVoucherConsumption) — generation only
        // reserves capacity against gb_balance, it never spends it. So the
        // check here has to account for GB already reserved by other
        // not-yet-settled vouchers, not just the raw current balance.
        $isGbPackage = $plan->package_type === 'gb';

        // Fail fast with a clear message before touching anything.
        if ($purchaseSource === 'wallet') {
            if ($totalCost > 0 && (float) $owner->wallet_balance < $totalCost) {
                throw ValidationException::withMessages(['wallet' => "Not enough wallet balance. Need Rs. {$totalCost}."]);
            }
        } elseif ($isGbPackage) {
            if ($totalGb > 0) {
                $reserved = (float) Voucher::where('owner_id', $owner->id)
                    ->whereIn('status', ['ready', 'active'])
                    ->whereNotNull('gb_cost')
                    ->whereNull('gb_due_amount')
                    ->sum('gb_cost');
                $available = (float) $owner->gb_balance - $reserved;
                if ($available < $totalGb) {
                    throw ValidationException::withMessages(['gb' => "Not enough available GB balance. Available: {$available} GB (balance ".(float) $owner->gb_balance." minus {$reserved} GB already reserved by unsold vouchers), need {$totalGb} GB."]);
                }
            }
        } else {
            if ($totalGb > 0 && (float) $owner->gb_balance < $totalGb) {
                throw ValidationException::withMessages(['gb' => "Not enough GB balance. Need {$totalGb} GB."]);
            }
        }

        // Ownership from the target owner's position in the hierarchy.
        [$resellerId, $sellerId] = match ($owner->role) {
            'seller' => [$owner->parent_id, $owner->id],
            'reseller' => [$owner->id, null],
            default => [null, null],
        };

        return DB::transaction(function () use ($owner, $plan, $quantity, $validity, $gbPer, $pricePer, $totalGb, $totalCost, $resellerId, $sellerId, $note, $purchaseSource, $customBatchCode, $isGbPackage) {
            $bCode = $customBatchCode ?: $this->uniqueBatchCode();
            if (Batch::where('batch_code', $bCode)->exists()) {
                $bCode = $bCode . '-' . $this->randomCode(4);
            }
            $batch = Batch::create([
                'batch_code' => $bCode,
                'plan_id' => $plan->id,
                'quantity' => $quantity,
                'generated_by' => $owner->id,
            ]);

            $codes = $this->uniqueCodes($quantity);
            $now = now();
            // Activation/expiry are lazy: both stay null until the voucher's first
            // successful RADIUS login, at which point FreeRADIUS post-auth stamps
            // activated_at and derives expires_at from validity_days itself.

            // Serial number: "{2-digit year}-{6-digit running count}", one continuous
            // sequence per calendar year shared across every batch (not reset per
            // batch) — e.g. 26-000001, 26-000002, ... resetting to 000001 the next
            // year. Distinct from `code`, which is the random, globally-unique RADIUS
            // credential. $serialYear + $lastSerial mark this batch's reserved
            // starting offset in that year's sequence.
            $serialYear = $now->format('y');
            $lastSerial = $this->reserveSerialRange($serialYear, $quantity);

            $voucherRows = [];
            $checkRows = [];
            $replyRows = [];
            foreach ($codes as $i => $code) {
                $voucherRows[] = [
                    'code' => $code, 'serial_number' => sprintf('%s-%06d', $serialYear, $lastSerial + $i + 1),
                    'username' => $code, 'password' => $code,
                    'plan_id' => $plan->id, 'batch_id' => $batch->id,
                    'owner_id' => $owner->id, 'reseller_id' => $resellerId, 'seller_id' => $sellerId,
                    // Only a real 'data' plan's cap belongs on data_gb — $gbPer below is a
                    // cost-derived GB-equivalent for balance deduction, not an enforced cap,
                    // and would otherwise impose a phantom total-volume cutoff on
                    // unlimited/time/daily_data vouchers (whose $plan->data_gb is null).
                    'data_gb' => $plan->plan_type === 'data' ? ($gbPer ?: null) : null,
                    'daily_data_gb' => $plan->plan_type === 'daily_data' ? ($plan->daily_data_gb ?: null) : null,
                    'nas_ip' => $plan->nasDevice?->nasname ?: null,
                    'mac_bind' => (bool) $plan->mac_bind,
                    'enforce_physical_mac' => (bool) ($plan->enforce_physical_mac ?? true),
                    'validity_days' => $validity,
                    'simultaneous_use' => (int) ($plan->simultaneous_use ?: 1),
                    'price' => $pricePer,
                    'base_price' => $pricePer,
                    // GB Package vouchers carry their own GB-equivalent cost so it
                    // can be deducted later, at sell/first-use time, instead of now.
                    'gb_cost' => $isGbPackage ? $gbPer : null,
                    'status' => 'ready', 'expires_at' => null,
                    'created_at' => $now, 'updated_at' => $now,

                ];
                $r = $this->radius->rows($code, $code, $plan);
                $checkRows = array_merge($checkRows, $r['check']);
                $replyRows = array_merge($replyRows, $r['reply']);
            }

            // Bulk insert in chunks (handles up to 20k without huge queries).
            foreach (array_chunk($voucherRows, 1000) as $chunk) {
                Voucher::insert($chunk);
            }
            foreach (array_chunk($checkRows, 2000) as $chunk) {
                DB::table('radcheck')->insert($chunk);
            }
            foreach (array_chunk($replyRows, 2000) as $chunk) {
                DB::table('radreply')->insert($chunk);
            }

            // Deduct balance (row-locked, audited). GB Package vouchers are the
            // exception: their gb_cost was persisted per-row above instead, and
            // gb_balance is only actually spent later, at sell/first-use time
            // (GbService::settleVoucherConsumption) — generation only reserved it.
            if ($purchaseSource === 'wallet') {
                if ($totalCost > 0) {
                    $this->wallet->deduct($owner, $totalCost, $batch->batch_code, $note ?? "Generated {$quantity} vouchers via Wallet");
                }
            } elseif (! $isGbPackage) {
                if ($totalGb > 0) {
                    $this->gb->deduct($owner, $totalGb, $batch->batch_code, $note ?? "Generated {$quantity} vouchers via GB");
                }
            }

            return $batch->fresh();
        });
    }

    /**
     * Atomically reserve $count serial numbers in $yearKey's sequence and
     * return the last serial issued *before* this reservation (so the caller's
     * first number is the return value + 1). Row-locked so concurrent
     * `generate()` calls for the same year serialize instead of racing onto
     * the same numbers — safe to call only from within the enclosing
     * DB::transaction in generate().
     */
    private function reserveSerialRange(string $yearKey, int $count): int
    {
        DB::table('voucher_serial_counters')->insertOrIgnore([
            'year_key' => $yearKey, 'last_serial' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $lastSerial = DB::table('voucher_serial_counters')
            ->where('year_key', $yearKey)
            ->lockForUpdate()
            ->value('last_serial');

        DB::table('voucher_serial_counters')
            ->where('year_key', $yearKey)
            ->update(['last_serial' => $lastSerial + $count, 'updated_at' => now()]);

        return $lastSerial;
    }

    private function uniqueBatchCode(): string
    {
        do {
            $code = 'BAT'.now()->format('ymd').$this->randomCode(4);
        } while (Batch::where('batch_code', $code)->exists());

        return $code;
    }

    /** Code length: 6 uppercase alphanumerics, matching the legacy voucher format. Excludes 0, O, and I to prevent user confusion. */
    private const CODE_LENGTH = 6;
    private const CODE_CHARSET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    private function randomCode(int $length = self::CODE_LENGTH): string
    {
        $code = '';
        $charsetLen = strlen(self::CODE_CHARSET);
        for ($j = 0; $j < $length; $j++) {
            $code .= self::CODE_CHARSET[random_int(0, $charsetLen - 1)];
        }

        return $code;
    }

    /** @return string[] $count unique voucher codes not already in the DB. */
    private function uniqueCodes(int $count): array
    {
        $codes = []; // set of code => true
        while (count($codes) < $count) {
            $candidates = [];
            for ($i = 0, $need = $count - count($codes); $i < $need; $i++) {
                $code = $this->randomCode(self::CODE_LENGTH);
                $candidates[$code] = true;
            }
            $list = array_keys($candidates);
            $takenVouchers = Voucher::whereIn('code', $list)->pluck('code')->all();
            $takenPppoe = \App\Models\PppoeCustomer::whereIn('username', $list)->pluck('username')->all();
            $taken = array_fill_keys(array_merge($takenVouchers, $takenPppoe), true);
            foreach ($list as $c) {
                if (! isset($taken[$c])) {
                    $codes[$c] = true;
                }
            }
        }

        return array_slice(array_keys($codes), 0, $count);
    }

    /**
     * Regenerate a voucher's password, decoupling it from the printed `code`
     * — which up to now has always doubled as both username and password
     * (see the voucher row shape in generate() above). Lets whoever currently
     * holds a card invalidate whatever password is printed on it before it
     * reaches the end customer. This matters most for allocated stock: it
     * passes through more hands (Reseller -> Seller -> customer) before sale,
     * so there's more chance the printed code was seen by someone other than
     * the eventual buyer.
     *
     * Only the RADIUS Cleartext-Password row is touched — username and
     * everything else on the voucher stay put. If the voucher is currently
     * 'disabled' (no radcheck rows exist at all — see VoucherController::disable),
     * this still updates the password column; the new value takes effect
     * automatically the next time the voucher is re-enabled, since enable()
     * rebuilds radcheck from the voucher's own columns.
     *
     * $newPassword lets the caller set a specific value (e.g. one they've
     * already told the customer); left null, a random one is generated from
     * the same unambiguous charset as a voucher code.
     *
     * @return string the new password
     */
    public function changePassword(Voucher $voucher, ?string $newPassword = null): string
    {
        $new = $newPassword ?: $this->randomCode();

        DB::transaction(function () use ($voucher, $new) {
            $voucher->update(['password' => $new]);
            DB::table('radcheck')
                ->where('username', $voucher->username)
                ->where('attribute', 'Cleartext-Password')
                ->update(['value' => $new]);
        });

        return $new;
    }
}
