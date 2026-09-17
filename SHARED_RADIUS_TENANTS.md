# Shared FreeRADIUS, one database per tenant

How Mera and Annapurna run as two independent billing systems behind a
**single** FreeRADIUS server, with the database chosen per request from the
NAS that sent it.

> This supersedes `MULTITENANT_FREERADIUS_SETUP.md`, which describes a
> different design (one FreeRADIUS container per tenant, separated by port
> offsets). That design was never deployed. Nothing in this document uses
> port offsets — both tenants answer on the same 1812/1813.

---

## 1. The routing chain

One server, one port pair, two databases. What separates the tenants is the
NAS the packet came from:

```
Annapurna NAS ──▶ client{} in clients-annapurna.conf
                    virtual_server = annapurna
                        ──▶ server annapurna {}   (sites-enabled/annapurna)
                            ──▶ sql_annapurna     (mods-enabled/sql_annapurna)
                                ──▶ airlink_annapurna  @ annapurna-mariadb

Mera NAS ─────▶ client{} in clients.conf
                    (no virtual_server → the default)
                        ──▶ server default {}     (sites-enabled/default)
                            ──▶ sql               (mods-enabled/sql)
                                ──▶ airlink_mera       @ mariadb
```

`virtual_server` on a `client{}` stanza is a stock FreeRADIUS 3 feature — it
is the entire tenant-routing mechanism. A NAS is registered in exactly one
tenant's UI, and that registration is what binds it to that tenant's data.

**A NAS with no `virtual_server` line falls through to Mera.** That is the
single most important failure mode here: an Annapurna NAS missing that line
does not error, it quietly authenticates against Mera's database and writes
Annapurna's sessions into Mera's `radacct`. The Annapurna app stamps the line
on every block it writes (`RADIUS_VIRTUAL_SERVER=annapurna`); don't hand-edit
clients around it.

---

## 2. Why the Annapurna virtual server is generated, not copied

`sites-enabled/default` is ~1500 lines of Airlink-specific policy: the voucher
lifecycle gate, MAC binding, PPPoE checks, 8 inline `%{sql:...}` xlats. A
second tenant needs that policy *verbatim*, pointed at a different SQL
instance. Keeping a hand-maintained second copy would guarantee drift — a
voucher-policy fix applied to Mera and forgotten for Annapurna is a silent
billing bug.

So `docker/freeradius/gen-tenant-site.sh` derives it at **image build time**,
making exactly three mechanical changes:

1. `server default {` → `server annapurna {`
2. drops the top-level `listen{}` blocks — this server owns no socket, it is
   reached only via client routing. Leaving them in would try to bind
   1812/1813 twice and abort startup.
3. rewrites every reference to the `sql` instance (both bare module calls and
   `%{sql:...}` xlats) to `sql_annapurna`.

It then **fails the build** if any unrewritten `sql` reference or surviving
`listen{}` remains — a generated site that silently still talks to Mera is
worse than no build at all.

Mera's policy stays the single source of truth: change
`sites-enabled/default`, rebuild, and Annapurna inherits the change.

---

## 3. Layout

| | Mera | Annapurna |
|---|---|---|
| Compose project | `airlink3-prod` | `airlink3-annapurna` |
| Repo | `/home/airlink_mera` | `/home/airlink_annapurna` |
| Web | `:8090` | `:8091` |
| DB container | `airlink-mera-prod-mariadb` | `airlink-mariadb-annapurna` |
| DB host port | `127.0.0.1:3308` | `127.0.0.1:3309` |
| Schema | `airlink_mera` | `airlink_annapurna` |
| Virtual server | `default` | `annapurna` |
| SQL instance | `sql` | `sql_annapurna` |
| Clients file | `clients.conf` | `clients-annapurna.conf` |
| Client name prefix | *(none)* | `ann_` |
| FreeRADIUS | **owns it** (`airlink-prod-freeradius`) | **shares Mera's** |

Both clients files live on the shared `radius_shared` volume and are
`$INCLUDE`d by the stock `clients.conf`.

### Container naming

Annapurna's containers use `airlink-<role>-<tenant>`:

| Role | Annapurna | Mera (legacy naming) |
|---|---|---|
| Backend (php-fpm) | `airlink-backend-annapurna` | `airlink-mera-prod-app` |
| Frontend (nginx) | `airlink-frontend-annapurna` | `airlink-mera-prod-web` |
| Database | `airlink-mariadb-annapurna` | `airlink-mera-prod-mariadb` |
| Queue worker | `airlink-queue-annapurna` | `airlink-mera-prod-queue` |
| Scheduler | `airlink-scheduler-annapurna` | `airlink-mera-prod-scheduler` |

