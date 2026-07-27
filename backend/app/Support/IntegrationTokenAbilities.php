<?php

namespace App\Support;

/**
 * Curated ability catalog for third-party integration tokens created via
 * IntegrationTokenController (e.g. a hotel/lodge PMS like "Trekkers Inn" selling vouchers
 * through a reseller/seller account). Deliberately narrower than the `*` wildcard the SPA's own
 * login tokens get (AuthController::login) — an integration only ever needs to read plans, read
 * stock, sell, and disable a voucher, never generate/delete vouchers or manage the account.
 *
 * Checked via $request->user()->tokenCan($ability) in the controllers below — a token created
 * with no abilities argument (the SPA's own login token) defaults to ['*'], which tokenCan()
 * always matches, so this is purely additive and never restricts the SPA itself.
 */
class IntegrationTokenAbilities
{
    public const ALL = [
        'vouchers.read' => 'View voucher stock',
        'vouchers.sell' => 'Sell a voucher',
        'vouchers.disable' => 'Disable a voucher',
        'plans.read' => 'View plans',
    ];
}
