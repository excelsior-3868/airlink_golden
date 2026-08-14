#!/bin/bash
# Airlink v3.0 — FreeRADIUS entrypoint.
# Seeds the shared clients.conf (only if the volume is empty), starts a
# background watcher that reloads FreeRADIUS when the app touches the
# restart-trigger file, then execs freeradius in the foreground.
set -euo pipefail

SHARED_DIR="${RADIUS_SHARED_DIR:-/var/lib/airlink-radius}"
CLIENTS_CONF="${SHARED_DIR}/clients.conf"
TRIGGER_FILE="${SHARED_DIR}/.restart-trigger"

mkdir -p "${SHARED_DIR}"

if [ ! -f "${CLIENTS_CONF}" ]; then
    echo "[freeradius] Seeding ${CLIENTS_CONF} (first run on this volume)..."
    cp /etc/freeradius/clients.conf.seed "${CLIENTS_CONF}"
fi
touch "${TRIGGER_FILE}"
chown -R freerad:radiusweb "${SHARED_DIR}"
chmod 660 "${CLIENTS_CONF}" "${TRIGGER_FILE}"

echo "[freeradius] Waiting for MariaDB at mariadb:3306 ..."
# The fd only ever exists inside this subshell — it's closed automatically
# when the subshell exits, so there's nothing to clean up in the parent.
until (echo > /dev/tcp/mariadb/3306) 2>/dev/null; do
    sleep 2
done
echo "[freeradius] MariaDB is reachable."

# Watch the trigger file the app touches after editing clients.conf
# (ClientsConfService::requestRestart) and HUP radiusd (pid 1) to reload —
# same job the host's freeradius-restart-watch.path systemd unit used to do.
(
    last=""
    seen_once=""
    while true; do
        cur="$(stat -c %Y "${TRIGGER_FILE}" 2>/dev/null || echo "")"
        if [ -n "${cur}" ] && [ "${cur}" != "${last}" ]; then
            last="${cur}"
            if [ -n "${seen_once}" ]; then
                echo "[freeradius] clients.conf changed — reloading (HUP)."
                kill -HUP 1 2>/dev/null || true
            fi
            seen_once=1
        fi
        sleep 2
    done
) &

exec freeradius -f
