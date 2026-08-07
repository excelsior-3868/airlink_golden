# Implement PPPoE in Airlink 3.0

## Context

Airlink 3.0 (`/home/airlink_3.0`) is a Laravel 13 + React 18 voucher-based **hotspot** billing system. A reference document describing the legacy PPPoE implementation (PHPNuxBill fork + FreeRADIUS 3.0.26 at Nepal Airlink) was supplied as an as-is spec of the behaviour to reproduce.

**Today PPPoE is a label, not a feature.** `internet_plans.type` has a `pppoe` enum value, `PppoePlans.tsx` is a stale CRUD stub, and chart-of-accounts `4250 "PPPoE Sales Revenue"` exists — fed by a query that can never match. There is no subscriber entity: in this codebase a "customer" *is* a voucher (anonymous, single-shot, lazily activated on first login). PPPoE needs the opposite: a named, long-lived account on a prepaid recharge cycle.

The goal is a working PPPoE product in this stack — subscriber management, RADIUS provisioning, lifecycle enforcement, and prepaid recharge billing — built on **this** codebase's patterns rather than porting the legacy design. The reference document is used as a requirements source and as a catalogue of legacy behaviours to *deliberately not* reproduce (see "Legacy behaviours explicitly not carried over").

### Decisions already made

| Decision | Choice |
|---|---|
| Billing lifecycle | **Prepaid recharge.** `expires_at` extended by the plan's `validity_days`; payment taken up front. No postpaid invoicing. |
| IP assignment | **None via RADIUS.** MikroTik assigns from its own local `/ppp` profile pool. No `Framed-IP-Address`, no `Framed-Pool`, no `sqlippool`. The address still lands in `radacct.framedipaddress` for reporting. |
| Who can use it | **Admin + reseller only.** Sellers stay voucher-only. |
| Wallet flow | **Full price debited from the actor's wallet + commission split**, mirroring `VoucherService`/`VoucherController::sell` exactly. |
| Data caps | **Unlimited only.** PPPoE plans are speed + validity. No per-period quota. |
| Legacy import | **Greenfield now.** `legacy_id` columns are reserved so a `LegacyImport` extension is a straight field map later. |

### What already exists and gets reused

- The **rad\* tables** are already created by `backend/database/migrations/2026_07_11_000008_create_freeradius_tables.php`, in the same `airlink` DB FreeRADIUS reads.
- Host **FreeRADIUS 3.2.5** (systemd, `/etc/freeradius/3.0`, ports 1812/1813) with one `sql` instance → `127.0.0.1:3308` db `airlink`.
- A clean, well-commented **unlang enforcement pattern** in `sites-available/default`: an inline `%{sql: SELECT CASE … END FROM vouchers}` state machine writing `control:Tmp-String-0`, then a `switch` giving each failure a distinct `Reply-Message`.
- A working **CoA/Disconnect** implementation (`app/Services/Radius/CoaService.php` + `CoaClient.php`) that resolves the NAS secret from `nas_devices.nasname` — works for PPPoE unchanged.
- `WalletService`, commission columns, `SystemPermission` matrix, `Combobox`/`CustomSelect`/`Modal`/`Pagination` UI kit.

---

## Architecture

The contract with FreeRADIUS stays exactly what it is today: **rows in shared MySQL tables**. A PPPoE subscriber gets per-user `radcheck`/`radreply` rows; lifecycle is gated in `authorize` by a state machine reading `pppoe_customers` directly — the same shape as the voucher one, so both products read identically.

```
pppoe_customers ──1:N──> pppoe_recharges          (app tables, new)
       │
       │ provisioned by PppoeRadiusService
       ▼
   radcheck (Cleartext-Password, Simultaneous-Use)
   radreply (Mikrotik-Rate-Limit, Acct-Interim-Interval)
       │
       ▼
FreeRADIUS authorize: voucher CASE → (empty ⇒ not a voucher) → pppoe_customers CASE → switch/reject
```

### Two decisions worth stating up front

**Per-user rows, not `radgroupcheck`/`radgroupreply`/`radusergroup`.** Those three tables exist but are referenced by zero PHP code. The legacy system used them; we will not. Populating `radusergroup` changes the query plan for **every** authentication on a live production server (the group queries in `mods-config/sql/main/mysql/queries.conf:199-217` are enabled and only free today because the table is empty) — unacceptable blast radius for a cosmetic normalisation. It also makes de-provisioning a three-table problem when the entire codebase's teardown idiom is a single `DB::table('radcheck')->where('username', …)->delete()`. Note the legacy dump itself has `radusergroup` rows but **zero** `radgroupreply`/`radgroupcheck` inserts — the mechanism was wired up and abandoned.

**The voucher/PPPoE discriminator is "the voucher query returned empty".** The existing voucher `CASE` can never yield an empty string when a row exists — every branch returns a non-empty literal. So *empty `Tmp-String-0` ⟺ this User-Name is not a voucher*, and that is exactly when it is worth spending a query on `pppoe_customers`. Consequence: **the hotspot path is byte-for-byte unchanged**; the new block is never entered for a voucher.

---

## Backend

### 1. Migrations

`backend/database/migrations/2026_08_07_000000_create_pppoe_customers_table.php`

```php
$table->id();
$table->string('username', 64)->unique();          // matches radcheck.username width
$table->string('password');
$table->foreignId('plan_id')->constrained('internet_plans')->restrictOnDelete();
$table->foreignId('owner_id')->constrained('users')->restrictOnDelete();
$table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
$table->string('customer_code', 40)->nullable()->unique();
$table->string('full_name');
$table->string('phone', 30)->nullable()->index();
$table->string('address')->nullable();
$table->text('notes')->nullable();
$table->enum('status', ['pending','active','expired','suspended','terminated'])->default('pending')->index();
$table->timestamp('activated_at')->nullable();
$table->timestamp('expires_at')->nullable()->index();
$table->timestamp('last_recharged_at')->nullable();
$table->string('bandwidth')->nullable();            // per-subscriber override, e.g. "20M/20M"
$table->unsignedTinyInteger('simultaneous_use')->nullable();
$table->decimal('contract_price', 12, 2)->nullable();
$table->boolean('mac_bind')->default(false);
$table->string('mac_address', 50)->nullable();
$table->foreignId('nas_device_id')->nullable()->constrained('nas_devices')->nullOnDelete();
$table->string('nas_ip')->nullable();               // denormalised nas_devices.nasname
$table->unsignedBigInteger('legacy_id')->nullable()->unique();
$table->timestamps();
$table->index(['owner_id','status']); $table->index(['reseller_id','status']); $table->index(['status','expires_at']);
```

