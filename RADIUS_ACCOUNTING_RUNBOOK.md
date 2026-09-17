# RADIUS Accounting Runbook

Diagnosing and fixing MikroTik RADIUS accounting and login failures on an Airlink v3.0 deployment.

Derived from the 2026-09-08/09 investigation on `169.58.174.21` / NAS `110.34.1.63`.
Written to be run against a **second tenant / replica VPS** without assuming it has the same fault.

> **Measure before you change anything.** Every number below came from one deployment. They are
> reference values and decision thresholds, not settings to apply blindly.

> ### ⚠️ Read this before touching any timeout
>
> **The Winbox `RADIUS › Timeout` field is in MILLISECONDS.** It displays a bare number with no unit.
> Typing `10` sets **10 ms**, not 10 seconds.
>
> On 2026-09-09 this took the entire hotspot down for 18 hours. The default is `300` (= 300 ms).
> Someone "raised" it to `10`, which is 30× *shorter*, and below the 172 ms RTT floor — so every
> RADIUS request failed, while the server logged every one as a success.
>
> **Always set it from the CLI with an explicit unit, and always verify:**
> ```
> /radius set [find] timeout=3s
> /radius print detail          # must read timeout=3s — NOT 3ms
> ```

---

## 1. The three fingerprints

Accounting and logins fail for **three different reasons**. They leave different traces, and only two
are fixable with a setting. Identify which one you have before changing anything.

| Fingerprint | Meaning | Fix |
|---|---|---|
| **Router log: `login failed: RADIUS server is not responding`** — while the **server** log shows `Login OK` for the same user at the same moment | The router's timeout is **shorter than the round trip**. The server answers; the router has already stopped listening and discards the reply. | **Set the timeout correctly** (§4.1). Total outage until fixed. |
| **Duplicate entries in the detail log** — same `Acct-Session-Id` twice within seconds | Packets arriving **late**. The router gave up waiting and resent; both copies eventually landed. | **Raise the timeout** (§4.1). Partial loss. |
| **Missing interims, no duplicates** — a gap that is a clean multiple of the session's cadence | Packets genuinely **lost** in transit. No retry ever arrived. | **Escalate the network path.** No timeout value recovers a packet that never arrives. |

### Fingerprint 1 is the dangerous one — it disguises itself

When the timeout is below the RTT, the server-side logs look **perfectly healthy**:

```
# Server — everything looks fine
14:20:58  Auth: Login OK: [A275B5/<CHAP-Password>] (from client mikrotiksubisu_13 ...)

# Router — the same login, same second
14:20:53  A275B5 trying to log in by http-chap
14:20:55  A275B5 login failed: RADIUS server is not responding
```

Two more things make it hard to spot:

- **Local hotspot users keep working.** MikroTik tries RADIUS first, then falls back to
  `/ip hotspot user`. So local accounts stay online through a total RADIUS outage, and the hotspot
  looks half-alive. On the reference deployment three local users were connected the whole time.
- **Accounting goes silent rather than lossy.** No session is ever created, so there is nothing to
  account for. An empty detail log reads like "accounting is broken" when the real failure is one
  step earlier, at login.

**The tell is the interval.** Failures appear ~2 seconds after the attempt, every time, regardless of
load. A correctly configured timeout takes as long as the timeout to give up.

### Confirming it on the wire

```bash
# -U is REQUIRED. Without it tcpdump buffers and an idle-looking capture proves nothing.
tcpdump -n -i any -U "udp and (port 1812 or port 1813)"
```

Validate the capture works before trusting its silence — send yourself two packets:

```bash
python3 -c "
import socket
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
s.sendto(b'\x04\x00\x00\x14'+b'\x00'*16, ('<SERVER_IP>',1813))
s.sendto(b'\x01\x00\x00\x14'+b'\x00'*16, ('<SERVER_IP>',1812))"
```

What a too-short timeout looks like — note the retry spacing:

```
14:20:58.567929  Access-Request  id 0x50
14:20:58.583506  Access-Request  id 0x50   (+15.6 ms — retry)
14:20:58.588271  Access-Request  id 0x50   (+4.8 ms  — retry)
14:20:58.600311  Access-Accept   id 0x50   ← server answered in 32 ms, too late
```

**Retries milliseconds apart mean the timeout is set in milliseconds.** A 3-second timeout retries
seconds apart. And count the packet types: many `Access-Accept` with **zero** `Accounting-Request` is
fingerprint 1, definitively.

