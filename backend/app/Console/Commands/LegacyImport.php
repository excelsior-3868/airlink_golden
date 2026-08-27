<?php

namespace App\Console\Commands;

use App\Models\Batch;
use App\Models\GbTransaction;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use App\Models\Voucher;
use App\Models\WalletTransaction;
use App\Services\PppoeRadiusService;
use App\Services\RadiusService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Throwable;

/**
 * ETL: migrate the legacy v2.0 dump (airlink_legacy) into the clean v3.0
 * schema (airlink). Idempotent (keyed on legacy_id), --dry-run capable, and
 * emits a review report (storage/app/legacy-import-report.json) so the
 * inferred hierarchy/roles and forced password resets can be corrected.
 *
 * Legacy shape learned from the data:
 *  - Voucher code == RADIUS username == password. tbl_customers (superset of
 *    tbl_voucher) is the authoritative voucher/credential source and matches
 *    radcheck 1:1 (Cleartext-Password, User-Profile, Expire-After, ...).
 *  - generated_for on a customer names the reseller/seller it was allocated to.
 *  - tbl_users are staff (Admin/Sales/POS); wallet holds their money balance.
 */
class LegacyImport extends Command
{
    protected $signature = 'legacy:import
        {--dry-run : Compute and report without writing}
        {--fresh : Wipe previously imported rows first}
        {--only= : Comma-separated sections to run (plans,staff,wallets,vouchers,pppoe,radius). Default: all}';

    protected $description = 'Migrate legacy v2.0 data (airlink_legacy) into the v3.0 schema';

    private const TEMP_PASSWORD = 'ChangeMe123!';

    /**
     * tbl_customers and tbl_voucher have independent id sequences that overlap
     * heavily, but vouchers.legacy_id is UNIQUE. Voucher-sourced rows are stored
     * at OFFSET + tbl_voucher.id — far above tbl_customers' max (377,969) — so
     * both remain traceable to their source row.
     */
    private const VOUCHER_LEGACY_ID_OFFSET = 1_000_000_000;

    private array $report = [];

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');
        $this->info($dry ? 'DRY RUN — no changes will be written.' : 'Running legacy import...');

        $this->line('Legacy source: <info>'.DB::connection('legacy')->getDatabaseName().'</info>');

        try {
            DB::transaction(function () use ($dry) {
                // Sections not selected are read back from what is already in
                // the v3.0 schema, so a later stage never re-imports (and never
                // re-flags must_reset_password on) an earlier one.
                $planMap = $this->wants('plans') ? $this->importPlans() : $this->existingPlanMap();

                if ($this->wants('staff') || $this->wants('wallets') || $this->wants('vouchers') || $this->wants('pppoe')) {
                    $userMap = $this->wants('staff') ? $this->importStaff() : $this->existingUserMap();

                    if ($this->wants('wallets')) {
                        $this->importWallets($userMap);
                        $this->reconstructHierarchy($userMap);
                    }
                    if ($this->wants('vouchers')) {
                        $this->importVouchers($planMap, $userMap);
                    }
                    if ($this->wants('pppoe')) {
                        $this->purgePppoeVoucherRows();
                        $this->importPppoeCustomers($userMap);
                    }
                }

                if ($dry) {
                    // Roll the whole thing back — we only wanted the numbers.
                    throw new DryRunComplete();
                }
            });
        } catch (DryRunComplete) {
            // expected on --dry-run
        } catch (Throwable $e) {
            $this->error('Import failed and was rolled back: '.$e->getMessage());
            throw $e;
        }

        // radcheck/radreply copy is a bulk cross-schema INSERT..SELECT — done
        // after the transaction commits (skipped on dry-run, counted instead).
        if ($this->wants('radius')) {
            if ($dry) {
                $this->report['radius'] = $this->radiusCandidateCounts();
            } else {
                $this->report['radius'] = $this->copyRadius();
            }
        }

        $this->writeReport($dry);
        $this->renderSummary();

