# PPPoE Commission Summary — Design

## Goal
A page under the PPPoE sidebar group showing each reseller's commission split on PPPoE recharges, filterable by reseller and date range.

## Data
Source: `pppoe_recharges` only (columns `price`, `commission_percent`, `admin_share`, `reseller_share`, `reseller_id`, `created_at`). Registrations carry no commission split and are excluded. Date filter uses `whereDate(created_at)`, like Sales Summary. Recharges with null `reseller_id` form a "Direct (no reseller)" bucket.

## Backend
`GET /reports/pppoe-commission-summary?from=&to=&reseller_id=` -> `ReportController::pppoeCommissionSummary`, middleware `permission:view_pppoe`.
- Admin: all resellers, optional `reseller_id` filter.
- Reseller: only own rows; `reseller_id` ignored.
- Response: `rows[]` (reseller_id, reseller_name, recharges, total_sales, commission_percent, admin_share, reseller_share), `totals`, `recharges[]` (detail list: reference, date, subscriber, plan, price, admin_share, reseller_share, reseller_id).

## Frontend
`frontend/src/pages/PppoeCommissionSummary.tsx`, route `/pppoe/commission-summary` guarded by `view_pppoe` (admin, reseller); sidebar item "PPPoE Commission" in AppShell. Reuses `Combobox`, `DualDatePicker`, presets from PppoeSalesSummary. Reseller dropdown hidden for resellers. Summary tiles, stacked bar chart (admin vs reseller share), per-reseller table with totals row and expandable recharge detail.

## Testing
Backend feature test: split sums, date filter, reseller filter, reseller scoping, direct bucket. Frontend: type-check + manual browser check.
