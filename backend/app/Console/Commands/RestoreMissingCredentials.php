<?php

namespace App\Console\Commands;

use App\Models\InternetPlan;
use App\Models\User;
use App\Models\Voucher;
use App\Services\RadiusService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Restores legacy credentials that exist in the legacy `radcheck` but never
 * reached v3.0.
 *
 * The original import sourced vouchers from tbl_customers, which is a
 * historical archive rather than the live credential set — it matches legacy
 * radcheck only 29% of the time. radcheck is the only table that actually
 * decides whether a card can authenticate, so it is the authority here:
 * anything with a Cleartext-Password in legacy radcheck and no row in v3.0
 * `vouchers` is a user who could log in before the cutover and cannot now.
 *
 * The plan comes from radcheck's own User-Profile attribute, matched by name
 * against internet_plans. Credentials whose profile names a package that was
 * deleted in legacy are reported, not guessed at — they need a business
 * decision about which current plan replaces them.
 *
 * Activation is derived from real accounting history for the same reason the
 * legacy lifecycle backfill does it: a card first used in 2025 must not be
 * handed a fresh validity window by its next login.
 */
class RestoreMissingCredentials extends Command
{
    protected $signature = 'legacy:restore-credentials
        {--dry-run : Report what would be restored without writing}
        {--database= : Override the legacy database name (config is cached in production)}';

    protected $description = 'Recreate legacy radcheck credentials that the original voucher import missed';

    /** tbl_voucher-sourced rows keep the importer's offset so a later re-import upserts rather than duplicates. */
    private const VOUCHER_LEGACY_ID_OFFSET = 1_000_000_000;

    public function __construct(private readonly RadiusService $radius)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');

        if ($name = $this->option('database')) {
            config(['database.connections.legacy.database' => $name]);
            DB::purge('legacy');
        }

        $legacy = DB::connection('legacy');

        $this->line('Legacy source: <info>'.$legacy->getDatabaseName().'</info>');

        $admin = User::where('role', 'admin')->orderBy('id')->first();
        if (! $admin) {
            $this->error('No admin user to own restored vouchers.');

            return self::FAILURE;
        }

        // Streamed rather than collected: legacy radcheck is ~300k rows and the
        // v3.0 voucher table ~190k, so holding either whole blows the CLI's
        // memory limit. Lowest radcheck id wins where a user has duplicate rows.
        $missing = collect();
        $seen = [];

        $legacy->table('radcheck')
            ->select('username', 'value')
            ->where('attribute', 'Cleartext-Password')
            ->orderBy('id')
            ->chunk(5000, function ($rows) use (&$missing, &$seen) {
                $fresh = [];
                foreach ($rows as $row) {
                    $username = (string) $row->username;
                    if (isset($seen[$username])) {
                        continue;
                    }
                    $seen[$username] = true;
                    $fresh[$username] = (string) $row->value;
                }
                if (! $fresh) {
                    return;
                }

                $taken = Voucher::whereIn('code', array_keys($fresh))->pluck('code')->all();
                foreach ($taken as $code) {
                    unset($fresh[$code]);
                }
                foreach ($fresh as $username => $password) {
                    $missing->put($username, $password);
                }
            });

        unset($seen);

        $profiles = $missing->isEmpty()
            ? collect()
            : $this->profilesFor($legacy, $missing->keys()->all());

        if ($missing->isEmpty()) {
            $this->info('Nothing missing — every legacy credential already exists in v3.0.');

            return self::SUCCESS;
        }

        $plansByName = InternetPlan::get()->keyBy('name');

        // tbl_voucher supplies attribution and a stable legacy_id where the code
        // still has a row there; most of these credentials have neither.
        $sourceRows = $legacy->table('tbl_voucher')
            ->select('id', 'code', 'generated_for')
            ->whereIn('code', $missing->keys())
            ->get()->keyBy('code');

        $users = User::get()->keyBy('username');

        $insert = [];
        $skippedNoProfile = 0;
        $skippedUnknownPlan = [];
        $now = now();

