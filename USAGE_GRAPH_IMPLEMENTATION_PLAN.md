# Usage Graph — Implementation Plan (and Port Guide to Another Tenant/VPS)

How the **Usage: `<CODE>`** modal on the Vouchers page is built, and the exact
steps to reproduce it on a second tenant running on a different VPS.

---

## 1. What the feature is

A modal opened from the Vouchers table row menu (**Usage Graph**) that shows a
single voucher's RADIUS accounting history:

| Region | Content | Source |
| :-- | :-- | :-- |
| 4 stat tiles | Used / Remaining / Sessions + online time / Expires + status | `totals` + `voucher` |
| Chart 1 | Cumulative data consumed (step area) with a dashed quota `ReferenceLine` | `sessions[].cumulative_gb` |
| Chart 2 | Per-day stacked bars, download vs upload, optional daily-cap line | `daily[]` |
| Detail table | Toggle between per-session and per-day rows | `sessions[]` / `daily[]` |
| Amber banner | "open session the NAS hasn't reported yet" | `live_session_not_yet_counted` |

There is **no new table and no new writes** — everything is derived read-only
from FreeRADIUS's `radacct`.

---

## 2. Moving parts (files to copy)

| Layer | File | Role |
| :-- | :-- | :-- |
| Route | [backend/routes/api.php:134](backend/routes/api.php#L134) | `GET /vouchers/{voucher}/usage` |
| Controller | [VoucherController.php:221-327](backend/app/Http/Controllers/Api/VoucherController.php#L221-L327) | `usage()` — the whole aggregation |
| Access | [VoucherController.php:698-712](backend/app/Http/Controllers/Api/VoucherController.php#L698-L712) | `canAccess()` admin/reseller/seller scoping |
| Index | [2026_08_09_150000_add_radacct_usage_covering_index.php](backend/database/migrations/2026_08_09_150000_add_radacct_usage_covering_index.php) | `(username, acctstarttime, acctinputoctets, acctoutputoctets)` |
| Schema | [2026_07_11_000008_create_freeradius_tables.php](backend/database/migrations/2026_07_11_000008_create_freeradius_tables.php) | `radacct` itself |
| UI | [VoucherUsageModal.tsx](frontend/src/components/VoucherUsageModal.tsx) (388 lines) | the entire modal — self-contained |
| Wiring | [Vouchers.tsx:16](frontend/src/pages/Vouchers.tsx#L16), [:119](frontend/src/pages/Vouchers.tsx#L119), [:546-557](frontend/src/pages/Vouchers.tsx#L546-L557), [:674](frontend/src/pages/Vouchers.tsx#L674) | import, state, menu item, mount |
| Helpers | [format.ts](frontend/src/lib/format.ts) (`gb`, `datet`, `parseDate`, `TZ`), [ui.tsx](frontend/src/components/ui.tsx) (`Modal`, `Spinner`, `EmptyState`, `Pill`) | shared |
| Deps | `recharts ^3.9.2`, `lucide-react ^0.441.0` | [frontend/package.json](frontend/package.json) |

---

## 3. Backend design decisions (keep these — they are load-bearing)

1. **Recycled-username cut-off.** Rows are filtered to
   `acctstarttime >= voucher.created_at`. A reused hotspot username carries the
   previous holder's accounting rows; without this the graph overstates usage
   and disagrees with `vouchers:sync-status`, which applies the same cut-off.
   *If the target tenant computes quota differently, the cut-off here must be
   changed to match it — the two must never diverge.*
2. **Cumulative is computed in PHP**, not SQL — a running `$cumulative` over
   `orderBy(acctstarttime, radacctid)`. Simpler than a window function and
   works on any MariaDB version.
3. **Bytes → GiB uses `1073741824`**, matching FreeRADIUS's own quota checks in
   `sites-enabled/default`. Do not switch to 1e9.
4. **Daily grouping is by `substr(acctstarttime, 0, 10)`.** A session spanning
   midnight lands wholly on its start date — the NAS reports one figure for the
   whole session, so any split would be invented.
5. **`live_session_not_yet_counted`** = an open session with both octet counters
   still at 0, i.e. no Interim-Update yet. Drives the amber banner so a live
   customer doesn't look like a flat line.
6. **Ability + ownership gates**: `tokenCan('vouchers.read')` then `canAccess()`
   — resellers/sellers only see their own cards, and a failure returns 404, not
   403, so the endpoint can't be used to enumerate voucher IDs.

### Response contract
```jsonc
{
  "voucher": { "code","username","status","plan","data_gb","daily_data_gb","activated_at","expires_at" },
  "totals":  { "used_gb","cap_gb","remaining_gb","percent_used","session_count","total_seconds" },
  "sessions":[{ "id","start","stop","seconds","upload_gb","download_gb","total_gb",
                "cumulative_gb","nas_ip","ip_address","mac_address","terminate_cause","is_open" }],
  "daily":   [{ "date","upload_gb","download_gb","total_gb","sessions" }],
  "live_session_not_yet_counted": false
}
```

---

## 4. Frontend design decisions

1. **`type="stepAfter"`, not a sloping line.** A session's cumulative total is
   only *known* at the Stop packet, so each point sits at `stop || start`.
   Interpolating between stops would claim a consumption rate the accounting
   data doesn't carry.
2. **Leading zero anchor** at `activated_at` (falling back to the first session
   start), otherwise the first session appears to begin already part-consumed.
3. **Numeric time X axis** (`type="number" scale="time"`) with a domain padded
   4% each side (min 15 min), so first/last steps aren't drawn on the frame.
4. **Tick format switches on span**: `> 7d` → date only; `> 12h` → date + time;
   else clock only. A 24-hour card straddles midnight, where bare clock times
   read as going backwards.
5. **Y domain `[0, peak * 1.12]`** where `peak = max(cap, …cumulative)` — the
   cap line must never sit on the frame.
6. **Timezone.** Raw `DB::table()` selects return bare `"2026-08-07 09:58:15"`.
   `parseDate()` tags those as UTC before formatting, and output is pinned to
   `Asia/Kathmandu`. This only holds if the DB stores UTC.
7. **Colour roles** (checked for colourblind separation, not eyeballed):
   `USAGE #00579f`, `CAP #b45309` (only dashed stroke in the chart — grid stays
   solid so it doesn't compete), `DOWNLOAD #f43f5e` / `UPLOAD #a855f7` (the
   dashboard's existing categorical pair). Stacked bars use a 2px surface-white
   stroke, which reads as a gap rather than a border.
8. **Menu item is hidden** when `status === 'ready' && !activated_at` — a card
   still in stock has nothing to plot — and the whole menu is behind
   `can('generate_voucher')`.

---

## 5. Porting to the second tenant on another VPS

The feature is tenant-agnostic: it reads `radacct` on the tenant's own DB
connection and needs no new config. Steps, in order:

### Phase 1 — Prerequisites (verify before copying anything)
- [ ] Target tenant already has the `radacct` table populated by its own
      FreeRADIUS container (per `MULTITENANT_FREERADIUS_SETUP.md`; Mera uses
      ports 1814/1815 → DB `airlink_mera`).
- [ ] `vouchers` table has `data_gb`, `daily_data_gb`, `activated_at`,
      `expires_at`, `username`, `created_at`, and a `plan` relation.
- [ ] `vouchers.read` ability exists on issued API tokens.
- [ ] MariaDB container runs **UTC** (`TZ=UTC`) — otherwise item 4.6 above
      breaks and every timestamp shifts by 5h45m.

### Phase 2 — Backend
1. Copy the `usage()` method into the target's `VoucherController`; confirm
   `use Illuminate\Support\Facades\DB;` is present.
2. Confirm `canAccess()` exists with the same role semantics; if the target has
   a different ownership model, adapt this method only — the rest is unchanged.
3. Add the route inside the same authenticated group as the other voucher
   routes:
   `Route::get('/vouchers/{voucher}/usage', [VoucherController::class, 'usage']);`
4. Copy the covering-index migration and run `php artisan migrate`. It is
   `INPLACE/LOCK=NONE` and guarded by `SHOW INDEX`, so it is safe on a live
   server and idempotent.
5. Smoke test:
   `curl -H "Authorization: Bearer <token>" https://<tenant>/api/vouchers/<id>/usage | jq`

### Phase 3 — Frontend
1. `npm i recharts lucide-react` if absent (`cd frontend`).
2. Copy `src/components/VoucherUsageModal.tsx` verbatim.
3. Ensure `src/lib/format.ts` exports `gb`, `datet`, `parseDate` with `TZ`
   set to the target tenant's display timezone, and `src/components/ui.tsx`
   exports `Modal` (with `widthClassName`), `Spinner`, `EmptyState`, `Pill`.
4. In the target's `Vouchers.tsx`, add the four wiring points: import, the
   `usageVoucher` state, the `Usage Graph` menu entry (with the
   `status === 'ready' && !activated_at` hidden rule), and the
   `<VoucherUsageModal … />` mount beside the other modals.
5. If the target's brand colour differs, change the `USAGE` constant only —
   `CAP`/`DOWNLOAD`/`UPLOAD` are chosen for separation against it, so re-check
   contrast if you move it far.
6. `npm run build`, deploy `dist/`.

### Phase 4 — Verification on the target
- [ ] A card with several closed sessions: cumulative steps up, tiles' `used_gb`
      equals the last step, `remaining = cap − used`.
- [ ] A capped card: dashed cap line visible and *below* the top of the Y axis.
- [ ] A card with a live session and no Interim-Update yet: amber banner shows.
- [ ] An unlimited card (`data_gb` null): Remaining reads "Unlimited", no cap line.
- [ ] A card spanning midnight: X ticks carry the date, not just the clock.
- [ ] A daily-capped plan: second chart shows the daily cap line.
- [ ] Reseller/seller login: can open their own card, gets 404 on someone else's.
- [ ] `EXPLAIN` the usage query on a heavy username — should hit
      `radacct_username_usage_index`, not a clustered lookup per row.

---

## 6. Risks when porting

| Risk | Mitigation |
| :-- | :-- |
| Target DB not UTC | Timestamps shift 5h45m; fix `TZ` on the MariaDB container before deploying, not in JS. |
| Target quota logic uses a different cut-off than `created_at` | Graph and quota disagree; align both to one rule. |
| `radacct` large and index missing | Auth latency spike and NAS retransmit floods (see the migration's notes) — run the migration first. |
| Different voucher ownership model | Adapt `canAccess()` only; leave `usage()` alone. |
| Recharts major-version drift | `scale="time"` + `type="stepAfter"` behaviour changed across v2→v3; pin `recharts ^3.9.2`. |
