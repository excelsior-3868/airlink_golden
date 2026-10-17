#!/usr/bin/env python3
"""
Airlink Golden — FTTH CPE RADIUS Credential Lookup Tool
Locates the active PPPoE username & password for any FTTH CPE using Method 2:
1. Queries the OLT for the learned MAC address on the ONT port.
2. Correlates the MAC address against FreeRADIUS radacct sessions.
3. Retrieves the plain text PPPoE password and customer profile.

Usage:
  python3 lookup_cpe_credentials.py --sn 485754431C675FA0
  python3 lookup_cpe_credentials.py --port 0/1/1 --ont 43
  python3 lookup_cpe_credentials.py --mac 50:6F:77:2F:DC:44
"""

import sys
import os
import re
import time
import argparse
import telnetlib
import subprocess
import json

OLT_HOST = "172.16.16.5"
OLT_PORT = 23
OLT_USER = "aonesupport"
OLT_PASS = "support##123"

def check_and_nsenter():
    """Ensure we can reach the OLT. If not reachable directly, switch into nms container netns."""
    import socket
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect((OLT_HOST, OLT_PORT))
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

def run_olt_command(cmd, host=OLT_HOST, user=OLT_USER, password=OLT_PASS):
    tn = telnetlib.Telnet(host, OLT_PORT, timeout=10)
    tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*")], timeout=10)
    tn.write(user.encode("ascii") + b"\r\n")
    tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=10)
    tn.write(password.encode("ascii") + b"\r\n")
    prompt = re.compile(b"[>#]")
    tn.expect([prompt], timeout=10)
    tn.write(b"enable\r\n")
    tn.expect([prompt], timeout=10)
    tn.write(b"scroll 512\r\n")
    tn.expect([prompt], timeout=10)

    tn.write(cmd.encode("ascii") + b"\r\n")
    _, _, out = tn.expect([prompt], timeout=10)
    tn.write(b"quit\r\n")
    tn.close()
    return out.decode("ascii", errors="replace")

def normalize_mac(raw):
    """Normalize MAC to XX:XX:XX:XX:XX:XX format."""
    clean = re.sub(r"[^0-9a-fA-F]", "", raw)
    if len(clean) == 12:
        return ":".join(clean[i:i+2].upper() for i in range(0, 12, 2))
    return raw.upper()

def get_olt_mac(f, s, p, ont_id, host=OLT_HOST):
    out = run_olt_command(f"display mac-address port {f}/{s}/{p} ont {ont_id}", host=host)
    m = re.search(r"([0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4})", out)
    if m:
        return normalize_mac(m.group(1))
    return None

def find_ont_by_sn(sn, host=OLT_HOST):
    out = run_olt_command(f"display ont info by-sn {sn}", host=host)
    m_fsp = re.search(r"F/S/P\s*:\s*(\d+)/(\d+)/(\d+)", out, re.I)
    m_id = re.search(r"ONT-ID\s*:\s*(\d+)", out, re.I)
    if m_fsp and m_id:
        return m_fsp.group(1), m_fsp.group(2), m_fsp.group(3), m_id.group(1)
    return None

def query_db(mac):
    php_code = (
        f"$mac = '{mac}';"
        "$acct = DB::table('radacct')->where('callingstationid', 'LIKE', '%' . $mac . '%')->orderByDesc('radacctid')->first();"
        "$username = $acct?->username;"
        "if (!$username) {"
        "  $cust = DB::table('pppoe_customers')->where('mac_address', 'LIKE', '%' . $mac . '%')->first();"
        "  $username = $cust?->username;"
        "}"
        "$cust = $username ? DB::table('pppoe_customers')->where('username', $username)->first() : null;"
        "$pwd = $username ? DB::table('radcheck')->where('username', $username)->where('attribute', 'Cleartext-Password')->value('value') : null;"
        "echo json_encode(['acct' => $acct, 'cust' => $cust, 'password' => $pwd]);"
    )
    cmd = ["docker", "exec", "airlink-backend-golden", "php", "artisan", "tinker", f"--execute={php_code}"]
    res = subprocess.check_output(cmd).decode().strip()
    start = res.find("{")
    end = res.rfind("}")
    if start != -1 and end != -1:
        return json.loads(res[start:end+1])
    return None

