<?php

namespace App\Services;

use App\Models\InternetPlan;

/**
 * Translates a voucher + its plan into standard FreeRADIUS rows.
 * radcheck holds only the check item (Cleartext-Password); everything the NAS
 * should honor (rate limit, data cap, session time) goes to radreply as real
 * MikroTik/RADIUS attributes — the same split the ETL enforces for legacy data.
 */
class RadiusService
{
    /** @return array{check: array<int,array>, reply: array<int,array>} */
    public function rows(string $username, string $password, InternetPlan $plan): array
    {
        $check = [[
            'username' => $username, 'attribute' => 'Cleartext-Password', 'op' => ':=', 'value' => $password,
        ], [
            'username' => $username, 'attribute' => 'Simultaneous-Use', 'op' => ':=', 'value' => (string) ($plan->simultaneous_use ?: 1),
        ]];

        $reply = [];

        if ($plan->bandwidth) {
            // MikroTik rate-limit format is "rx/tx", e.g. "10M/10M".
            $reply[] = ['username' => $username, 'attribute' => 'Mikrotik-Rate-Limit', 'op' => ':=', 'value' => $plan->bandwidth];
        }

        if ($plan->plan_type === 'data' && $plan->data_gb > 0) {
            // MikroTik-Total-Limit is 32-bit (≤4 GB). For larger caps, split into
            // whole 4 GB units (…-Gigawords) plus the remainder, MikroTik sums them.
            $bytes = (int) round(((float) $plan->data_gb) * 1024 * 1024 * 1024);
            $gigawords = intdiv($bytes, 4294967296);   // 2^32
            $remainder = $bytes % 4294967296;
            if ($gigawords > 0) {
                $reply[] = ['username' => $username, 'attribute' => 'Mikrotik-Total-Limit-Gigawords', 'op' => ':=', 'value' => (string) $gigawords];
            }
            $reply[] = ['username' => $username, 'attribute' => 'Mikrotik-Total-Limit', 'op' => ':=', 'value' => (string) $remainder];
        }

        if ($plan->plan_type === 'time' && $plan->time_limit > 0) {
            $reply[] = ['username' => $username, 'attribute' => 'Session-Timeout', 'op' => ':=', 'value' => (string) ((int) $plan->time_limit * 60)];
        }

        return ['check' => $check, 'reply' => $reply];
    }
}