Anything the unlang state machine reads is **denormalised onto the customer** (`status`, `expires_at`, `nas_ip`, `mac_bind`, `mac_address`) so the auth-path query is a single-row unique-index lookup with no JOIN — same as the voucher one. `bandwidth`/`simultaneous_use`/`contract_price` are nullable per-subscriber overrides because field ops routinely grant one line a different speed without minting a plan. `status='pending'` means "row exists, no recharge taken, no radcheck rows, cannot dial".

`backend/database/migrations/2026_08_07_000001_create_pppoe_recharges_table.php` — the revenue document, playing the role `vouchers` plays for hotspot. Money columns deliberately identical to `vouchers` so `AccountController` can treat both uniformly:

```php
$table->string('reference', 40)->unique();          // RCH260807ABCD
$table->foreignId('customer_id')->constrained('pppoe_customers')->cascadeOnDelete();
$table->foreignId('plan_id')->constrained('internet_plans')->restrictOnDelete();
$table->foreignId('owner_id')->constrained('users')->restrictOnDelete();
$table->foreignId('reseller_id')->nullable()->constrained('users')->nullOnDelete();
$table->foreignId('collected_by')->constrained('users')->restrictOnDelete();
$table->decimal('price', 12, 2)->default(0);
$table->decimal('base_price', 12, 2)->default(0);
$table->decimal('commission_percent', 5, 2)->nullable();
$table->decimal('admin_share', 12, 2)->nullable();
$table->decimal('reseller_share', 12, 2)->nullable();
$table->string('payment_method', 40)->nullable();
$table->unsignedInteger('validity_days')->default(0);   // snapshot — a plan edit never rewrites history
$table->timestamp('period_start'); $table->timestamp('period_end');
$table->string('note')->nullable();
$table->unsignedBigInteger('legacy_id')->nullable()->unique();
$table->timestamps();
$table->index(['customer_id','created_at']); $table->index(['owner_id','created_at']); $table->index(['reseller_id','created_at']);
```

No `wallet_transactions.type` enum migration is needed — `deduct` and `commission` already exist (`2026_07_30_000002_…`).

**Models**: `app/Models/PppoeCustomer.php`, `app/Models/PppoeRecharge.php` (`$guarded = []`, casts, relations). Add `pppoeCustomers(): HasMany` to `app/Models/InternetPlan.php`.

### 2. `app/Services/PppoeRadiusService.php`

A **sibling** to `RadiusService.php`, not a second method on it — the two share only three of eight attribute decisions and take different model types. Rejected: `RadiusService::pppoeRows()`, which would make one 49-line class own two products with two attribute policies.

```php
public const ACCT_INTERIM_INTERVAL = 300;

public function rows(PppoeCustomer $customer): array
{
    $plan = $customer->plan;
    $check = [
        [... 'attribute' => 'Cleartext-Password',  'op' => ':=', 'value' => $customer->password],
        [... 'attribute' => 'Simultaneous-Use',    'op' => ':=',
             'value' => (string) ($customer->simultaneous_use ?: $plan->simultaneous_use ?: 1)],
    ];
    $reply = [
        [... 'attribute' => 'Acct-Interim-Interval', 'op' => ':=', 'value' => (string) self::ACCT_INTERIM_INTERVAL],
    ];
    if ($bandwidth = ($customer->bandwidth ?: $plan->bandwidth)) {
        $reply[] = [... 'attribute' => 'Mikrotik-Rate-Limit', 'op' => ':=', 'value' => $bandwidth];
    }
    return ['check' => $check, 'reply' => $reply];
}
```

**Attribute rationale** (write it into the class docblock):

| Attribute | Verdict | Why |
|---|---|---|
| `Cleartext-Password` (check) | yes | MikroTik `/ppp` profiles default to `pap,chap,mschap1,mschap2`; only cleartext satisfies MS-CHAPv2. |
| `Simultaneous-Use` (check) | yes | Already enforced by the live `session { sql }` block at `sites-available/default:837-845`; works for PPPoE unchanged. |
| `Mikrotik-Rate-Limit` (reply) | yes | This is what actually shapes the line; overrides the router's `/ppp` profile. |
| `Acct-Interim-Interval := 300` (reply) | **yes** | New vs. the voucher pattern. A PPPoE session runs for weeks; without interim updates `radacct` octets stay 0 until disconnect, so the sessions/usage UI would show nothing. The reference doc flags exactly this as a legacy defect (§08 B5). |
| `Framed-Protocol == PPP` / `Service-Type == Framed-User` (check) | no | Zero added security — the password already gates — and a hard failure against any NAS that omits them. |
| `Framed-Protocol` / `Service-Type` (reply) | no | MikroTik derives both for a PPPoE interface and ignores them in the reply. Two dead rows per subscriber. |
| `Framed-IP-Address` / `Framed-Pool` | no | Product decision. `sqlippool` stays commented out at `:794` and `:934`. |
| `Session-Timeout` | no | Would drop a permanent line on a timer. Expiry is enforced at re-auth plus CoA. |
| `Mikrotik-Total-Limit(-Gigawords)` | no | Not applicable — unlimited-only. (It is also a *per-session* counter on RouterOS, so it could never express a period cap.) |

**Invariant to maintain:** `radcheck`/`radreply` rows exist for a `pppoe_customers.username` **iff** `status NOT IN ('pending','terminated')`.

