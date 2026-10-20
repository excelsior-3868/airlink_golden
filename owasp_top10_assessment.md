# OWASP Top 10 (2021) Assessment

**Scope:** Laravel backend, React frontend, Go NMS backend, docker configs. Static review only. Dependency CVE scans could not run (`npm` and `composer` are not installed on this host).
**Updated after remediation.** Status key: FIXED = fixed in this session. OPEN = not fixed. OK = no issue found.

| # | Category | Rating | Summary |
|---|---|---|---|
| A01 | Broken Access Control | Medium | Custom pricing, free changes and cash settlement were open to non-admin roles (FIXED). Plan scoping per reseller and the OR-style permission gate are OPEN. |
| A02 | Cryptographic Failures | Medium | NMS default signing key removed (FIXED); OLT key now pinned in `NMS_SECRET_KEY` (still a copy of `APP_KEY`). Prod dump and RADIUS secret untracked but still in git history. |
| A03 | Injection | Low | Raw SQL uses bindings. No command injection found. |
| A04 | Insecure Design | Medium | Refund logic could mint money (FIXED). Race conditions (FIXED). Refund baseline (FIXED). No rate limits or business-logic limits elsewhere. |
| A05 | Security Misconfiguration | Medium | CORS `*`, `APP_DEBUG=true` in the example env, ports on all interfaces. Security headers added (CSP still report-only); `.env` permission fixed. |
| A06 | Vulnerable and Outdated Components | Unknown | Not scanned. Versions look current (Laravel 13, React 18, Vite 5). |
| A07 | Identification and Authentication Failures | Medium | Login throttling, 10-character passwords and 12-hour portal tokens are FIXED. reCAPTCHA still fails open when unconfigured. |
| A08 | Software and Data Integrity Failures | Low | No unsafe deserialization. Hot-patching with `docker cp` has no integrity check. |
| A09 | Security Logging and Monitoring Failures | Medium | Login attempts are logged. Money movements keep wallet transactions. No alerting, and no audit entry for who used admin-only overrides. |
| A10 | Server-Side Request Forgery | Low | Only outbound call is reCAPTCHA to a fixed URL. No user-supplied URLs fetched. |

---

## A01 Broken Access Control
- **FIXED** `PppoeCustomerController::changePackage` and `previewChangePackage`: `custom` and `no_wallet` modes, `custom_price`, `custom_expires_at` and `cash` settlement are now admin-only; the target plan must be active PPPoE. Ownership is enforced through `canAccess`.
- **OPEN** (partly addressed: the target plan must be an active PPPoE plan) `routes/api.php:177-178`: `permission:create_pppoe_customer,recharge_pppoe_customer` is an OR gate, and the controller does not re-assert the specific permission. Resellers can pick any active plan, not just ones they may sell.
- **OPEN** `routes/api.php:202`: `POST /settings/branding` is open to every authenticated user. `logo_url` is not validated.
- **Fix:** Re-assert the exact permission in the controller, scope plans per role/owner, restrict branding writes.

## A02 Cryptographic Failures
- **FIXED** (was High) `docker-compose.yml:74`: `JWT_SECRET: "${APP_KEY:-airlink-nms-secret-key-0123456789}"`. If `APP_KEY` is unset in the NMS environment, anyone can forge an NMS admin JWT. Because `nms-backend/internal/config/config.go:62` also uses this secret as the key that encrypts OLT passwords (`SecretKey = JWTSecret`), the same value decrypts every stored OLT credential. **Fix:** Remove the default so the service refuses to start without a secret. Use a separate `NMS_SECRET_KEY` from the JWT secret.
- **PARTIAL** `nalrd_backup.sql` and `backend/clients.conf` were committed (now untracked, history not purged). Rotate the RADIUS secret.
- **By design** PPPoE subscriber passwords are plaintext because RADIUS (PAP/CHAP) needs them. Restrict who can read them and never return them in list endpoints.
- **OK** User passwords use `Hash::make` / `Hash::check`.
- **FIXED** The built-in NMS users (`admin/admin123`, `operator/operator123`) are removed; direct NMS login is disabled unless `NMS_USERS` is set. (If it is set, those passwords are still plaintext in the environment.) NMS user passwords come from config and were compared in plaintext (`api.go` login). Hash them.
- **OPEN** Frontend token in `localStorage` (`frontend/src/lib/api.ts:30`, `auth.tsx:65`): any XSS steals a session that never expires. No XSS sink was found (no `dangerouslySetInnerHTML`), which limits current exposure.

