# Airlink FreeRADIUS Server Replica Toolkit

This toolkit enables automated replication of the exact FreeRADIUS server setup (version 3.2.5, dictionaries, SQL modules, custom voucher lifecycle rules, MAC binding, clients.conf, and systemd path watchers) to a new VPS running Ubuntu 24.04 / 22.04 or Debian 12.

---

## What is Replicated?

1. **FreeRADIUS 3.2.x Core & Modules**:
   - `freeradius`, `freeradius-common`, `freeradius-config`, `freeradius-mysql`, `freeradius-utils`, `libfreeradius3`.
2. **Server Configurations (`/etc/freeradius/3.0`)**:
   - `radiusd.conf`: Logging configuration and `reject_delay = 0` (critical for MikroTik Hotspot compatibility).
   - `dictionary`: Custom attribute definitions (`ATTRIBUTE Expire-After 16 integer`).
   - `clients.conf`: Complete NAS client definitions (both testing clients and production routers).
   - `sites-available/default` & `sites-available/inner-tunnel`: Voucher lifecycle validation, live quota checks, MAC binding capture, and SQL integration.
   - `mods-available/sqlcounter` & `mods-available/detail`: Quota calculation and `radiusweb` group access.
   - `mods-config/sql/main/mysql/queries.conf`: Simultaneous use and connection verification queries.
3. **System Users, Groups & Permissions**:
   - `radiusweb` group (GID 5555) with `freerad` and `www-data` memberships.
   - 0660 permissions on `clients.conf` and `.restart-trigger` for Airlink API management.
   - 0750 permissions on `/var/log/freeradius/radacct`.
4. **Systemd Automation**:
   - `freeradius-restart-watch.path` & `freeradius-restart-watch.service` to automatically reload FreeRADIUS when `.restart-trigger` is updated.
5. **Firewall Rules**:
   - Automatic opening of UDP ports `1812` (Authentication) and `1813` (Accounting) in UFW.

---

## Step-by-Step Migration Instructions

### Step 1: Export Bundle from this Server

On this server, run the export script as root:

```bash
sudo bash /home/airlink_3.0/scripts/radius-replica/export-radius.sh
```

This generates an archive in `/home/airlink_3.0/scripts/radius-replica/output/`:
- `radius-replica-bundle-<TIMESTAMP>.tar.gz` (and symlink `radius-replica-bundle.tar.gz`)

---

### Step 2: Copy the Bundle to the New VPS

Copy the generated tarball to your new VPS:

```bash
scp /home/airlink_3.0/scripts/radius-replica/output/radius-replica-bundle.tar.gz root@<NEW_VPS_IP>:/tmp/
```

---

### Step 3: Run the Installer on the New VPS

SSH into your new VPS and execute the installer:

```bash
ssh root@<NEW_VPS_IP>

# Create working directory and extract
mkdir -p /tmp/radius-install && cd /tmp/radius-install
tar -xzf /tmp/radius-replica-bundle.tar.gz

# Run interactive installer (prompts for database host/port/credentials)
sudo bash install-radius.sh
```

#### Non-Interactive / Scripted Installation:

If you prefer passing all database parameters directly:

```bash
sudo bash install-radius.sh \
  --non-interactive \
  --db-host="127.0.0.1" \
  --db-port=3306 \
  --db-name="airlink" \
  --db-user="airlink" \
  --db-pass="your_db_password"
```

---

### Step 4: Verification & Testing

1. **Verify Configuration Syntax**:
   ```bash
   sudo freeradius -CX
   ```
   *Expected output: `Configuration appears to be OK`*

2. **Verify Daemon Status**:
   ```bash
   sudo systemctl status freeradius
   ```

3. **Check Listening UDP Ports**:
   ```bash
   ss -tulpn | grep -E "1812|1813"
   ```

4. **Run a Test Authentication Query**:
   ```bash
   radtest testing123 testing123 127.0.0.1 0 testing123
   ```
   *(Or using any voucher username/password present in your `vouchers`/`radcheck` table)*

5. **Test Backend Restart Trigger**:
   ```bash
   touch /etc/freeradius/3.0/.restart-trigger
   # Check that systemd triggered a restart
   sudo journalctl -u freeradius-restart-watch.service -n 10 --no-pager
   ```