### 3. `app/Services/PppoeCustomerService.php` + `PppoeRechargeService.php`

Each mutation in one `DB::transaction`, CoA fired **after** commit.

| Event | `pppoe_customers` | radcheck/radreply | CoA |
|---|---|---|---|
| create | insert, `status='pending'` | none | — |
| first recharge | `active`, `activated_at`, `expires_at`, `last_recharged_at` | insert | — |
| renewal | `expires_at = GREATEST(expires_at, now()) + validity`, `status='active'` | delete + reinsert | only if previously `expired`/`suspended` |
| suspend | `status='suspended'` | **keep** | disconnect |
| resume | `expires_at > now() ? 'active' : 'expired'` | ensure present | — |
| plan change | `plan_id`, re-snapshot `bandwidth`/`simultaneous_use` | delete + reinsert | disconnect |
| password change | `password` | delete + reinsert | disconnect |
| terminate | `status='terminated'` | **delete** | disconnect |
| destroy | delete (cascades recharges) | delete | disconnect |
| sweep: expiry | `status='expired'` | **keep** | disconnect |

**Judgement call — keep radcheck rows on suspend/expiry**, diverging from `VoucherController::disable()`. The `authorize` state machine gates before `radcheck` is ever consulted, so keeping them costs nothing, makes renewal a pure `UPDATE expires_at`, and lets the subscriber receive the *specific* `Reply-Message` (which MikroTik surfaces in its PPP log) instead of a bare unknown-user reject. Rejected: mirroring the voucher delete-on-disable, which would churn 3–4 rows per subscriber per billing cycle for no gain.

**Renewal date rule** (frontend must preview the same arithmetic): renewing **early stacks** onto the remaining term; renewing **after lapse restarts from today**.

`PppoeRechargeService::recharge(User $actor, PppoeCustomer $customer, ?InternetPlan $plan, ?float $customPrice, ?int $validityDays, ?string $paymentMethod, ?string $note): PppoeRecharge`

1. `PppoeCustomer::whereKey($id)->lockForUpdate()->first()` — the `WalletService`/`GbService` idiom.
2. Reject if `status === 'terminated'`, if `$plan->status !== 'active'`, or if `$plan->type !== 'pppoe'`.
3. `$price = $customPrice ?? $c->contract_price ?? $plan->selling_price`.
4. `WalletService::deduct($owner, $price, $reference, …)` — wallet only, never GB.
5. Commission split copied character-for-character from `VoucherController::sell()` (`VoucherController.php:398-427`): `admin_share`, `reseller_share`, credit admin `type='commission'`, `$reseller->increment('commission_due', $adminShare)`.
6. Insert `pppoe_recharges`; update the customer; rebuild radius rows from `PppoeRadiusService::rows($c->fresh())`.
7. After commit, CoA only if the prior status was `expired`/`suspended`.

### 4. FreeRADIUS policy

**Two files must change and be kept in sync:**
1. `/etc/freeradius/3.0/sites-available/default` — `sites-enabled/default` is a symlink to it, so **editing this file is editing production**.
2. `/home/airlink_3.0/docker/freeradius/sites-enabled/default` — a hand-written 141-line minimal server, **not a copy**. Port the blocks by hand; do not attempt a patch.

**`authorize`** — insert immediately after the closing `}` of the existing voucher `switch` (currently `:387`), before the `# If you intend to use CUI …` comment. Match the surrounding comment density and style:

```unlang
	#  Airlink v3.0 PPPoE subscriber lifecycle check.
	#
	#  Only reached when the voucher lookup above found nothing: a %{sql:}
	#  SELECT over zero rows expands to the empty string, and the voucher CASE
	#  can never itself return "" when a row exists. So an empty Tmp-String-0
	#  means "this User-Name is not a voucher" — exactly when it is worth
	#  spending a query on pppoe_customers. The hotspot path therefore runs the
	#  same two queries it ran before this block existed; nothing about voucher
	#  authentication changes.
	#
	#  Unlike vouchers, PPPoE is prepaid-recharge: expires_at is written by the
	#  app when a recharge is taken, never lazily by this server. This section
	#  performs NO writes — every Access-Request stays a pure read. The one
	#  exception is the optional first-login MAC capture, signalled by
	#  'ok_bind_mac' and executed once, in post-auth.
	if (!&control:Tmp-String-0 || &control:Tmp-String-0 == "") {
		update control {
			Tmp-String-3 := "%{sql: SELECT \
				CASE \
					WHEN status = 'terminated' THEN 'terminated' \
					WHEN status = 'suspended' THEN 'suspended' \
					WHEN status = 'pending' THEN 'pending' \
					WHEN status = 'expired' THEN 'expired' \
					WHEN expires_at IS NULL OR expires_at < NOW() THEN 'expired' \
					WHEN nas_ip IS NOT NULL AND nas_ip <> '' AND nas_ip <> '%{NAS-IP-Address}' THEN 'nas_mismatch' \
					WHEN mac_bind = 1 AND mac_address IS NOT NULL AND mac_address <> '' \
						AND mac_address <> '%{Calling-Station-Id}' THEN 'mac_mismatch' \
					WHEN mac_bind = 1 AND (mac_address IS NULL OR mac_address = '') THEN 'ok_bind_mac' \
					ELSE 'ok' \
				END \
				FROM pppoe_customers WHERE username = '%{User-Name}' LIMIT 1}"
		}

		switch &control:Tmp-String-3 {
			case "expired"      { update reply { Reply-Message := "Your subscription has expired. Please recharge to continue." } reject }
			case "suspended"    { update reply { Reply-Message := "Your connection is suspended. Please contact your service provider." } reject }
			case "terminated"   { update reply { Reply-Message := "This account has been closed." } reject }
			case "pending"      { update reply { Reply-Message := "This account is not activated yet. Please complete your first recharge." } reject }
			case "nas_mismatch" { update reply { Reply-Message := "This account is not permitted on this router." } reject }
			case "mac_mismatch" { update reply { Reply-Message := "This account is locked to a different device." } reject }
		}
	}
```

