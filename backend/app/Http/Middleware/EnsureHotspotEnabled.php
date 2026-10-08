<?php

namespace App\Http\Middleware;

use App\Models\BrandingSetting;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects hotspot/voucher routes when the deployment is switched to
 * PPPoE-only (Settings → Branding → "PPPoE only"): ->middleware('hotspot').
 */
class EnsureHotspotEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (BrandingSetting::find(1)?->pppoe_only) {
            return response()->json([
                'success' => false,
                'message' => 'Hotspot is disabled: this system is set to PPPoE only.',
            ], 403);
        }

        return $next($request);
    }
}
