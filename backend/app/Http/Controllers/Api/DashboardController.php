<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\NetworkDashboardMetrics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * Network and subscriber figures only — no money. Every role gets the same
     * shape; the service limits a reseller (or seller) to its own subscribers
     * and the OLTs assigned to it.
     */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();

        return $this->ok([
            'role' => $actor->role,
            'network_metrics' => app(NetworkDashboardMetrics::class)->for($actor),
        ]);
    }
}
