# Security Audit Report

**Scope:** `/home/airlink_golden` (Laravel backend, React frontend, docker configs). The newest code (uncommitted change-package feature) was reviewed in most depth.
**Date:** 2026-10-20

**Not run:** `npm audit` and `composer audit`. Neither `npm` nor `composer` is installed on this host, so there are **no dependency CVE results**. Run both in CI or in the containers (`frontend/package-lock.json`, `backend/composer.lock`).

---

## CRITICAL

### C1. Unbounded negative `custom_price` mints wallet credit
- **Location:** `backend/app/Http/Controllers/Api/PppoeCustomerController.php` (`changePackage`, validation `'custom_price' => ['nullable','numeric']`); `backend/app/Services/PppoeRechargeService.php` (`previewPackageChange`, `replace_period` and `custom` branches; `changePackage` refund branch); `backend/app/Services/WalletService.php` (`refundPackageAdjustment`).
- **Risk:** A reseller can POST `custom_price=-1000000`. It becomes a "refund" and `refundPackageAdjustment` credits that amount to the reseller's own wallet (or the actor's if there is no reseller). This is direct theft of funds, with no check that anything was paid.
- **Remediation:** Compute refunds server-side only, from recorded payments, capped at the amount actually paid for the current period. Accept `custom_price` and `custom` mode only from admins, and validate `min:0` for everyone else:
  ```php
  'custom_price' => ['nullable','numeric','min:0','max:1000000'],
  // in changePackage(): if (($data['mode'] === 'custom' || isset($data['custom_price'])) && $actor->role !== 'admin') abort(403);
  ```

---

## HIGH

### H1. Payment and expiry bypass for non-admins
- **Location:** `PppoeRechargeService::changePackage` (`no_wallet` mode, `payment_method=cash`, `custom_expires_at`); `PppoeCustomerController::changePackage` validation (`custom_expires_at` => `date`, no bounds).
- **Risk:**
  - `no_wallet` changes the plan and activates the account with zero charge.
  - `cash` skips the wallet debit, but the admin share is still credited and `commission_due` incremented, so the books show money that was never collected.
  - `custom_expires_at` lets any caller with the permission set an arbitrary expiry, so subscriptions can be extended indefinitely for free.
- **Remediation:** Restrict `no_wallet`, `cash` and `custom_expires_at` to admins. Cap `custom_expires_at` to `now()+plan validity`. Never credit the admin share unless a real debit or due-post happened.

### H2. Race conditions (TOCTOU) in money movement
- **Location:** `PppoeRechargeService::changePackage`. The preview, `$netAmount` and the balance check run before `DB::transaction`. The customer lock is taken afterwards, and the preview isn't recomputed.
- **Risk:** Parallel requests all pass the balance check on stale data. This allows overspending the wallet or issuing a refund more than once for the same change.
- **Remediation:** Open the transaction first. Lock the customer and the paying user (`lockForUpdate`). Recompute the preview inside the transaction. `WalletService::deduct` must verify the balance after locking and fail if insufficient.

### H3. Refund baseline corrupted by storing the adjustment diff as `price`
- **Location:** `PppoeRechargeService::changePackage` (`'price' => $netAmount`) and `previewPackageChange` (`$oldPrice = $lastRecharge->price`).
- **Risk:** After one adjustment, the "last recharge price" is the diff (possibly negative), not the plan price. Subsequent changes compute wrong charges and refunds. Repeating A→B→A can be abused to extract refunds.
- **Remediation:** Store the full plan price in `price` and the adjustment in a separate column. Derive the baseline from the last real recharge or payment.

### H4. Production database dump and RADIUS secret committed to git
- **Location:** `nalrd_backup.sql` (9 MB, tracked) and `backend/clients.conf` (tracked, contains a shared `secret`). Both are mounted or used by `docker-compose.yml`. The dump includes `tbl_users`, `tbl_customers`, `radcheck` (plaintext RADIUS passwords are typical) and transactions.
- **Risk:** Anyone with repo access, or any leaked clone, gets customer PII, credentials and the RADIUS secret. The data also stays in git history after removal.
- **Remediation:** `git rm --cached nalrd_backup.sql backend/clients.conf`, add them to `.gitignore`, and rotate the RADIUS shared secret and any credentials found in the dump. Purge history (`git filter-repo`) if the repo is shared. Generate `clients.conf` from the `.seed` file at deploy time.

---

## MEDIUM

### M1. No rate limiting on login (brute force)
- **Location:** `backend/routes/api.php:35` (`/login`); `AuthController::login` (lines ~46–90). Grep finds no `throttle` or `RateLimiter` anywhere in routes or app code.
- **Risk:** Unlimited password guessing. reCAPTCHA is skipped entirely when the keys are unset (`recaptchaPasses` returns `true`), which is the default in `.env.example`.
- **Remediation:** `->middleware('throttle:5,1')` on `/login`, plus a per-username limiter. Fail closed in production if reCAPTCHA is not configured.