### What was actually measured

| | 300 ms default | 10 ms (misconfigured) | 3 s (correct) |
|---|---|---|---|
| Missed interims | 8 of 91 (8.8%) | total failure | measuring |
| Sessions created | yes | **none for 18 h** | yes |
| Link RTT | 172 / 217 / 494 ms | — | 175 / 178 / 208 ms |

> **A correction worth carrying:** an earlier pass at this concluded "8.8% before, 17.1% after — loss
> is episodic." That "after" window was running the 10 ms timeout, so the comparison was meaningless.
> Do not compare loss rates across a period where the timeout itself changed.

---

## 2. Fill these in first

```bash
APP=airlink-mera-prod-app          # Laravel app container
FR=airlink-mera-prod-freeradius    # FreeRADIUS container
APP_DEV=airlink-backend            # container that mounts the repo (tests only)
COMPOSE=docker-compose.prod.yml    # prod compose file
NAS_IP=110.34.1.63                 # discovered in §3.1
```

`APP_DEV` is only needed for the test run in §5.4. Production containers bake the code in and have
no bind mount, so edits are invisible to them until §6 rebuilds.

---

## 3. Phase 0 — Measure

### 3.0 First: is anyone actually getting online?

Do this before anything else. It separates "accounting is broken" from "logins are failing".

```
/ip hotspot active print
```

Cross-reference every name against `radcheck`. If the only active users are **local** accounts
(present in `/ip hotspot user`, absent from `radcheck`), RADIUS logins are failing entirely — go
straight to fingerprint 1.

```
/log print without-paging where topics~"hotspot"
```

This is the single most informative command on the router. It states in plain text why each login
succeeded or failed.

### 3.1 Find which NAS devices actually carry traffic

```bash
docker exec $APP php artisan tinker --execute='
foreach (DB::table("radacct")
    ->where("acctstarttime", ">=", now()->subDays(7))
    ->selectRaw("nasipaddress, COUNT(*) c, MIN(acctinterval) mn, MAX(acctinterval) mx, MAX(acctstarttime) last")
    ->groupBy("nasipaddress")->orderByDesc("c")->get() as $r) {
  echo "$r->nasipaddress  sessions=$r->c  acctinterval {$r->mn}-{$r->mx}  last=$r->last\n";
}'
```

`acctinterval` near **3600** = hourly reporting. Near **600** = 10 minutes. A mix is normal while
older sessions have not reconnected. **If `last` is hours old while people are logging in, that is
fingerprint 1.**

### 3.2 Measure the round trip to each NAS

The number the timeout must exceed. Run it **more than once, spread over time** — loss is episodic.

```bash
ping -c 40 -i 0.3 -W 2 $NAS_IP | tail -3
```

**Decision gate**

- **min RTT above ~100 ms** → the 300 ms default is marginal; use `3s`.
- **min RTT below ~30 ms** (LAN or same-datacentre NAS) → the default is fine.
- **Any sustained loss above ~1%** → fingerprint 3. Settings will not fix it.
- **Whatever you set, it must exceed the *maximum* observed RTT with several times' headroom.**

> MikroTik de-prioritises ICMP to its own CPU, so the loss figure can overstate real UDP loss. The
> **minimum RTT is not subject to that caveat** and is the number to size the timeout against.

### 3.3 Confirm the server itself is fast

Rules out a genuine server-side stall. This writes a row, removed in §3.7.

```bash
docker exec $FR sh -c '
printf "User-Name = \"acct-probe-1\"\nAcct-Status-Type = Start\n\
Acct-Session-Id = \"probe0001\"\nNAS-IP-Address = 127.0.0.1\n\
NAS-Port = 1\nFramed-IP-Address = 10.99.99.99\nAcct-Session-Time = 0\n" > /tmp/acct.txt
for i in 1 2 3 4 5 6 7 8 9 10; do
  s=$(date +%s%N)
  radclient -t 5 -r 1 127.0.0.1:1813 acct testing123 -f /tmp/acct.txt >/dev/null 2>&1
  e=$(date +%s%N); echo "  probe $i: $(( (e-s)/1000000 )) ms"
done'
```

Expect **50–70 ms** including `radclient` startup. If this is slow, the fault *is* server-side —
check the SQL pool (`max = 5` by default in `docker/freeradius/mods-enabled/sql`) before touching any
router.

