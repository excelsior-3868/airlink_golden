#!/usr/bin/env bash
# ==============================================================================
# Airlink v3.0 - FreeRADIUS Replication & Setup Installer
# ==============================================================================
# This script installs FreeRADIUS 3.2.x on a new VPS server (Ubuntu/Debian),
# configures users, groups, permissions, custom dictionaries, SQL policies,
# database connectivity, clients.conf, and systemd path watchers to replicate
# the exact Airlink FreeRADIUS environment.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="${SCRIPT_DIR}/freeradius_config"
SYSTEMD_SRC="${SCRIPT_DIR}/systemd"

# Defaults matching current server
DB_HOST="127.0.0.1"
DB_PORT="3308"
DB_NAME="airlink"
DB_USER="airlink"
DB_PASS="airlink_pass"
NON_INTERACTIVE=false
CONFIGURE_UFW=true
START_SERVICE=true

show_help() {
    cat <<EOF
Usage: sudo bash install-radius.sh [OPTIONS]

Options:
  -h, --help                Show this help message and exit
  -y, --non-interactive     Run non-interactively using defaults or provided flags
  --db-host <HOST>          MariaDB/MySQL host (default: ${DB_HOST})
  --db-port <PORT>          MariaDB/MySQL port (default: ${DB_PORT})
  --db-name <NAME>          Database name (default: ${DB_NAME})
  --db-user <USER>          Database username (default: ${DB_USER})
  --db-pass <PASS>          Database password (default: ${DB_PASS})
  --no-ufw                  Skip configuring UFW firewall rules
  --skip-start              Do not start/restart FreeRADIUS at end

Example:
  sudo bash install-radius.sh --db-host=127.0.0.1 --db-port=3306 --db-pass=mySecretPass
EOF
}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_help
            exit 0
            ;;
        -y|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --db-host=*)
            DB_HOST="${1#*=}"
            shift
            ;;
        --db-host)
            DB_HOST="$2"
            shift 2
            ;;
        --db-port=*)
            DB_PORT="${1#*=}"
            shift
            ;;
        --db-port)
            DB_PORT="$2"
            shift 2
            ;;
        --db-name=*)
            DB_NAME="${1#*=}"
            shift
            ;;
        --db-name)
            DB_NAME="$2"
            shift 2
            ;;
        --db-user=*)
            DB_USER="${1#*=}"
            shift
            ;;
        --db-user)
            DB_USER="$2"
            shift 2
            ;;
        --db-pass=*)
            DB_PASS="${1#*=}"
            shift
            ;;
        --db-pass)
            DB_PASS="$2"
            shift 2
            ;;
        --no-ufw)
            CONFIGURE_UFW=false
            shift
            ;;
        --skip-start)
            START_SERVICE=false
            shift
            ;;
        *)
            echo -e "${RED}[ERROR] Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   FreeRADIUS Server Replica Installer (Airlink 3.0)  ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This installer must be run as root (or via sudo).${NC}"
    exit 1
fi

# Verify config directory exists
if [ ! -d "${CONFIG_SRC}" ]; then
    echo -e "${RED}[ERROR] Configuration directory '${CONFIG_SRC}' not found!${NC}"
    echo -e "Make sure you extracted the complete replica bundle archive before running this script."
    exit 1
fi

# Detect OS
echo -e "${YELLOW}[1/8] Detecting Operating System...${NC}"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${ID:-unknown}"
    OS_VER="${VERSION_ID:-unknown}"
    echo -e "${GREEN}✓ Detected ${PRETTY_NAME:-$OS_NAME $OS_VER}${NC}"
else
    echo -e "${RED}[ERROR] Cannot detect operating system from /etc/os-release.${NC}"
    exit 1
fi

if [[ "$OS_NAME" != "ubuntu" && "$OS_NAME" != "debian" ]]; then
    echo -e "${YELLOW}! Warning: This installer is optimized for Ubuntu 24.04/22.04 and Debian 12.${NC}"
    if [ "$NON_INTERACTIVE" = false ]; then
        read -r -p "Continue anyway? [y/N]: " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
    fi
fi

