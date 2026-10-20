#!/bin/bash
# Production backend entrypoint: wait for DB, migrate, cache config, start php-fpm.
set -euo pipefail
cd /var/www/html

echo "[app] Waiting for MariaDB at ${DB_HOST}:${DB_PORT} ..."
until php -r "try { new PDO('mysql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT'), getenv('DB_USERNAME'), getenv('DB_PASSWORD')); exit(0);} catch (Exception \$e){exit(1);}"; do
  sleep 2
done

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  php artisan migrate --force
  php artisan db:seed --force || true
fi

# Guard against files that arrived with host modes (e.g. 640 root) via docker cp
# or a bind mount: php-fpm runs as www-data and must be able to read the code.
chmod -R a+rX /var/www/html 2>/dev/null || true
# ...but keep secrets readable only by the app user/group, not world-readable.
[ -f /var/www/html/.env ] && chown root:www-data /var/www/html/.env && chmod 640 /var/www/html/.env || true
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

# Cache config/routes for speed (safe to re-run).
php artisan config:cache
php artisan route:cache

exec "$@"