### 3.4 Count duplicates — fingerprint 2

```bash
docker exec -e NAS_IP="$NAS_IP" $FR sh -c '
D=/var/log/freeradius/radacct/$NAS_IP/detail-$(date +%Y%m%d)
awk "/^[A-Z][a-z][a-z] [A-Z]/{ts=\$0} /Acct-Session-Id/{print ts, \$3}" "$D" | uniq -d'
```

Empty is a pass — **but only if accounting is flowing at all.** An empty result during a fingerprint-1
outage means nothing. Check §3.0 first.

### 3.5 Count missed interims — fingerprint 3

```bash
docker exec -e NAS_IP="$NAS_IP" $FR sh -c '
D=/var/log/freeradius/radacct/$NAS_IP/detail-$(date +%Y%m%d)
awk "/^[A-Z][a-z][a-z] [A-Z]/{split(\$4,t,\":\"); now=t[1]*3600+t[2]*60+t[3]}
     /Acct-Status-Type/{st=\$3} /User-Name =/{u=\$3}
     /Acct-Session-Id/{print now, st, u, \$3}" "$D"' > /tmp/acct.txt

python3 - /tmp/acct.txt <<'PY'
import sys, collections, statistics
S = collections.defaultdict(list)
for now, st, u, sid in (l.split() for l in open(sys.argv[1]) if l.strip()):
    S[(sid, u)].append(int(now))
tot = miss = 0
for (sid, u), ts in sorted(S.items(), key=lambda x: x[1][0]):
    ts = sorted(ts)
    gaps = [b - a for a, b in zip(ts, ts[1:]) if b - a > 30]
    if len(gaps) < 3: continue          # small-sample guard, see caveat below
    cad = round(statistics.median(gaps) / 60) * 60 or 60
    m = sum(round(g / cad) - 1 for g in gaps if g > cad * 1.6)
    tot += len(gaps) + m; miss += m
    print("%-9s %-10s cadence %2dm  updates %2d  missed %d"
          % (u.strip('"'), sid.strip('"'), cad / 60, len(ts), m))
print("\nexpected %d   missed %d   loss %.1f%%" % (tot, miss, 100.0 * miss / tot))
PY
```

**Caveats:**

- **Sessions with fewer than 3 gaps are skipped**, and must be. The cadence is derived from the
  median gap, so a short session gives a meaningless estimate — a clean 3-packet session
  (`Start 16:20:59 / Interim 16:30:58 / Stop 16:33:42`) was reported as a miss before this guard
  existed, because the Stop dragged the median down. If your run reports a "miss" on a session with
  only two or three packets, it is the script that is wrong, not the link.
- A session's **Stop** arrives whenever the router notices, which inflates the count for sessions
  that closed. Read the per-session lines, not just the total.
- Check whether flagged gaps **cluster in time across several sessions at once** — that is a link
  episode. Scattered single misses, each a clean 2x the cadence, are per-packet loss.
- The rate is meaningless below a few hundred samples. At n=25 one lost packet is 4 percentage
  points.

### 3.6 Record router settings and the clock offset

```bash
# On the MikroTik — write the old values down before changing them
/radius print detail
/ip hotspot profile print detail
```

Confirm `use-radius=yes` and `radius-accounting=yes` on the profile actually serving the hotspot.

```bash
# On the VPS — these two are NOT on the same clock
docker exec $APP php artisan tinker --execute='echo DB::selectOne("SELECT NOW() n")->n."\n";'
docker exec $FR date
```

On the reference deployment the database runs **UTC** while the FreeRADIUS container and the MikroTik
log run **Asia/Kathmandu (+5:45)**. A `radacct` row reading `14:08` is the event the router logged at
`19:53`. Detail-log files match the router's clock; add the offset to `radacct` values before
comparing. Getting this wrong makes healthy accounting look broken.

### 3.7 Remove the probe row from §3.3

```bash
docker exec $APP php artisan tinker --execute='
echo DB::table("radacct")->where("username","acct-probe-1")
  ->where("framedipaddress","10.99.99.99")
  ->where("nasipaddress","127.0.0.1")->delete()." row(s) deleted\n";'
```

---

## 4. Phase 1 — Router settings

> **Ordering rule:** fix the timeout **before** shortening the interim interval. Reversed, you put six
> times more packets onto a link that is still dropping them.

### 4.1 Set the RADIUS timeout — from the CLI, with the unit

