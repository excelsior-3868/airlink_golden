#!/bin/bash
# Airlink v3.0 — derive a tenant virtual server from sites-enabled/default.
#
# The Mera policy in sites-enabled/default is the single source of truth. A
# second tenant needs the SAME policy but pointed at its own SQL instance, so
# rather than maintaining a divergent copy we generate one at image build time.
#
#   gen-tenant-site.sh <tenant-name> <sql-instance> <src> <dst>
#
# Three transformations, and deliberately nothing else:
#   1. `server default {`  ->  `server <tenant> {`
#   2. drop the top-level listen{} blocks — this server owns no socket; it is
#      reached only because its NAS clients set `virtual_server = <tenant>`.
#      Leaving them in would try to bind 1812/1813 twice and abort startup.
#   3. rewrite every reference to the `sql` module instance (both the bare
#      module calls and the `%{sql:...}` xlats) to <sql-instance>.
#
# Because it is purely mechanical, policy changes made to the Mera site
# propagate to every tenant on the next build.
set -euo pipefail

TENANT="${1:?tenant name required}"
SQL_INSTANCE="${2:?sql instance required}"
SRC="${3:?source site required}"
DST="${4:?destination site required}"

awk -v tenant="$TENANT" -v sqlinst="$SQL_INSTANCE" '
    # --- 2. strip top-level listen{} blocks ---------------------------------
    # They open at column 0 ("listen {") and close at a column-0 "}".
    /^listen[[:space:]]*\{/ { in_listen = 1; next }
    in_listen { if ($0 ~ /^\}/) in_listen = 0; next }

    # --- 1. rename the virtual server --------------------------------------
    /^server[[:space:]]+default[[:space:]]*\{/ {
        print "server " tenant " {"
        next
    }

    {
        # --- 3a. bare module calls: a line that is only "sql" or "-sql",
        # optionally indented. Anchored so it can never touch a word that
        # merely contains "sql" (sqlcounter, sql_session_start, pgsql-voip).
        if ($0 ~ /^[[:space:]]*-?sql[[:space:]]*$/) {
            sub(/sql[[:space:]]*$/, sqlinst)
        }
        # --- 3b. inline xlats: %{sql: ... }
        gsub(/%\{sql:/, "%{" sqlinst ":")
        print
    }
' "$SRC" > "$DST"

# Fail loudly rather than shipping a site that silently still talks to Mera.
if grep -qE '^[[:space:]]*-?sql[[:space:]]*$|%\{sql:' "$DST"; then
    echo "gen-tenant-site: ERROR — unrewritten 'sql' references remain in $DST" >&2
    grep -nE '^[[:space:]]*-?sql[[:space:]]*$|%\{sql:' "$DST" >&2
    exit 1
fi

if grep -qE '^listen[[:space:]]*\{' "$DST"; then
    echo "gen-tenant-site: ERROR — listen{} block survived into $DST" >&2
    exit 1
fi

echo "gen-tenant-site: wrote $DST (tenant=$TENANT, sql=$SQL_INSTANCE)"
