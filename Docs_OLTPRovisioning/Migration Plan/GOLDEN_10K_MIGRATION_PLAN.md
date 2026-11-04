# Golden migration plan: dedicated VM for 10k customers

Context: Golden has ~280 PPPoE customers today on a shared 4 vCPU / 8 GB host (with Mera and Annapurna tenants). Target is ~10k customers on its own VM.

## Live findings (Golden DB, 2026-10-28)

| Metric | Value |
|---|---|
| PPPoE customers | 279 (254 sessions open) |
| `radacct` | 12.4k rows, 11 MB in 22 days |
| Session starts / day (last 7 days) | 400–1,560 (~3.6–5.6 per customer per day) |
| `innodb_buffer_pool_size` | 128 MB (default) |
| `max_connections` | 151 (peak used 23) |
| `innodb_flush_log_at_trx_commit` | 1 |
| Slow query log | off |
| PHP-FPM `pm.max_children` | 5 (default) |

Scaled 36x: ~36–56k sessions/day, 13–20M `radacct` rows/year (~18 GB), hot data ~400 MB in month one (3x the buffer pool), disk-flush-bound writes, and 5 PHP workers. The current setup will not hold 10k customers without changes.

## 0. Decisions first
- **Single VM or split.** One VM is enough for 10k. Split app/DB only for HA later.
- **RADIUS ownership.** Golden uses the shared FreeRADIUS (`sql_golden`, `clients-golden.conf`). The new VM runs its own. Start from `docker-compose.yml` (single tenant) and copy the Golden-specific bits. Verify against the compose file.
- **Cutover IP.** New IP (re-point every NAS, easy rollback) or take over the old RADIUS IP.

## 1. VM sizing
| Item | Spec |
|---|---|
| vCPU | 8 |
| RAM | 16 GB (32 GB for longer retention in buffer pool) |
| Disk | 200 GB SSD/NVMe, separate volume for Docker / DB data |
| OS | Ubuntu 24.04 LTS |
| Network | Static IP reachable from all NAS, OLT, VPN, monitoring |
| Swap | 2–4 GB safety net |
| Extras | No IDE servers or dev tools on the VM; alert at 80% disk |

## 2. Base setup
1. Patch OS, non-root deploy user, SSH keys only.
2. Install Docker Engine + compose plugin.
3. Firewall (ufw): 80/443 open; 22 from admin network only; **1812/udp, 1813/udp** from NAS IPs only; **3799/udp** VM <-> NAS (CoA); MariaDB on localhost only.
4. NTP; host timezone matches the app.
5. Sysctl/limits: `fs.file-max`, `net.core.rmem_max` >= 4 MB (UDP bursts), `nofile` >= 65535.
6. VPN client (`vpn/`, `.ovpn`) if OLT/NAS are reached over VPN. Test SSH and SNMP to OLTs from the VM.

## 3. Deploy the stack
1. Clone repo, create `.env` with new strong secrets (`DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`, `NMS_SECRET_KEY`). Do not reuse `airlink_pass` / `root_secret`.
2. **Carry over the current `NMS_SECRET_KEY`** (or the current `JWT_SECRET` if it is unset) so stored OLT passwords still decrypt.
3. Compose override with `mem_limit` per service and the tuned configs below.
4. TLS via nginx + Let's Encrypt (host or container).

## 4. Tuned configuration

**MariaDB** (`/etc/mysql/conf.d/airlink.cnf`):
```
[mysqld]
innodb_buffer_pool_size = 6G
innodb_log_file_size = 1G
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
innodb_io_capacity = 2000
max_connections = 400
slow_query_log = ON
long_query_time = 1
character-set-server = utf8mb4
```

**PHP-FPM** (`www.conf`):
```
pm = dynamic
pm.max_children = 30
pm.start_servers = 8
pm.min_spare_servers = 4
pm.max_spare_servers = 12
pm.max_requests = 500
```
Workers can use up to the 256 MB `memory_limit` each (30 workers peak ~7.5 GB). Lower if RAM is tight.