```
/radius set [find] timeout=3s
/radius print detail
```

**Verify the output literally reads `timeout=3s`.** If it reads `3ms`, every login on that router is
already broken.

- **Never set this in Winbox.** The field is milliseconds with no unit label. Winbox will display a
  correct `3s` as `3000`.
- Apply to **every** entry — `/radius print detail` may list several. Disabled entries (flag `X`)
  don't matter, but enable-state can change.
- 3 s gives ~6× headroom over a 494 ms worst-case RTT while still failing fast if the server really
  is down.

**The trade:** accounting is a background packet, so a longer timeout costs nothing there. The one
cost is on the auth path — if the RADIUS server is genuinely down, a hotspot login hangs up to 3 s
before failing instead of ~0.3 s.

### 4.2 Shorten the interim update to 10 minutes

Only after 4.1 is verified.

```
/ip hotspot profile set [find] radius-interim-update=10m
/ip hotspot profile print detail
```

The field's minimum is 10 s. That is a floor, **not** a recommendation — at 10 s you send one packet
per user per 10 seconds over a link that already drops packets.

Existing sessions keep their old cadence until the customer reconnects. A mixed fleet is expected,
and §5.1 handles it.

---

## 5. Phase 2 — Code changes

None of these fix packet loss — §4 does that. Without them the online-user list stays sized for the
old hourly cadence and reports disconnected customers as online for over an hour.

### 5.1 Derive the online window from each session's own cadence

`app/Services/Radius/OnlineSession.php`

A fixed constant cannot serve a mixed fleet: sized for 600 s it hides every hourly session; sized for
3600 s it holds disconnected users on the list for two hours. `radacct.acctinterval` is the
per-session cadence FreeRADIUS already records, so reading it makes the window self-tuning.

```php
// in scopeLive() — replaces a fixed 75-minute window
"COALESCE({$table}.acctupdatetime, {$table}.acctstarttime) >= DATE_SUB(NOW(), INTERVAL "
    ."LEAST(GREATEST(COALESCE({$table}.acctinterval, 0), ?) * ? + ?, ?) SECOND)",
[
    self::MIN_INTERIM_SECONDS,       // 600   floor: null/0 acctinterval
    self::STALE_INTERVAL_MULTIPLIER, // 2     survives one lost interim
    self::STALE_GRACE_SECONDS,       // 300   jitter slack
    self::MAX_STALE_SECONDS,         // 10800 ceiling: implausible acctinterval
]
```

| Session cadence | Window before | Window after | Effect |
|---|---|---|---|
| 600 s | 75 m | 25 m | Disconnects drop off 3× faster |
| 1200 s | 75 m | 45 m | Handles a session that lost one update |
| 3600 s | 75 m | 125 m | Survives a lost interim instead of vanishing |

### 5.2 Raise the CoA probe threshold above the new cadence

```php
- public const PROBE_AFTER_MINUTES = 10;
+ public const PROBE_AFTER_MINUTES = 15;
```

At 10 it exactly equalled the interim cadence, so healthy sessions sat on the threshold and were
probed on most ticks. **Cost:** with a 5-minute scheduler tick this moves worst-case voucher lockout
from ~15 to ~20 minutes.

### 5.3 Align the advisory interim attribute

`app/Services/RadiusService.php`

```php
- ['username' => $username, 'attribute' => 'Acct-Interim-Interval', 'op' => ':=', 'value' => '60'],
+ ['username' => $username, 'attribute' => 'Acct-Interim-Interval', 'op' => ':=', 'value' => '600'],
```

MikroTik ignores this unless the hotspot profile is set to `radius-interim-update=received`. Leaving
it at 60 means that if anyone ever switches that on, every user sends a packet a minute.

### 5.4 Run the test suite

```bash
docker exec -e DB_CONNECTION=testing -e TEST_DB_DATABASE=airlink_test \
  $APP_DEV sh -c 'cd /var/www/html && php artisan test'
```

The container sets `DB_CONNECTION=mysql` as a real environment variable, which `phpunit.xml` does not
override — without these two the suite refuses to run and reports everything as failed. Compare
against a baseline; some failures may pre-date your change.

---

## 6. Phase 3 — Deploy

### 6.1 Build all three services, not just `app`

```bash
docker compose -f $COMPOSE build app queue scheduler
docker compose -f $COMPOSE up -d app queue scheduler
```