(Write each `case` body across multiple lines in the file, matching the existing voucher `switch` formatting — collapsed here for brevity.)

Two details that matter:
- `if (!&control:Tmp-String-0 || &control:Tmp-String-0 == "")` — FreeRADIUS 3 is inconsistent about whether assigning `""` materialises a zero-length attribute or skips the assignment. Both forms are covered.
- The `switch` has **no `default`**. An unknown User-Name yields `""` from both queries, matches no case, falls through to `-sql` → no radcheck rows → normal reject. Same as today.

**`post-auth`** — insert after the existing voucher `update control { Tmp-String-1 := … }` block (ends `:966`), before `-sql`:

```unlang
	#  Airlink v3.0 PPPoE: the only write this server ever makes against
	#  pppoe_customers. Runs at most once per subscriber — authorize only
	#  returns 'ok_bind_mac' while mac_bind = 1 and mac_address is still empty.
	#  The Tmp-String-3 existence test keeps this inert for hotspot requests.
	if (&control:Tmp-String-3 && &control:Tmp-String-3 == "ok_bind_mac") {
		update control {
			Tmp-String-4 := "%{sql: UPDATE pppoe_customers SET \
				mac_address = NULLIF('%{Calling-Station-Id}', '') \
				WHERE username = '%{User-Name}' AND mac_bind = 1 \
					AND (mac_address IS NULL OR mac_address = '')}"
		}
	}
```

**Deliberately not repeating the voucher pattern of doing `UPDATE`s from `authorize`.** That turns every Access-Request into a write, takes a row lock on the auth hot path, and serialises reconnect storms after a NAS reboot. PPPoE has no need for it — `expires_at` is authoritative from the app at recharge time, not derived at first login.

`Tmp-String-0/1/2` are taken; `3` and `4` are free (`/usr/share/freeradius/dictionary.freeradius.internal:452-461`). Nothing else in the RADIUS tree changes — `mods-enabled/sql`, `queries.conf`, `clients.conf`, `radiusd.conf`, `dictionary` are all untouched.

### 5. `app/Console/Commands/SyncPppoeStatus.php` (`pppoe:sync-status`)

A new command, **not** an extension of `SyncVoucherStatus` — disjoint terminal states and different SQL; merging means one product's query failure takes the other's lifecycle down.

Flip `active` subscribers past `expires_at` to `expired`, then `CoaService::disconnectUsername()` each one. `CoaService`/`CoaClient` need no changes — they read `radacct` where `acctstoptime IS NULL` and resolve the secret via `NasDevice::where('nasname', $nasIp)`. Register in `backend/routes/console.php` alongside the two voucher schedules:

```php
Schedule::command('pppoe:sync-status')->everyFiveMinutes()->withoutOverlapping();
```

### 6. API surface

`app/Http/Controllers/Api/PppoeCustomerController.php` — shaped like `BandwidthController` (private `validateData()`), scoped like `VoucherController` (private `scopedQuery()` / `canAccess()`):
`index, show, store, update, destroy, suspend, resume, changePlan, disconnect, sessions, exportCsv`.

`app/Http/Controllers/Api/PppoeRechargeController.php` — `index` (scoped recharge feed), `store` (take a recharge).

Routes in `backend/routes/api.php`, inserted after the Vouchers block (after `:129`) so the two products sit together. **Declare `/pppoe/customers/export` and `/pppoe/recharges` before `/pppoe/customers/{customer}`** — the flat routes file matches in declaration order.

```php
// PPPoE subscribers — admin + reseller only. The role: gate is deliberate
// belt-and-braces on top of permission:, so a well-meaning flip of a
// system_permissions row can never hand PPPoE to the seller tier.
Route::middleware('role:admin,reseller')->group(function () {
    Route::get   ('/pppoe/customers',                        [PppoeCustomerController::class, 'index'])      ->middleware('permission:view_pppoe');
    Route::get   ('/pppoe/customers/export',                 [PppoeCustomerController::class, 'exportCsv'])   ->middleware('permission:view_pppoe');
    Route::get   ('/pppoe/recharges',                        [PppoeRechargeController::class, 'index'])       ->middleware('permission:view_pppoe');
    Route::post  ('/pppoe/customers',                        [PppoeCustomerController::class, 'store'])       ->middleware('permission:create_pppoe_customer');
    Route::get   ('/pppoe/customers/{customer}',             [PppoeCustomerController::class, 'show'])        ->middleware('permission:view_pppoe');
    Route::get   ('/pppoe/customers/{customer}/sessions',    [PppoeCustomerController::class, 'sessions'])    ->middleware('permission:view_pppoe');
    Route::put   ('/pppoe/customers/{customer}',             [PppoeCustomerController::class, 'update'])      ->middleware('permission:create_pppoe_customer');
    Route::patch ('/pppoe/customers/{customer}/plan',        [PppoeCustomerController::class, 'changePlan'])  ->middleware('permission:create_pppoe_customer');
    Route::patch ('/pppoe/customers/{customer}/suspend',     [PppoeCustomerController::class, 'suspend'])     ->middleware('permission:suspend_pppoe_customer');
    Route::patch ('/pppoe/customers/{customer}/resume',      [PppoeCustomerController::class, 'resume'])      ->middleware('permission:suspend_pppoe_customer');
    Route::post  ('/pppoe/customers/{customer}/disconnect',  [PppoeCustomerController::class, 'disconnect'])  ->middleware('permission:suspend_pppoe_customer');
    Route::post  ('/pppoe/customers/{customer}/recharge',    [PppoeRechargeController::class, 'store'])       ->middleware('permission:recharge_pppoe_customer');
    Route::delete('/pppoe/customers/{customer}',             [PppoeCustomerController::class, 'destroy'])     ->middleware('permission:delete_pppoe_customer');
});
```

Also add `GET /pppoe/customers/summary` (counts for the stat tiles) and `GET /pppoe/sessions` (live radacct feed) under `permission:view_pppoe`.

