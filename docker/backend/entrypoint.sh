#!/bin/bash
# Airlink v3.0 backend entrypoint.
# Runs on every container start. First-run tasks (composer install, key
# generate) are guarded so restarts are fast. Only the primary `backend`
# service runs migrations/seed; queue & scheduler set RUN_MIGRATIONS=0.
set -euo pipefail

cd /var/www/html

# 1. Dependencies (first run only — vendor is bind-mounted and persists).
if [ ! -f vendor/autoload.php ]; then
  echo "[backend] Installing composer dependencies ..."
  composer install --no-interaction --prefer-dist --no-progress
fi

# 2. .env. Gitignored, so a fresh clone / fresh bind mount has only
# .env.example, and key:generate needs the file to already exist.
#
# The compose environment is NOT enough on its own: `php artisan serve`
# unsets every non-passthrough env var in the dev-server child process
# whenever a .env exists (ServeCommand::startProcess), so DB_*/RADIUS_*
# supplied only by compose are invisible to HTTP requests even though the
# artisan CLI sees them — HTTP would silently fall back to .env.example's
# DB_CONNECTION=sqlite. So mirror the compose values into .env.
#
# The primary service owns this shared file; queue & scheduler read the same
# values straight from their own compose environment (no `serve` in between),
# and only wait for the file to exist so they don't boot without an APP_KEY.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  if [ ! -f .env ]; then
    echo "[backend] Seeding .env from .env.example ..."
    cp .env.example .env
  fi

  echo "[backend] Syncing compose config into .env ..."
  for key in $(env | sed -n 's/^\(DB_[A-Z_]*\|LEGACY_DB_[A-Z_]*\|RADIUS_[A-Z_]*\|DOCKER_PROXY_URL\|FREERADIUS_CONTAINER\)=.*/\1/p'); do
    val="$(printenv "${key}")"
    # Rewrite by delete-then-append so the value never passes through sed
    # (passwords may contain characters sed would treat as syntax).
    sed -i "/^${key}=/d" .env
    case "${val}" in
      *[[:space:]\#]*) printf '%s="%s"\n' "${key}" "${val}" >> .env ;;
      *)               printf '%s=%s\n'   "${key}" "${val}" >> .env ;;
    esac
  done
else
  until [ -f .env ]; do
    echo "[backend] Waiting for the primary service to create .env ..."
    sleep 2
  done
fi

# 3. App key (first run only).
if ! grep -q '^APP_KEY=base64:' .env 2>/dev/null; then
  echo "[backend] Generating APP_KEY ..."
  php artisan key:generate --force
fi

# 4. Wait for MariaDB to accept connections.
echo "[backend] Waiting for MariaDB at ${DB_HOST}:${DB_PORT} ..."
until php -r "
  try { new PDO('mysql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT'),
        getenv('DB_USERNAME'), getenv('DB_PASSWORD')); exit(0); }
  catch (Exception \$e) { exit(1); }
"; do
  sleep 2
done
echo "[backend] MariaDB is up."

# 5. Migrations + seed (primary service only).
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "[backend] Running migrations ..."
  php artisan migrate --force
  if [ "${RUN_SEED:-1}" = "1" ]; then
    echo "[backend] Seeding ..."
    php artisan db:seed --force || echo "[backend] (seed skipped/failed — non-fatal)"
  fi
fi

exec "$@"
