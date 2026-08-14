# Multi-Tenant FreeRADIUS Architecture & Deployment Guide (Strategy 1)

This document provides complete instructions for deploying a multi-tenant FreeRADIUS billing architecture on a single VPS for two tenants: **Everest** and **Mera**.

---

## 1. Architecture Overview

### Why Docker Container per Tenant?
* **Zero Cross-Tenant Outages**: A configuration error, dictionary change, or crash in Everest's RADIUS server will never disrupt Mera's active PPPoE or Hotspot user authentications.
* **Isolated Security & Data**: Each tenant operates with dedicated database schemas (`airlink_everest` and `airlink_mera`) and separate NAS shared secrets (`clients.conf`).
* **Negligible VPS Resource Impact**: FreeRADIUS runs as an ultra-lightweight C service (< 30 MB RAM per container).

### Network & Port Map (Strategy 1: Port Offsets)

| Tenant | Service | Host Public Port | Container Port | Database |
| :--- | :--- | :--- | :--- | :--- |
| **Everest** | RADIUS Auth | `1812/udp` | `1812/udp` | `airlink_everest` |
| **Everest** | RADIUS Acct | `1813/udp` | `1813/udp` | `airlink_everest` |
| **Mera** | RADIUS Auth | `1814/udp` | `1812/udp` | `airlink_mera` |
| **Mera** | RADIUS Acct | `1815/udp` | `1813/udp` | `airlink_mera` |

---

## 2. Recommended VPS File & Folder Structure

Organize your deployment files on the VPS under `/opt/airlink` or your target project directory:

```text
/opt/airlink/
├── docker-compose.yml
├── docker/
│   ├── freeradius/
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   ├── clients.conf
│   │   └── mods-enabled/
│   │       └── sql
│   └── mariadb/
│       └── init-multitenant.sql
└── tenants/
    ├── everest/
    │   └── clients.conf
    └── mera/
        └── clients.conf
```

---

## 3. Dynamic FreeRADIUS Docker Entrypoint

Create or update `docker/freeradius/entrypoint.sh` to allow dynamic database host, database name, user, and password injection via container environment variables:

```bash
#!/bin/bash
set -e

# Substitute environment variables into the FreeRADIUS SQL configuration module
if [ -f /etc/freeradius/mods-enabled/sql ]; then
    sed -i "s/server = .*/server = \"${DB_HOST:-mariadb}\"/" /etc/freeradius/mods-enabled/sql
    sed -i "s/radius_db = .*/radius_db = \"${DB_DATABASE:-airlink}\"/" /etc/freeradius/mods-enabled/sql
    sed -i "s/login = .*/login = \"${DB_USER:-airlink}\"/" /etc/freeradius/mods-enabled/sql
    sed -i "s/password = .*/password = \"${DB_PASS:-airlink_pass}\"/" /etc/freeradius/mods-enabled/sql
fi

# Launch FreeRADIUS in foreground logging mode
exec freeradius -f -l stdout
```

Make the entrypoint script executable:
```bash
chmod +x docker/freeradius/entrypoint.sh
```

---

## 4. FreeRADIUS Dockerfile

Update `docker/freeradius/Dockerfile`:

```dockerfile
FROM freeradius/freeradius-server:3.2.10

COPY mods-enabled/sql /etc/freeradius/mods-enabled/sql
COPY sites-enabled/default /etc/freeradius/sites-enabled/default
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && chown -R freerad:freerad /etc/freeradius \
    && chmod -R o-w /etc/freeradius

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

---

## 5. Production `docker-compose.yml`

```yaml
version: '3.8'

