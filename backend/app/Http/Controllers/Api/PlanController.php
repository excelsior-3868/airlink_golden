<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternetPlan;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlanController extends Controller
{
    /** List plans — all roles. */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('plans.read')) {
            return $this->fail("This API token does not have the 'plans.read' ability.", 403);
        }

        $query = InternetPlan::query()->with(['creator:id,name,username,role,gb_balance', 'nasDevice:id,name'])->orderBy('name');
        if ($request->boolean('active_only')) {
            $query->where('status', 'active');
        }
        if ($request->filled('type')) {
            $query->where('type', $request->input('type'));
        }

        $actor = $request->user();
        if ($actor && !$actor->isAdmin()) {
            if ($actor->isReseller()) {
                // A scoped third-party integration token (e.g. Trekkers Inn's) is bound to
                // exactly one reseller account — it must never reach into that reseller's own
                // downline sellers' individually-created plans, same restriction as
                // VoucherController::scopedQuery. The reseller's own SPA session (['*']) still
                // sees its whole downline's plans, unchanged.
                $includeDownline = $this->isFullAccessToken($actor);
                $query->where(function ($q) use ($actor, $includeDownline) {
                    $q->whereNull('created_by')
                      ->orWhere('created_by', $actor->id)
                      ->orWhereIn('created_by', function ($sub) {
                          $sub->select('id')->from('users')->where('role', 'admin');
                      });
                    if ($includeDownline) {
                        $q->orWhereIn('created_by', function ($sub) use ($actor) {
                            $sub->select('id')->from('users')->where('parent_id', $actor->id);
                        });
                    }
                });
            } else if ($actor->isSeller()) {
                $query->where('type', '!=', 'pppoe')
                      ->where('package_type', '!=', 'wallet')
                      ->where(function ($q) use ($actor) {
                          $q->whereNull('created_by')
                            ->orWhere('created_by', $actor->id)
                            ->orWhere('created_by', $actor->parent_id)
                            ->orWhereIn('created_by', function ($sub) {
                                $sub->select('id')->from('users')->where('role', 'admin');
                            });
                      });
            }
        }

        return $this->ok($query->get());
    }

    public function show(Request $request, InternetPlan $plan): JsonResponse
    {
        if (! $request->user()->tokenCan('plans.read')) {
            return $this->fail("This API token does not have the 'plans.read' ability.", 403);
        }

        return $this->ok($plan);
    }

    /** Create — admin, reseller, and seller. */
    public function store(Request $request): JsonResponse
    {
        // 'plans.write' is deliberately NOT in IntegrationTokenAbilities::ALL — a scoped
        // integration token can never create/modify/delete plans, regardless of the
        // underlying user's role permissions. Only the SPA's own login token (['*']) can.
        if (! $request->user()->tokenCan('plans.write')) {
            return $this->fail("This API token does not have the 'plans.write' ability.", 403);
        }

        // Inline custom packages built during voucher generation are gated separately
        // from plans created on the Plans page. On the Plans page the gate depends
        // on what the actor can actually produce: only an admin-owned plan may be a
        // Wallet Package (package_type is forced to 'gb' for every non-admin owner
        // below), so a non-admin is creating a GB Package by definition and is gated
        // on create_gb_package rather than create_plan.
        $role = $request->user()->role;
        if ($request->boolean('via_voucher')) {
            $feature = 'create_voucher_plan';
            $permitted = \App\Models\SystemPermission::isAllowed($feature, $role);
        } elseif ($request->user()->isAdmin()) {
            $feature = 'create_plan';
            $permitted = \App\Models\SystemPermission::isAllowed($feature, $role);
        } else {
            $feature = 'create_gb_package';
            // create_plan still grants it, so a deployment that already allowed
            // plan creation for this role keeps working after the split.
            $permitted = \App\Models\SystemPermission::isAllowed('create_gb_package', $role)
                || \App\Models\SystemPermission::isAllowed('create_plan', $role);
        }

        if (! $permitted) {
            return $this->fail("This action is not permitted for your role: access to '{$feature}' is restricted by system policy.", 403);
        }

        $data = $this->validateData($request);
        $data['base_price'] = $data['base_price'] ?? 0;
        $data['selling_price'] = $data['selling_price'] ?? 0;

        if (!empty($data['bandwidth_id'])) {
            $bw = \App\Models\Bandwidth::find($data['bandwidth_id']);
            if ($bw) {
                $short = fn ($u) => strtoupper($u) === 'MBPS' ? 'M' : (strtoupper($u) === 'KBPS' ? 'K' : $u);
                $data['bandwidth'] = "{$bw->rate_down}{$short($bw->rate_down_unit)}/{$bw->rate_up}{$short($bw->rate_up_unit)}";
            }
        }

        $creatorId = $request->user()->id;
        if ($request->filled('owner_id')) {
            $request->validate([
                'owner_id' => ['integer', 'exists:users,id']
            ]);
            $ownerId = (int)$request->input('owner_id');
            if ($request->user()->isAdmin()) {
                $creatorId = $ownerId;
            } elseif ($request->user()->isReseller()) {
                $isSelf = $ownerId === $request->user()->id;
                $isDownline = \App\Models\User::where('id', $ownerId)->where('parent_id', $request->user()->id)->exists();
                if ($isSelf || $isDownline) {
                    $creatorId = $ownerId;
                } else {
                    return $this->fail('You do not have permission to create a plan for this owner.', 403);
                }
            } else {
                if ($ownerId !== $request->user()->id) {
                    return $this->fail('You do not have permission to create a plan for this owner.', 403);
                }
            }
        }
        $data['created_by'] = $creatorId;
        $ownerObj = \App\Models\User::find($creatorId);
        $isOwnerAdmin = $ownerObj && $ownerObj->role === 'admin';

        if (($data['type'] ?? 'hotspot') === 'pppoe') {
            $data['package_type'] = 'wallet';
        } elseif ($request->filled('package_type') && in_array($request->input('package_type'), ['wallet', 'gb'])) {
            $data['package_type'] = ($isOwnerAdmin && $request->input('package_type') === 'wallet') ? 'wallet' : 'gb';
        } else {
            $data['package_type'] = ($isOwnerAdmin && !$request->boolean('via_voucher')) ? 'wallet' : 'gb';
        }

        // A GB package's NAS restriction must be one of its delegated owner's own
        // devices — admin-owned Wallet packages may pin to any device.
        if (!empty($data['nas_device_id']) && !$isOwnerAdmin) {
            $nas = \App\Models\NasDevice::find($data['nas_device_id']);
            if (!$nas || $nas->owner_id !== $creatorId) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'nas_device_id' => 'You can only restrict a plan to a NAS device you own.'
                ]);
            }
        }

        return $this->created(InternetPlan::create($data), 'Plan created.');
    }

    public function update(Request $request, InternetPlan $plan): JsonResponse
    {
        if (! $request->user()->tokenCan('plans.write')) {
            return $this->fail("This API token does not have the 'plans.write' ability.", 403);
        }

        $isPppoeCreator = $plan->type === 'pppoe' && $plan->created_by === $request->user()->id;
        if (!$request->user()->isAdmin() && !$isPppoeCreator && ($plan->package_type === 'wallet' || $plan->created_by !== $request->user()->id)) {
            return $this->fail('You do not have permission to modify this plan.', 403);
        }

        $data = $this->validateData($request, $plan);
        $data['base_price'] = $data['base_price'] ?? 0;
        $data['selling_price'] = $data['selling_price'] ?? 0;

        if (!empty($data['bandwidth_id'])) {
            $bw = \App\Models\Bandwidth::find($data['bandwidth_id']);
            if ($bw) {
                $short = fn ($u) => strtoupper($u) === 'MBPS' ? 'M' : (strtoupper($u) === 'KBPS' ? 'K' : $u);
                $data['bandwidth'] = "{$bw->rate_down}{$short($bw->rate_down_unit)}/{$bw->rate_up}{$short($bw->rate_up_unit)}";
            }
        }

        $creatorId = $plan->created_by;
        if ($request->filled('owner_id')) {
            $request->validate([
                'owner_id' => ['integer', 'exists:users,id']
            ]);
            $ownerId = (int)$request->input('owner_id');
            if ($request->user()->isAdmin()) {
                $creatorId = $ownerId;
            } elseif ($request->user()->isReseller()) {
                $isSelf = $ownerId === $request->user()->id;
                $isDownline = \App\Models\User::where('id', $ownerId)->where('parent_id', $request->user()->id)->exists();
                if ($isSelf || $isDownline) {
                    $creatorId = $ownerId;
                } else {
                    return $this->fail('You do not have permission to assign this plan to this owner.', 403);
                }
            } else {
                if ($ownerId !== $request->user()->id) {
                    return $this->fail('You do not have permission to assign this plan to this owner.', 403);
                }
            }
        }
        $data['created_by'] = $creatorId;

        if (($data['type'] ?? $plan->type) === 'pppoe') {
            $data['package_type'] = 'wallet';
        } elseif ($request->filled('package_type') && in_array($request->input('package_type'), ['wallet', 'gb'])) {
            $data['package_type'] = ($request->user()->isAdmin() && $request->input('package_type') === 'wallet') ? 'wallet' : 'gb';
        }

        // A GB package's NAS restriction must be one of its delegated owner's own
        // devices — admin-owned Wallet packages may pin to any device.
        $ownerObj = \App\Models\User::find($creatorId);
        $isOwnerAdmin = $ownerObj && $ownerObj->role === 'admin';
        if (!empty($data['nas_device_id']) && !$isOwnerAdmin) {
            $nas = \App\Models\NasDevice::find($data['nas_device_id']);
            if (!$nas || $nas->owner_id !== $creatorId) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'nas_device_id' => 'You can only restrict a plan to a NAS device you own.'
                ]);
            }
        }

        $plan->update($data);

        return $this->ok($plan, 'Plan updated.');
    }

    public function destroy(InternetPlan $plan): JsonResponse
    {
        if (! request()->user()->tokenCan('plans.write')) {
            return $this->fail("This API token does not have the 'plans.write' ability.", 403);
        }

        $isPppoeCreator = $plan->type === 'pppoe' && $plan->created_by === request()->user()->id;
        if (!request()->user()->isAdmin() && !$isPppoeCreator && ($plan->package_type === 'wallet' || $plan->created_by !== request()->user()->id)) {
            return $this->fail('You do not have permission to delete this plan.', 403);
        }

        if ($plan->vouchers()->exists()) {
            return $this->fail('Cannot delete a plan that already has vouchers.', 422);
        }

        if ($plan->pppoeCustomers()->exists()) {
            return $this->fail('Cannot delete a plan that already has PPPoE subscribers.', 422);
        }

        $plan->delete();

        return $this->ok(null, 'Plan deleted.');
    }

    private function validateData(Request $request, ?InternetPlan $plan = null): array
    {
        $ignoreId = $plan?->id;
        $user = $request->user();
        if ($user && !$user->isAdmin()) {
            if (!\App\Models\SystemPermission::isAllowed('customize_plan_bandwidth', $user->role)) {
                // If updating, verify they didn't change it. If creating, force defaults/null.
                if ($ignoreId) {
                    $original = $plan ?? InternetPlan::find($ignoreId);
                    if ($original && ($request->has('bandwidth_id') && $request->input('bandwidth_id') != $original->bandwidth_id)) {
                        throw \Illuminate\Validation\ValidationException::withMessages([
                            'bandwidth' => 'You do not have permission to customize bandwidth speed limits.'
                        ]);
                    }
                } else {
                    $request->merge(['bandwidth_id' => null, 'bandwidth' => null]);
                }
            }

            if (!\App\Models\SystemPermission::isAllowed('customize_plan_data_limit', $user->role)) {
                if ($ignoreId) {
                    $original = $plan ?? InternetPlan::find($ignoreId);
                    if ($original && ($request->has('data_gb') && $request->input('data_gb') != $original->data_gb)) {
                        throw \Illuminate\Validation\ValidationException::withMessages([
                            'data_gb' => 'You do not have permission to customize data/volume limits.'
                        ]);
                    }
                } else {
                    $request->merge(['data_gb' => null]);
                }
            }

            if (!\App\Models\SystemPermission::isAllowed('customize_plan_validity', $user->role)) {
                if ($ignoreId) {
                    $original = $plan ?? InternetPlan::find($ignoreId);
                    if ($original && ($request->has('validity_days') && $request->input('validity_days') != $original->validity_days)) {
                        throw \Illuminate\Validation\ValidationException::withMessages([
                            'validity_days' => 'You do not have permission to customize validity duration.'
                        ]);
                    }
                } else {
                    $request->merge(['validity_days' => 30]);
                }
            }
        }

        $type = $request->input('type') ?? $plan?->type ?? 'hotspot';
        $isPppoe = $type === 'pppoe';
        $isHotspot = $type === 'hotspot';

        $rules = [
            'name' => [$ignoreId ? 'sometimes' : 'required', 'string', 'max:255'],
            'type' => ['nullable', 'in:hotspot,pppoe'],
            'plan_type' => ['required', $isPppoe ? 'in:unlimited' : 'in:data,time,unlimited,daily_data'],
            'bandwidth_id' => ['nullable', 'exists:bandwidths,id'],
            'bandwidth' => ['nullable', 'string', 'max:255'],
            'nas_device_id' => ['nullable', 'exists:nas_devices,id'],
            'mac_bind' => ['nullable', 'boolean'],
            'data_gb' => ['nullable', 'numeric', 'min:0'],
            'daily_data_gb' => ['nullable', 'numeric', 'min:0'],
            'time_limit' => ['nullable', 'integer', 'min:0'],
            'validity_days' => ['required', 'integer', $isPppoe ? 'min:1' : 'min:0'],
            'simultaneous_use' => ['nullable', 'integer', 'min:1', 'max:10'],
            'base_price' => ['nullable', 'numeric', 'min:0'],
            'selling_price' => [$isHotspot ? 'nullable' : 'required', 'numeric', 'min:0'],
            'api_nas' => ['nullable', 'string', 'max:255'],
            'package_type' => ['nullable', 'in:wallet,gb'],
            'status' => ['nullable', 'in:active,disabled'],
        ];

        $validated = $request->validate($rules);
        if ($isPppoe) {
            unset($validated['time_limit'], $validated['daily_data_gb'], $validated['data_gb']);
        }

        return $validated;
    }
}