`app`, `queue` and `scheduler` share one Dockerfile but compose tags them as **three separate
images**. Building only `app` leaves the other two on old code, and `up -d` reports them as `Running`
rather than recreating them. This matters most for the scheduler, which runs
`radius:close-stale-sessions`.

**If BuildKit fails with `connection reset by peer`:** its registry fetches can fail over IPv6 while
the Docker daemon's own pull path works. Pre-pull, then repeat the build.

```bash
docker pull docker/dockerfile:1
docker pull php:8.3-fpm-bookworm
docker pull composer:2
```

### 6.2 Verify each container picked up the new image

```bash
for svc in app scheduler queue; do
  NEW=$(docker image inspect airlink3-prod-$svc:latest --format '{{.Id}}')
  IMG=$(docker inspect airlink-mera-prod-$svc --format '{{.Image}}')
  printf "%-12s %s\n" "$svc" "$([ "$IMG" = "$NEW" ] && echo 'NEW ok' || echo 'OLD - not deployed')"
done
```

---

## 7. Phase 4 — Verify

### 7.1 A real login creates a real session

The only verification that matters. Have someone log in with a voucher that has **no MAC binding**
(see §8), then confirm all three stages within seconds of each other:

```bash
# 1. server accepted
docker exec $FR grep "Auth:" /var/log/freeradius/radius.log | tail -3

# 2. accounting arrived — this is the stage that fails under fingerprint 1
docker exec -e NAS_IP="$NAS_IP" $FR sh -c '
awk "/^[A-Z][a-z][a-z] [A-Z]/{ts=\$0} /Acct-Status-Type/{st=\$3} /User-Name =/{print ts\"  \"st\"  \"\$3}" \
  /var/log/freeradius/radacct/$NAS_IP/detail-$(date +%Y%m%d)' | tail -5

# 3. the app sees it
docker exec $APP php artisan tinker --execute='
use App\Services\Radius\OnlineSession;
echo "online: ".OnlineSession::scopeLive(DB::table("radacct"))->distinct()->count("username")."\n";
echo "open rows: ".DB::table("radacct")->whereNull("acctstoptime")->count()."\n";'
```

A `Login OK` with **no matching `Start`** is fingerprint 1 — go back to §4.1.

> Watch out for a quiet hotspot: if nobody attempts a login, every one of these looks like a failure.
> Confirm there was an actual attempt before concluding anything.

### 7.2 Then re-check for duplicates and misses

Repeat §3.4 and §3.5 **after a few hours of real traffic**, then again the next day. A short clean
window proves nothing — on the reference deployment a 20-minute sample produced a premature "fixed"
that a longer look contradicted.

If misses persist **without** duplicates, that is genuine packet loss: re-measure the link across the
day, look for clustering across sessions, and escalate the path. There is no setting left to change.

### 7.3 The stale-session cleanup still works

```bash
docker exec $APP php artisan radius:close-stale-sessions --dry-run

docker exec $APP php artisan tinker --execute='
echo "cache driver: ".config("cache.default")."\n";
echo "probe trust: ".var_export(Cache::get("coa:probe-answers:'"$NAS_IP"'", false), true)."\n";'
```

RouterOS answers a probe for a missing session with Error-Cause **406**, not the standard 503, so the
code only trusts a NAK from a router that has previously confirmed a live session. That flag lives in
the cache — the driver must be `database`, or it will not survive a redeploy.

---

## 8. Check these while you are in there

### `Invalid user` in the server log is often MAC binding, not a missing account

A voucher with `mac_bind = 1` binds to the **first device that logs in**, and every other device is
then rejected. FreeRADIUS logs this as `Invalid user`, which is misleading — the account is fine.

Diagnose by comparing the rejected `cli` MAC against the bound one:

```sql
SELECT username, status, mac_bind, mac_address FROM vouchers WHERE username = '<CODE>';
```

The giveaway is the same voucher succeeding and failing minutes apart from different MACs:

```
14:20:58  A275B5 from F2:96:44:35:BA:EC (bound)  → Login OK
14:21:28  A275B5 from 7E:9E:EC:0E:1B:28          → Invalid user
```

**Check the fleet-wide exposure before this bites:**

```sql
SELECT SUM(mac_bind=1 AND mac_address IS NOT NULL) AS bound,
       SUM(mac_bind=1 AND mac_address IS NULL)     AS primed
FROM vouchers;
```

