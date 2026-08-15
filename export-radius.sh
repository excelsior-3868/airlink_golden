#!/usr/bin/env bash
# ==============================================================================
# Airlink v3.0 - FreeRADIUS Configuration Exporter
# ==============================================================================
# This script bundles the active FreeRADIUS 3.2.5 configuration, custom
# dictionaries, SQL policies, clients.conf, systemd path watchers, and
# user/group metadata from this server into a transferable tarball package.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE_NAME="radius-replica-bundle-${TIMESTAMP}.tar.gz"
LATEST_LINK="radius-replica-bundle.tar.gz"
TEMP_STAGE="$(mktemp -d /tmp/radius_export_XXXXXX)"

cleanup() {
    rm -rf "${TEMP_STAGE}"
}
trap cleanup EXIT

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   FreeRADIUS Server Configuration Exporter           ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Check root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This script must be run as root (or via sudo) to read system files.${NC}"
    exit 1
fi

# Preflight check on current FreeRADIUS installation
echo -e "${YELLOW}[1/5] Validating current FreeRADIUS configuration syntax...${NC}"
if command -v freeradius >/dev/null 2>&1; then
    if freeradius -CX >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Local FreeRADIUS configuration syntax is valid (freeradius -CX passed).${NC}"
    else
        echo -e "${RED}✗ Warning: freeradius -CX reported errors. Proceeding with export anyway...${NC}"
    fi
else
    echo -e "${YELLOW}! freeradius binary not found in PATH; skipping syntax preflight.${NC}"
fi

# Prepare staging directories
echo -e "${YELLOW}[2/5] Staging configuration files and systemd units...${NC}"
STAGE_RAD="${TEMP_STAGE}/freeradius_config"
STAGE_SYSTEMD="${TEMP_STAGE}/systemd"
mkdir -p "${STAGE_RAD}" "${STAGE_SYSTEMD}" "${OUTPUT_DIR}"

# 1. Copy /etc/freeradius/3.0 configuration tree preserving symlinks, permissions, and hidden files
if [ -d "/etc/freeradius/3.0" ]; then
    cp -a /etc/freeradius/3.0/. "${STAGE_RAD}/"
    echo -e "${GREEN}✓ Copied /etc/freeradius/3.0/ configuration tree.${NC}"
else
    echo -e "${RED}[ERROR] Directory /etc/freeradius/3.0 not found!${NC}"
    exit 1
fi

# Ensure .restart-trigger exists in stage
if [ ! -f "${STAGE_RAD}/.restart-trigger" ]; then
    touch "${STAGE_RAD}/.restart-trigger"
fi

# 2. Copy systemd restart watcher units if present
if [ -f "/etc/systemd/system/freeradius-restart-watch.path" ]; then
    cp -a /etc/systemd/system/freeradius-restart-watch.path "${STAGE_SYSTEMD}/"
    echo -e "${GREEN}✓ Copied freeradius-restart-watch.path${NC}"
fi

if [ -f "/etc/systemd/system/freeradius-restart-watch.service" ]; then
    cp -a /etc/systemd/system/freeradius-restart-watch.service "${STAGE_SYSTEMD}/"
    echo -e "${GREEN}✓ Copied freeradius-restart-watch.service${NC}"
fi

# 3. Create metadata manifest
echo -e "${YELLOW}[3/5] Generating manifest and version metadata...${NC}"
cat <<EOF > "${TEMP_STAGE}/metadata.env"
EXPORTED_AT="${TIMESTAMP}"
SOURCE_HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
SOURCE_OS="$(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '\"')"
FREERADIUS_VERSION="$(freeradius -v 2>/dev/null | head -n 1 || echo '3.2.5')"
REQUIRED_PACKAGES="freeradius freeradius-common freeradius-config freeradius-mysql freeradius-utils libfreeradius3"
RADIUSWEB_GID="5555"
EOF

# 4. Copy installer and README into bundle
if [ -f "${SCRIPT_DIR}/install-radius.sh" ]; then
    cp "${SCRIPT_DIR}/install-radius.sh" "${TEMP_STAGE}/"
    chmod +x "${TEMP_STAGE}/install-radius.sh"
fi

if [ -f "${SCRIPT_DIR}/README.md" ]; then
    cp "${SCRIPT_DIR}/README.md" "${TEMP_STAGE}/"
fi

# 5. Build tarball
echo -e "${YELLOW}[4/5] Building distribution archive...${NC}"
tar -czf "${OUTPUT_DIR}/${ARCHIVE_NAME}" -C "${TEMP_STAGE}" .
ln -sf "${ARCHIVE_NAME}" "${OUTPUT_DIR}/${LATEST_LINK}"

echo -e "${YELLOW}[5/5] Export complete!${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN} Archive created successfully:${NC}"
echo -e "   ${OUTPUT_DIR}/${ARCHIVE_NAME}"
echo -e "   ${OUTPUT_DIR}/${LATEST_LINK} (symlink)"
echo -e "${GREEN}======================================================${NC}"
echo
echo -e "${BLUE}To transfer and install on your new VPS, run:${NC}"
echo -e "  1. Copy to new server:"
echo -e "     ${YELLOW}scp ${OUTPUT_DIR}/${ARCHIVE_NAME} root@<NEW_VPS_IP>:/tmp/${NC}"
echo
echo -e "  2. On the new server, extract and install:"
echo -e "     ${YELLOW}ssh root@<NEW_VPS_IP>${NC}"
echo -e "     ${YELLOW}mkdir -p /tmp/radius-install && cd /tmp/radius-install${NC}"
echo -e "     ${YELLOW}tar -xzf /tmp/${ARCHIVE_NAME}${NC}"
echo -e "     ${YELLOW}sudo bash install-radius.sh${NC}"
echo
