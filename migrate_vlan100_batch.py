#!/usr/bin/env python3
"""
Airlink Golden NMS — Automated Batch Migration Script
Target: Halesi-Cable-Huawei-OLT (172.16.16.5)
Function: Migrates untagged GPON subscribers on GEM 1 from old SVLAN (2190) to new SVLAN (100).
Zero changes to Line Profile 10, zero changes to customer ONTs/routers.
"""

import sys
import os
import re
import time
import argparse
import telnetlib
import subprocess

OLT_HOST = "172.16.16.5"
OLT_PORT = 23
OLT_USER = "aonesupport"
OLT_PASS = "support##123"

DEFAULT_OLD_VLAN = 2190
DEFAULT_NEW_VLAN = 100

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

    # Check for docker container airlink-nms-golden
    try:
        pid = subprocess.check_output(
            ["docker", "inspect", "airlink-nms-golden", "--format", "{{.State.Pid}}"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
        if pid and pid != "0":
            print(f"[*] Re-executing inside container netns (PID {pid})...")
            cmd = ["nsenter", "-t", pid, "-n", sys.executable] + sys.argv
            os.execvp("nsenter", cmd)
    except Exception as e:
        print(f"[!] Warning: Unable to enter container netns automatically: {e}")

class OLTClient:
    def __init__(self, host=OLT_HOST, port=OLT_PORT, user=OLT_USER, password=OLT_PASS):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.tn = None

    def connect(self):
        print(f"[*] Connecting to OLT at {self.host}:{self.port} via Telnet...")
        self.tn = telnetlib.Telnet(self.host, self.port, timeout=15)
        self.tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*")], timeout=15)
        self.tn.write(self.user.encode("ascii") + b"\r\n")
        self.tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=15)
        self.tn.write(self.password.encode("ascii") + b"\r\n")
        self.tn.expect([re.compile(b"Halesi-Cable-Huawei-OLT[>#]")], timeout=15)
        print("[+] Logged into Halesi-Cable-Huawei-OLT successfully.")
        self.exec_cmd("enable")
        self.exec_cmd("scroll 512")

    def exec_cmd(self, cmd, timeout=15):
        self.tn.write(cmd.encode("ascii") + b"\r\n")
        out = b""
        start = time.time()
        while time.time() - start < timeout:
            idx, match, chunk = self.tn.expect([
                re.compile(b"---- More \\( Press 'Q' to break \\) ----"),
                re.compile(b"\\{ <cr>.*\\}:"),
                re.compile(b"Are you sure.*\\(y/n\\)"),
                re.compile(b"Halesi-Cable-Huawei-OLT[>#\\(]"),
            ], timeout=5)
            out += chunk
            if idx == 0:
                self.tn.write(b" ")
            elif idx == 1:
                self.tn.write(b"\r\n")
            elif idx == 2:
                self.tn.write(b"y\r\n")
            elif idx == 3:
                break
        return out.decode("ascii", errors="replace")

    def get_service_ports_by_vlan(self, vlan_id):
        print(f"[*] Discovering existing service ports for VLAN {vlan_id}...")
        raw = self.exec_cmd(f"display service-port vlan {vlan_id}", timeout=25)
        
        # Regex to parse service-port table lines
        # Examples:
        # 1 2190 common gpon 0/1 /6  76   1     vlan  untag      -    -    up
        pattern = re.compile(
            r"^\s*(\d+)\s+" + str(vlan_id) + r"\s+\S+\s+gpon\s+(\d+/\d+\s*/\d+)\s+(\d+)\s+(\d+)\s+vlan\s+untag",
            re.MULTILINE
        )
        
        entries = []
        for match in pattern.finditer(raw):
            sp_index = int(match.group(1))
            fsp = match.group(2).replace(" ", "")
            ont_id = int(match.group(3))
            gem = int(match.group(4))
            entries.append({
                "index": sp_index,
                "fsp": fsp,
                "ont_id": ont_id,
                "gem": gem
            })
        print(f"[+] Found {len(entries)} untagged service ports on VLAN {vlan_id}.")
        return entries

    def close(self):
        if self.tn:
            try:
                self.tn.write(b"quit\r\n")
                self.tn.close()
            except Exception:
                pass
            self.tn = None

def main():
    check_and_nsenter()

    parser = argparse.ArgumentParser(description="Halesi OLT VLAN 100 Batch Migration Tool")
    parser.add_argument("--dry-run", action="store_true", help="Scan and display planned changes without applying them.")
    parser.add_argument("--execute", action="store_true", help="Execute the migration on the OLT.")
    parser.add_argument("--pilot-ont", type=int, help="Migrate ONLY this specific ONT ID for pilot verification.")
    parser.add_argument("--from-vlan", type=int, default=DEFAULT_OLD_VLAN, help=f"Source VLAN (default: {DEFAULT_OLD_VLAN})")
    parser.add_argument("--to-vlan", type=int, default=DEFAULT_NEW_VLAN, help=f"Target VLAN (default: {DEFAULT_NEW_VLAN})")
    parser.add_argument("--rollback", action="store_true", help="Reverse operation (migrate from to-vlan back to from-vlan)")

    args = parser.parse_args()

    if not args.dry-run and not args.execute:
        print("[!] Safety Lock: You must specify either --dry-run or --execute.")
        sys.exit(1)

    source_vlan = args.to_vlan if args.rollback else args.from_vlan
    target_vlan = args.from_vlan if args.rollback else args.to_vlan

    print("=================================================================")
    print("       HALESI OLT — AUTOMATED BATCH VLAN MIGRATION TOOL          ")
    print(f" Mode:          {'ROLLBACK' if args.rollback else 'MIGRATION'}")
    print(f" Source VLAN:   {source_vlan}")
    print(f" Target VLAN:   {target_vlan}")
    print(f" Operation:     {'DRY-RUN (SIMULATION)' if args.dry_run else 'LIVE EXECUTION'}")
    if args.pilot_ont is not None:
        print(f" Filter:        Single Pilot ONT ID {args.pilot_ont}")
    print("=================================================================\n")

    client = OLTClient()
    try:
        client.connect()
        ports = client.get_service_ports_by_vlan(source_vlan)
        
        if args.pilot_ont is not None:
            ports = [p for p in ports if p["ont_id"] == args.pilot_ont]
            if not ports:
                print(f"[!] ONT ID {args.pilot_ont} not found on VLAN {source_vlan}!")
                return

        if not ports:
            print(f"[!] No eligible untagged service-ports found on VLAN {source_vlan}.")
            return

        print(f"\n[+] Total items to process: {len(ports)}\n")

        if args.dry_run:
            print("--- Planned Commands (DRY-RUN) ---")
            for i, p in enumerate(ports[:10], start=1):
                undo_cmd = f"undo service-port {p['index']}"
                add_cmd = (
                    f"service-port vlan {target_vlan} gpon {p['fsp']} ont {p['ont_id']} "
                    f"gemport {p['gem']} multi-service user-vlan untagged tag-transform default"
                )
                print(f"[{i}] ONT {p['ont_id']} ({p['fsp']}):")
                print(f"    {undo_cmd}")
                print(f"    {add_cmd}")
            if len(ports) > 10:
                print(f"... and {len(ports) - 10} more items.")
            print("\n[+] Dry run complete. No changes were made on Halesi OLT.")
            return

        # LIVE EXECUTION
        print("[*] Entering config mode on Halesi OLT...")
        client.exec_cmd("config")

        success_count = 0
        fail_count = 0

        for i, p in enumerate(ports, start=1):
            undo_cmd = f"undo service-port {p['index']}"
            add_cmd = (
                f"service-port vlan {target_vlan} gpon {p['fsp']} ont {p['ont_id']} "
                f"gemport {p['gem']} multi-service user-vlan untagged tag-transform default"
            )

            res1 = client.exec_cmd(undo_cmd)
            res2 = client.exec_cmd(add_cmd)

            if "Failure" in res2 or "Error" in res2 or "%" in res2:
                print(f"[-] [{i}/{len(ports)}] FAILED on ONT {p['ont_id']} ({p['fsp']}): {res2.strip()}")
                fail_count += 1
            else:
                print(f"[+] [{i}/{len(ports)}] Migrated ONT {p['ont_id']} ({p['fsp']}) to VLAN {target_vlan}")
                success_count += 1

        print("\n[*] Saving OLT configuration...")
        client.exec_cmd("save")
        print("[+] Configuration successfully saved on Halesi OLT.")

        print("\n=================================================================")
        print(f" Migration Summary: {success_count} succeeded, {fail_count} failed.")
        print("=================================================================")

    finally:
        client.close()

if __name__ == "__main__":
    main()