services:
  # Shared Database Engine with Isolated Tenant Schemas
  mariadb:
    image: mariadb:11
    container_name: airlink-mariadb
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-super_secret_root_pass}
    ports:
      - "127.0.0.1:3306:3306"
    volumes:
      - mariadb_data:/var/lib/mysql
      - ./docker/mariadb/init-multitenant.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5

  # =========================================================================
  # TENANT 1: EVEREST (Ports 1812/1813)
  # =========================================================================
  backend-everest:
    build:
      context: ./docker/backend
    container_name: airlink-backend-everest
    restart: unless-stopped
    environment:
      DB_HOST: mariadb
      DB_PORT: 3306
      DB_DATABASE: airlink_everest
      DB_USERNAME: everest_user
      DB_PASSWORD: everest_pass_secret
      FREERADIUS_CONTAINER: freeradius-everest
    volumes:
      - ./backend:/var/www/html
      - ./tenants/everest/clients.conf:/var/www/html/clients.conf:ro
    depends_on:
      mariadb:
        condition: service_healthy

  freeradius-everest:
    build:
      context: ./docker/freeradius
    container_name: freeradius-everest
    restart: unless-stopped
    environment:
      DB_HOST: mariadb
      DB_DATABASE: airlink_everest
      DB_USER: everest_user
      DB_PASS: everest_pass_secret
    ports:
      - "1812:1812/udp" # Everest RADIUS Auth
      - "1813:1813/udp" # Everest RADIUS Accounting
    volumes:
      - ./tenants/everest/clients.conf:/etc/freeradius/clients.conf:ro
      - radius_logs_everest:/var/log/freeradius
    depends_on:
      mariadb:
        condition: service_healthy

  # =========================================================================
  # TENANT 2: MERA (Ports 1814/1815)
  # =========================================================================
  backend-mera:
    build:
      context: ./docker/backend
    container_name: airlink-backend-mera
    restart: unless-stopped
    environment:
      DB_HOST: mariadb
      DB_PORT: 3306
      DB_DATABASE: airlink_mera
      DB_USERNAME: mera_user
      DB_PASSWORD: mera_pass_secret
      FREERADIUS_CONTAINER: freeradius-mera
    volumes:
      - ./backend:/var/www/html
      - ./tenants/mera/clients.conf:/var/www/html/clients.conf:ro
    depends_on:
      mariadb:
        condition: service_healthy

  freeradius-mera:
    build:
      context: ./docker/freeradius
    container_name: freeradius-mera
    restart: unless-stopped
    environment:
      DB_HOST: mariadb
      DB_DATABASE: airlink_mera
      DB_USER: mera_user
      DB_PASS: mera_pass_secret
    ports:
      - "1814:1812/udp" # Mera RADIUS Auth (Offset)
      - "1815:1813/udp" # Mera RADIUS Accounting (Offset)
    volumes:
      - ./tenants/mera/clients.conf:/etc/freeradius/clients.conf:ro
      - radius_logs_mera:/var/log/freeradius
    depends_on:
      mariadb:
        condition: service_healthy

volumes:
  mariadb_data:
  radius_logs_everest:
  radius_logs_mera:
```

---

## 6. MariaDB Multi-Tenant Initialization (`docker/mariadb/init-multitenant.sql`)

Create database schemas and users for both tenants automatically on container startup:

```sql
-- Everest Schema and Permissions
CREATE DATABASE IF NOT EXISTS `airlink_everest` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'everest_user'@'%' IDENTIFIED BY 'everest_pass_secret';
GRANT ALL PRIVILEGES ON `airlink_everest`.* TO 'everest_user'@'%';

-- Mera Schema and Permissions
CREATE DATABASE IF NOT EXISTS `airlink_mera` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mera_user'@'%' IDENTIFIED BY 'mera_pass_secret';
GRANT ALL PRIVILEGES ON `airlink_mera`.* TO 'mera_user'@'%';

FLUSH PRIVILEGES;
```

---

## 7. NAS Shared Secrets (`clients.conf`)

### Everest `tenants/everest/clients.conf`
```text
client everest_routers {
    ipaddr = 0.0.0.0/0
    secret = EverestSecretKey123
    shortname = everest-nas
}
```

### Mera `tenants/mera/clients.conf`
```text
client mera_routers {
    ipaddr = 0.0.0.0/0
    secret = MeraSecretKey123
    shortname = mera-nas
}
```

---

## 8. VPS Firewall Configuration (UFW)

Open the UDP ports on your VPS host system:

```bash
# Everest RADIUS Firewall Rules
sudo ufw allow 1812/udp comment 'FreeRADIUS Everest Auth'
sudo ufw allow 1813/udp comment 'FreeRADIUS Everest Accounting'

# Mera RADIUS Firewall Rules
sudo ufw allow 1814/udp comment 'FreeRADIUS Mera Auth'
sudo ufw allow 1815/udp comment 'FreeRADIUS Mera Accounting'

# Apply rules
sudo ufw reload
```

---

## 9. Router (MikroTik) Setup Instructions

### Everest MikroTik Configuration
Run this command in the MikroTik Terminal:

```routeros
/radius
add service=ppp,hotspot address=YOUR_VPS_IP authentication-port=1812 accounting-port=1813 secret="EverestSecretKey123"
```

### Mera MikroTik Configuration
Run this command in the MikroTik Terminal:

```routeros
/radius
add service=ppp,hotspot address=YOUR_VPS_IP authentication-port=1814 accounting-port=1815 secret="MeraSecretKey123"
```

---

## 10. Testing & Troubleshooting Commands

### Stream Live Container Logs
```bash
# View Everest RADIUS output
docker logs -f freeradius-everest

# View Mera RADIUS output
docker logs -f freeradius-mera
```

### Test RADIUS Authentication from VPS Terminal
```bash
# Test Everest (Port 1812)
radtest username_everest password123 127.0.0.1:1812 0 EverestSecretKey123

# Test Mera (Port 1814)
radtest username_mera password123 127.0.0.1:1814 0 MeraSecretKey123
```