### M2. Weak password policy
- **Location:** `AuthController.php:107` (`'min:6'`).
- **Remediation:** `Password::min(10)->letters()->numbers()`. Reject common passwords.

### M3. API tokens never expire, with no revocation on password change
- **Location:** `backend/config/sanctum.php:53` (`'expiration' => null`); `AuthController.php:83` (`createToken('portal')` with default `*` abilities); `changePassword` doesn't delete other tokens.
- **Risk:** A stolen token works forever and survives a password change.
- **Remediation:** Set an expiration (e.g. 480 minutes), give portal tokens a scoped expiry, and call `$user->tokens()->where('id','!=',$current)->delete()` in `changePassword`.

### M4. Wide-open CORS
- **Location:** `backend/config/cors.php:7` (`'allowed_origins' => ['*']`, `allowed_headers ['*']`).
- **Risk:** Tokens are sent in `Authorization` headers rather than cookies, so impact is limited. It still lets any website call the API with a stolen token and eases phishing.
- **Remediation:** Restrict to the real frontend origin(s) via env.

### M5. Mass-assignment surface: `$guarded = []` on money and auth models
- **Location:** `PppoeCustomer`, `PppoeRecharge`, `Voucher`, `WalletTransaction`, `Payment`, `NasDevice`, `InternetPlan` and others (`backend/app/Models/*`).
- **Risk:** Any future `Model::create($request->all())` becomes privilege or price tampering. `PppoeCustomerService::update` already uses an allowlist, which is good.
- **Remediation:** Switch to explicit `$fillable`.

### M6. Change-package authorization gaps
- **Location:** `backend/routes/api.php:177–178`; `PppoeCustomerController::previewChangePackage` and `changePackage`.
- **Risk:**
  - `plan_id` accepts any plan, with no check that the reseller is allowed to sell it.
  - The preview route has no token-ability check, unlike `changePackage`.
  - The route permission is an OR gate (see `CheckPermission`), so holding either `create_pppoe_customer` or `recharge_pppoe_customer` is enough.
  - Preview accepts inactive plans, leaking their details.
- **Remediation:** Scope plans by role and owner, require the specific permission inside the controller as `PlanController::update` does, and filter `exists:internet_plans,id` to `status=active` and `type=pppoe`.

### M7. `clawbackCommission` and `postToDue` accounting
- **Location:** `WalletService.php` (`clawbackCommission` decrements with no floor; `postToDue` increments `wallet_due` while the rest of the feature uses `commission_due`).
- **Risk:** The admin wallet can go negative. Due charges are recorded in a field nothing reads.
- **Remediation:** Enforce a non-negative balance, or intentionally allow and track a negative balance. Use one consistent due field.

---

## LOW

### L1. World-readable code and secrets in the container
- **Location:** `docker/backend/prod-entrypoint.sh` (new `chmod -R a+rX /var/www/html`).
- **Risk:** Makes `.env` readable by every process and user in the container.
- **Remediation:** Exclude `.env` (`chmod 640 .env && chgrp www-data .env`).

### L2. Default and fallback DB credentials
- **Location:** `docker-compose.yml:12–15` (`root_secret`, `airlink_pass` defaults). MariaDB and phpMyAdmin are bound to 127.0.0.1, which is good.
- **Remediation:** Fail startup if the env vars are unset.

### L3. Backend and frontend dev ports are published on all interfaces
- **Location:** `docker-compose.yml` backend `${BACKEND_PORT:-8000}:8000`, frontend `5174:5173`, RADIUS UDP ports.
- **Remediation:** Bind to 127.0.0.1 or firewall them behind the reverse proxy. The RADIUS ports should be restricted to NAS IPs.

### L4. Branding endpoint
- **Location:** `routes/api.php:202` (any authenticated user can POST) and `BrandingSettingController.php` (`'logo_url' => 'nullable|string'`, no format check).
- **Risk:** `logo_url` is stored unvalidated, so a `javascript:` or external URL could be rendered. `logo_file` is correctly restricted to `image|max:5120`.
- **Remediation:** Validate `logo_url` as a relative `/storage/...` path or `url` with an `https` scheme. Consider limiting the route to admin and reseller roles.

### L5. Stray secrets-bearing artifacts in the project root
- `client1791299959.ovpn` is gitignored, which is good, but it sits next to tracked helper scripts. Confirm it isn't baked into any image.

---

## Areas reviewed with no issue found
- **SQL injection:** all `whereRaw` / `selectRaw` calls found use bound parameters or constants (`VoucherController`, `ReportController`, `RadiusController`, `DashboardController`). `AccountController` uses `sprintf($dateExpr, …)` with a server-side `$dateExpr`; confirm that value never comes from user input.
- **Command injection / unserialize / eval:** none found.
- **File upload:** only the logo upload, restricted to images up to 5 MB and stored under `storage/app/public`.
- **Password hashing:** Laravel `Hash::make` (bcrypt/argon). PPPoE customer passwords are stored in plaintext by design, because RADIUS needs them.
- **Unauthenticated routes:** only login, reCAPTCHA config and branding read.
