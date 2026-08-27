<?php

namespace App\Http\Middleware;

use App\Models\SystemPermission;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    /**
     * Handle an incoming request. Checks the database system_permissions table
     * to see if the user's role has access to the specified feature.
     *
     * More than one feature may be listed — `permission:a,b` passes when the
     * caller holds *any* of them. That is needed where one route serves two
     * separately-gated kinds of write: PUT /plans/{plan} covers both a hotspot
     * plan (create_plan) and a PPPoE plan (create_pppoe_plan), and a role
     * granted only the latter must still reach the route. A single-feature
     * route behaves exactly as it did before.
     *
     * The controller is then responsible for asserting the *specific* feature
     * for the write it is about to perform — an OR gate here widens the door,
     * not the room. See PlanController::update().
     */
    public function handle(Request $request, Closure $next, string ...$features): Response
    {
        $user = $request->user();

        $allowed = $user && collect($features)->contains(
            fn (string $feature) => SystemPermission::isAllowed($feature, $user->role)
        );

        if (! $allowed) {
            $label = implode("' or '", $features);

            return response()->json([
                'success' => false,
                'message' => "This action is not permitted for your role: access to '{$label}' is restricted by system policy.",
            ], 403);
        }

        return $next($request);
    }
}