Mera still uses the older `airlink-mera-prod-*` form; renaming it means
recreating live production containers, so it was left alone.

Only `container_name` follows this scheme. The compose **service** names are
deliberately untouched — `annapurna-mariadb` is the DNS name that
`mods-enabled/sql_annapurna` connects to, so renaming the service would break
the RADIUS→database link, while renaming the container does not.

### Why the RADIUS container has no tenant in its name

Every other container in the Mera stack is named `airlink-mera-prod-*`, but
the RADIUS one is plain `airlink-prod-freeradius`. The asymmetry is the
point: it is the only container serving both tenants, and naming it after one
of them invites the assumption that restarting it affects only that tenant.
It is *defined* in Mera's compose file because it has to live somewhere, not
because it belongs to Mera.

### Why two clients files rather than one

Each app's `ClientsConfService` names blocks `{shortname}_{id}`, and both
tenants number their devices from id 1. In one shared file those namespaces
would eventually collide, and FreeRADIUS refuses to start on a duplicate
client name — taking **both** tenants down. Separate files plus the `ann_`
prefix (`RADIUS_CLIENT_PREFIX`) make that impossible, and mean the two apps
never write the same file.

### Networking

`airlink_tenant_link` (172.31.0.0/16) is shared infrastructure, declared
`external` by both stacks so neither deletes it on `down`. Create it once:

```bash
docker network create airlink_tenant_link --subnet 172.31.0.0/16
```

Mera's FreeRADIUS and Annapurna's DB + app all join it. That subnet is not
arbitrary: Mera's `client docker_networks` covers `172.16.0.0/12`, which
*contains* 172.31.0.0/16, and FreeRADIUS resolves overlapping clients by
longest prefix — so the `/16` `annapurna_docker` stanza wins for Annapurna's
containers while Mera's `/12` keeps matching its own.

Annapurna's DB service is named `annapurna-mariadb`, **not** `mariadb`, on
purpose. It shares a network with the FreeRADIUS container, and a second host
answering to `mariadb` there would make FreeRADIUS's own `mariadb` lookup
ambiguous — Mera's SQL instance could resolve to Annapurna's server.

---

## 4. Blast radius

The point of one shared server is a shared failure domain, so two things are
deliberately defended:

- **`sql_annapurna` uses `pool { start = 0 }`** (Mera's uses `1`). If
  Annapurna's MariaDB is down or still booting, opening a connection at
  instantiate time would abort FreeRADIUS startup and take **Mera's live
  authentication** down with it. With `start = 0` nothing is attempted until
  an Annapurna NAS actually sends a request.
- **A config error in the generated site breaks both tenants.** Always run
  the config check below before restarting.

---

## 5. Operating it

Config check (never restart without it — this is a live server):

```bash
docker compose -f docker-compose.mera.yml build freeradius
docker run --rm --entrypoint freeradius --network airlink3-prod_default \
  -v airlink3-prod_radius_shared:/var/lib/airlink-radius \
  airlink3-prod-freeradius:latest -XC
```

Expect `Configuration appears to be OK`, plus `server annapurna` and
`rlm_sql (sql_annapurna)` in the output.

Prove tenant isolation end to end:

```bash
./scripts/tenant/verify-tenant-routing.sh
```

It plants a probe credential in one tenant's `radcheck` only, then
authenticates from both tenants' addresses and asserts Accept for the owner
and **Reject** for the other. The Reject half is the one that matters — a
server wired to a single DB would still pass the Accept half.

Remember that the prod stack builds `app`, `queue` and `scheduler` from one
Dockerfile as three separately-tagged images; build all three or the others
keep running old code.

---

## 6. Known limits

- **`radius.log` is shared.** FreeRADIUS writes one server log for both
  tenants and it is not per-virtual-server. Annapurna's app therefore mounts
  only the `radacct` subpath (already partitioned per NAS IP), not the whole
  log directory — so its "RADIUS Log" tab reports the file as missing rather
  than showing Mera's usernames. Splitting it properly needs a per-tenant
  `linelog` in each virtual server's `post-auth`.
- **`sites-enabled/inner-tunnel` is not tenant-aware** — it still calls
  Mera's `sql`. It only matters for EAP inner authentication (PEAP/TTLS),
  which this deployment does not use: MikroTik hotspot and PPPoE authenticate
  with PAP/CHAP/MS-CHAP directly. If EAP is ever enabled for Annapurna, that
  file needs the same generator treatment and a per-tenant `eap` instance.
- **Secrets are still the `testing123` placeholder**, inherited from Mera's
  seed. Rotate per device before either tenant carries live traffic.