`primed` cards will each silently lock to their first device. On the reference deployment that was
**600 of 10,561** — worth a deliberate policy decision, because the FreeRADIUS post-auth capture that
writes `mac_address` only started working recently ("Lock on First Login" never actually locked
before). Clearing `mac_address` lets a card rebind to the next device.

The mismatch reply also **leaks the bound MAC** to whoever holds the card:
`"This voucher is already bound to another MAC address (32:04:7D:B5:47:CC)."`

### Local hotspot users bypass RADIUS entirely — unbilled

A username in `/ip hotspot user` sends **no accounting at all** — no Start, no Interim, no Stop, ever.
Its traffic is invisible to billing and never appears in usage reports or the online list. They also
mask a RADIUS outage, because they keep working when RADIUS is completely down.

```
/ip hotspot user print
```

### NAS records pointing at unroutable addresses — breaks CoA

CoA travels **server → router**, so a `coa_host` on a private hotspot address such as `10.10.0.1` can
never be reached from a public VPS. Every probe and disconnect for sessions resolving to that record
fails silently.

```sql
SELECT name, nasname, coa_host FROM nas_devices;
```

### `SyncVoucherStatus` data-cap query has no date guard — bug

`app/Console/Commands/SyncVoucherStatus.php` step 1 sums **all** `radacct` rows for a username:

```sql
SELECT username, SUM(acctinputoctets + acctoutputoctets) FROM radacct GROUP BY username
```

Step 0 directly above it explicitly guards recycled usernames with `r.acctstarttime >= v.created_at`.
Step 1 doesn't. A reused voucher code inherits every byte its previous owner ever used and can be
marked `used` immediately. Codes on this deployment date back to 2025, so there is real history to
inherit.

### Framed-IP is not the packet's source — diagnosis trap

The `10.x.x.x` address in an accounting packet is `Framed-IP-Address` — the customer's IP inside the
hotspot, carried as **data**. FreeRADIUS never checks it against `clients.conf`. The packet's real
source is `NAS-IP-Address`. FreeRADIUS files detail logs under the accepted client's IP:

```bash
docker exec $FR ls /var/log/freeradius/radacct/
```

### Unknown-client errors are usually just scanners — noise

`Ignoring request … from unknown client` on port 1812 from random public IPs is internet background
noise. Only meaningful if the source is one of **your** NAS addresses.

### Shared RADIUS secret on an internet-facing port — hygiene

If every stanza in `clients.conf` carries the same default secret while port 1812 is publicly
reachable and actively scanned, that deserves its own ticket. `clients.conf` is generated by
`ClientsConfService` — edit through the NAS Devices UI, because manual edits get overwritten.

### The 12-hour blind backstop is now over-cautious — follow-up

`OnlineSession::CLOSE_AFTER_MINUTES = 720` was measured when routers reported hourly. With reliable
10-minute interims it can drop to 60–90 minutes. It is the only backstop when CoA cannot reach the
router, and every voucher with `Simultaneous-Use = 1` is locked out of its own next login while a
phantom session stays open.

**Two preconditions first:** the 10-minute cadence has held for several days, and every
`acctinterval = 3600` session has reconnected. Lowering it early closes live sessions.

---

## 9. What the fix buys, and what it does not

| Measure | Broken (10 ms) | 300 ms default | 3 s |
|---|---|---|---|
| Voucher logins | **all fail** | work | work |
| Sessions created | **none** | yes | yes |
| Retransmissions | n/a | present | none observed |
| Interim updates lost | n/a | 8.8% | measuring |
| Usage-graph resolution | — | 1 point / hour | 1 point / 10 min |
| Online list accuracy | — | 125 min | 25 min |
| Unaccounted traffic on lost Stop | — | up to 60 min | up to 10 min |

**What does not improve.** The link is unchanged — 172 ms RTT with real, episodic packet loss. The
timeout *absorbs* latency; it does not repair loss. If misses persist after §4, the path is the
remaining root cause and no setting will fix it.

**A lost Accounting-Stop is still possible.** Rarer, and the CoA probe closes the row within about 20
minutes, but "much less likely" is not "never". Only MAC-bound vouchers are fully exempt from the
resulting `Simultaneous-Use` lockout, via the `Simultaneous-Use !* ANY` bypass in the FreeRADIUS site
config — on the reference deployment that was 605 of 10,561 vouchers.
