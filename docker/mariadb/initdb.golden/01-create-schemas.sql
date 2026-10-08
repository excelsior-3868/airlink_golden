-- Airlink v3.0 — MariaDB init for the GOLDEN tenant (runs once, first boot).
--
-- Deliberately does NOT load any legacy dump. Mera's init mounts
-- nalrd_backup.sql and ETLs the v2.0 data in; Golden is a brand new
-- system and starts with an empty database. Its schema is created entirely
-- by `php artisan migrate` on first app boot (see docker/backend/
-- prod-entrypoint.sh), and `db:seed` adds only the default admin user and
-- the system permission matrix.
--
-- The entrypoint (MARIADB_DATABASE/MARIADB_USER) has already created the
-- `airlink_golden` schema and the `airlink` user with full rights on it.

-- Empty stand-in for the `legacy` connection declared in config/database.php.
-- Nothing reads it on this tenant, but having the schema exist means a stray
-- legacy query fails as "table not found" rather than "unknown database".
CREATE DATABASE IF NOT EXISTS `airlink_golden_legacy`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

GRANT SELECT ON `airlink_golden_legacy`.* TO 'airlink'@'%';

-- The shared FreeRADIUS connects as this same user from the sql_golden
-- module instance (read radcheck/radreply, write radacct/radpostauth) — all
-- inside `airlink_golden`, already granted by the entrypoint.
FLUSH PRIVILEGES;
