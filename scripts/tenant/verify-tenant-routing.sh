#!/bin/bash
# Airlink v3.0 — prove that the shared FreeRADIUS picks each tenant's database
# from the NAS the request came from.
#
# The test is deliberately a cross-check rather than a smoke test. It plants a
# probe credential in ONE tenant's radcheck table only, then authenticates from
# BOTH tenants' network ranges and asserts:
#
#   from Annapurna's range (172.31.x) : annapurna probe ACCEPT , mera probe REJECT
#   from Mera's range      (172.18.x) : mera probe      ACCEPT , annapurna probe REJECT
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

MERA_DB=airlink-mera-prod-mariadb
ANN_DB=airlink-mariadb-annapurna
MERA_NET=airlink3-prod_default
ANN_NET=airlink_tenant_link
SECRET="${RADIUS_SECRET:-testing123}"
PROBE_PW=probe-pass-123

mera_sql() { docker exec -i "$MERA_DB" mariadb -uairlink -pairlink_pass airlink_mera -N -B -e "$1"; }
ann_sql()  { docker exec -i "$ANN_DB"  mariadb -uairlink -pairlink_pass airlink_annapurna -N -B -e "$1"; }

cleanup() {
  echo "--- removing probe rows"
  mera_sql "DELETE FROM radcheck WHERE username='probe-mera';"      >/dev/null 2>&1
  ann_sql  "DELETE FROM radcheck WHERE username='probe-annapurna';" >/dev/null 2>&1
}
trap cleanup EXIT

echo "=== target: ${RADIUS_HOSTNAME}"
echo "=== planting probe credentials (one per tenant, never both) ==="
mera_sql "DELETE FROM radcheck WHERE username='probe-mera';
          INSERT INTO radcheck (username,attribute,op,value)
          VALUES ('probe-mera','Cleartext-Password',':=','${PROBE_PW}');" || exit 1
ann_sql  "DELETE FROM radcheck WHERE username='probe-annapurna';
          INSERT INTO radcheck (username,attribute,op,value)
          VALUES ('probe-annapurna','Cleartext-Password',':=','${PROBE_PW}');" || exit 1
echo "  probe-mera       -> airlink_mera only"
echo "  probe-annapurna  -> airlink_annapurna only"

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

echo
echo "=== sourced from ANNAPURNA (172.31.0.0/16 -> virtual_server=annapurna) ==="
check "annapurna probe should authenticate" Accept "$(auth_from "$ANN_NET" probe-annapurna)"
check "mera probe must NOT be visible here" Reject "$(auth_from "$ANN_NET" probe-mera)"

echo
echo "=== sourced from MERA (172.18.0.0/16 -> virtual_server=default) ==="
check "mera probe should authenticate"           Accept "$(auth_from "$MERA_NET" probe-mera)"
check "annapurna probe must NOT be visible here" Reject "$(auth_from "$MERA_NET" probe-annapurna)"

echo
if [ "$fail" = 0 ]; then
  echo "RESULT: tenant routing verified — each NAS reaches only its own database."
else
  echo "RESULT: FAILED — tenant isolation is not correct. Do not put this live."
fi
exit "$fail"
