<?php

namespace App\Http\Controllers;

use App\Http\Responses\ApiResponse;
use App\Models\User;

abstract class Controller
{
    use ApiResponse;

    /**
     * True only for the SPA's own login token (abilities ['*'], see AuthController::login) —
     * false for a scoped third-party integration token (IntegrationTokenController::store always
     * assigns a curated, non-'*' ability list, see IntegrationTokenAbilities). A reseller's SPA
     * session legitimately sees/manages their whole downline; a third-party integration bound to
     * that same reseller account must not — it's scoped to exactly the account an admin bound it
     * to, never that reseller's individual sellers' own vouchers/plans.
     */
    protected function isFullAccessToken(User $actor): bool
    {
        return (bool) $actor->currentAccessToken()?->can('*');
    }
}