        foreach ($missing as $username => $password) {
            $profile = $profiles->get($username);
            if (! $profile) {
                $skippedNoProfile++;

                continue;
            }

            $plan = $plansByName->get($profile);
            if (! $plan) {
                $skippedUnknownPlan[$profile] = ($skippedUnknownPlan[$profile] ?? 0) + 1;

                continue;
            }

            $source = $sourceRows->get($username);
            $own = $this->ownership($source->generated_for ?? null, $users, $admin);

            $insert[] = [
                'code' => $username,
                'username' => $username,
                'password' => $password,
                'plan_id' => $plan->id,
                'owner_id' => $own['owner'],
                'reseller_id' => $own['reseller'],
                'seller_id' => $own['seller'],
                'data_gb' => $plan->plan_type === 'data' ? $plan->data_gb : null,
                'daily_data_gb' => $plan->plan_type === 'daily_data' ? $plan->daily_data_gb : null,
                'mac_bind' => (bool) $plan->mac_bind,
                'validity_days' => $plan->validity_days,
                'simultaneous_use' => (int) ($plan->simultaneous_use ?: 1),
                'price' => $plan->selling_price,
                'base_price' => $plan->base_price,
                'status' => 'active',
                'legacy_id' => $source ? self::VOUCHER_LEGACY_ID_OFFSET + $source->id : null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        $this->table(['Outcome', 'Count'], [
            ['Legacy credentials missing from v3.0', $missing->count()],
            ['Restorable (profile maps to a live plan)', count($insert)],
            ['Skipped — no User-Profile in radcheck', $skippedNoProfile],
            ['Skipped — profile names a deleted package', array_sum($skippedUnknownPlan)],
        ]);

        if ($skippedUnknownPlan) {
            arsort($skippedUnknownPlan);
            $this->newLine();
            $this->line('Deleted packages still referenced — each needs a replacement plan:');
            foreach ($skippedUnknownPlan as $profile => $count) {
                $this->line(sprintf('  %-38s %d', $profile, $count));
            }
        }

        if ($dry) {
            $this->newLine();
            $this->info('Dry run — nothing written.');

            return self::SUCCESS;
        }

        if (! $insert) {
            $this->warn('Nothing restorable.');

            return self::SUCCESS;
        }

        DB::transaction(function () use ($insert) {
            foreach (array_chunk($insert, 1000) as $chunk) {
                Voucher::insert($chunk);
            }

            $checkRows = [];
            $replyRows = [];
            $plans = InternetPlan::get()->keyBy('id');
            foreach ($insert as $row) {
                $r = $this->radius->rows($row['username'], $row['password'], $plans[$row['plan_id']]);
                $checkRows = array_merge($checkRows, $r['check']);
                $replyRows = array_merge($replyRows, $r['reply']);
            }

            foreach (array_chunk($checkRows, 2000) as $chunk) {
                DB::table('radcheck')->insert($chunk);
            }
            foreach (array_chunk($replyRows, 2000) as $chunk) {
                DB::table('radreply')->insert($chunk);
            }
        });

        // Same derivation as the legacy lifecycle backfill: a restored card that
        // was already in use starts its clock at its first session, not today.
        $stamped = DB::update(
            "UPDATE vouchers v
             JOIN (
                 SELECT username, MIN(acctstarttime) AS first_login
                 FROM radacct
                 GROUP BY username
             ) a ON a.username = v.username
             SET v.activated_at = a.first_login,
                 v.expires_at   = DATE_ADD(a.first_login, INTERVAL v.validity_days DAY),
                 v.status       = CASE
                     WHEN DATE_ADD(a.first_login, INTERVAL v.validity_days DAY) < NOW()
                         THEN 'used'
                     ELSE 'active'
                 END,
                 v.updated_at   = NOW()
             WHERE v.activated_at IS NULL
               AND v.status IN ('ready', 'active')
               AND v.validity_days > 0"
        );

        $this->newLine();
        $this->info(sprintf('Restored %d credentials; %d stamped with their real activation date.', count($insert), $stamped));

        return self::SUCCESS;
    }

    /**
     * User-Profile per username, lowest radcheck id winning, fetched only for
     * the usernames actually being restored.
     *
     * @param  array<int,string>  $usernames
     * @return \Illuminate\Support\Collection<string,string>
     */
    private function profilesFor(\Illuminate\Database\Connection $legacy, array $usernames)
    {
        $profiles = collect();

        foreach (array_chunk($usernames, 5000) as $chunk) {
            $legacy->table('radcheck')
                ->select('username', 'value')
                ->where('attribute', 'User-Profile')
                ->whereIn('username', $chunk)
                ->orderBy('id')
                ->get()
                ->each(function ($row) use ($profiles) {
                    $profiles->has($row->username) or $profiles->put($row->username, (string) $row->value);
                });
        }

        return $profiles;
    }

    /** @return array{owner:int,reseller:?int,seller:?int} */
    private function ownership(?string $generatedFor, $users, User $admin): array
    {
        $target = $generatedFor ? $users->get($generatedFor) : null;

        if (! $target) {
            return ['owner' => $admin->id, 'reseller' => null, 'seller' => null];
        }
        if ($target->role === 'seller') {
            return ['owner' => $target->id, 'reseller' => $target->parent_id, 'seller' => $target->id];
        }
        if ($target->role === 'reseller') {
            return ['owner' => $target->id, 'reseller' => $target->id, 'seller' => null];
        }

        return ['owner' => $target->id, 'reseller' => null, 'seller' => null];
    }
}
