# Airlink FreeRADIUS Billing System v3.0

Multi-level ISP distribution platform (**Admin → Reseller → Seller → Customer**) with dual
balances — **Wallet (Rs)** and **GB quota** — that both deduct on voucher generation.
Built on the legacy v2.0 FreeRADIUS + MikroTik hotspot model, with the old data migrated in.

- **Backend**: Laravel 13 (PHP 8.3) REST API, Sanctum token auth
- **Frontend**: React + Vite + TypeScript, Tailwind, Framer Motion (NT-blue glass UI)
- **Database**: MariaDB 11 — app tables + FreeRADIUS `radcheck`/`radreply`/`radacct`/`nas`
- **Auth path**: FreeRADIUS 3.2 (PAP over SQL) — MikroTik NAS → RADIUS → MariaDB
- Everything runs in **Docker Desktop**.

## Quick start

```bash
cp .env.example .env          # first time only
docker compose up -d --build
```

On first boot MariaDB loads `nalrd_backup.sql` into `airlink_legacy`, the backend runs
migrations + seeds the admin, and the frontend installs deps. Then migrate the legacy data:

```bash
docker compose exec backend php artisan legacy:import          # add --dry-run to preview
```

## URLs & credentials

| Service | URL | Login |
|---|---|---|
| Frontend (SPA) | http://localhost:5173 | `admin` / `admin@123` |
| Backend API | http://localhost:8000/api | Sanctum bearer token |
| phpMyAdmin | http://localhost:8080 | `airlink` / `airlink_pass` |
| FreeRADIUS | `localhost:1812/1813` (udp) | client secret `testing123` |

> Imported staff (resellers/sellers) get a temporary password `ChangeMe123!` and a
> `must_reset_password` flag — see `backend/storage/app/legacy-import-report.json`.

## Services (docker compose)

`mariadb` · `backend` (API) · `queue` (jobs) · `scheduler` (voucher expiry) ·
`frontend` (Vite) · `freeradius` · `phpmyadmin`.

Two DB schemas: **`airlink`** (clean v3.0, the app) and **`airlink_legacy`** (read-only v2.0 dump).

## Verify the RADIUS path

```bash
# Any imported/generated voucher: code == username == password
docker compose exec freeradius radtest <CODE> <CODE> localhost 0 testing123   # → Access-Accept
```

## Key commands

```bash
docker compose exec backend php artisan legacy:import [--dry-run]   # ETL
docker compose exec backend php artisan vouchers:sync-status        # lifecycle (also scheduled /5min)
docker compose exec backend php artisan migrate --force
```

## Production profile

Optimized build — code baked into images, `--no-dev` deps, cached config/routes,
SPA served by nginx which proxies `/api` to php-fpm. Own DB volume + internal-only
DB/RADIUS, so it can run alongside dev.

```bash
docker compose -f docker-compose.mera.yml up -d --build
# → SPA + API on http://localhost:8090   (login admin / admin123)
```

Services: `mariadb` · `app` (php-fpm) · `web` (nginx: SPA + /api) · `queue` · `scheduler` · `freeradius`.

## Tests

```bash
docker compose exec backend php artisan test        # 17 feature tests (auth, RBAC, wallet, GB, voucher gen)
```

See `IMPLEMENTATION_PLAN.md` for the full architecture, DB-bridge design, and ETL mapping.