        return self::SUCCESS;
    }

    /** Is this section selected? --only= unset means "run everything". */
    private function wants(string $section): bool
    {
        $only = trim((string) $this->option('only'));
        if ($only === '') {
            return true;
        }

        return in_array($section, array_map('trim', explode(',', strtolower($only))), true);
    }

    /**
     * Already-migrated plans, as the same legacy id => new id map importPlans()
     * returns, so --only=vouchers can resolve tbl_voucher.id_plan without
     * re-importing plans.
     *
     * @return array<int,int>
     */
    private function existingPlanMap(): array
    {
        return InternetPlan::whereNotNull('legacy_id')
            ->pluck('id', 'legacy_id')->all();
    }

    /**
     * Already-migrated staff keyed by their LEGACY username — that is what
     * tbl_customers.generated_for holds.
     *
     * @return array<string,User>
     */
    private function existingUserMap(): array
    {
        $map = [];
        foreach (User::all() as $u) {
            $map[$u->legacy_username ?: $u->username] = $u;
        }

        return $map;
    }

    // ---- Plans -------------------------------------------------------------

    /** @return array<int,int> legacy plan id => new plan id */
    private function importPlans(): array
    {
        $bwRows = DB::connection('legacy')->table('tbl_bandwidth')->get();
        $bwMap = [];
        $bwKeyed = $bwRows->keyBy('id');
        
        foreach ($bwRows as $b) {
            $newBw = \App\Models\Bandwidth::updateOrCreate(
                ['name' => $b->name_bw],
                [
                    'rate_down' => (int) $b->rate_down,
                    'rate_down_unit' => $b->rate_down_unit,
                    'rate_up' => (int) $b->rate_up,
                    'rate_up_unit' => $b->rate_up_unit,
                ]
            );
            $bwMap[$b->id] = $newBw->id;
        }

        // Legacy `routers` holds a NAS *name*; link it to a v3.0 nas_devices row
        // when the names match exactly (case/separator-insensitive), else leave
        // the FK null and report it — a wrong guess here would point vouchers at
        // the wrong NAS, so unmatched names stay unlinked for manual mapping.
        $nasMap = \App\Models\NasDevice::pluck('id', 'name')
            ->mapWithKeys(fn ($id, $name) => [$this->nasKey($name) => $id])
            ->all();

        $map = [];
        $dualCap = [];
        $unmatchedNas = [];
        $rows = DB::connection('legacy')->table('tbl_plans')->get();

        foreach ($rows as $p) {
            $dataGb = (float) $p->data_usage_gb;
            if ($dataGb <= 0 && $p->data_limit > 0) {
                $dataGb = strtoupper((string) $p->data_unit) === 'MB'
                    ? round($p->data_limit / 1024, 3)
                    : (float) $p->data_limit;
            }

            $dailyGb = (float) ($p->daily_quota ?? 0);

            $timeMin = null;
            if ((int) $p->time_limit > 0) {
                $timeMin = strtoupper((string) $p->time_unit) === 'HRS'
                    ? (int) $p->time_limit * 60
                    : (int) $p->time_limit;
            }

            // typebp/limit_type are NOT trustworthy: every legacy hotspot row
            // claims Unlimited + Time_Limit while carrying time_limit = 0 and
            // data_limit = 0. The real quota lives in data_usage_gb (total GB)
            // and daily_quota (GB/day), so the shape is derived from those.
            // A total cap outranks a daily one because plan_type is single-valued
            // and only 'data' is enforced at the NAS (Mikrotik-Total-Limit);
            // daily_data_gb is still persisted below so nothing is lost.
            $planType = match (true) {
                $dataGb > 0 => 'data',
                $dailyGb > 0 => 'daily_data',
                (bool) $timeMin => 'time',
                default => 'unlimited',
            };

            // '0' is the legacy "no router" sentinel; blank strings mean the same.
            $router = trim((string) ($p->routers ?? ''));
            $apiNas = ($router === '' || $router === '0') ? null : $router;
            $nasDeviceId = $apiNas ? ($nasMap[$this->nasKey($apiNas)] ?? null) : null;
            if ($apiNas && ! $nasDeviceId) {
                $unmatchedNas[$apiNas] = ($unmatchedNas[$apiNas] ?? 0) + 1;
            }

            $plan = InternetPlan::updateOrCreate(
                ['legacy_id' => $p->id],
                [
                    'name' => $p->name_plan,
                    'type' => strtolower($p->type), // hotspot or pppoe
                    'plan_type' => $planType,
                    'bandwidth_id' => $bwMap[$p->id_bw] ?? null,
                    'bandwidth' => $this->bandwidthLabel($bwKeyed->get($p->id_bw)),
                    'data_gb' => $dataGb > 0 ? $dataGb : null,
                    'daily_data_gb' => $dailyGb > 0 ? $dailyGb : null,
                    'time_limit' => $timeMin,
                    'validity_days' => $this->toDays((int) $p->validity, (string) $p->validity_unit),
                    // shared_users is null on every legacy PPPoE row; the schema
                    // default of 1 concurrent session applies there.
                    'simultaneous_use' => max(1, (int) ($p->shared_users ?: 1)),
                    'base_price' => (float) $p->price,
                    'selling_price' => (float) $p->price,
                    'api_nas' => $apiNas,
                    'nas_device_id' => $nasDeviceId,
                    'status' => 'active',
                ]
            );
            $map[$p->id] = $plan->id;

            if ($dataGb > 0 && $dailyGb > 0) {
                $dualCap[] = [
                    'legacy_id' => $p->id,
                    'name' => $p->name_plan,
                    'total_gb' => $dataGb,
                    'daily_gb' => $dailyGb,
                    'imported_as' => 'data',
                    'note' => 'legacy carried BOTH a total and a daily cap; plan_type is single-valued so the total is enforced and daily_data_gb is stored but inert — review',
                ];
            }
        }

        $this->report['plans'] = [
            'imported' => count($map),
            'dual_cap_review' => $dualCap,
            'unmatched_nas_names' => $unmatchedNas,
        ];

        return $map;
    }

    /** Normalise a NAS name for matching: case- and separator-insensitive. */
    private function nasKey(string $name): string
    {
        return preg_replace('/[^a-z0-9]/', '', strtolower($name)) ?? '';
    }

    private function bandwidthLabel(?object $bw): ?string
    {
        if (! $bw) {
            return null;
        }
        $short = fn ($u) => strtoupper($u) === 'MBPS' ? 'M' : (strtoupper($u) === 'KBPS' ? 'K' : $u);

        return "{$bw->rate_down}{$short($bw->rate_down_unit)}/{$bw->rate_up}{$short($bw->rate_up_unit)}";
    }

    private function toDays(int $value, string $unit): int
    {
        return match (strtolower($unit)) {
            'h' => (int) max(1, ceil($value / 24)),
            'm' => $value * 30,
            default => max($value, 0), // 'd' or blank
        };
    }

    // ---- Staff / users -----------------------------------------------------

    /** @return array<string,\App\Models\User> legacy username => user */
    private function importStaff(): array
    {
        $roleReport = [];
        $map = [];
        $rows = DB::connection('legacy')->table('tbl_users')->get();

        foreach ($rows as $u) {
            // Both POS and Sales staff become resellers in v3.0: legacy POS
            // accounts are the ones vouchers were allocated to (generated_for),
            // so vouchers.reseller_id must be able to point at them.
            $role = match (strtolower($u->user_type ?? '')) {
                'admin' => 'admin',
                'sales', 'pos' => 'reseller',
                default => 'reseller',
            };

            // Reuse the seeded admin if usernames collide; else create/update
            // keyed on legacy_id so re-runs are idempotent.
            $existing = User::where('legacy_id', $u->id)
                ->orWhere('username', $u->username)
                ->first();

            $attrs = [
                'name' => $u->fullname ?: $u->username,
                'username' => $u->username,
                'role' => $role,
                'status' => strtolower($u->status) === 'inactive' ? 'disabled' : 'active',
                'legacy_id' => $u->id,
                'legacy_username' => $u->username,
                'must_reset_password' => true,
            ];

            if ($existing) {
                // Never downgrade/overwrite the seeded admin's known password.
                $existing->fill($attrs);
                if (! $existing->password) {
                    $existing->password = Hash::make(self::TEMP_PASSWORD);
                }
                $existing->save();
                $user = $existing;
            } else {
                $user = User::create($attrs + ['password' => Hash::make(self::TEMP_PASSWORD)]);
            }

            $map[$u->username] = $user;
            $roleReport[] = [
                'legacy_id' => $u->id,
                'username' => $u->username,
                'legacy_type' => $u->user_type,
                'assigned_role' => $role,
                'password_reset_required' => true,
            ];
        }

        $this->report['users'] = $roleReport;

        return $map;
    }

    // ---- Wallets -----------------------------------------------------------

    private function importWallets(array $userMap): void
    {
        $walletReport = [];
        $rows = DB::connection('legacy')->table('wallet')->get();

        foreach ($rows as $w) {
            $user = $userMap[$w->username] ?? null;
            if (! $user) {
                $walletReport[] = ['username' => $w->username, 'status' => 'no matching staff user — skipped'];

                continue;
            }

            $balance = (float) ($w->available_balance ?? $w->credit_balance ?? 0);
            $user->update(['wallet_balance' => $balance]);

            WalletTransaction::updateOrCreate(
                ['user_id' => $user->id, 'type' => 'opening', 'reference' => 'legacy:wallet'],
                ['amount' => $balance, 'balance_after' => $balance, 'note' => 'Imported opening balance from v2.0 wallet']
            );

            $walletReport[] = ['username' => $w->username, 'balance_rs' => $balance];
        }

        $this->report['wallets'] = $walletReport;
        $this->report['wallet_unit_note'] = 'available_balance imported verbatim as Rs — confirm the v2.0 unit (Rs vs paisa).';
    }

    // ---- Hierarchy ---------------------------------------------------------

    private function reconstructHierarchy(array $userMap): void
    {
        $admins = array_filter($userMap, fn ($u) => $u->role === 'admin');
        $resellers = array_filter($userMap, fn ($u) => $u->role === 'reseller');

        $primaryAdmin = $userMap['admin'] ?? (reset($admins) ?: null);
        $primaryReseller = reset($resellers) ?: null;

        $links = [];
        foreach ($userMap as $u) {
            if ($u->role === 'reseller' && $primaryAdmin) {
                $u->update(['parent_id' => $primaryAdmin->id, 'created_by' => $primaryAdmin->id]);
                $links[] = ['user' => $u->username, 'role' => 'reseller', 'parent' => $primaryAdmin->username, 'confidence' => 'high'];
            } elseif ($u->role === 'seller') {
                // Legacy allocated to sellers directly from admin; best-guess
                // parent is the reseller. Flag LOW for review.
                $parent = $primaryReseller ?: $primaryAdmin;
                if ($parent) {
                    $u->update(['parent_id' => $parent->id, 'created_by' => $primaryAdmin?->id]);
                    $links[] = ['user' => $u->username, 'role' => 'seller', 'parent' => $parent->username, 'confidence' => 'low — verify in UI'];
                }
            }
        }

        $this->report['hierarchy'] = $links;
    }

    // ---- Vouchers / customers ----------------------------------------------

    /**
     * v3.0 folds the legacy pair (tbl_customers + tbl_voucher) into one
     * `vouchers` table. tbl_customers is the base — it is the only side that
     * carries a password — and tbl_voucher contributes its id-based `id_plan`
     * plus the 241 codes that never got a customer row.
     */
    private function importVouchers(array $planMap, array $userMap): void
    {
        $admin = $userMap['admin'] ?? User::where('role', 'admin')->first();
        if (! $admin) {
            throw new \RuntimeException('No admin user to own unattributable vouchers — import staff first.');
        }
        $plansByName = InternetPlan::pluck('id', 'name');
        $plansById = InternetPlan::get()->keyBy('id');

        // legacy_id is UNIQUE but the two source tables have independent id
        // sequences that overlap heavily (50,922 shared ids), so voucher-sourced
        // rows are offset out of tbl_customers' range to stay traceable.
        $voucherIdOffset = self::VOUCHER_LEGACY_ID_OFFSET;

        // tbl_voucher keyed by code: supplies id_plan (an FK, more reliable than
        // matching a plan by name) and the voucher-only codes.
        $legacyVouchers = DB::connection('legacy')->table('tbl_voucher')
            ->select('id', 'code', 'id_plan', 'batch', 'generated_for', 'user_status')
            ->get()->keyBy('code');

        // Resolve a legacy row to a v3.0 plan id: prefer the voucher's id_plan
        // (survives renames), fall back to the customer's profile name.
        $resolvePlan = function (?object $v, ?string $profile) use ($planMap, $plansByName): ?int {
            if ($v && $v->id_plan && isset($planMap[$v->id_plan])) {
                return $planMap[$v->id_plan];
            }

            return $profile ? ($plansByName[$profile] ?? null) : null;
        };

        $ownership = function (?string $generatedFor) use ($userMap, $admin): array {
            $target = $generatedFor ? ($userMap[$generatedFor] ?? null) : null;
            if (! $target) {
                // Deleted staff (e.g. "EBC Spring_023") and null/blank fall to admin.
                return ['owner' => $admin->id, 'reseller' => null, 'seller' => null];
            }
            if ($target->role === 'seller') {
                return ['owner' => $target->id, 'reseller' => $target->parent_id, 'seller' => $target->id];
            }
            if ($target->role === 'reseller') {
                return ['owner' => $target->id, 'reseller' => $target->id, 'seller' => null];
            }

            return ['owner' => $target->id, 'reseller' => null, 'seller' => null];
        };

        $batchMap = $this->importBatches($resolvePlan, $legacyVouchers, $userMap, $admin);

        $imported = 0;
        $skippedNoPlan = 0;
        $seenCodes = [];
        $duplicateCodes = 0;
        $now = now();

        // PPPoE subscribers live in the same tbl_customers table but are a
        // different product entirely — they belong in pppoe_customers, not
        // here. Leaving them in would be actively harmful: FreeRADIUS runs the
        // voucher CASE first and only falls through to the PPPoE state machine
        // when it finds nothing, so a subscriber that also exists as a voucher
        // is silently governed by voucher rules and never sees its own
        // lifecycle. See importPppoeCustomers() below.
        // NULL-safe on purpose: 192,992 of the 195,182 rows have type IS NULL,
        // and `type != 'PPPOE'` is NULL (not true) for those, which would drop
        // almost the entire voucher estate.
        DB::connection('legacy')->table('tbl_customers')
            ->whereRaw("IFNULL(type, '') <> 'PPPOE'")
            ->orderBy('id')->chunk(1000, function ($chunk) use (
            $legacyVouchers, $resolvePlan, $ownership, $plansById, $batchMap,
            &$imported, &$skippedNoPlan, &$seenCodes, &$duplicateCodes, $now
        ) {
            $insert = [];
            foreach ($chunk as $c) {
                // vouchers.code is UNIQUE; legacy allowed duplicate usernames.
                // First occurrence (lowest id) wins, the rest are reported.
                if (isset($seenCodes[$c->username])) {
                    $duplicateCodes++;

                    continue;
                }

                $v = $legacyVouchers->get($c->username);
                $planId = $resolvePlan($v, $c->profile);
                if (! $planId) {
                    $skippedNoPlan++;

                    continue;
                }
                $seenCodes[$c->username] = true;

                $plan = $plansById[$planId];
                $own = $ownership($c->generated_for ?? null);
                $createdAt = $c->created_at ?: $now;

                $insert[] = [
                    'code' => $c->username,
                    'username' => $c->username,
                    'password' => $c->password,
                    'plan_id' => $planId,
                    'batch_id' => $batchMap[$this->batchKey($c->batch)] ?? null,
                    'owner_id' => $own['owner'],
                    'reseller_id' => $own['reseller'],
                    'seller_id' => $own['seller'],
                    'data_gb' => $plan->plan_type === 'data' ? $plan->data_gb : null,
                    'daily_data_gb' => $plan->plan_type === 'daily_data' ? $plan->daily_data_gb : null,
                    'validity_days' => $plan->validity_days,
                    'simultaneous_use' => (int) ($plan->simultaneous_use ?: 1),
                    'price' => $plan->selling_price,
                    'base_price' => $plan->base_price,
                    // 'ready': imported stock has not been logged into yet, and
                    // 'active' means "customer has logged in". The old reason for
                    // importing as 'active' — post-auth stamping only WHERE
                    // status IN ('active','sold','used'), so a card left on 'new'
                    // never started its clock — no longer holds: post-auth now
                    // matches ('ready','active') and promotes ready → active
                    // itself. stampVoucherLifecycle() below still corrects any
                    // card that was already in use before the cutover.
                    'status' => strtolower((string) $c->status) === 'deactivate' ? 'disabled' : 'ready',
                    'customer_username' => $c->fullname ?: null,
                    'legacy_id' => $c->id,
                    'created_at' => $createdAt,
                    'updated_at' => $createdAt,
                ];
                $imported++;
            }
            if ($insert) {
                Voucher::upsert($insert, ['legacy_id'], [
                    'status', 'plan_id', 'owner_id', 'reseller_id', 'seller_id',
                    'batch_id', 'data_gb', 'daily_data_gb', 'price', 'base_price',
                ]);
            }
        });

        // Voucher-only codes: no customer row, so no password — legacy convention
        // is code == username == password. Rows whose plan is gone are skipped
        // under the same rule as planless customers.
        $orphanImported = 0;
        $orphanSkipped = 0;
        $orphanInsert = [];
        foreach ($legacyVouchers as $code => $v) {
            if (isset($seenCodes[$code])) {
                continue;
            }
            $planId = $resolvePlan($v, null);
            if (! $planId) {
                $orphanSkipped++;

                continue;
            }
            $plan = $plansById[$planId];
            $own = $ownership($v->generated_for ?? null);

            $orphanInsert[] = [
                'code' => $code,
                'username' => $code,
                'password' => $code,
                'plan_id' => $planId,
                'batch_id' => $batchMap[$this->batchKey($v->batch)] ?? null,
                'owner_id' => $own['owner'],
                'reseller_id' => $own['reseller'],
                'seller_id' => $own['seller'],
                'data_gb' => $plan->plan_type === 'data' ? $plan->data_gb : null,
                'daily_data_gb' => $plan->plan_type === 'daily_data' ? $plan->daily_data_gb : null,
                'validity_days' => $plan->validity_days,
                'simultaneous_use' => (int) ($plan->simultaneous_use ?: 1),
                'price' => $plan->selling_price,
                'base_price' => $plan->base_price,
                // 'ready' for the same reason as the customer branch above.
                'status' => strtolower((string) $v->user_status) === 'deactivate' ? 'disabled' : 'ready',
                'legacy_id' => $voucherIdOffset + $v->id,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $orphanImported++;
        }
        if ($orphanInsert) {
            Voucher::upsert($orphanInsert, ['legacy_id'], ['status', 'plan_id', 'owner_id', 'reseller_id', 'batch_id']);
        }

        $this->report['vouchers'] = [
            'imported_from_customers' => $imported,
            'imported_voucher_only' => $orphanImported,
            'total' => $imported + $orphanImported,
            'skipped_no_plan' => $skippedNoPlan,
            'skipped_voucher_only_no_plan' => $orphanSkipped,
            'skipped_duplicate_code' => $duplicateCodes,
            'batches' => count($batchMap),
            'legacy_id_note' => "voucher-only rows carry legacy_id = {$voucherIdOffset} + tbl_voucher.id to avoid colliding with tbl_customers ids",
        ];
    }

    // ---- PPPoE subscribers -------------------------------------------------

    /**
     * Earlier runs of this import had no type filter on tbl_customers, so PPPoE
     * subscribers were migrated into `vouchers`. Those rows shadow the real
     * pppoe_customers entry — FreeRADIUS evaluates the voucher CASE first and
     * only consults the PPPoE state machine when it comes back empty — so they
     * have to go before the subscribers are inserted.
     *
     * Scoped by legacy_id against the legacy PPPoE ids, so a genuine hotspot
     * voucher that merely happens to share a code is never touched.
     */
    private function purgePppoeVoucherRows(): void
    {
        $pppoeLegacyIds = DB::connection('legacy')->table('tbl_customers')
            ->where('type', 'PPPOE')->pluck('id')->all();

        if (! $pppoeLegacyIds) {
            $this->report['pppoe_voucher_cleanup'] = ['deleted' => 0];

            return;
        }

        $stale = Voucher::whereIn('legacy_id', $pppoeLegacyIds)->get(['id', 'username']);
        $usernames = $stale->pluck('username')->filter()->all();

        $deleted = Voucher::whereIn('id', $stale->pluck('id'))->delete();
        if ($usernames) {
            DB::table('radcheck')->whereIn('username', $usernames)->delete();
            DB::table('radreply')->whereIn('username', $usernames)->delete();
        }

        $this->report['pppoe_voucher_cleanup'] = [
            'deleted' => $deleted,
            'note' => 'voucher rows that were really PPPoE subscribers, removed so they cannot shadow pppoe_customers in the FreeRADIUS authorize chain',
        ];
    }

    /**
     * PPPoE subscribers (tbl_customers.type = 'PPPOE') are a different product
     * from vouchers: a named, long-lived account on a prepaid recharge cycle
     * rather than an anonymous single-shot card. They land in pppoe_customers.
     *
     * Deliberately NOT imported: the 184 tbl_user_recharges rows. AccountController
     * sums pppoe_recharges.price into account 4250 "PPPoE Sales Revenue", so
     * replaying historical recharges would fabricate revenue in the income
     * statement. Legacy billing history stays in the legacy schema; only the
     * *derived* expiry date is carried across.
     */
    private function importPppoeCustomers(array $userMap): void
    {
        $admin = $userMap['admin'] ?? User::where('role', 'admin')->first();
        if (! $admin) {
            throw new \RuntimeException('No admin user to own unattributable subscribers — import staff first.');
        }

        // profile is a free-text plan NAME on the customer row, not an FK, so
        // this is the only join available back to a plan.
        $plansByName = InternetPlan::where('type', 'pppoe')->pluck('id', 'name');

        // Only 8 of the 20 distinct legacy PPPoE profile names exist in
        // tbl_plans; the rest (mostly FOC packages) were only ever a string on
        // the customer row. plan_id is NOT NULL, so those subscribers cannot be
        // imported without a plan — synthesize one per missing name, taking the
        // term from the subscribers' own validity/validity_unit.
        //
        // Priced at 0 and left without a bandwidth deliberately: neither figure
        // exists anywhere in the legacy data, and inventing a speed would push a
        // wrong Mikrotik-Rate-Limit onto a live line. With bandwidth null the
        // router falls back to its own /ppp profile, which is what these lines
        // already run on. Both are listed in the report to be set.
        $synthesized = [];
        $missing = DB::connection('legacy')->table('tbl_customers')
            ->where('type', 'PPPOE')
            ->whereNotNull('profile')
            ->where('profile', '<>', '')
            ->select('profile', DB::raw('MAX(validity) as validity'), DB::raw('MAX(validity_unit) as validity_unit'))
            ->groupBy('profile')
            ->get()
            ->filter(fn ($r) => ! $plansByName->has($r->profile));

        foreach ($missing as $m) {
            $days = $this->toDays((int) $m->validity, (string) $m->validity_unit);
            $plan = InternetPlan::updateOrCreate(
                ['name' => $m->profile, 'type' => 'pppoe'],
                [
                    'plan_type' => 'unlimited',
                    'package_type' => 'wallet',
                    'validity_days' => max(1, $days),
                    'simultaneous_use' => 1,
                    'base_price' => 0,
                    'selling_price' => 0,
                    'status' => 'active',
                ]
            );
            $plansByName->put($m->profile, $plan->id);
            $synthesized[] = ['plan_id' => $plan->id, 'name' => $m->profile, 'validity_days' => max(1, $days)];
        }

        $plansById = InternetPlan::whereIn('id', $plansByName->values())->get()->keyBy('id');

        // Latest expiry per subscriber. tbl_customers has no expiry column of
        // its own — the date lives on the recharge ledger.
        $expiryByUser = DB::connection('legacy')->table('tbl_user_recharges')
            ->select('username', DB::raw('MAX(expiration) as expiration'))
            ->groupBy('username')
            ->pluck('expiration', 'username');

        $ownership = function (?string $generatedFor) use ($userMap, $admin): array {
            $target = $generatedFor ? ($userMap[$generatedFor] ?? null) : null;
            if (! $target) {
                return ['owner' => $admin->id, 'reseller' => null];
            }
            if ($target->role === 'reseller') {
                return ['owner' => $target->id, 'reseller' => $target->id];
            }
            // A seller never owns PPPoE (sellers are voucher-only), so a
            // seller-allocated line is booked to its parent reseller.
            if ($target->role === 'seller' && $target->parent_id) {
                return ['owner' => $target->parent_id, 'reseller' => $target->parent_id];
            }

            return ['owner' => $target->id, 'reseller' => null];
        };

        $now = now();
        $imported = 0;
        $skippedNoPlan = [];
        $nonEditableUsernames = [];
        $skippedDuplicate = 0;
        $pendingNoExpiry = [];
        $statusCounts = ['active' => 0, 'expired' => 0, 'pending' => 0];
        $seen = [];
        $insert = [];

        $rows = DB::connection('legacy')->table('tbl_customers')
            ->where('type', 'PPPOE')
            ->orderBy('id')
            ->get();

        foreach ($rows as $c) {
            $username = trim((string) $c->username);

            // pppoe_customers.username is UNIQUE; legacy allowed duplicates.
            if (isset($seen[$username])) {
                $skippedDuplicate++;

                continue;
            }

            // A handful of legacy accounts use a bare MAC address as the
            // username. That fails the app's /^[A-Za-z0-9._@-]{3,64}$/ rule, so
            // the edit form will refuse to save one until it is renamed — but
            // the credential is what the CPE actually dials with, so it is
            // imported verbatim and flagged here rather than altered. Renaming
            // would take the line off the air.
            if (! preg_match('/^[A-Za-z0-9._@-]{3,64}$/', $username)) {
                $nonEditableUsernames[] = ['legacy_id' => $c->id, 'username' => $username, 'full_name' => $c->fullname];
            }

            $planId = $c->profile ? ($plansByName[$c->profile] ?? null) : null;
            if (! $planId) {
                $skippedNoPlan[] = ['legacy_id' => $c->id, 'username' => $username, 'profile' => $c->profile];

                continue;
            }

            $seen[$username] = true;
            $plan = $plansById[$planId];
            $own = $ownership($c->generated_for ?? null);

            // Expiry is derived from the recharge ledger. No recharge row means
            // no defensible paid-through date, so the line lands 'pending':
            // visible in the UI, not provisioned in RADIUS, and cleared by an
            // operator taking a real recharge.
            $expiration = $expiryByUser[$username] ?? null;
            if ($expiration) {
                $expiresAt = \Carbon\Carbon::parse($expiration)->endOfDay();
                $status = $expiresAt->isPast() ? 'expired' : 'active';
            } else {
                $expiresAt = null;
                $status = 'pending';
                $pendingNoExpiry[] = $username;
            }
            $statusCounts[$status]++;

            $phone = trim((string) ($c->phonenumber ?? ''));

            $insert[] = [
                'username' => $username,
                'password' => $c->password,
                'plan_id' => $planId,
                'owner_id' => $own['owner'],
                'reseller_id' => $own['reseller'],
                'full_name' => $c->fullname ?: $username,
                'phone' => ($phone === '' || $phone === '0') ? null : $phone,
                'address' => $c->address ?: null,
                'status' => $status,
                'activated_at' => $c->created_at ?: null,
                'expires_at' => $expiresAt,
                'bandwidth' => $plan->bandwidth,
                'simultaneous_use' => (int) ($plan->simultaneous_use ?: 1),
                'mac_bind' => false,
                'legacy_id' => $c->id,
                'created_at' => $c->created_at ?: $now,
                'updated_at' => $now,
            ];
            $imported++;
        }

        if ($insert) {
            foreach (array_chunk($insert, 500) as $slice) {
                PppoeCustomer::upsert($slice, ['legacy_id'], [
                    'plan_id', 'owner_id', 'reseller_id', 'full_name', 'phone',
                    'address', 'status', 'expires_at', 'bandwidth', 'simultaneous_use',
                ]);
            }
        }

        // Provisioning invariant: radcheck/radreply rows exist for a subscriber
        // iff status NOT IN ('pending','terminated').
        $radius = app(PppoeRadiusService::class);
        $checkRows = 0;
        $replyRows = 0;
        PppoeCustomer::with('plan')->whereNotIn('status', ['pending', 'terminated'])
            ->orderBy('id')->chunk(500, function ($chunk) use ($radius, &$checkRows, &$replyRows) {
                $check = [];
                $reply = [];
                foreach ($chunk as $customer) {
                    if (! $customer->plan) {
                        continue;
                    }
                    $r = $radius->rows($customer);
                    $check = array_merge($check, $r['check']);
                    $reply = array_merge($reply, $r['reply']);
                }
                $names = $chunk->pluck('username')->all();
                DB::table('radcheck')->whereIn('username', $names)->delete();
                DB::table('radreply')->whereIn('username', $names)->delete();
                if ($check) {
                    DB::table('radcheck')->insert($check);
                    $checkRows += count($check);
                }
                if ($reply) {
                    DB::table('radreply')->insert($reply);
                    $replyRows += count($reply);
                }
            });

        $this->report['pppoe_customers'] = [
            'imported' => $imported,
            'by_status' => $statusCounts,
            'radcheck_generated' => $checkRows,
            'radreply_generated' => $replyRows,
            'skipped_no_matching_plan' => $skippedNoPlan,
            'skipped_duplicate_username' => $skippedDuplicate,
            'pending_no_recharge_history' => $pendingNoExpiry,
            'synthesized_plans_review' => $synthesized,
            'synthesized_plans_note' => 'Created from the subscribers own validity because the legacy profile name had no tbl_plans row. Price 0 and no bandwidth — set both before charging a recharge against them.',
            'non_editable_usernames_review' => $nonEditableUsernames,
            'non_editable_usernames_note' => 'Imported verbatim so the line keeps dialling. The username fails the apps /^[A-Za-z0-9._@-]{3,64}$/ rule, so the edit form will refuse to save one until it is renamed.',
            'note' => 'tbl_user_recharges is NOT imported into pppoe_recharges — account 4250 sums that table as revenue, so replaying legacy billing would fabricate income. Only the derived expires_at is carried across.',
        ];
    }

    /**
     * Fold a legacy batch code to its lookup key. Must match how importBatches()
     * keys its map — and the case-insensitive UNIQUE index on batches.batch_code.
     */
    private function batchKey(?string $batch): string
    {
        return mb_strtolower(trim((string) $batch));
    }

    /**
     * Batches come from BOTH legacy tables. batches.plan_id is NOT NULL but a
     * legacy batch is not necessarily single-plan (338 span 2-10 plans), so the
     * batch takes its members' most common plan and reports the mixed ones.
     *
     * @return array<string,int> legacy batch code => new batch id
     */
    private function importBatches(callable $resolvePlan, $legacyVouchers, array $userMap, User $admin): array
    {
        // Keyed by the CASE-FOLDED batch code. batches.batch_code is UNIQUE under
        // utf8mb4_unicode_ci (case-insensitive) while PHP array keys are not, and
        // 110 legacy codes differ only in case ("Above"/"above"). Folding here
        // merges them deliberately — with their quantities summed — instead of
        // letting updateOrCreate silently overwrite one variant with the other.
        $planVotes = [];
        $owners = [];
        $sizes = [];
        $forms = [];      // folded key => first-seen original spelling
        $variants = [];   // folded keys that appeared under >1 capitalisation

        $tally = function (?string $batch, ?int $planId, ?string $generatedFor) use (&$planVotes, &$owners, &$sizes, &$forms, &$variants) {
            $batch = trim((string) $batch);
            if ($batch === '') {
                return;
            }
            $key = mb_strtolower($batch);
            if (isset($forms[$key]) && $forms[$key] !== $batch) {
                $variants[$key] = true;   // same batch, different capitalisation
            }
            $forms[$key] ??= $batch;
            $sizes[$key] = ($sizes[$key] ?? 0) + 1;
            if ($planId) {
                $planVotes[$key][$planId] = ($planVotes[$key][$planId] ?? 0) + 1;
            }
            if ($generatedFor) {
                $owners[$key][$generatedFor] = ($owners[$key][$generatedFor] ?? 0) + 1;
            }
        };

        // 56,348 codes exist in BOTH legacy tables. Tallying each side blindly
        // would count those twice and inflate quantity above the real member
        // count, so customers are tallied first and the voucher pass only adds
        // codes that have no customer row.
        $hasCustomer = [];
        DB::connection('legacy')->table('tbl_customers')->orderBy('id')
            ->select('username', 'batch', 'profile', 'generated_for')
            ->chunk(2000, function ($chunk) use ($tally, $legacyVouchers, $resolvePlan, &$hasCustomer) {
                foreach ($chunk as $c) {
                    $hasCustomer[$c->username] = true;
                    $tally($c->batch, $resolvePlan($legacyVouchers->get($c->username), $c->profile), $c->generated_for);
                }
            });

        foreach ($legacyVouchers as $code => $v) {
            if (isset($hasCustomer[$code])) {
                continue;
            }
            $tally($v->batch, $resolvePlan($v, null), $v->generated_for);
        }

        $map = [];
        $mixed = 0;
        $skippedNoPlan = 0;

        $caseMerged = count($variants);
        foreach ($sizes as $key => $quantity) {
            $votes = $planVotes[$key] ?? [];
            if (! $votes) {
                // Every member's plan is gone — the batch cannot satisfy
                // plan_id NOT NULL, so its vouchers land with batch_id null.
                $skippedNoPlan++;

                continue;
            }
            arsort($votes);
            if (count($votes) > 1) {
                $mixed++;
            }
            $planId = (int) array_key_first($votes);

            $ownerVotes = $owners[$key] ?? [];
            arsort($ownerVotes);
            $ownerName = $ownerVotes ? array_key_first($ownerVotes) : null;
            $generatedBy = ($ownerName && isset($userMap[$ownerName])) ? $userMap[$ownerName]->id : $admin->id;

            $original = $forms[$key];
            $batch = Batch::updateOrCreate(
                ['legacy_batch' => $original],
                [
                    'batch_code' => 'LEG-'.$original,
                    'plan_id' => $planId,
                    'quantity' => $quantity,
                    'generated_by' => $generatedBy,
                ]
            );
            $map[$key] = $batch->id;
        }

        $this->report['batches'] = [
            'created' => count($map),
            'mixed_plan_batches' => $mixed,
            'skipped_all_plans_deleted' => $skippedNoPlan,
            'case_variants_merged' => $caseMerged,
            'note' => 'batch codes are matched case-insensitively to mirror the UNIQUE index collation; mixed-plan batches took their most common member plan; quantity is the true member count',
        ];

        return $map;
    }

    // ---- FreeRADIUS credential copy ----------------------------------------

    private function copyRadius(): array
    {
        // Both schema names come from config so the ETL follows LEGACY_DB_DATABASE
        // (e.g. `narld`) instead of silently reading a stale `airlink_legacy`.
        $app = $this->quoteSchema(DB::connection()->getDatabaseName());
        $leg = $this->quoteSchema(DB::connection('legacy')->getDatabaseName());

        $out = [];

        // 1. Credentials are GENERATED from the migrated vouchers, not copied.
        //    Legacy radcheck holds Cleartext-Password for only ~57k of the 192k
        //    vouchers (the rest were pruned there but survive in
        //    tbl_customers.password), so a verbatim copy would leave two thirds
        //    of the estate unable to authenticate. RadiusService also emits the
        //    correct modern attributes, whereas legacy radcheck parked
        //    reply-type junk (User-Profile, Total-Volume-Limit, Expire-After,
        //    Daily-Quota-Limit) as check items, which stock FreeRADIUS rejects.
        $out['stale_radcheck_removed'] = DB::table('radcheck')->count();
        $out['stale_radreply_removed'] = DB::table('radreply')->count();
        DB::table('radcheck')->delete();
        DB::table('radreply')->delete();

        $radius = app(RadiusService::class);
        $checkRows = 0;
        $replyRows = 0;

        Voucher::with('plan')->orderBy('id')->chunk(2000, function ($chunk) use ($radius, &$checkRows, &$replyRows) {
            $check = [];
            $reply = [];
            foreach ($chunk as $v) {
                if (! $v->plan) {
                    continue;
                }
                $r = $radius->rows($v->username, $v->password, $v->plan);
                $check = array_merge($check, $r['check']);
                $reply = array_merge($reply, $r['reply']);
            }
            foreach (array_chunk($check, 2000) as $slice) {
                DB::table('radcheck')->insert($slice);
                $checkRows += count($slice);
            }
            foreach (array_chunk($reply, 2000) as $slice) {
                DB::table('radreply')->insert($slice);
                $replyRows += count($slice);
            }
        });

        // The wipe above is indiscriminate, so PPPoE subscribers must be
        // reprovisioned here too — otherwise `--only=radius` silently strips the
        // credentials off every PPPoE line. Same invariant as the import:
        // rows exist iff status NOT IN ('pending','terminated').
        $pppoeRadius = app(PppoeRadiusService::class);
        $pppoeCheckRows = 0;
        $pppoeReplyRows = 0;

        PppoeCustomer::with('plan')->whereNotIn('status', ['pending', 'terminated'])
            ->orderBy('id')->chunk(500, function ($chunk) use ($pppoeRadius, &$pppoeCheckRows, &$pppoeReplyRows) {
                $check = [];
                $reply = [];
                foreach ($chunk as $customer) {
                    if (! $customer->plan) {
                        continue;
                    }
                    $r = $pppoeRadius->rows($customer);
                    $check = array_merge($check, $r['check']);
                    $reply = array_merge($reply, $r['reply']);
                }
                if ($check) {
                    DB::table('radcheck')->insert($check);
                    $pppoeCheckRows += count($check);
                }
                if ($reply) {
                    DB::table('radreply')->insert($reply);
                    $pppoeReplyRows += count($reply);
                }
            });

        $out['radcheck_generated'] = $checkRows;
        $out['radreply_generated'] = $replyRows;
        $out['pppoe_radcheck_generated'] = $pppoeCheckRows;
        $out['pppoe_radreply_generated'] = $pppoeReplyRows;

        // 2. Group config copies verbatim — small and purely declarative.
        foreach (['radgroupcheck', 'radgroupreply', 'radusergroup'] as $t) {
            $cols = $this->columnsOf($t, 'id');
            $list = implode(',', array_map(fn ($c) => "`{$c}`", $cols));
            DB::statement("INSERT IGNORE INTO {$app}.{$t} ({$list}) SELECT {$list} FROM {$leg}.{$t}");
            $out[$t] = DB::table($t)->count();
        }

        // 3. Session accounting. radacctid is a surrogate that already collides
        //    with prod's own range, so it is omitted and rows are deduplicated on
        //    acctuniqueid (UNIQUE). Copied in id-ranged batches to avoid holding
        //    one huge lock on a table FreeRADIUS is actively writing to.
        $cols = $this->columnsOf('radacct', 'radacctid');
        $list = implode(',', array_map(fn ($c) => "`{$c}`", $cols));
        $max = (int) DB::connection('legacy')->table('radacct')->max('radacctid');
        $before = DB::table('radacct')->count();

        for ($lo = 0; $lo <= $max; $lo += 100000) {
            $hi = $lo + 100000;
            DB::statement("
                INSERT IGNORE INTO {$app}.radacct ({$list})
                SELECT {$list} FROM {$leg}.radacct
                WHERE radacctid >= {$lo} AND radacctid < {$hi}
            ");
        }

        $after = DB::table('radacct')->count();
        $out['radacct_before'] = $before;
        $out['radacct_after'] = $after;
        $out['radacct_inserted'] = $after - $before;
        $out['radpostauth'] = 'skipped by choice — 11.35M-row audit log, not read by any app code';
        $out['nas'] = 'skipped — legacy nas table is empty; v3.0 uses nas_devices';

        // 4. Voucher lifecycle — must run after radacct lands, since that is
        //    where the activation dates come from.
        $out['lifecycle'] = $this->stampVoucherLifecycle();

        return $out;
    }

    /**
     * Give imported vouchers the activation/expiry that FreeRADIUS post-auth
     * would have stamped, derived from real accounting history.
     *
     * Post-auth only stamps on a login, and only for status IN
     * ('ready','active'). Left to it, a card already in use before the
     * cutover would take a fresh full validity window from its next login
     * instead of expiring on the schedule it was sold under. Cards with no
     * history are left alone on 'ready' — post-auth promotes them to
     * 'active' and starts their clock correctly on first use.
     *
     * Idempotent: rows that already carry an activation date are skipped.
     *
     * @return array<string,int>
     */
    private function stampVoucherLifecycle(): array
    {
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
             WHERE v.legacy_id IS NOT NULL
               AND v.activated_at IS NULL
               AND v.status IN ('ready', 'active')
               AND v.validity_days > 0"
        );

        return ['vouchers_activation_stamped' => $stamped];
    }

    /**
     * Column names of a table in the app schema, minus the given surrogate key.
     *
     * @return array<int,string>
     */
    private function columnsOf(string $table, string $exclude): array
    {
        return collect(DB::select('SHOW COLUMNS FROM '.$table))
            ->pluck('Field')
            ->reject(fn ($c) => strcasecmp($c, $exclude) === 0)
            ->values()->all();
    }

    /** Backtick-quote a schema name for interpolation into raw SQL. */
    private function quoteSchema(string $name): string
    {
        return '`'.str_replace('`', '``', $name).'`';
    }

    private function radiusCandidateCounts(): array
    {
        $vouchers = Voucher::count();

        return [
            'vouchers_to_generate_credentials_for' => $vouchers,
            'radcheck_rows_estimate' => $vouchers * 2,     // Cleartext-Password + Simultaneous-Use
            'radgroup_rows_to_copy' => DB::connection('legacy')->table('radgroupcheck')->count()
                + DB::connection('legacy')->table('radgroupreply')->count()
                + DB::connection('legacy')->table('radusergroup')->count(),
            'radacct_source_rows' => DB::connection('legacy')->table('radacct')->count(),
            'note' => 'credentials are generated from vouchers, not copied from legacy radcheck',
        ];
    }

    // ---- Report ------------------------------------------------------------

    private function writeReport(bool $dry): void
    {
        $this->report['meta'] = ['dry_run' => $dry, 'generated_at' => now()->toIso8601String()];
        $path = storage_path('app/legacy-import-report.json');
        file_put_contents($path, json_encode($this->report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $this->info("Review report written to: {$path}");
    }

    private function renderSummary(): void
    {
        $this->newLine();
        $this->line('<comment>Import summary</comment>');
        $this->table(['Entity', 'Result'], [
            ['Plans', ($this->report['plans']['imported'] ?? 0).' imported'],
            ['Staff users', count($this->report['users'] ?? []).' imported'],
            ['Wallets', count($this->report['wallets'] ?? []).' processed'],
            ['Vouchers', ($this->report['vouchers']['total'] ?? 0).' imported ('
                .($this->report['vouchers']['imported_from_customers'] ?? 0).' customers + '
                .($this->report['vouchers']['imported_voucher_only'] ?? 0).' voucher-only)'],
            ['  skipped', ($this->report['vouchers']['skipped_no_plan'] ?? 0).' no plan, '
                .($this->report['vouchers']['skipped_duplicate_code'] ?? 0).' duplicate code, '
                .($this->report['vouchers']['skipped_voucher_only_no_plan'] ?? 0).' voucher-only no plan'],
            ['Batches', ($this->report['batches']['created'] ?? 0).' created, '
                .($this->report['batches']['mixed_plan_batches'] ?? 0).' mixed-plan'],
            ['radcheck', json_encode($this->report['radius'] ?? [])],
        ]);

        $this->newLine();
        $this->line('<comment>Hierarchy (REVIEW — correct parents/roles in the UI):</comment>');
        foreach ($this->report['hierarchy'] ?? [] as $h) {
            $this->line("  {$h['user']} ({$h['role']}) → parent {$h['parent']}  [{$h['confidence']}]");
        }
    }
}

/** Internal signal to roll back a dry-run transaction. */
class DryRunComplete extends \RuntimeException {}