**FreeRADIUS:**
```
pool { start = 5  min = 5  max = 50  spare = 5  idle_timeout = 60 }
```
Raise thread pool `max_servers` to 64. `start = 5` is fine on a dedicated server (the `start = 0` workaround existed for the shared setup).

**Accounting interval:** set PPPoE interim-update to 10–15 min (currently 5) to cut steady write load by two thirds.

## 5. App changes before cutover (do on a branch)
1. **Online users** (`RadiusController::onlineUsers`): server-side pagination; replace the per-row lifetime `SUM` subquery with a pre-aggregated usage table (or compute for the visible page only); prefix search (`term%`) instead of `%term%`. Match `OnlineUsers.tsx` and `PppoeCustomers.tsx`.
2. **Retention job:** archive/purge `radacct` and `radpostauth` older than 90 days, daily off-peak.
3. **Stale-session cleanup:** raise `--max-probes`, confirm queries are indexed for 10k open sessions.
4. **Indexes:** `EXPLAIN` top queries; confirm `radacct` indexes on `acctuniqueid`, `username`, `acctstoptime`, `nasipaddress`.
5. Investigate the 4–5 reconnects per customer per day (link instability, session timeouts, NAS flapping). It multiplies write load and login-storm risk.

## 6. Data migration
1. **Rehearse:** restore a copy of `airlink_golden` (and `airlink_golden_legacy` if used) on the new VM, run migrations, log in.
2. Test RADIUS end to end: `radtest`, one real NAS, accounting, CoA disconnect.
3. **Cutover day:**
   - Announce a short window.
   - Final `mysqldump --single-transaction --routines --triggers` of the live DB, restore on the VM (optionally skip `radacct` older than 30–90 days).
   - Copy NAS client config (`clients.conf`) and storage volumes/uploads.
   - Re-point NAS devices to the new RADIUS IP (a few first), or move the old IP.
   - Watch auth success, accounting writes, CoA.
4. **Rollback:** keep the old stack untouched; revert NAS RADIUS settings. Accounting written to the new DB will not exist on the old one.

## 7. Onboard the 10k customers
1. Batches of **1,000–2,000** (existing import tooling such as `LegacyImport`), at least a day apart, outside peak hours.
2. After each batch check: slow query log; buffer pool hit rate (>99%); threads/connections; FreeRADIUS logs for "already at max" or timeouts; disk IOPS and free RAM.

## 8. Load test (before batch 1)
- Seed ~10k synthetic customers and 10k open `radacct` rows.
- `radclient`: 150 auths/s for 5 min; a 10k-session interim-update burst.
- Hit `/radius/online-users` and `/pppoe` with 20 concurrent users.
- **Pass:** auth p95 < 200 ms, API p95 < 1 s, no FPM or DB connection exhaustion, no reject storms.

## 9. Monitoring and operations
- Prometheus (node, MariaDB, cAdvisor exporters) + Grafana. Alert on CPU > 80%, free RAM < 15%, disk > 80%, MariaDB connections > 75%, FreeRADIUS reject rate.
- Docker log rotation (`max-size: 50m`, `max-file: 5`); rotate slow query logs.
- Nightly `mysqldump`/`mariabackup` off-VM, 14–30 day retention. **Run one restore test.**
- Pin image tags, not `latest`.
- Runbook: restart order (DB -> FreeRADIUS -> app, queue, scheduler) and rollback steps.

## 10. Go/no-go checklist
- [ ] VM sized and hardened; NAS and OLT connectivity verified
- [ ] Tuned MariaDB, FPM, FreeRADIUS configs applied
- [ ] Pagination and aggregation fixes merged and tested
- [ ] Retention job running
- [ ] Load test passes targets
- [ ] Backup and restore proven
- [ ] Cutover and rollback rehearsed
- [ ] Monitoring and alerts live
