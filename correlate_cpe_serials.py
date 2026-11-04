#!/usr/bin/env python3
"""
Airlink Golden — Automated FTTH CPE Serial Number Correlator
Scans OLT MAC tables, resolves ONT serial numbers from ont_inventory,
correlates them with live radacct sessions / subscriber MACs,
and updates pppoe_customers.onu_serial_number and onu_id.
"""

import sys
import os
import re
import time
import socket
import base64
import hashlib
import telnetlib
import subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import pymysql

# Auto-detect container netns if OLT is not reachable directly
def check_and_nsenter():
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect(("172.16.16.5", 23))
        s.close()
        return
    except Exception:
        pass

    try:
        pid = subprocess.check_output(
            ["docker", "inspect", "airlink-nms-golden", "--format", "{{.State.Pid}}"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
        if pid and pid != "0":
            cmd = ["nsenter", "-t", pid, "-n", sys.executable] + sys.argv
            os.execvp("nsenter", cmd)
    except Exception as e:
        print(f"[!] Warning: Unable to enter container netns automatically: {e}")

APP_KEY = os.getenv("APP_KEY", "base64:eQzSFYt+YkbuC2ODk4kDpCN7ovPgoCfYb+EFQgsxitM=")
DB_USER = "airlink"
DB_PASS = os.getenv("DB_PASSWORD", "airlink_pass")
DB_NAME = "airlink_golden"

def get_db():
    # Try container IP first, then golden-mariadb, then localhost:3310
    candidates = [
        ("172.21.0.2", 3306),
        ("golden-mariadb", 3306),
        ("127.0.0.1", 3310),
    ]
    for host, port in candidates:
        try:
            conn = pymysql.connect(
                host=host,
                port=port,
                user=DB_USER,
                password=DB_PASS,
                database=DB_NAME,
                cursorclass=pymysql.cursors.DictCursor,
                autocommit=True,
                connect_timeout=3
            )
            return conn
        except Exception:
            continue
    raise RuntimeError("Could not connect to database on any known host/port.")

def decrypt_password(enc_b64):
    if not enc_b64:
        return ""
    secret = APP_KEY.encode()
    key = hashlib.sha256(b"nms-secretbox-v1:" + secret).digest()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(enc_b64)
    nonce = raw[:12]
    ciphertext = raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()

def normalize_mac(raw):
    clean = re.sub(r"[^0-9a-fA-F]", "", raw)
    if len(clean) == 12:
        return ":".join(clean[i:i+2].upper() for i in range(0, 12, 2))
    return raw.upper()

def get_olts(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT o.device_id, d.name, d.ip, d.vendor, o.login_user, o.login_pass_enc, o.protocol
            FROM olts o
            JOIN devices d ON d.id = o.device_id
            WHERE d.enabled = 1
        """)
        olts = cur.fetchall()
        for o in olts:
            o["password"] = decrypt_password(o.get("login_pass_enc"))
        return olts

def exec_olt_cmd(tn, cmd, timeout=60):
    tn.write(cmd.encode("ascii") + b"\r\n")
    out = b""
    start = time.time()
    prompt_re = re.compile(rb"(?:Bijule|Udaypur|Halesi|Huawei|MA5683|MA5600)[\w-]*[>#]")
    while time.time() - start < timeout:
        idx, match, chunk = tn.expect([
            re.compile(b"---- More \\( Press .Q. to break \\) ----"),
            re.compile(b"\\{ <cr>.*\\}:"),
            re.compile(b"Are you sure.*\\(y/n\\)"),
            prompt_re,
        ], timeout=5)
        out += chunk
        if idx == 0:
            tn.write(b" ")
        elif idx == 1:
            tn.write(b"\r\n")
        elif idx == 2:
            tn.write(b"y\r\n")
        elif idx == 3:
            break
    return out.decode("ascii", errors="replace")

def fetch_olt_mac_table(host, user, password, timeout=60):
    print(f"[*] Connecting to OLT {host} as {user}...")
    try:
        tn = telnetlib.Telnet(host, 23, timeout=12)
        tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*")], timeout=10)
        tn.write(user.encode("ascii") + b"\r\n")
        tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=10)
        tn.write(password.encode("ascii") + b"\r\n")
        tn.expect([re.compile(b"[>#]")], timeout=10)
        exec_olt_cmd(tn, "enable")
        exec_olt_cmd(tn, "scroll 512")
        raw = exec_olt_cmd(tn, "display mac-address all", timeout=timeout)
        try:
            tn.write(b"quit\r\n")
            tn.close()
        except Exception:
            pass
        return raw
    except Exception as e:
        print(f"[!] Error fetching from {host}: {e}")
        return ""

def parse_mac_table(raw):
    results = []
    line_re = re.compile(
        r"gpon\s+([0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4})\s+\S+\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)\s+(\d+)",
        re.IGNORECASE
    )
    for line in raw.splitlines():
        m = line_re.search(line)
        if m:
            mac = normalize_mac(m.group(1))
            f = int(m.group(2))
            s = int(m.group(3))
            p = int(m.group(4))
            ont_id = int(m.group(5))
            results.append({
                "mac": mac,
                "frame": f,
                "slot": s,
                "port": p,
                "ont_id": ont_id
            })
    return results

def is_hsgq(olt):
    return "hsgq" in (olt.get("vendor") or "").lower()

# HSGQ: `show mac-address gpon <pon>` lists PORT / ONT / MAC / VLAN per PON, in config mode. Only plain `show`
# commands are ever sent. (`show mac-address all` has no ONT column and the pager truncates it.)
HSGQ_PON_PORTS = range(1, 17)
HSGQ_LOG_RE = re.compile(r"^\s*\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}")
HSGQ_MORE_RE = re.compile(rb"(?i)--+\s*more\s*--+.*$")
HSGQ_PROMPT_RE = re.compile(rb"[\w\-().]+(?:\(config[^)]*\))?[>#]\s*$")

def hsgq_read(tn, timeout=60):
    out = b""
    end = time.time() + timeout
    while time.time() < end:
        idx, _, chunk = tn.expect([HSGQ_MORE_RE, HSGQ_PROMPT_RE], timeout=3)
        out += chunk
        if idx == 0:
            tn.write(b" ")
        elif idx == 1:
            break
    text = re.sub(r"(?i)--+\s*more\s*--+[^\n]*", "", out.decode("ascii", errors="replace")).replace("\r", "")
    return "\n".join(l for l in text.split("\n") if not HSGQ_LOG_RE.match(l))

def fetch_hsgq_mac_table(host, user, password):
    print(f"[*] Connecting to HSGQ OLT {host} as {user}...")
    raw = []
    try:
        tn = telnetlib.Telnet(host, 23, timeout=12)
        tn.expect([re.compile(b"(?i)(user\\s?name|login)\\s*:\\s*$")], timeout=10)
        tn.write(user.encode("ascii") + b"\r\n")
        tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*$")], timeout=10)
        tn.write(password.encode("ascii") + b"\r\n")
        hsgq_read(tn, 10)
        for step in ("enable", "configure"):
            tn.write(step.encode("ascii") + b"\r\n")
            hsgq_read(tn, 10)
        for pon in HSGQ_PON_PORTS:
            tn.write(f"show mac-address gpon {pon}".encode("ascii") + b"\r\n")
            raw.append(hsgq_read(tn))
        try:
            tn.write(b"exit\r\nquit\r\n")
            tn.close()
        except Exception:
            pass
    except Exception as e:
        print(f"[!] Error fetching from {host}: {e}")
    return "\n".join(raw)

def parse_hsgq_mac_table(raw):
    """Rows look like `PON03   22   e4:2d:7b:6e:1e:e0   100   dynamic   255`. HSGQ has no frame/slot: ont_inventory stores 0/0."""
    results = []
    line_re = re.compile(
        r"^\s*PON(\d+)\s+(\d+)\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(\d+)",
        re.IGNORECASE
    )
    for line in raw.splitlines():
        m = line_re.match(line)
        if m:
            results.append({
                "mac": normalize_mac(m.group(3)),
                "frame": 0,
                "slot": 0,
                "port": int(m.group(1)),
                "ont_id": int(m.group(2)),
                "vlan": int(m.group(4)),
            })
    # A MAC can be learned in several VLANs; keep one row per MAC and prefer the PPPoE VLAN (100).
    best = {}
    for r in results:
        cur = best.get(r["mac"])
        if cur is None or (r["vlan"] == 100 and cur["vlan"] != 100):
            best[r["mac"]] = r
    return list(best.values())

def run_correlation(dry_run=False, only_olt=None):
    check_and_nsenter()
    conn = get_db()
    olts = get_olts(conn)
    if only_olt is not None:
        olts = [o for o in olts if o["device_id"] == only_olt]
    print(f"[*] Found {len(olts)} enabled OLTs.")
    if dry_run:
        print("[*] DRY RUN: customers will not be modified.")

    total_matched = 0
    total_updated = 0

    for olt in olts:
        print(f"\n[*] Processing OLT: {olt['name']} ({olt['ip']})...")
        if is_hsgq(olt):
            raw_output = fetch_hsgq_mac_table(olt["ip"], olt["login_user"], olt["password"])
            entries = parse_hsgq_mac_table(raw_output)
        else:
            raw_output = fetch_olt_mac_table(olt["ip"], olt["login_user"], olt["password"])
            entries = parse_mac_table(raw_output)
        print(f"[+] Found {len(entries)} learned GPON MAC entries on {olt['name']}.")

        for entry in entries:
            mac = entry["mac"]
            # 1. Lookup ONT Serial from ont_inventory
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT serial_number
                    FROM ont_inventory
                    WHERE olt_id = %s AND frame = %s AND slot = %s AND pon_port = %s AND ont_id = %s
                    LIMIT 1
                """, (olt["device_id"], entry["frame"], entry["slot"], entry["port"], entry["ont_id"]))
                ont_row = cur.fetchone()
                if not ont_row or not ont_row.get("serial_number"):
                    continue

                sn = ont_row["serial_number"].strip()
                ont_id_str = str(entry["ont_id"])

                # 2. Correlate with active PPPoE session or customer MAC
                cur.execute("""
                    SELECT id, username, onu_serial_number, onu_id
                    FROM pppoe_customers
                    WHERE mac_address = %s
                       OR username = (
                           SELECT username
                           FROM radacct
                           WHERE callingstationid = %s
                           ORDER BY radacctid DESC
                           LIMIT 1
                       )
                    LIMIT 1
                """, (mac, mac))
                cust = cur.fetchone()

                if cust:
                    total_matched += 1
                    current_sn = cust.get("onu_serial_number")
                    cust_id = cust["id"]
                    cust_username = cust["username"]

                    if current_sn != sn or cust.get("onu_id") != ont_id_str:
                        if not dry_run:
                            cur.execute("""
                                UPDATE pppoe_customers
                                SET onu_serial_number = %s,
                                    onu_id = %s,
                                    mac_address = COALESCE(mac_address, %s)
                                WHERE id = %s
                            """, (sn, ont_id_str, mac, cust_id))
                        print(f"  [{'WOULD UPDATE' if dry_run else 'UPDATED'}] User: {cust_username:22} | MAC: {mac} -> OLT: {olt['name']} Port: {entry['frame']}/{entry['slot']}/{entry['port']} ONT #{ont_id_str} | SN: {sn}"
                              + (f" | REPLACED old SN: {current_sn} (ONT #{cust.get('onu_id')})" if current_sn and current_sn != sn else ""))
                        total_updated += 1
                    else:
                        print(f"  [OK] User: {cust_username:22} already has SN: {sn}")

    conn.close()
    print(f"\n==========================================")
    print(f"[*] Correlation complete.")
    print(f"[*] Total subscriber sessions matched: {total_matched}")
    print(f"[*] Total subscribers updated: {total_updated}")
    print(f"==========================================")

if __name__ == "__main__":
    only = None
    if "--olt-id" in sys.argv:
        only = int(sys.argv[sys.argv.index("--olt-id") + 1])
    run_correlation(dry_run="--dry-run" in sys.argv, only_olt=only)
