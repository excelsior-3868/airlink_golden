<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentMethodController extends Controller
{
    /**
     * Seed default payment methods if table is empty.
     */
    private function seedDefaultsIfNeeded(): void
    {
        if (PaymentMethod::count() === 0) {
            $defaults = [
                ['icon' => '💵', 'label' => 'Cash', 'code' => 'CASH', 'status' => 'active', 'sort_order' => 0],
                ['icon' => '🟢', 'label' => 'eSewa', 'code' => 'QR_ESEWA', 'status' => 'active', 'sort_order' => 1],
                ['icon' => '🚀', 'label' => 'Khalti', 'code' => 'QR_KHALTI', 'status' => 'active', 'sort_order' => 2],
                ['icon' => '💳', 'label' => 'Card', 'code' => 'CARD', 'status' => 'active', 'sort_order' => 3],
                ['icon' => '📲', 'label' => 'Fonepay QR', 'code' => 'FONEPAY_QR', 'status' => 'active', 'sort_order' => 40],
            ];

            foreach ($defaults as $d) {
                PaymentMethod::create($d);
            }
        }
    }

    /**
     * Get active payment methods for dropdowns / selections across the app.
     */
    public function index(): JsonResponse
    {
        $this->seedDefaultsIfNeeded();

        $methods = PaymentMethod::where('status', 'active')
            ->orderBy('sort_order', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $methods,
        ]);
    }

    /**
     * Get all payment methods (active & disabled) for management.
     */
    public function adminIndex(): JsonResponse
    {
        $this->seedDefaultsIfNeeded();

        $methods = PaymentMethod::orderBy('sort_order', 'asc')
            ->orderBy('id', 'asc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $methods,
        ]);
    }

    /**
     * Create a new payment method.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'label' => 'required|string|max:100',
            'code' => 'required|string|max:50|unique:payment_methods,code',
            'icon' => 'nullable|string|max:5000000',
            'status' => 'required|in:active,disabled',
            'sort_order' => 'nullable|integer',
        ]);

        $validated['code'] = strtoupper(str_replace(' ', '_', trim($validated['code'])));
        $validated['sort_order'] = $validated['sort_order'] ?? 0;

        $pm = PaymentMethod::create($validated);

        return response()->json([
            'success' => true,
            'message' => 'Payment method created successfully.',
            'data' => $pm,
        ], 201);
    }

    /**
     * Update an existing payment method.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $pm = PaymentMethod::findOrFail($id);

        $validated = $request->validate([
            'label' => 'required|string|max:100',
            'code' => 'required|string|max:50|unique:payment_methods,code,' . $id,
            'icon' => 'nullable|string|max:5000000',
            'status' => 'required|in:active,disabled',
            'sort_order' => 'nullable|integer',
        ]);

        $validated['code'] = strtoupper(str_replace(' ', '_', trim($validated['code'])));
        $validated['sort_order'] = $validated['sort_order'] ?? 0;

        $pm->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Payment method updated successfully.',
            'data' => $pm,
        ]);
    }

    /**
     * Delete a payment method.
     */
    public function destroy(int $id): JsonResponse
    {
        $pm = PaymentMethod::findOrFail($id);
        $pm->delete();

        return response()->json([
            'success' => true,
            'message' => 'Payment method deleted successfully.',
        ]);
    }
}
