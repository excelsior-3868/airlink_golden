import sys
import time
import telnetlib
import re

HOST = "172.16.16.5"
PORT = 23
USER = "aonesupport"
PASS = "support##123"
SN = "485754431C675FA0"

def run():
    print(f"Connecting to {HOST}:{PORT} via Telnet...")
    tn = telnetlib.Telnet(HOST, PORT, timeout=15)
    
    # Wait for Username:
    idx, match, text = tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*"), re.compile(b"(?i)login\\s*:\\s*")], timeout=15)
    print("Received login prompt:", text.decode("ascii", errors="replace"))
    tn.write(USER.encode("ascii") + b"\r\n")
    
    # Wait for Password:
    idx, match, text = tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=15)
    print("Received password prompt.")
    tn.write(PASS.encode("ascii") + b"\r\n")
    
    # Wait for initial prompt: > or #
    prompt_re = re.compile(b"[>#]")
    idx, match, text = tn.expect([prompt_re], timeout=15)
    print("Logged in successfully! Prompt:", text.decode("ascii", errors="replace"))

    def send_cmd(cmd, expect_regex=prompt_re, timeout=20):
        print(f"\n>>> Executing: {cmd}")
        tn.write(cmd.encode("ascii") + b"\r\n")
        output = b""
        start_time = time.time()
        while time.time() - start_time < timeout:
            i, m, chunk = tn.expect([
                re.compile(b"---- More \\( Press 'Q' to break \\) ----"),
                re.compile(b"\\{ <cr>\\|.*\\}:"),
                re.compile(b"Are you sure.*\\(y/n\\)"),
                expect_regex
            ], timeout=5)
            output += chunk
            if i == 0: # More prompt
                tn.write(b" ")
            elif i == 1: # <cr> prompt
                tn.write(b"\r\n")
            elif i == 2: # confirmation
                tn.write(b"y\r\n")
            elif i == 3: # got prompt
                break
        res = output.decode("ascii", errors="replace")
        print(res)
        return res

    # Switch to enable mode if needed
    send_cmd("enable")
    # Disable pagination
    send_cmd("scroll 512")
    
    # Query ONT by SN
    out1 = send_cmd(f"display ont info by-sn {SN}")
    
    # Also check autofind in case it's not registered
    send_cmd("display ont autofind all")

    # Let's inspect out1 to see if F/S/P and ONT ID are present
    m = re.search(r"F/S/P\s*:\s*(\d+)/(\d+)/(\d+)", out1, re.I)
    m_id = re.search(r"ONT-ID\s*:\s*(\d+)", out1, re.I)
    if m and m_id:
        f, s, p = m.group(1), m.group(2), m.group(3)
        ont_id = m_id.group(1)
        print(f"\n[+] Found ONT at {f}/{s}/{p} ONT-ID {ont_id}")
        send_cmd(f"display ont info {f} {s} {p} {ont_id}")
        send_cmd(f"display service-port port {f}/{s}/{p} ont {ont_id}")

    tn.write(b"quit\r\n")
    tn.close()

if __name__ == "__main__":
    run()
