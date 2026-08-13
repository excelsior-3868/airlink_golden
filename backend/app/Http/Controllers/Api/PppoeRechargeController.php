<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\PppoeRecharge;
use App\Models\User;
use App\Services\PppoeRechargeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PppoeRechargeController extends Controller
{
    public function __construct(
        private readonly PppoeRechargeService $rechargeService,
    ) {
    }

    /**
     * List recharge history with server-side pagination and filters.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = $this->scopedQuery($actor)
            ->with(['customer:id,username,full_name,customer_code,status', 'plan:id,name', 'collectedBy:id,name,username', 'reseller:id,name,username']);

        // Search: reference or customer
        if ($search = trim($request->input('q') ?? $request->input('search') ?? '')) {
            $query->where(function ($q) use ($search) {
                $q->where('reference', 'like', "%{$search}%")
                  ->orWhereHas('customer', function ($cq) use ($search) {
                      $cq->where('username', 'like', "%{$search}%")
                         ->orWhere('full_name', 'like', "%{$search}%")
                         ->orWhere('customer_code', 'like', "%{$search}%");
                  });
            });
        }

        // Filter: Customer
        if ($customerId = $request->input('customer_id')) {
            $query->where('customer_id', $customerId);
        }

        // Filter: Plan
        if ($planId = $request->input('plan_id')) {
            $query->where('plan_id', $planId);
        }

        // Filter: Payment Method
        if ($method = $request->input('payment_method')) {
            $query->where('payment_method', $method);
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $recharges = $query->orderBy('created_at', 'desc')->paginate($perPage);

        return $this->ok($recharges);
    }

    /**
     * Process a prepaid recharge for a subscriber.
     */
    public function store(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        if (!$actor->tokenCan('pppoe.recharge') && !$actor->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.recharge' ability.", 403);
        }

        $data = $request->validate([
            'plan_id' => ['nullable', 'integer', 'exists:internet_plans,id'],
            'custom_price' => ['nullable', 'numeric', 'min:0'],
            'validity_days' => ['nullable', 'integer', 'min:1'],
            'periods' => ['nullable', 'integer', 'min:1', 'max:24'],
            'payment_method' => ['nullable', 'string', 'max:40'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $plan = null;
        if (!empty($data['plan_id'])) {
            $plan = InternetPlan::findOrFail($data['plan_id']);
        }

        $recharge = $this->rechargeService->recharge(
            $actor,
            $customer,
            $plan,
            isset($data['custom_price']) ? (float) $data['custom_price'] : null,
            isset($data['validity_days']) ? (int) $data['validity_days'] : null,
            (int) ($data['periods'] ?? 1),
            $data['payment_method'] ?? 'wallet',
            $data['note'] ?? null
        );

        return $this->created($recharge->load(['customer', 'plan', 'collectedBy']), 'Subscriber recharged successfully.');
    }

    /**
     * Scoped query for recharges based on actor role.
     */
    private function scopedQuery(User $actor)
    {
        $query = PppoeRecharge::query();

        if ($actor->isAdmin()) {
            return $query;
        }

        if ($actor->isReseller()) {
            return $query->where(function ($q) use ($actor) {
                $q->where('owner_id', $actor->id)
                  ->orWhere('reseller_id', $actor->id)
                  ->orWhere('collected_by', $actor->id);
            });
        }

        return $query->whereRaw('1 = 0');
    }

    private function canAccess(User $actor, PppoeCustomer $customer): bool
    {
        if ($actor->isAdmin()) {
            return true;
        }

        if ($actor->isReseller()) {
            return $customer->owner_id === $actor->id || $customer->reseller_id === $actor->id;
        }

        return false;
    }
}