**Permission keys** — append to `$perms` in `backend/database/seeders/DatabaseSeeder.php:49-71`. The existing `foreach` inserts missing rows without clobbering toggles, so `php artisan db:seed` is safe on a live DB. **Also add the reseller-allowed keys to the hardcoded fallback lists in `app/Models/SystemPermission.php:46-52`**, or a not-yet-reseeded DB denies resellers.

| feature | category | admin | reseller | seller |
|---|---|---|---|---|
| `view_pppoe` | Navigation | 1 | 1 | 0 |
| `create_pppoe_customer` | PPPoE | 1 | 1 | 0 |
| `recharge_pppoe_customer` | PPPoE | 1 | 1 | 0 |
| `suspend_pppoe_customer` | PPPoE | 1 | 1 | 0 |
| `delete_pppoe_customer` | PPPoE | 1 | 0 | 0 |

`app/Support/IntegrationTokenAbilities.php` — add **read only**: `'pppoe.read' => 'View PPPoE subscribers'`. Write methods check `tokenCan('pppoe.write')`/`('pppoe.recharge')`, deliberately absent from `ALL` — same policy as `vouchers.generate`: a scoped third-party token must never spend wallet balance.

### 7. `PlanController` — make PPPoE plans first-class

All in `backend/app/Http/Controllers/Api/PlanController.php`.

- **`:91` and `:160`** — drop the `if ($request->input('type') === 'hotspot')` gate around the price defaults; apply them to every type.
- **`validateData()` at `:236`** — change the signature to `(Request $request, ?InternetPlan $plan = null)` (callers at `:89`/`:158`; `$ignoreId` uses become `$plan?->id`), then derive the type from payload-or-stored: `$type = $request->input('type') ?? $plan?->type ?? 'hotspot'`. **This also fixes a latent bug**: `$isHotspot` is currently computed from the request, so a PUT to an existing hotspot plan that omits `type` flips `selling_price` from `nullable` to `required`. Rules become `plan_type => $isPppoe ? 'in:unlimited' : 'in:data,time,unlimited,daily_data'` (unlimited-only per the data-cap decision), `validity_days => $isPppoe ? 'min:1' : 'min:0'`. After validation, for PPPoE: `unset($data['time_limit'], $data['daily_data_gb'], $data['data_gb'])`.
- **`store()`/`update()`** — force `$data['package_type'] = 'wallet'` for PPPoE (billed by prepaid recharge, never metered out of a GB allocation).
- **`update()` `:154` / `destroy()` `:220`** — the wallet guard would then lock a reseller out of a PPPoE plan they just created. Exempt `$plan->type === 'pppoe' && $plan->created_by === $request->user()->id`.
- **`index()` `:27-59`** — the seller branch must add `->where('type', '!=', 'pppoe')`, or PPPoE plans surface in a seller's voucher-generation picker where they cannot be used.
- **`destroy()` `:216`** — add `if ($plan->pppoeCustomers()->exists()) return $this->fail('Cannot delete a plan that already has PPPoE subscribers.', 422);`

### 8. `AccountController` — remap account 4250

`4250 "PPPoE Sales Revenue"` is currently fed at `:791-794` by `Voucher::whereHas('plan', type=pppoe)->sum('price')` — a mapping that can only ever match hotspot stock generated against a mis-typed plan, since a PPPoE subscriber is never a `vouchers` row. Replace the source with `PppoeRecharge`: admin sums `whereNull('reseller_id')->sum('price')`; reseller sums `where('reseller_id', $actor->id)->sum(COALESCE(reseller_share, price))`; seller gets zero. Add `'pppoe_revenue_applicable' => ! $actor->isSeller()` next to the existing `commission_revenue_applicable` flag at `:1019` so the frontend can hide a permanent zero. `$totalOperatingRevenue`/`$directVoucherSalesCash` at `:854`/`:888` already add `$pppoeRevenue` and need no edit.

`commissionReport()` `:445-458` reads `$earnedByPeriod` only from `vouchers.admin_share`/`sold_at`; union in `PppoeRecharge` `admin_share`/`created_at` so an admin's commission report doesn't under-report. `$collectedByPeriod` needs no change — `Payment type='commission'` settles both products through the existing collect flow. Document that `1150 "Customer Accounts Receivable"` stays at zero: prepaid means a subscriber can never owe money.

---

## Frontend

### Files

**Create:** `frontend/src/pages/PppoeCustomers.tsx`, `frontend/src/pages/PppoeSessionsTab.tsx`, `frontend/src/components/PppoeRechargeModal.tsx`
**Modify:** `frontend/src/pages/PppoePlans.tsx` (full rewrite), `frontend/src/App.tsx`, `frontend/src/layouts/AppShell.tsx`, `frontend/src/lib/format.ts`
**Untouched:** `ui.tsx`, `cache.ts`, `api.ts`, `auth.tsx`, `index.css`, `HotspotPlans.tsx`

> **Branch off the working tree, not HEAD.** `HotspotPlans.tsx` has uncommitted changes fixing two real ownership bugs (reseller self-delegation defaulting to the wrong owner, and `openEdit` silently reassigning a plan on save). Carry both forward into anything cloned from it.

### `PppoeCustomers.tsx` — the main page

Tabbed (`subscribers | sessions`) with a `defaultTab` prop, following `<FundAllocation defaultTab="wallet" />` at `App.tsx:84`. Structure mirrors `HotspotPlans.tsx`: `PageTitle` with action button → tab strip → four `StatCard`s (Total / Active / Expiring in 7d / Expired+Suspended) → filter bar → `GlassCard className="!p-0 overflow-hidden"` with `motion.tr` rows → `Pagination`.

