// olt-probe runs the read-only discovery commands from the billing design (section 16) against one OLT
// and writes the raw output to a directory, so real MA5683T output can be used to validate the parsers.
// It only uses allow-listed read commands. Credentials come from OLT_USER / OLT_PASS.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nepalairlink/nms/internal/olt"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("usage: olt-probe host:port outdir [F/S/P ...]")
		os.Exit(2)
	}
	addr, out := os.Args[1], os.Args[2]
	os.MkdirAll(out, 0o700)

	key, err := olt.FetchHostKey(addr)
	if err != nil {
		fmt.Println("host key:", err)
		os.Exit(1)
	}
	fmt.Println("host key presented:", olt.FormatHostKey(key))
	fmt.Println("(pinned for this run only)")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	ex, err := olt.DialSSH(ctx, olt.SSHConfig{Addr: addr, User: os.Getenv("OLT_USER"), Pass: os.Getenv("OLT_PASS"), HostKey: key, Timeout: 60 * time.Second})
	if err != nil {
		fmt.Println("connect:", err)
		os.Exit(1)
	}
	defer ex.Close()
	fmt.Println("logged in, enable/config mode reached")

	cmds := []olt.Cmd{olt.DisplayVersion(), olt.DisplayBoard(), olt.DisplayDBAProfiles(), olt.DisplayLineProfiles(),
		olt.DisplaySrvProfiles(), olt.DisplayVLANAll(), olt.DisplayServicePortAll(), olt.DisplayAutofind(), olt.DisplayNextFreeServicePort()}
	for _, fsp := range os.Args[3:] {
		var f, s, p int
		fmt.Sscanf(fsp, "%d/%d/%d", &f, &s, &p)
		if c, err := olt.DisplayONTPort(f, s, p); err == nil {
			cmds = append(cmds, c)
		}
	}
	for _, c := range cmds {
		o, err := ex.Run(ctx, c)
		name := strings.NewReplacer(" ", "_", "/", "-").Replace(c.String()) + ".txt"
		body := o
		if err != nil {
			body += "\n[ERROR] " + err.Error()
		}
		os.WriteFile(filepath.Join(out, name), []byte(body), 0o600)
		fmt.Printf("%-50s %6d bytes err=%v\n", c.String(), len(o), err != nil)
	}
}