def main():
    parser = argparse.ArgumentParser(description="Lookup RADIUS Credentials for FTTH CPE")
    parser.add_argument("--sn", help="ONT Serial Number (e.g. 485754431C675FA0)")
    parser.add_argument("--port", help="Port in F/S/P format (e.g. 0/1/1)")
    parser.add_argument("--ont", help="ONT ID (e.g. 43)")
    parser.add_argument("--mac", help="Known CPE MAC address")
    parser.add_argument("--olt", default=OLT_HOST, help="OLT IP address")
    args = parser.parse_args()

    if not (args.sn or (args.port and args.ont) or args.mac):
        parser.print_help()
        sys.exit(1)

    check_and_nsenter()

    mac = None
    fsp_str = None
    ont_id = None

    if args.mac:
        mac = normalize_mac(args.mac)
        print(f"[*] Querying for MAC: {mac}")
    else:
        if args.sn:
            print(f"[*] Querying OLT {args.olt} for ONT SN: {args.sn}...")
            found = find_ont_by_sn(args.sn, host=args.olt)
            if not found:
                print(f"[!] ONT Serial {args.sn} not found on OLT {args.olt}")
                sys.exit(1)
            f, s, p, ont_id = found
            fsp_str = f"{f}/{s}/{p}"
            print(f"[+] Found ONT at Port: {fsp_str}, ONT-ID: #{ont_id}")
        else:
            f, s, p = args.port.split("/")
            fsp_str = args.port
            ont_id = args.ont

        print(f"[*] Querying learned MAC address on Port {fsp_str} ONT-ID #{ont_id}...")
        mac = get_olt_mac(f, s, p, ont_id, host=args.olt)
        if not mac:
            print(f"[!] No learned MAC address found on {fsp_str} ONT #{ont_id}. Is the CPE powered on and connected?")
            sys.exit(1)
        print(f"[+] Learned CPE MAC Address: {mac}")

    print(f"[*] Searching RADIUS and Customer Database for MAC {mac}...")
    db_res = query_db(mac)

    if not db_res or (not db_res.get("acct") and not db_res.get("cust")):
        print(f"[!] No RADIUS session or customer record found for MAC {mac}.")
        sys.exit(1)

    acct = db_res.get("acct")
    cust = db_res.get("cust")
    password = db_res.get("password") or (cust.get("password") if cust else "N/A")
    username = acct.get("username") if acct else (cust.get("username") if cust else "Unknown")

    print("\n" + "=" * 55)
    print("         FTTH CPE CREDENTIALS FOUND")
    print("=" * 55)
    if fsp_str and ont_id:
        print(f"  OLT Location   : Port {fsp_str}, ONT-ID #{ont_id}")
    print(f"  CPE WAN MAC    : {mac}")
    print(f"  PPPoE Username : {username}")
    print(f"  PPPoE Password : {password}")
    print("-" * 55)
    if cust:
        print(f"  Customer Name  : {cust.get('full_name')}")
        print(f"  Phone Number   : {cust.get('phone')}")
        print(f"  Address        : {cust.get('address')}")
        print(f"  Account Status : {cust.get('status', '').upper()}")
        print(f"  Expiry Date    : {cust.get('expires_at')}")
    if acct:
        is_online = acct.get("acctstoptime") is None
        print("-" * 55)
        print(f"  Live Session   : {'ONLINE' if is_online else 'OFFLINE (Last Seen)'}")
        print(f"  Framed IP      : {acct.get('framedipaddress')}")
        print(f"  BRAS / NAS IP  : {acct.get('nasipaddress')}")
        print(f"  Started At     : {acct.get('acctstarttime')}")
    print("=" * 55 + "\n")

if __name__ == "__main__":
    main()
