<?php

namespace App\Services;

use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\PppoeRecharge;
use App\Models\User;
use App\Services\Radius\CoaService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PppoeRechargeService
{
    public function __construct(
        private readonly PppoeCustomerService $customerService,
        private readonly WalletService $wallet,
        private readonly CoaService $coaService,
    ) {
    }

    /**
     * Perform a prepaid recharge for a PPPoE subscriber.
     *
     * @param User $actor The user initiating and paying for the recharge
     * @param PppoeCustomer $customer The subscriber to recharge
     * @param InternetPlan|null $plan Optional new or renewed plan
     * @param float|null $customPrice Optional custom price override
     * @param int|null $validityDays Optional custom validity override per period
     * @param int $periods Number of validity periods (default 1)
     * @param string|null $paymentMethod
     * @param string|null $note
     * @return PppoeRecharge
     */
    public function recharge(
        User $actor,
        PppoeCustomer $customer,
        ?InternetPlan $plan = null,
        ?float $customPrice = null,
        ?int $validityDays = null,
        int $periods = 1,
        ?string $paymentMethod = 'wallet',
        ?string $note = null,
        ?int $ownerId = null,
    ): PppoeRecharge {
        $priorStatus = $customer->status;

        if ($customer->status === 'terminated') {
            throw ValidationException::withMessages([
                'customer' => 'Cannot recharge a terminated account.',
            ]);
        }

        $targetPlan = $plan ?? $customer->plan;
        if (!$targetPlan) {
            throw ValidationException::withMessages([
                'plan_id' => 'No internet plan specified for subscriber.',
            ]);
        }

        if ($targetPlan->status !== 'active') {
            throw ValidationException::withMessages([
                'plan_id' => 'The selected plan is disabled.',
            ]);
        }

        if ($targetPlan->type !== 'pppoe') {
            throw ValidationException::withMessages([
                'plan_id' => 'The selected plan is not a PPPoE plan.',
            ]);
        }

        $periods = max(1, $periods);
        $baseValidity = $validityDays ?? $targetPlan->validity_days;
        $totalValidityDays = $baseValidity * $periods;

        $unitPrice = $customPrice ?? ($customer->contract_price !== null ? (float) $customer->contract_price : (float) $targetPlan->selling_price);
        $totalPrice = round($unitPrice * $periods, 2);
        $totalBasePrice = round(((float) $targetPlan->base_price) * $periods, 2);

        do {
            $reference = 'RCH' . now()->format('ymd') . strtoupper(Str::random(4));
        } while (PppoeRecharge::where('reference', $reference)->exists());

        $recharge = DB::transaction(function () use (
            $actor,
            $customer,
            $targetPlan,
            $totalPrice,
            $totalBasePrice,
            $totalValidityDays,
            $reference,
            $paymentMethod,
            $note,
            $ownerId
        ) {
            // Lock subscriber row
            /** @var PppoeCustomer $c */
            $c = PppoeCustomer::whereKey($customer->id)->lockForUpdate()->first();

            // 1. Debit wallet of the paying actor
            $this->wallet->deduct($actor, $totalPrice, $reference, "PPPoE Recharge for {$c->username} ({$targetPlan->name})");

            // 2. Commission split (mirroring VoucherController::sell)
            $delegatedOwner = ($actor->isAdmin() && $ownerId) ? User::find($ownerId) : null;
            $targetOwnerId = $delegatedOwner ? $delegatedOwner->id : $c->owner_id;
            $resellerId = $delegatedOwner?->isReseller()
                ? $delegatedOwner->id
                : ($c->reseller_id ?: ($actor->isReseller() ? $actor->id : null));
            $reseller = $resellerId ? User::find($resellerId) : null;
            $percent = $reseller ? (float) $reseller->commission_percent : 0.0;
            $adminShare = round($totalPrice * $percent / 100, 2);
            $resellerShare = round($totalPrice - $adminShare, 2);

            if ($adminShare > 0 && $reseller && $reseller->parent_id) {
                $admin = User::find($reseller->parent_id);
                if ($admin && $admin->isAdmin()) {
                    $this->wallet->credit(
                        $admin,
                        $adminShare,
                        'commission',
                        $reference,
                        "Commission on PPPoE recharge {$reference} ({$percent}%)"
                    );
                    $reseller->increment('commission_due', $adminShare);
                }
            }

            // 3. Renewal date calculation: early stacks onto remaining term; lapsed restarts from today
            $now = Carbon::now();
            $periodStart = ($c->expires_at && $c->expires_at->isFuture()) ? Carbon::parse($c->expires_at) : $now;
            $periodEnd = (clone $periodStart)->addDays($totalValidityDays);

            // 4. Update customer
            $c->update([
                'plan_id' => $targetPlan->id,
                'status' => 'active',
                'owner_id' => $targetOwnerId,
                'reseller_id' => $resellerId,
                'activated_at' => $c->activated_at ?? $now,
                'expires_at' => $periodEnd,
                'last_recharged_at' => $now,
            ]);

            // 5. Create recharge record
            $rec = PppoeRecharge::create([
                'reference' => $reference,
                'customer_id' => $c->id,
                'plan_id' => $targetPlan->id,
                'owner_id' => $targetOwnerId,
                'reseller_id' => $resellerId,
                'collected_by' => $actor->id,
                'price' => $totalPrice,
                'base_price' => $totalBasePrice,
                'commission_percent' => $percent,
                'admin_share' => $adminShare,
                'reseller_share' => $resellerShare,
                'payment_method' => $paymentMethod,
                'validity_days' => $totalValidityDays,
                'period_start' => $periodStart,
                'period_end' => $periodEnd,
                'note' => $note,
            ]);

            // 6. Rebuild radius rows
            $this->customerService->rebuildRadiusRows($c->fresh());

            return $rec;
        });

        // CoA disconnect only if subscriber was previously suspended or expired so they can reconnect fresh
        if (in_array($priorStatus, ['expired', 'suspended'])) {
            try {
                $this->coaService->disconnectUsername($customer->username);
            } catch (\Throwable $e) {
                // Ignore CoA error
            }
        }

        return $recharge;
    }
}
