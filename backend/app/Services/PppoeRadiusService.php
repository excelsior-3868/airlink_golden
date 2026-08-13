<?php

namespace App\Services;

use App\Models\PppoeCustomer;

/**
 * Translates a PPPoE subscriber + plan into standard FreeRADIUS rows.
 *
 * Sibling to RadiusService. Differences from the voucher policy:
 *  - Acct-Interim-Interval is 300s (voucher is 60s): long-lived sessions need
 *    periodic radacct updates so traffic and session UI stay fresh without
 *    overwhelming the DB.
 *  - Per-subscriber bandwidth / simultaneous_use overrides take precedence over plan defaults.
 *  - No volume caps (Mikrotik-Total-Limit) or Session-Timeout — PPPoE is unlimited-only
 *    and lifetime is managed via prepaid recharge (expires_at) + CoA.
 */
class PppoeRadiusService
{
    public const ACCT_INTERIM_INTERVAL = 300;

    /** @return array{check: array<int, array{username: string, attribute: string, op: string, value: string}>, reply: array<int, array{username: string, attribute: string, op: string, value: string}>} */
    public function rows(PppoeCustomer $customer): array
    {
        $plan = $customer->plan;
        $username = $customer->username;

        $check = [
            [
                'username' => $username,
                'attribute' => 'Cleartext-Password',
                'op' => ':=',
                'value' => $customer->password,
            ],
            [
                'username' => $username,
                'attribute' => 'Simultaneous-Use',
                'op' => ':=',
                'value' => (string) ($customer->simultaneous_use ?: ($plan?->simultaneous_use ?: 1)),
            ],
        ];

        $reply = [
            [
                'username' => $username,
                'attribute' => 'Acct-Interim-Interval',
                'op' => ':=',
                'value' => (string) self::ACCT_INTERIM_INTERVAL,
            ],
        ];

        $bandwidth = $customer->bandwidth ?: $plan?->bandwidth;
        if ($bandwidth) {
            $reply[] = [
                'username' => $username,
                'attribute' => 'Mikrotik-Rate-Limit',
                'op' => ':=',
                'value' => $bandwidth,
            ];
        }

        return ['check' => $check, 'reply' => $reply];
    }
}