**Columns** (nine, chosen so an operator can triage without opening a row): Subscriber (`username` + name/phone sub-line) · Plan (name + bandwidth sub-line) · Status (Pill + online dot) · Expiry (AD date, BS sub-line, days-remaining Pill) · Connection (framed IP + MAC) · Last Session · Data Used (from radacct, reporting only) · Owner (**admin only** — a reseller's list is already owner-scoped) · Actions.

**Row actions** as icon buttons: `Zap` Recharge · `Pencil` Edit · `PauseCircle`/`PlayCircle` Suspend/Resume · `Unplug` Disconnect (disabled + `opacity-40` when offline) · `Trash2` Delete · `Eye` Detail. All destructive/stateful ones through `ConfirmModal` — and let `onConfirm` **throw** rather than catching, since `ConfirmModal` owns and renders its own error state (`ConfirmModal.tsx:36,41-46`).

**Create/edit `Modal`**, one for both, three internal tabs like `HotspotPlans.tsx:532-547`:
- `identity` — username, password (reveal toggle; blank on edit = unchanged), full name, phone, address
- `service` — plan (`Combobox`, badge shows price + validity days), status, owner/delegation (`Combobox`, admin-only picker; reseller pinned to itself via the `(Myself)` option)
- `access` — restrict to NAS (`CustomSelect`, narrowed by chosen owner exactly like `nasOptions` at `HotspotPlans.tsx:83-92`), MAC binding (`Disabled | Bind on first login | Static`), concurrent sessions override

Validation stays imperative before the `try`, `setErr(...)`, rendered as `<div className="pill danger w-full justify-center py-2">`: username `/^[A-Za-z0-9._@-]{3,64}$/`, password required on create, plan required, static MAC `/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/`.

**Subscriber detail** is a `Modal` (`max-w-3xl`), not a route — `App.tsx` has zero param routes today and one would break both the "cache key = URL" convention and `AppShell`'s `pathname === c.to` nav matching.

### `PppoeRechargeModal.tsx`

A modal, extracted to `components/` (not inlined) because it renders from two surfaces and is the only money-moving control in the feature — `FundModal.tsx` is the exact precedent. Body: read-only summary grid (current plan / current expiry AD+BS / status) → plan `Combobox` → periods input → computed preview panel (amount due, new expiry, and for a reseller: wallet before → after, rendered rose with submit disabled when negative, per `FundModal.tsx:133-141`) → payment-method `CustomSelect` (reuse the `/payment-methods` loader + `renderPaymentMethodIcon`) → note → error pill → footer.

Preview arithmetic must match the server exactly:
```ts
const base = c.expires_at && new Date(c.expires_at) > new Date() ? new Date(c.expires_at) : new Date()
const next = new Date(base); next.setDate(next.getDate() + plan.validity_days * periods)
```

### `PppoePlans.tsx` — rewrite to HotspotPlans parity

**Carries over:** `CustomSelect` everywhere (kills the native `<select>`s at `:226`/`:239`/`:290`), `Pencil`/`Trash2` icon buttons (kills the text links at `:193-198`), the filter bar with `isFiltered` Clear button, admin owner filter, the 3-tab modal, `simultaneous_use`, NAS restriction, imperative validation, and the two working-tree ownership fixes.

**Explicitly does not apply to PPPoE:**
1. `package_type` (Wallet/GB) — GB packages decrement a seller's GB stock when minting vouchers; PPPoE has no stock. Drop the control; still send `package_type: 'wallet'` so the schema needs no change.
2. Plan-level `mac_bind` — hotspot binds a *voucher* to the first device; PPPoE identity is the CPE credential, so MAC binding moves to the *subscriber* form.
3. `daily_data_gb` / `data_gb` / the `daily_data` and `data` quota types — unlimited-only decision.
4. The "Seller Plan" tab and Seller GB Balance column — no seller touches PPPoE. Reseller tab strip shrinks to `My Plans | Plans from Admin`; delegation offers resellers only.
5. `plan_type: 'time'` / `time_limit` — PPPoE validity is days, not session minutes.

**Tightened:** bandwidth becomes effectively mandatory (it *is* the rate-limit attribute) — validate non-empty; `validity_days` gets a "30 = one month" hint.

### Nav + routes

`AppShell.tsx` — **delete** the `/plans/pppoe` child at `:43` (it moves into the new group) and add, after the `/plans/hotspot` reseller item:

```ts
{ label: 'PPPoE', icon: Router, roles: ['admin','reseller'], color: 'text-indigo-500',
  perm: ['view_pppoe','view_plans'], children: [
    { to: '/pppoe/customers', label: 'Subscribers',     roles: ['admin','reseller'], icon: Users2,   color: 'text-indigo-500',  perm: 'view_pppoe' },
    { to: '/pppoe/sessions',  label: 'Active Sessions', roles: ['admin','reseller'], icon: Activity, color: 'text-emerald-500', perm: 'view_pppoe' },
    { to: '/plans/pppoe',     label: 'PPPoE Plans',     roles: ['admin','reseller'], icon: Package,  color: 'text-violet-500',  perm: 'view_plans' },
  ]},
```

Add `Activity` to the lucide import; seed `expanded.PPPoE` at `:192-195` from `location.pathname.startsWith('/pppoe') || location.pathname === '/plans/pppoe'`.

`App.tsx` — add the three routes, **and fix the existing nav/Guard drift**: `:80` currently guards `/plans/pppoe` with `perm="view_plans"` and no `roles`, while the nav gates it to admin. Since `view_plans` is seeded `1` for sellers, a seller typing the URL gets the page today.

```tsx
<Route path="/pppoe"           element={<Navigate to="/pppoe/customers" replace />} />
<Route path="/pppoe/customers" element={<Guard perm="view_pppoe" roles={['admin','reseller']}><PppoeCustomers /></Guard>} />
<Route path="/pppoe/sessions"  element={<Guard perm="view_pppoe" roles={['admin','reseller']}><PppoeCustomers defaultTab="sessions" /></Guard>} />
<Route path="/plans/pppoe"     element={<Guard perm="view_plans" roles={['admin','reseller']}><PppoePlans /></Guard>} />
```

`can()` in `lib/auth.tsx` **fails open** when `user.permissions` is absent, so the `roles` array is the only hard guard against sellers — every PPPoE route must carry it, never `perm` alone.

### Data fetching

Cache key **is** the URL, matching existing convention. Copy the render-time page-reset ref pattern from `Vouchers.tsx` (not a `useEffect`), or the first request after every filter change fires against a stale page. Search debounced 400 ms; selects apply immediately.

| Key | Notes |
|---|---|
| `` `pppoe/customers?page=${page}&${custKey}` `` | server-paginated |
| `` `pppoe/customers/summary?${custKey}` `` | stat tiles |
| `` `pppoe/sessions?page=${p}&${sessKey}` `` | `staleTime: 5000` + manual Refresh button — nothing in this codebase polls |
| `` `pppoe/customers/${id}/sessions?page=${p}` `` | detail modal history |
| `'plans?type=pppoe&active_only=1'` | shared by the customer form and the recharge modal |
| `'bandwidths'`, `'nas'` | **same keys as `HotspotPlans.tsx:24-25`** — free cache hits |

After a **recharge**: `refetch(); invalidateCache('pppoe'); invalidateCache('dashboard'); invalidateCache('wallet'); invalidateCache('transactions'); invalidateCache('accounts'); refresh()` — `refresh()` from `useAuth` re-reads `/me` so the sidebar wallet badge reflects the debit. `PppoePlans` save/delete should additionally `invalidateCache('pppoe')`, since plan name/price is denormalised into customer rows.

### UX detail

Suspension always beats the countdown. Status pill: `suspended` → `secondary`; no `expires_at` → `info` "Not activated"; past expiry → `danger`; ≤7 days → `warning` "{d}d left"; else `success`. Online is **orthogonal** to status (an active subscriber can be offline) so it's an inline pulsing dot beside the pill, not a pill.

Two small additions to `lib/format.ts` (not `ui.tsx`): `bsDate()` wrapping the existing `adToBs`/`formatBsString` from `nepaliDate.ts` (no page converts AD→BS today, but expiry dates must read in BS for Nepali operators), and `statusPill.suspended = 'warning'`. `daysLeft()`/`expiryTone()` stay local to the page — single consumer.

Empty states branch on the same `isFiltered` boolean, so a filtered-to-zero list never reads as "you have no customers". **Render `error` from `useQuery`** as a danger pill above the card — `HotspotPlans.tsx` silently swallows it; don't replicate that.

---

## Legacy behaviours explicitly not carried over

The reference document's §08 catalogue, and what we do instead:

| Legacy behaviour | Decision |
|---|---|
| `Expire-After` = `validity × 86400` ignoring `validity_unit` (a 24-hour plan lasts 24 *days*) | Not reproduced. `validity_days` is unambiguous; expiry is a real `expires_at` timestamp. |
| `expire_on_login` sqlcounter measuring from `MAX(acctstarttime)` — i.e. session age, not account age | Not reproduced. Expiry is a date the app owns. The dead `expire_on_login`/`total_volume`/`daily_quota` counters and the colliding `ATTRIBUTE Expire-After 16` dictionary line stay untouched but unused. |
| `Mikrotik-Rate-Limit` hardcoding the `M` suffix | Not reproduced — `bandwidths.rate_*_unit` already drives a unit-aware builder in `PlanController`/`BandwidthController`. |
| RADIUS rows never deleted; duplicates accumulate; last row wins | Not reproduced. Provisioning is delete-then-insert with a stated invariant. |
| `radusergroup`/`radgroupreply` name-string joins | Not reproduced — per-user rows only (see Architecture). |
| Deactivation flag with no auth effect | Fixed by design: `status` is read by the state machine on every auth. |
| Plaintext passwords | Unchanged — `Cleartext-Password` is a hard requirement for CHAP/MS-CHAPv2. Same as today's vouchers. |
| Hardcoded plan-name blocklists in unlang | Not reproduced. Per-subscriber `nas_ip` restriction covers the real need. |

---

## Sequencing

| Phase | Scope | Production impact |
|---|---|---|
| **0** | `sudo freeradius -CX` baseline; `cp sites-available/default sites-available/default.bak-YYYYMMDD` | none |
| **1** | Migrations, models, `PppoeRadiusService`, `PppoeCustomerService`, `PppoeRechargeService`, feature tests | **inert** — new tables, no route reaches them |
| **2** | Controllers, routes, permission seeds + `SystemPermission` fallbacks, `IntegrationTokenAbilities` | ⚠️ see R0 |
| **3** | `sites-available/default` + `docker/freeradius/sites-enabled/default` | ⚠️ the live-auth risk |
| **4** | `SyncPppoeStatus` + `routes/console.php` | none |
| **5** | `PlanController` changes, `AccountController` 4250 remap + commission union | reporting only |
| **6** | Frontend: `format.ts` → nav/routes → `PppoePlans` rewrite → `PppoeCustomers` → recharge modal → sessions tab | none |

**Phases 2 and 3 must ship together.** In the gap, `radcheck` rows exist for PPPoE subscribers and FreeRADIUS's plain `-sql` module will happily authenticate them **with zero lifecycle enforcement** — an expired subscriber gets online free. If they can't ship together, hold the `radcheck` write behind a config flag until Phase 3 lands.

### Phase 3 deployment procedure

1. Edit `/etc/freeradius/3.0/sites-available/default` (`sites-enabled/default` symlinks to it — this *is* production).
2. Hand-port both blocks into `/home/airlink_3.0/docker/freeradius/sites-enabled/default`.
3. `sudo freeradius -CX` → must end `Configuration appears to be OK`. **Do not proceed otherwise.**
4. `sudo systemctl restart freeradius` (a reload does not re-read virtual-server policy).
5. Run the `radtest` checklist below, **hotspot cases first**.
6. Rollback: restore the `.bak` and restart.

**Do not use `/etc/freeradius/3.0/.restart-trigger` for this change.** `freeradius-restart-watch.service` runs a bare `systemctl restart` with **no `-C` preflight**; a syntax error there means the daemon fails to start and every hotspot customer loses auth with no automatic recovery. That path is for `clients.conf`, which `ClientsConfService` generates mechanically.

### Risks

- **R0 — the Phase-2/3 gap.** Above.
- **R1 — a mis-typed `\` line continuation takes the whole file down.** The new SQL literal is 15+ continued lines. `freeradius -CX` catches it; nothing else does. Highest-consequence failure in the plan.
- **R2 — `Tmp-String-0` may be absent rather than empty.** Mitigated by testing both forms in the `if`.
- **R3 — Tmp-String collision.** `0/1/2` are in use; the new blocks use `3` and `4`. Reusing `2` would silently corrupt the daily-quota rollup.
- **R4 — username collision between a voucher code and a PPPoE username** silently routes the subscriber into the voucher state machine. `radcheck` has no unique key on `username`. Mitigate all three ways: the `unique` index on `pppoe_customers.username`; a `Voucher::where('username', $u)->exists()` check in `PppoeCustomerService`; and the reverse check in `VoucherService::uniqueCodes()` (`:196-215`).
- **R5 — `Simultaneous-Use` lockout after a NAS reboot** from stale open `radacct` rows. Already mitigated by the `nasreload` join in `queries.conf:236-242` and `delete_stale_sessions = yes`, but requires the MikroTik to actually send Accounting-On. Verify per-NAS during rollout.
- **R6 — one extra query per unknown username.** A typo or credential-stuffing probe now costs 3 queries instead of 2. It's a unique-index lookup, so cheap, but a probe flood costs 50% more DB.
- **R7 — the two RADIUS config files drifting.** `docker/freeradius/sites-enabled/default` is a *different file*, not a copy. Worth a `grep -c "pppoe_customers"` assertion in CI over both paths.

---

## Verification

### Automated (`cd backend && php artisan test`)

- **`PppoeCustomerTest.php`** — create → `status='pending'` and `assertDatabaseCount('radcheck', 0)` (the provisioning invariant); username uniqueness enforced **across `vouchers`**; reseller sees only own, admin sees all, scoped token narrows a reseller to `owner_id`; suspend → radcheck rows **still present** (the deliberate divergence) + `CoaService` mock called once; resume before/after expiry → `active`/`expired`; destroy removes both app and radius rows.
- **`PppoeRechargeTest.php`** — first recharge debits wallet, writes `wallet_transactions type='deduct'`, stamps `activated_at`/`expires_at`; **asserts exactly** one `Cleartext-Password`, one `Simultaneous-Use`, one `Mikrotik-Rate-Limit`, one `Acct-Interim-Interval`, and **zero** rows for `Framed-IP-Address`/`Framed-Pool`/`Session-Timeout`/`Mikrotik-Total-Limit` — the IP decision as an executable contract; renewal before expiry stacks, after expiry restarts; reseller recharge populates `admin_share`/`reseller_share` and increments `commission_due`; insufficient wallet → 422 with full rollback; seller → 403 on every route.
- **`PppoeSyncStatusTest.php`** — past-expiry active → `expired` + one CoA; radcheck rows survive the sweep.
- **Extend `BandwidthAndPlanTest.php`** — a `type=pppoe` plan forces `package_type='wallet'` even for a reseller; a reseller can then `PUT` their own PPPoE plan (the G.4 regression); seller `GET /api/plans` returns no `type=pppoe` rows; **and the latent-bug regression**: `PUT /api/plans/{hotspot}` omitting both `type` and `selling_price` still returns 200.
- **Extend `FinancialDashboardTest.php`** — `income_statement.pppoe_revenue` comes from `pppoe_recharges`, not `vouchers`; a hotspot voucher on a mis-typed `type=pppoe` plan no longer inflates 4250.

### Manual — unlang is not testable from PHPUnit

Record the results in the PR description. After Phase 3, with `sudo freeradius -X` capturing:

```bash
radtest <voucher-code>  <voucher-code>  127.0.0.1 0 <secret>   # expect Accept  (regression: hotspot unchanged)
radtest <expired-code>  <expired-code>  127.0.0.1 0 <secret>   # expect Reject + existing voucher message
radtest <pppoe-user>    <pppoe-pass>    127.0.0.1 0 <secret>   # expect Accept + Mikrotik-Rate-Limit + Acct-Interim-Interval
radtest <expired-sub>   <pass>          127.0.0.1 0 <secret>   # expect Reject + "Your subscription has expired…"
radtest <suspended-sub> <pass>          127.0.0.1 0 <secret>   # expect Reject + "Your connection is suspended…"
radtest <pending-sub>   <pass>          127.0.0.1 0 <secret>   # expect Reject + "…not activated yet…"
radtest nosuchuser      x               127.0.0.1 0 <secret>   # expect Reject, no Reply-Message (fall-through unchanged)
```

Then one real MikroTik PPPoE dial-up captured under `radiusd -X`, confirming: Access-Accept carries `Mikrotik-Rate-Limit`, the router assigns an IP from its own pool, `radacct` gets a Start with `framedprotocol='PPP'`/`servicetype='Framed-User'`, an Interim-Update lands within ~5 minutes with non-zero octets, and Stop closes the row. Then suspend the subscriber in the UI and confirm the session drops within seconds via CoA.

### End-to-end in the app

Log in as **admin**: create a PPPoE plan → create a subscriber (verify it lands `pending` with no radcheck rows) → recharge (verify wallet debit, `expires_at`, radius rows, and the invoice/ledger entry) → dial up → see the session on the Active Sessions tab → suspend → verify disconnect → resume → recharge early and confirm days stack.
Log in as **reseller**: confirm they see only their own subscribers, their wallet is debited, and admin's commission accrues.
Log in as **seller**: confirm no PPPoE nav item, and that typing `/pppoe/customers` and `/plans/pppoe` both give Access Denied.

Finally `cd frontend && npm run build` and commit the `dist/` diff — `frontend/dist/` is committed to this repo and rebuilt in feature commits.
