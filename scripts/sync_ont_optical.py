#!/usr/bin/env python3
"""
Airlink Golden - Synchronize ONT Optical Power (Rx / Tx / OLT Rx RSSI)
Connects to Huawei OLTs, runs 'display ont optical-info <port> all',
and updates ont_inventory.rx_power_dbm in airlink_golden MySQL.
"""

import os
import sys
import re
import time
import socket
import base64
import hashlib
import telnetlib
import subprocess
import pymysql
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

APP_KEY = os.getenv("APP_KEY", "base64:eQzSFYt+YkbuC2ODk4kDpCN7ovPgoCfYb+EFQgsxitM=")
DB_USER = "airlink"
DB_PASS = os.getenv("DB_PASSWORD", "airlink_pass")
DB_NAME = "airlink_golden"

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
            cmd = ["nsenter", "-t", pid, "-n", sys.executable, __file__] + sys.argv[1:]
            os.execvp("nsenter", cmd)
    except Exception as e:
        print(f"[!] Warning: Unable to enter container netns: {e}")

def get_db():
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
    raise RuntimeError("Could not connect to database on any candidate host/port.")

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

def exec_cmd(tn, cmd_str, timeout=15):
    tn.write(cmd_str.encode("ascii") + b"\r\n")
    out = b""
    start = time.time()
    prompt_re = re.compile(rb"[>#]")
    while time.time() - start < timeout:
        idx, _, chunk = tn.expect([
            re.compile(b"---- More \\( Press .Q. to break \\) ----"),
            re.compile(b"\\{ <cr>.*\\}:"),
            re.compile(b"Are you sure.*\\(y/n\\)"),
            prompt_re
        ], timeout=4)
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

def parse_optical_table(output):
    """
    Parses table output of:
    ONT  Rx power    Tx power    OLT Rx ONT  Temperature  Voltage     Current
    ID   (dBm)       (dBm)       power(dBm)  (C)          (V)         (mA)
    -------------------------------------------------------------------------
      0  -20.08      2.30        -24.09      45           3.280       14
    """
    results = {}
    lines = output.splitlines()
    table_started = False
    for line in lines:
        line = line.strip()
        if "ONT" in line and "Rx power" in line:
            table_started = True
            continue
        if table_started and ("----" in line or not line):
            continue
        # Row match: ONT_ID  Rx_power  Tx_power  OLT_Rx ...
        # Note: Some offline ONTs show '-' for powers
        m = re.match(r"^(\d+)\s+([-\d\.]+|-)\s+([-\d\.]+|-)\s+([-\d\.]+|-)", line)
        if m:
            ont_id = int(m.group(1))
            rx_raw = m.group(2)
            try:
                rx_power = float(rx_raw)
            except ValueError:
                rx_power = None
            results[ont_id] = rx_power
    return results

def sync_olt(olt, conn, specific_port=None):
    host = olt["ip"]
    user = olt["login_user"]
    password = olt["password"]
    olt_id = olt["device_id"]
    print(f"\n[*] Connecting to OLT #{olt_id} ({olt['name']} @ {host})...")

    try:
        tn = telnetlib.Telnet(host, 23, timeout=12)
        tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*")], timeout=10)
        tn.write(user.encode("ascii") + b"\r\n")
        tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=10)
        tn.write(password.encode("ascii") + b"\r\n")
        tn.expect([re.compile(b"[>#]")], timeout=10)

        exec_cmd(tn, "enable")
        exec_cmd(tn, "scroll 512")
        exec_cmd(tn, "config")

        # Get list of (frame, slot, pon_port) on this OLT
        with conn.cursor() as cur:
            if specific_port:
                f, s, p = specific_port
                cur.execute("""
                    SELECT DISTINCT frame, slot, pon_port
                    FROM ont_inventory
                    WHERE olt_id=%s AND frame=%s AND slot=%s AND pon_port=%s
                """, (olt_id, f, s, p))
            else:
                cur.execute("""
                    SELECT DISTINCT frame, slot, pon_port
                    FROM ont_inventory
                    WHERE olt_id=%s
                    ORDER BY frame, slot, pon_port
                """, (olt_id,))
            ports = cur.fetchall()

        total_updated = 0
        current_gpon = None

        for port_info in ports:
            f = port_info["frame"]
            s = port_info["slot"]
            p = port_info["pon_port"]

            gpon_interface = f"{f}/{s}"
            if current_gpon != gpon_interface:
                if current_gpon is not None:
                    exec_cmd(tn, "quit")
                exec_cmd(tn, f"interface gpon {gpon_interface}")
                current_gpon = gpon_interface

            # Run bulk optical info for this PON port
            out = exec_cmd(tn, f"display ont optical-info {p} all", timeout=12)
            optical_map = parse_optical_table(out)
            if not optical_map:
                continue

            with conn.cursor() as cur:
                for ont_id, rx_pwr in optical_map.items():
                    if rx_pwr is not None:
                        cur.execute("""
                            UPDATE ont_inventory
                            SET rx_power_dbm = %s, last_seen_at = NOW()
                            WHERE olt_id = %s AND frame = %s AND slot = %s AND pon_port = %s AND ont_id = %s
                        """, (rx_pwr, olt_id, f, s, p, ont_id))
                        total_updated += 1

            print(f"  [+] Port {f}/{s}/{p}: parsed {len(optical_map)} ONTs ({sum(1 for v in optical_map.values() if v is not None)} with optical readings)")

        if current_gpon is not None:
            exec_cmd(tn, "quit")
        exec_cmd(tn, "quit")
        tn.write(b"quit\r\n")
        tn.close()
        print(f"[+] OLT #{olt_id} ({olt['name']}) sync finished. {total_updated} ONT optical readings updated.")
    except Exception as e:
        print(f"[-] Error syncing OLT #{olt_id} ({olt.get('name')}): {e}")

def main():
    check_and_nsenter()
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT o.device_id, d.name, d.ip, o.login_user, o.login_pass_enc
            FROM olts o
            JOIN devices d ON d.id = o.device_id
            WHERE d.enabled = 1
        """)
        olts = cur.fetchall()
        for o in olts:
            o["password"] = decrypt_password(o.get("login_pass_enc"))

    target_olt_id = int(sys.argv[1]) if len(sys.argv) > 1 else None

    for o in olts:
        if target_olt_id and o["device_id"] != target_olt_id:
            continue
        sync_olt(o, conn)

    conn.close()

if __name__ == "__main__":
    main()
