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
            // Reseller commission: reseller keeps $percent%, admin gets the remainder.
            // Direct (admin-created) subscribers have no reseller: admin gets 100%.
            $resellerShare = $reseller ? round($totalPrice * $percent / 100, 2) : 0.0;
            $adminShare = $reseller ? round($totalPrice - $resellerShare, 2) : $totalPrice;

            if ($adminShare > 0 && $reseller && $reseller->parent_id) {
                $admin = User::find($reseller->parent_id);
                if ($admin && $admin->isAdmin()) {
                    $this->wallet->credit(
                        $admin,
                        $adminShare,
                        'commission',
                        $reference,
                        "Admin share on PPPoE recharge {$reference} (Reseller commission: {$percent}%)"
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

    /**
     * Net amount actually paid for the subscriber's current period: the latest
     * real recharge (RCH…) plus every signed package adjustment (PKG…) booked
     * since. Using the last row's price alone would take an adjustment diff
     * (possibly negative) as the baseline and corrupt later refunds/charges.
     */
    private function effectivePeriodPrice(PppoeCustomer $customer, ?InternetPlan $currentPlan): float
    {
        $base = PppoeRecharge::where('customer_id', $customer->id)
            ->where('reference', 'not like', 'PKG%')
            ->orderBy('id', 'desc')
            ->first();

        if (!$base) {
            return (float) ($currentPlan?->selling_price ?? 0);
        }

        $adjustments = (float) PppoeRecharge::where('customer_id', $customer->id)
            ->where('reference', 'like', 'PKG%')
            ->where('id', '>', $base->id)
            ->sum('price');

        return max(0.0, round((float) $base->price + $adjustments, 2));
    }

    /**
     * Preview calculation for switching a subscriber's package.
     */
    public function previewPackageChange(
        PppoeCustomer $customer,
        InternetPlan $targetPlan,
        string $mode = 'replace_period',
        ?float $customPrice = null,
        ?User $actor = null
    ): array {
        $currentPlan = $customer->plan;
        $lastRecharge = PppoeRecharge::where('customer_id', $customer->id)->orderBy('id', 'desc')->first();
        $oldPrice = $this->effectivePeriodPrice($customer, $currentPlan);
        $targetPrice = (float) $targetPlan->selling_price;

        $now = Carbon::now();
        $unusedCredit = 0.0;
        $netAmount = 0.0;
        $newExpiry = null;

        // Determine effective reseller
        $resellerId = $customer->reseller_id ?: ($actor?->isReseller() ? $actor->id : null);
        $reseller = $resellerId ? User::find($resellerId) : null;
        $commissionPercent = $reseller ? (float) $reseller->commission_percent : 0.0;
        $resellerBalance = $reseller ? (float) $reseller->wallet_balance : 0.0;

        if ($mode === 'replace_period') {
            // Replace/correct current period with new plan (from activation / period start)
            $periodStart = $lastRecharge?->period_start
                ? Carbon::parse($lastRecharge->period_start)
                : ($customer->activated_at ? Carbon::parse($customer->activated_at) : $now);
            $newExpiry = (clone $periodStart)->addDays($targetPlan->validity_days);
            $diff = $customPrice !== null ? round($customPrice, 2) : round($targetPrice - $oldPrice, 2);

            if ($diff < 0) {
                $actionType = 'refund';
                $refundAmount = abs($diff);
                $resellerShare = round($refundAmount * $commissionPercent / 100, 2);
                $adminShare = $reseller ? round($refundAmount - $resellerShare, 2) : $refundAmount;
                $balanceAfter = $resellerBalance + $refundAmount;
                $dueAdjustment = -$adminShare;
            } elseif ($diff > 0) {
                $actionType = 'charge';
                $chargeAmount = $diff;
                $resellerShare = round($chargeAmount * $commissionPercent / 100, 2);
                $adminShare = $reseller ? round($chargeAmount - $resellerShare, 2) : $chargeAmount;
                $balanceAfter = $resellerBalance - $chargeAmount;
                $dueAdjustment = $adminShare;
            } else {
                $actionType = 'neutral';
                $adminShare = 0.0;
                $resellerShare = 0.0;
                $balanceAfter = $resellerBalance;
                $dueAdjustment = 0.0;
            }
            $netAmount = $diff;
        } elseif ($mode === 'prorated') {
            // Prorated from today
            $totalDays = max(1, (int) ($lastRecharge?->validity_days ?: ($currentPlan?->validity_days ?: 30)));
            $expiresAt = $customer->expires_at ? Carbon::parse($customer->expires_at) : null;
            if ($expiresAt && $expiresAt->isFuture()) {
                $remainingDays = $now->diffInDays($expiresAt);
                $dailyRate = $oldPrice / $totalDays;
                $unusedCredit = round($dailyRate * min($totalDays, $remainingDays), 2);
            }
            $netAmount = $customPrice !== null ? round($customPrice, 2) : max(0.0, round($targetPrice - $unusedCredit, 2));
            $periodStart = $now;
            $newExpiry = (clone $periodStart)->addDays($targetPlan->validity_days);
            $actionType = $netAmount > 0 ? 'charge' : 'neutral';
            $resellerShare = $reseller ? round($netAmount * $commissionPercent / 100, 2) : 0.0;
            $adminShare = $reseller ? round($netAmount - $resellerShare, 2) : $netAmount;
            $balanceAfter = $resellerBalance - $netAmount;
            $dueAdjustment = $adminShare;
        } elseif ($mode === 'no_wallet') {
            $netAmount = 0.0;
            $periodStart = $now;
            $newExpiry = $customer->expires_at ? Carbon::parse($customer->expires_at) : (clone $periodStart)->addDays($targetPlan->validity_days);
            $actionType = 'neutral';
            $adminShare = 0.0;
            $resellerShare = 0.0;
            $balanceAfter = $resellerBalance;
            $dueAdjustment = 0.0;
        } else { // 'custom'
            $netAmount = $customPrice !== null ? round($customPrice, 2) : 0.0;
            $periodStart = $now;
            $newExpiry = (clone $periodStart)->addDays($targetPlan->validity_days);
            if ($netAmount < 0) {
                $actionType = 'refund';
                $refundAmount = abs($netAmount);
                $resellerShare = round($refundAmount * $commissionPercent / 100, 2);
                $adminShare = $reseller ? round($refundAmount - $resellerShare, 2) : $refundAmount;
                $balanceAfter = $resellerBalance + $refundAmount;
                $dueAdjustment = -$adminShare;
            } elseif ($netAmount > 0) {
                $actionType = 'charge';
                $chargeAmount = $netAmount;
                $resellerShare = round($chargeAmount * $commissionPercent / 100, 2);
                $adminShare = $reseller ? round($chargeAmount - $resellerShare, 2) : $chargeAmount;
                $balanceAfter = $resellerBalance - $chargeAmount;
                $dueAdjustment = $adminShare;
            } else {
                $actionType = 'neutral';
                $adminShare = 0.0;
                $resellerShare = 0.0;
                $balanceAfter = $resellerBalance;
                $dueAdjustment = 0.0;
            }
        }

        $resellerDue = $reseller ? (float) $reseller->commission_due : 0.0;
        $dueAfter = $reseller ? max(0.0, round($resellerDue + $dueAdjustment, 2)) : 0.0;

        return [
            'customer' => [
                'id' => $customer->id,
                'username' => $customer->username,
                'full_name' => $customer->full_name,
                'status' => $customer->status,
                'activated_at' => $customer->activated_at ? Carbon::parse($customer->activated_at)->toIso8601String() : null,
                'expires_at' => $customer->expires_at ? Carbon::parse($customer->expires_at)->toIso8601String() : null,
            ],
            'current_plan' => $currentPlan ? [
                'id' => $currentPlan->id,
                'name' => $currentPlan->name,
                'bandwidth' => $currentPlan->bandwidth,
                'validity_days' => $currentPlan->validity_days,
                'selling_price' => (float) $currentPlan->selling_price,
            ] : null,
            'target_plan' => [
                'id' => $targetPlan->id,
                'name' => $targetPlan->name,
                'bandwidth' => $targetPlan->bandwidth,
                'validity_days' => $targetPlan->validity_days,
                'selling_price' => (float) $targetPlan->selling_price,
            ],
            'last_recharge' => $lastRecharge ? [
                'id' => $lastRecharge->id,
                'reference' => $lastRecharge->reference,
                'price' => (float) $lastRecharge->price,
                'validity_days' => $lastRecharge->validity_days,
                'period_start' => $lastRecharge->period_start,
                'period_end' => $lastRecharge->period_end,
            ] : null,
            'mode' => $mode,
            'old_price' => $oldPrice,
            'target_price' => $targetPrice,
            'unused_credit' => $unusedCredit,
            'net_amount' => $netAmount,
            'action_type' => $actionType,
            'refund_amount' => $actionType === 'refund' ? abs($netAmount) : 0.0,
            'charge_amount' => $actionType === 'charge' ? $netAmount : 0.0,
            'reseller' => $reseller ? [
                'id' => $reseller->id,
                'name' => $reseller->name,
                'username' => $reseller->username,
                'wallet_balance' => $resellerBalance,
                'balance_after' => $balanceAfter,
                'commission_percent' => $commissionPercent,
                'commission_due' => $resellerDue,
                'commission_due_after' => $dueAfter,
                'due_adjustment' => $dueAdjustment,
            ] : null,
            'admin_share' => $adminShare,
            'reseller_share' => $resellerShare,
            'due_adjustment' => $dueAdjustment,
            'new_expires_at' => $newExpiry->format('Y-m-d H:i:s'),
            'new_expires_at_iso' => $newExpiry->toIso8601String(),
            'period_start' => $periodStart->format('Y-m-d H:i:s'),
            'has_sufficient_balance' => $balanceAfter >= 0,
        ];
    }

    /**
     * Change a subscriber's package with full financial and validity reconciliation.
     */
    public function changePackage(
        User $actor,
        PppoeCustomer $customer,
        InternetPlan $targetPlan,
        string $mode = 'replace_period',
        ?float $customPrice = null,
        ?string $customExpiresAt = null,
        ?string $paymentMethod = 'wallet',
        ?string $note = null
    ): array {
        if ($customer->status === 'terminated') {
            throw ValidationException::withMessages(['customer' => 'Cannot change package of a terminated account.']);
        }
        if ($targetPlan->status !== 'active' || $targetPlan->type !== 'pppoe') {
            throw ValidationException::withMessages(['plan_id' => 'The selected target plan is invalid or inactive.']);
        }

        $result = DB::transaction(function () use (
            $actor,
            $customer,
            $targetPlan,
            $mode,
            $customPrice,
            $customExpiresAt,
            $paymentMethod,
            $note
        ) {
            // Lock the subscriber and every wallet involved BEFORE computing the
            // preview, so the amounts and balance check cannot go stale under
            // concurrent requests.
            /** @var PppoeCustomer $c */
            $c = PppoeCustomer::whereKey($customer->id)->lockForUpdate()->first();
            if ($c->status === 'terminated') {
                throw ValidationException::withMessages(['customer' => 'Cannot change package of a terminated account.']);
            }

            $resellerId = $c->reseller_id ?: ($actor->isReseller() ? $actor->id : null);
            $reseller = $resellerId ? User::whereKey($resellerId)->lockForUpdate()->first() : null;
            $payingUser = ($reseller && in_array($paymentMethod, ['wallet', 'post_to_due'])) ? $reseller : $actor;
            if (!$reseller || $payingUser->id !== $reseller->id) {
                $payingUser = User::whereKey($payingUser->id)->lockForUpdate()->first();
            }

            $preview = $this->previewPackageChange($c, $targetPlan, $mode, $customPrice, $actor);
            $netAmount = (float) $preview['net_amount'];
            $actionType = $preview['action_type'];
            $periodStart = Carbon::parse($preview['period_start']);
            $newExpiresAt = $customExpiresAt ? Carbon::parse($customExpiresAt) : Carbon::parse($preview['new_expires_at']);

            if ($actionType === 'charge' && $paymentMethod === 'wallet' && (float) $payingUser->wallet_balance < $netAmount) {
                throw ValidationException::withMessages([
                    'amount' => "Insufficient wallet balance (Rs. {$payingUser->wallet_balance}) to debit Rs. {$netAmount}. Select 'Post to Reseller Due' or 'Cash' instead.",
                ]);
            }

            do {
                $reference = 'PKG' . now()->format('ymd') . strtoupper(Str::random(4));
            } while (PppoeRecharge::where('reference', $reference)->exists());

            $oldPlanName = $c->plan?->name ?? 'None';

            $adminShare = (float) $preview['admin_share'];
            $resellerShare = (float) $preview['reseller_share'];
            $commissionPercent = (float) ($preview['reseller']['commission_percent'] ?? 0.0);

            // 1. Financial Settlement & Reconciliation
            if ($actionType === 'refund') {
                $refundAmount = abs($netAmount);
                $targetReseller = $reseller ?: $actor;

                // Credit Reseller Wallet with package adjustment refund
                $this->wallet->refundPackageAdjustment(
                    $targetReseller,
                    $refundAmount,
                    $reference,
                    "Package adjustment refund for {$c->username} ({$oldPlanName} -> {$targetPlan->name})"
                );

                // Admin commission clawback and commission_due reduction
                if ($adminShare > 0 && $reseller && $reseller->parent_id) {
                    $admin = User::find($reseller->parent_id);
                    if ($admin && $admin->isAdmin()) {
                        $this->wallet->clawbackCommission(
                            $admin,
                            $adminShare,
                            $reference,
                            "Admin commission reversal on package adjustment {$reference} for {$c->username}"
                        );
                        $reseller->decrement('commission_due', min((float) $reseller->commission_due, $adminShare));
                    }
                }
            } elseif ($actionType === 'charge') {
                $chargeAmount = $netAmount;

                if ($paymentMethod === 'post_to_due') {
                    $this->wallet->postToDue(
                        $payingUser,
                        $chargeAmount,
                        $reference,
                        "Package adjustment for {$c->username} ({$oldPlanName} -> {$targetPlan->name})"
                    );
                } elseif ($paymentMethod === 'cash') {
                    // Paid externally via cash — no wallet balance reduction
                } else {
                    // Wallet deduction
                    $this->wallet->deduct(
                        $payingUser,
                        $chargeAmount,
                        $reference,
                        "Package change for {$c->username} ({$oldPlanName} -> {$targetPlan->name})"
                    );
                }

                // Credit Admin commission split & increment commission_due
                if ($adminShare > 0 && $reseller && $reseller->parent_id) {
                    $admin = User::find($reseller->parent_id);
                    if ($admin && $admin->isAdmin()) {
                        $this->wallet->credit(
                            $admin,
                            $adminShare,
                            'commission',
                            $reference,
                            "Admin share on package change {$reference} for {$c->username} (Reseller commission: {$commissionPercent}%)"
                        );
                        $reseller->increment('commission_due', $adminShare);
                    }
                }
            }

            // 2. Create recharge / package change audit record
            $rec = PppoeRecharge::create([
                'reference' => $reference,
                'customer_id' => $c->id,
                'plan_id' => $targetPlan->id,
                'owner_id' => $c->owner_id,
                'reseller_id' => $c->reseller_id,
                'collected_by' => $actor->id,
                'price' => $netAmount,
                'base_price' => 0.00,
                'commission_percent' => $commissionPercent,
                'admin_share' => $actionType === 'refund' ? -$adminShare : $adminShare,
                'reseller_share' => $actionType === 'refund' ? -$resellerShare : $resellerShare,
                'payment_method' => $paymentMethod ?? 'wallet',
                'validity_days' => $targetPlan->validity_days,
                'period_start' => $periodStart,
                'period_end' => $newExpiresAt,
                'note' => $note ?: "Package Adjustment: {$oldPlanName} -> {$targetPlan->name} ({$mode})",
            ]);

            // 3. Update customer
            $c->update([
                'plan_id' => $targetPlan->id,
                'bandwidth' => null, // Inherit new plan bandwidth
                'expires_at' => $newExpiresAt,
                'status' => 'active',
                'last_recharged_at' => now(),
            ]);

            // 4. Rebuild RADIUS rows
            $this->customerService->rebuildRadiusRows($c->fresh());

            return [
                'customer' => $c->fresh(['plan', 'owner', 'reseller']),
                'recharge' => $rec,
                'net_amount' => $netAmount,
                'action_type' => $actionType,
                'new_expires_at' => $newExpiresAt->format('Y-m-d H:i:s'),
            ];
        });

        // 5. Always disconnect active session so new attributes take effect on Mikrotik immediately
        try {
            $this->coaService->disconnectUsername($customer->username);
        } catch (\Throwable $e) {
            // Ignore CoA disconnect failure
        }

        return $result;
    }
}

