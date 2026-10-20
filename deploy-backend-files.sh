#!/bin/bash
# Usage: ./deploy-backend-files.sh <container> <path-under-backend> [...]
# Hot-copy edited backend files into a running container with safe modes.
# (Plain `docker cp` keeps host modes; files edited as root come out 640 and
# php-fpm/www-data then returns 500 "Permission denied".)
set -euo pipefail
c="$1"; shift
for f in "$@"; do
  docker cp "backend/$f" "$c:/var/www/html/$f"
  docker exec "$c" chmod a+rX "/var/www/html/$f"
done
docker exec "$c" sh -c 'chown -R www-data:www-data storage bootstrap/cache; php artisan route:clear >/dev/null; php artisan route:cache >/dev/null'
