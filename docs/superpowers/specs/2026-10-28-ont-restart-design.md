# ONT Restart (Restart CPE) — Design

Date: 2026-10-28

## Goal

Let staff restart a customer's ONT from the Online Customers detail view, on both Huawei and HSGQ OLTs.

## Decisions

- Vendors: Huawei and HSGQ.
- Access: admins can restart any ONT; resellers only ONTs whose `ont_inventory.reseller_id` is their own.
- Placement: a **Restart CPE** button in `SubscriberDetailModal` (the Online Customers detail view), next to Disconnect.

## Verified OLT commands

Confirmed with read-only `?` help on the live OLTs (nothing executed).

| Vendor | Mode | Command | Range |
|---|---|---|---|
| Huawei | `enable`, `config`, `interface gpon <frame>/<slot>` | `ont reset <port> <ont_id>` | ont_id 0-127 |
| HSGQ | `enable`, `configure` | `ont reset <pon> <ont_id>` | pon 1-16, ont_id 0-127 |

Both CLIs also accept `all` in place of the ONT ID, and HSGQ accepts a bare `reboot` that restarts the whole OLT. None of these may ever be produced.

Unverified: whether Huawei `ont reset` asks a `(y/n)` confirmation. The executor's pre-approve mechanism handles it if so; confirm on the first live restart.

## Components

1. **Frontend** — `SubscriberDetailModal.tsx`: button shown only when the customer's ONT is matched in inventory. Confirmation dialog (service drops about 2 minutes). Result shown in the existing `actionMsg` banner.
2. **Laravel** — `RadiusController` already returns `ont_olt_id`, `ont_frame`, `ont_slot`, `ont_pon_port`, `ont_ont_id`. Add `oi.id as ont_inventory_id`.
3. **Go NMS** — `POST /olts/{oltId}/onts/{id}/reboot`:
   - Role gate: reseller or above, plus ownership check for resellers (same pattern as `updateONTReseller`).
   - Command chosen by the OLT's vendor and built only from range-checked integers by a per-vendor validated constructor. `all` and bare `reboot` are unrepresentable.
   - Huawei: new write command in `internal/olt`. HSGQ: new write command in `internal/hsgq`, run through a separate write path; sync stays on `readOnlyExec`.
   - Audit log `ont.reboot` (actor, OLT, ONT). Per-ONT cooldown of about 60 seconds.

## Testing

- Unit: command builders (valid and invalid ranges, `all`, injection attempts) for both vendors.
- Integration: admin allowed, reseller allowed on own ONT, reseller denied on another's ONT, cooldown, unknown vendor.
- Existing "reboot is rejected" tests remain valid for arbitrary input.

## Out of scope

Bulk restart, restart from the ONT inventory list, scheduling.
