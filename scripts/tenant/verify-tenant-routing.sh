#!/bin/bash
# Airlink v3.0 — prove that the shared FreeRADIUS picks each tenant's database
# from the NAS the request came from.
#
# The test is deliberately a cross-check rather than a smoke test. It plants a
# probe credential in ONE tenant's radcheck table only, then authenticates from
# EVERY tenant's network range and asserts:
#
#   from each tenant's range : its OWN probe ACCEPT, every other tenant's probe REJECT
#   (Mera 172.18.x, Annapurna 172.31.x, Golden 172.30.x)
#
# A single Accept proves the right database was read; the paired Reject proves
# the other database was NOT read. Both halves matter — a server wired to one
# database for everything would still pass the Accept half for that tenant.
#
# Requests are sourced from a short-lived container on the relevant network
# rather than from the app containers: what selects the tenant is the source
# address, and the PHP app images have no RADIUS client in them anyway.
#
# Safe to re-run: the probe rows are removed on exit.
#
#   ./verify-tenant-routing.sh
#   RADIUS_HOSTNAME=freeradius-preflight ./verify-tenant-routing.sh   # dry run
set -uo pipefail

# Override to point the same checks at a throwaway server built from a new
# image, so routing can be proven before the live container is replaced.
RADIUS_HOSTNAME="${RADIUS_HOSTNAME:-airlink-prod-freeradius}"
RADIUS_IMAGE="${RADIUS_IMAGE:-airlink3-prod-freeradius:latest}"

# tenant  db-container  db-name  network
TENANTS=(
  "mera       airlink-mera-prod-mariadb  airlink_mera       airlink3-prod_default"
  "annapurna  airlink-mariadb-annapurna  airlink_annapurna  airlink_tenant_link"
  "golden     airlink-mariadb-golden     airlink_golden     airlink_golden_link"
)
SECRET="${RADIUS_SECRET:-testing123}"
PROBE_PW=probe-pass-123

t_sql() { # t_sql <tenant> <sql>
  local row name c db
  for row in "${TENANTS[@]}"; do
    read -r name c db _ <<<"$row"
    [ "$name" = "$1" ] && { docker exec -i "$c" mariadb -uairlink -pairlink_pass "$db" -N -B -e "$2"; return; }
  done
  return 1
}

cleanup() {
  echo "--- removing probe rows"
  local row name
  for row in "${TENANTS[@]}"; do
    read -r name _ <<<"$row"
    t_sql "$name" "DELETE FROM radcheck WHERE username='probe-$name';" >/dev/null 2>&1
  done
}
trap cleanup EXIT

echo "=== target: ${RADIUS_HOSTNAME}"
echo "=== planting probe credentials (one per tenant, never in two) ==="
for row in "${TENANTS[@]}"; do
  read -r name _ db _ <<<"$row"
  t_sql "$name" "DELETE FROM radcheck WHERE username='probe-$name';
                 INSERT INTO radcheck (username,attribute,op,value)
                 VALUES ('probe-$name','Cleartext-Password',':=','${PROBE_PW}');" || exit 1
  echo "  probe-$name -> $db only"
done

# auth_from <docker-network> <username> -> "Accept" | "Reject"
# The source address is what picks the tenant, so the network matters.
auth_from() {
  local net="$1" user="$2"
  if docker run --rm --entrypoint radtest --network "$net" "$RADIUS_IMAGE" \
       "$user" "$PROBE_PW" "${RADIUS_HOSTNAME}:1812" 0 "$SECRET" 2>&1 \
       | grep -q 'Access-Accept'; then
    echo Accept
  else
    echo Reject
  fi
}

fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  PASS  %-46s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-46s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

for src in "${TENANTS[@]}"; do
  read -r sname _ _ snet <<<"$src"
  echo
  echo "=== sourced from ${sname^^} (network $snet) ==="
  for tgt in "${TENANTS[@]}"; do
    read -r tname _ <<<"$tgt"
    if [ "$tname" = "$sname" ]; then
      check "$tname probe should authenticate" Accept "$(auth_from "$snet" "probe-$tname")"
    else
      check "$tname probe must NOT be visible here" Reject "$(auth_from "$snet" "probe-$tname")"
    fi
  done
done

echo
if [ "$fail" = 0 ]; then
  echo "RESULT: tenant routing verified — each NAS reaches only its own database."
else
  echo "RESULT: FAILED — tenant isolation is not correct. Do not put this live."
fi
exit "$fail"