# Prompt for database parameters if interactive
if [ "$NON_INTERACTIVE" = false ]; then
    echo
    echo -e "${CYAN}--- Database Connection Configuration ---${NC}"
    echo -e "FreeRADIUS rlm_sql requires connectivity to your MariaDB/MySQL server."
    echo
    read -r -p "Database Host [${DB_HOST}]: " input_db_host
    DB_HOST="${input_db_host:-$DB_HOST}"

    read -r -p "Database Port [${DB_PORT}]: " input_db_port
    DB_PORT="${input_db_port:-$DB_PORT}"

    read -r -p "Database Name [${DB_NAME}]: " input_db_name
    DB_NAME="${input_db_name:-$DB_NAME}"

    read -r -p "Database Username [${DB_USER}]: " input_db_user
    DB_USER="${input_db_user:-$DB_USER}"

    read -r -p "Database Password [${DB_PASS}]: " input_db_pass
    DB_PASS="${input_db_pass:-$DB_PASS}"
    echo
fi

echo -e "${CYAN}Target Database Settings:${NC}"
echo -e "  Host:     ${DB_HOST}"
echo -e "  Port:     ${DB_PORT}"
echo -e "  Database: ${DB_NAME}"
echo -e "  User:     ${DB_USER}"
echo -e "  Password: [HIDDEN]"
echo

# 1. Install FreeRADIUS packages via APT
echo -e "${YELLOW}[2/8] Installing FreeRADIUS 3.2.x packages...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq freeradius freeradius-common freeradius-config freeradius-mysql freeradius-utils libfreeradius3

INSTALLED_VER="$(freeradius -v 2>/dev/null | head -n 1 || echo 'Unknown')"
echo -e "${GREEN}✓ Installed: ${INSTALLED_VER}${NC}"

# 2. Configure radiusweb group and permissions
echo -e "${YELLOW}[3/8] Setting up system users and groups...${NC}"
if ! getent group radiusweb >/dev/null 2>&1; then
    groupadd -g 5555 radiusweb 2>/dev/null || groupadd radiusweb
    echo -e "${GREEN}✓ Created group 'radiusweb'${NC}"
else
    echo -e "${GREEN}✓ Group 'radiusweb' already exists.${NC}"
fi

# Add freerad to radiusweb
usermod -aG radiusweb freerad 2>/dev/null || true
echo -e "${GREEN}✓ Added user 'freerad' to group 'radiusweb'${NC}"

# Add www-data to radiusweb if www-data exists (for local web server/PHP API)
if id www-data >/dev/null 2>&1; then
    usermod -aG radiusweb www-data
    echo -e "${GREEN}✓ Added user 'www-data' to group 'radiusweb'${NC}"
fi

# 3. Deploy FreeRADIUS Configuration
echo -e "${YELLOW}[4/8] Deploying FreeRADIUS configuration files...${NC}"
RAD_DEST="/etc/freeradius/3.0"

if [ -d "${RAD_DEST}" ]; then
    BACKUP_PATH="/etc/freeradius/3.0.bak-$(date +%Y%m%d_%H%M%S)"
    echo -e "  Backing up default config to ${BACKUP_PATH}..."
    cp -a "${RAD_DEST}" "${BACKUP_PATH}"
fi

# Copy all configuration files from bundle
mkdir -p "${RAD_DEST}"
cp -a "${CONFIG_SRC}/." "${RAD_DEST}/"
echo -e "${GREEN}✓ Installed configuration files to ${RAD_DEST}/${NC}"

# 4. Inject Database Settings into mods-available/sql
echo -e "${YELLOW}[5/8] Configuring SQL database connection in FreeRADIUS...${NC}"
SQL_MOD_FILE="${RAD_DEST}/mods-available/sql"

if [ -f "${SQL_MOD_FILE}" ]; then
    sed -i -E "s/^[[:space:]]*server[[:space:]]*=[[:space:]]*\".*\"/        server = \"${DB_HOST}\"/" "${SQL_MOD_FILE}"
    sed -i -E "s/^[[:space:]]*port[[:space:]]*=[[:space:]]*[0-9]+/        port = ${DB_PORT}/" "${SQL_MOD_FILE}"
    sed -i -E "s/^[[:space:]]*login[[:space:]]*=[[:space:]]*\".*\"/        login = \"${DB_USER}\"/" "${SQL_MOD_FILE}"
    sed -i -E "s/^[[:space:]]*password[[:space:]]*=[[:space:]]*\".*\"/        password = \"${DB_PASS}\"/" "${SQL_MOD_FILE}"
    sed -i -E "s/^[[:space:]]*radius_db[[:space:]]*=[[:space:]]*\".*\"/        radius_db = \"${DB_NAME}\"/" "${SQL_MOD_FILE}"
    echo -e "${GREEN}✓ Updated ${SQL_MOD_FILE} with specified database credentials.${NC}"
fi

