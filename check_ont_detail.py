import sys
import time
import telnetlib
import re

HOST = "172.16.16.5"
PORT = 23
USER = "aonesupport"
PASS = "support##123"

def run():
    tn = telnetlib.Telnet(HOST, PORT, timeout=15)
    tn.expect([re.compile(b"(?i)user(name)?\\s*:\\s*")], timeout=15)
    tn.write(USER.encode("ascii") + b"\r\n")
    tn.expect([re.compile(b"(?i)pass(word)?\\s*:\\s*")], timeout=15)
    tn.write(PASS.encode("ascii") + b"\r\n")
    
    prompt_re = re.compile(b"Halesi-Cable-Huawei-OLT[>#]")
    tn.expect([prompt_re], timeout=15)

    def exec_cmd(cmd):
        print(f"\n==================== [ {cmd} ] ====================")
        tn.write(cmd.encode("ascii") + b"\r\n")
        out = b""
        start_time = time.time()
        while time.time() - start_time < 20:
            idx, match, chunk = tn.expect([
                re.compile(b"---- More \\( Press 'Q' to break \\) ----"),
                re.compile(b"\\{ <cr>.*\\}:"),
                re.compile(b"Halesi-Cable-Huawei-OLT[>#]"),
            ], timeout=5)
            out += chunk
            if idx == 0:
                tn.write(b" ")
            elif idx == 1:
                tn.write(b"\r\n")
            elif idx == 2:
                break
        text = out.decode("ascii", errors="replace")
        print(text)
        return text

    exec_cmd("enable")
    exec_cmd("scroll 512")
    exec_cmd("display ont info by-sn 485754431C675FA0")
    exec_cmd("display service-port port 0/1/1 ont 43")
    exec_cmd("display ont optical-info 0 1 1 43")
    exec_cmd("display ont version 0 1 1 43")
    
    tn.write(b"quit\r\n")
    tn.close()

if __name__ == "__main__":
    run()
