<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemPermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PermissionController extends Controller
{
    /**
     * Get the full permission matrix. Accessible to all users for rendering.
     */
    public function index(): JsonResponse
    {
        return $this->ok(SystemPermission::orderBy('id')->get());
    }

    /**
     * Update the permission matrix. Restricted to Admin only.
     */
    public function update(Request $request): JsonResponse
    {
        $request->validate([
            'permissions' => ['required', 'array'],
            'permissions.*.id' => ['required', 'integer', 'exists:system_permissions,id'],
            'permissions.*.admin' => ['required', 'boolean'],
            'permissions.*.reseller' => ['required', 'boolean'],
            'permissions.*.seller' => ['required', 'boolean'],
        ]);

        // PPPoE is admin + reseller by design: there is no seller-facing PPPoE
        // surface anywhere in the app, and routes/api.php wraps every PPPoE
        // endpoint in role:admin,reseller on top of its permission: gate. A
        // seller tick on a PPPoE row would therefore save cleanly and then do
        // nothing, which reads as a broken toggle. Drop it and say so.
        $droppedSellerGrants = [];

        foreach ($request->input('permissions') as $p) {
            $perm = SystemPermission::findOrFail($p['id']);

            $seller = (bool) $p['seller'];
            if ($seller && str_contains($perm->feature, 'pppoe')) {
                $seller = false;
                $droppedSellerGrants[] = $perm->display_name;
            }

            $perm->update([
                'admin' => $p['admin'],
                'reseller' => $p['reseller'],
                'seller' => $seller,
            ]);
        }

        // isAllowed() memoises per request; the next request would otherwise be
        // fine, but the same request answering from a pre-save cache is not.
        SystemPermission::flushCache();

        $message = 'Permission matrix updated successfully.';
        if ($droppedSellerGrants) {
            $message .= ' Seller access was not granted for '
                . implode(', ', $droppedSellerGrants)
                . ' — PPPoE features are unavailable to the seller role.';
        }

        return $this->ok(['dropped_seller_grants' => $droppedSellerGrants], $message);
    }
}