# Ensure essential symlinks in mods-enabled and sites-enabled
mkdir -p "${RAD_DEST}/mods-enabled" "${RAD_DEST}/sites-enabled"
ln -sf "../mods-available/sql" "${RAD_DEST}/mods-enabled/sql"
ln -sf "../mods-available/sqlcounter" "${RAD_DEST}/mods-enabled/sqlcounter"
ln -sf "../sites-available/default" "${RAD_DEST}/sites-enabled/default"
ln -sf "../sites-available/inner-tunnel" "${RAD_DEST}/sites-enabled/inner-tunnel"

# 5. Fix permissions across /etc/freeradius/3.0 and log directories
echo -e "${YELLOW}[6/8] Enforcing file permissions and ownership...${NC}"
chown -R freerad:freerad "${RAD_DEST}"
chmod 755 "${RAD_DEST}"

# Specific Airlink permissions for dynamic API clients and restart trigger
touch "${RAD_DEST}/.restart-trigger"
chown freerad:radiusweb "${RAD_DEST}/clients.conf" "${RAD_DEST}/.restart-trigger"
chmod 660 "${RAD_DEST}/clients.conf" "${RAD_DEST}/.restart-trigger"

# Log directories
mkdir -p /var/log/freeradius/radacct
chown -R freerad:radiusweb /var/log/freeradius/radacct
chmod 750 /var/log/freeradius/radacct
chown freerad:adm /var/log/freeradius 2>/dev/null || chown freerad:freerad /var/log/freeradius
echo -e "${GREEN}✓ Permissions configured successfully.${NC}"

# 6. Install systemd restart watcher path units
echo -e "${YELLOW}[7/8] Installing systemd restart watcher units...${NC}"
if [ -d "${SYSTEMD_SRC}" ]; then
    if [ -f "${SYSTEMD_SRC}/freeradius-restart-watch.path" ]; then
        cp "${SYSTEMD_SRC}/freeradius-restart-watch.path" /etc/systemd/system/
    fi
    if [ -f "${SYSTEMD_SRC}/freeradius-restart-watch.service" ]; then
        cp "${SYSTEMD_SRC}/freeradius-restart-watch.service" /etc/systemd/system/
    fi
    systemctl daemon-reload
    systemctl enable --now freeradius-restart-watch.path
    echo -e "${GREEN}✓ Enabled freeradius-restart-watch.path${NC}"
fi

# Firewall configuration (UFW)
if [ "${CONFIGURE_UFW}" = true ] && command -v ufw >/dev/null 2>&1; then
    if ufw status | grep -qw "active"; then
        echo -e "  Adding UFW rules for RADIUS ports 1812/udp and 1813/udp..."
        ufw allow 1812/udp comment "FreeRADIUS Auth (Airlink)" >/dev/null 2>&1 || true
        ufw allow 1813/udp comment "FreeRADIUS Acct (Airlink)" >/dev/null 2>&1 || true
        echo -e "${GREEN}✓ UFW rules applied (1812/udp, 1813/udp allowed).${NC}"
    fi
fi

# 7. Syntax Verification & Service Startup
echo -e "${YELLOW}[8/8] Testing FreeRADIUS configuration syntax...${NC}"
if freeradius -CX; then
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}✓ Configuration check passed: 'Configuration appears to be OK'${NC}"
    echo -e "${GREEN}======================================================${NC}"
else
    echo -e "${RED}======================================================${NC}"
    echo -e "${RED}[ERROR] freeradius -CX reported syntax errors!${NC}"
    echo -e "Please review the output above or check database connectivity."
    echo -e "${RED}======================================================${NC}"
    exit 1
fi

if [ "${START_SERVICE}" = true ]; then
    echo -e "Starting FreeRADIUS service..."
    systemctl enable freeradius >/dev/null 2>&1 || true
    systemctl restart freeradius

    sleep 2

    if systemctl is-active --quiet freeradius; then
        echo -e "${GREEN}✓ freeradius.service is ACTIVE and running!${NC}"
        echo
        echo -e "${CYAN}Listening UDP ports:${NC}"
        ss -tulpn | grep -E "1812|1813" || netstat -tulpn 2>/dev/null | grep -E "1812|1813" || true
        echo
        echo -e "${GREEN}Replication complete and verified successfully!${NC}"
        echo -e "To run a test authentication query:"
        echo -e "  ${YELLOW}radtest testing123 testing123 127.0.0.1 0 testing123${NC}"
    else
        echo -e "${RED}[ERROR] freeradius.service failed to start.${NC}"
        echo -e "Check logs with: ${YELLOW}journalctl -u freeradius.service -e --no-pager${NC}"
        exit 1
    fi
fi
