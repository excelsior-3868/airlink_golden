# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Admin** — the ISP's own back-office staff. Owns the master Wallet (Rs) and GB stock, allocates GB to resellers on credit, sets commission rates, and can generate/sell vouchers directly.
- **Reseller** — a sub-distributor under Admin. Buys GB stock from Admin (on credit, tracked as `wallet_due`), allocates GB to the sellers under them, sells GB/Wallet vouchers directly, and owes Admin commission on sales.
- **Seller** — the front-line staff/shop under a Reseller. Generates and sells vouchers to end customers using the GB/wallet stock allocated to them; has no wallet balance of their own.
- **Customer (end user)** — buys a voucher from a Seller/Reseller and authenticates through a MikroTik hotspot/PPPoE captive portal (FreeRADIUS). Never touches this web app directly.

One ISP company runs this internally — Admin plus its own network of resellers/sellers it manages. Not multi-tenant SaaS; there is exactly one ISP's hierarchy per deployment.

## Product Purpose

A multi-level billing and voucher-distribution platform for an ISP's hotspot/PPPoE business, replacing/succeeding a legacy v2.0 FreeRADIUS + MikroTik admin panel (real customer and voucher history migrated in via `legacy:import`). It lets the ISP push GB stock down a distribution hierarchy (Admin → Reseller → Seller) and turn that stock into sellable vouchers, while tracking who owes what to whom at every level. Success = accurate stock/due/commission balances at each level, and a customer's voucher working at the RADIUS/MikroTik layer the moment it's sold.

## Positioning

The dual-balance credit model: **Wallet (Rs)** and **GB quota** are two parallel balances that both move together when a voucher is generated — a voucher simultaneously consumes GB stock and creates/settles a Rs obligation. Resellers/sellers acquire GB from their parent on credit (`wallet_due`), not by prepaying a flat per-voucher price, and commission is computed and settled on top of that same flow. This dual-ledger-on-credit structure, not just "sell hotspot vouchers," is the mechanism the rest of the product (dashboards, invoices, ledger, commission settlement) is built around.

## Operating Context

- Runs fully in Docker: `mariadb` (app schema `airlink` + read-only legacy schema `airlink_legacy`), `backend` (Laravel API), `queue`, `scheduler` (voucher-expiry sweep), `frontend` (Vite SPA), `freeradius`, `phpmyadmin`. A separate `docker-compose.prod.yml` profile bakes code into images (nginx + php-fpm) instead of bind-mounting it.
- Voucher auth path is unchanged from legacy v2.0: Customer → MikroTik captive portal → FreeRADIUS (`radcheck`/`radreply`/`radacct` in the shared MariaDB) → Access-Accept/Reject. A voucher's `code` is simultaneously its RADIUS username and password.
- Roles are gated by a granular, admin-configurable permission table (`SystemPermission`: feature × role → allowed), not just a hardcoded role check — sidebar and route access both follow it.
- Terminology: "GB Package"/"GB voucher" (data quota, deducts from GB balance) vs. "Wallet Package"/"Wallet voucher" (time/unlimited packs, deducts from Wallet balance) are the two voucher families threaded through dashboards, stats, and reports.
- A voucher's lifecycle is `new → sold → active → expired/disabled`, with `used` also possible; `sold_at`/`activated_at` (not just current `status`) are what most revenue/"genuinely sold" figures gate on, since a batch can be generated as stock (`active`) long before an individual voucher is actually sold to a customer.

## Capabilities and Constraints

- Wallet/GB allocation between hierarchy levels, with live `wallet_due` (owed for GB bought on credit) and `commission_due` (owed to the parent on sales) balances, settled via a payments/collection flow with recorded payment methods.
- Voucher generation in batches (batch code, plan, quantity), per-voucher lifecycle tracking, and voucher card/print templates.
- Reporting: per-role dashboards (stat cards, daily sales trend, vouchers-sold trend, top resellers/sellers), a separate Financial Dashboard, Accounting & Ledger, and a Chart of Accounts.
- Plan management: Hotspot, PPPoE, and Bandwidth plan types, admin-authored.
- API tokens (scoped) for programmatic access; login audit log.
- Open/undecided: no confirmed accessibility standard has been established for this app yet (see Accessibility section below).

## Evidence on Hand

- `README.md` and `IMPLEMENTATION_PLAN.md` describe the architecture and migration in detail — treat as authoritative product history, not to be contradicted.
- Real legacy data was migrated in (`backend/storage/app/legacy-import-report.json`, `legacy:import` artisan command) — this is a live production system with real ISP customers/resellers/sellers, not a demo/sample dataset. Do not invent sample customers, testimonials, or benchmark numbers; use real data already in the system (or clearly-labeled placeholders) when a screen needs example content.
- No design references, brand guidelines, or marketing copy on hand beyond the "Airlink" wordmark/icon already in the app shell and `frontend/public/icons/`.

## Product Principles

1. **The two balances move together.** Wallet and GB are never treated as independent — any UI or report that surfaces one should make it easy to see its paired counterpart and what's owed as a result.
2. **Show who owes whom, at every level.** Due/receivable/commission figures are core content, not secondary detail — the hierarchy only works if each level can see its own position at a glance.
3. **A voucher's real state beats its nominal status.** "Sold" means a customer actually has it (`sold_at`/`activated_at`), not merely generated; figures and charts should reflect that distinction rather than raw `status` counts.
4. **Preserve legacy continuity.** This succeeds a real v2.0 system with real migrated history — treat existing data, terminology, and voucher/RADIUS behavior as constraints to preserve, not defaults to redesign away.
5. **Role hierarchy is structural, not cosmetic.** Admin/Reseller/Seller differ in what they can see and do by design (permission-gated); scoping a figure to "my own" vs. "my downline" is a product decision, not an oversight, and should default to matching the equivalent figure at neighboring levels.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established yet (no ARIA usage found in the current UI component library). Treat as an open gap rather than an assumed standard until the user confirms one.