## A03 Injection
- All `whereRaw`, `selectRaw` and `DB::raw` calls found use bound parameters or server-side constants. Confirm `$dateExpr` in `AccountController` is never user-controlled.
- No `unserialize`, `eval`, `shell_exec`. The Go NMS runs `exec.CommandContext` in `vpn.go:98` with a binary and argument list (no shell); confirm the arguments never include user input.
- React escapes output, so the free-text `note` field is safe.

## A04 Insecure Design
- **FIXED** Negative `custom_price` created unlimited wallet credit.
- **FIXED** Preview and balance check ran outside the transaction (race conditions); everything is now computed after locking the customer and wallets.
- **FIXED** Refund baseline used the last row's signed price; it is now the net paid for the current period.
- **OPEN** No per-user limits on how much can be refunded in a day, and no approval step for large adjustments. Consider both for admin overrides.

## A05 Security Misconfiguration
- **OPEN** `backend/config/cors.php:7`: `allowed_origins ['*']`.
- **OPEN** `backend/.env.example:4`: `APP_DEBUG=true`, `APP_ENV=local`. Make sure production sets `APP_DEBUG=false` (stack traces leak paths and queries).
- **FIXED (CSP report-only)** Security headers added in `docker/web/nginx.conf`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy-Report-Only`. Deployed to the golden web container only; annapurna and mera need a rebuild. **Still open:** switch the CSP to enforcing once the browser console shows no violations, and add HSTS once the site is served over HTTPS.
- **OPEN** `docker-compose.yml`: backend 8000, frontend 5174, NMS 8085 and RADIUS ports are published on all interfaces; DB and phpMyAdmin are correctly bound to 127.0.0.1. Default DB passwords (`root_secret`, `airlink_pass`).
- **FIXED** `docker/backend/prod-entrypoint.sh` now sets `.env` to 640 root:www-data (untested in a container). Previously: `chmod -R a+rX /var/www/html` makes `.env` world-readable.

## A06 Vulnerable and Outdated Components
- Not assessed. Run `npm audit --omit=dev` in `frontend/`, `composer audit` in `backend/`, and `govulncheck ./...` in `nms-backend/` (inside the build containers or CI). Add them to CI so this is checked on every change.

## A07 Identification and Authentication Failures
- **FIXED** No `throttle` on `/login` (`routes/api.php:35`) or on NMS login. Password guessing is unlimited.
- **FIXED** `AuthController.php:107`: minimum password length 6.
- **FIXED** `config/sanctum.php:53`: `'expiration' => null`; `changePassword` does not revoke other tokens. Tokens issued by `createToken('portal')` carry all abilities.
- **OPEN** `AuthController::recaptchaPasses` returns true when the keys are unset, so the captcha is silently off by default.
- **OK** Generic login error messages; disabled accounts blocked; NMS JWT enforces `HS256` and expiry (12 hours).

## A08 Software and Data Integrity Failures
- No unsafe deserialization or unsigned update mechanism found in the backend.
- `deploy-backend-files.sh` copies files straight into containers without a checksum or a build step. Prefer building images in CI.
- The PWA service worker (`vite-plugin-pwa`) caches assets; make sure the update check keeps working so a bad build can be replaced quickly.

## A09 Security Logging and Monitoring Failures
- Logged: login success/failure with IP and user agent (`LoginLog`), wallet transactions, NMS audit endpoint.
- **OPEN** Nothing records *who* used an admin-only override (custom price, free change) beyond `collected_by` on the recharge row. Add an audit record with the reason.
- **OPEN** No alerting on repeated failed logins, large refunds or negative wallet balances.

## A10 Server-Side Request Forgery
- The only outbound HTTP call is reCAPTCHA verification to a fixed Google URL (`AuthController.php`). `file_get_contents` calls read local paths (`RadiusController.php:1134`, `VoucherCardService.php:60`); confirm those paths are not built from request input.

---

## Priority fixes (remaining)
1. Rotate the RADIUS secret and purge the dump and `clients.conf` from git history (A02).
2. Restrict CORS, set `APP_DEBUG=false` in production, bind ports, enforce the CSP (now report-only) and add HSTS behind HTTPS (A05).
3. Per-reseller plan scoping and re-checking the exact permission in the controller; restrict branding writes (A01).
4. Revoke a user's sessions when an admin resets their password; fail closed if reCAPTCHA is unconfigured (A07).
5. Give the NMS its own random `NMS_SECRET_KEY` and re-save OLT passwords (A02).
6. Run `npm audit`, `composer audit` and `govulncheck` in CI (A06).
7. Audit trail and alerting for admin overrides and large refunds (A09).

Fixed so far: change-package access control, money race conditions and refund baseline (A01/A04); NMS secret and default users (A02); login throttling, password policy and token expiry (A07).
