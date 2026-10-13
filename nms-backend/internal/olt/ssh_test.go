package olt

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// fakeOLT is a minimal Huawei-like CLI over SSH: user/enable/config prompts, a pager on long output,
// a "(y/n)" confirmation on `undo service-port`, and Failure messages for unknown input.
func startFakeOLT(t *testing.T) (addr string, hostKey ssh.PublicKey) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(priv)
	cfg := &ssh.ServerConfig{PasswordCallback: func(c ssh.ConnMetadata, p []byte) (*ssh.Permissions, error) {
		if c.User() == "nms" && string(p) == "secret" {
			return nil, nil
		}
		return nil, ssh.ErrNoAuth
	}}
	cfg.AddHostKey(signer)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			nc, err := ln.Accept()
			if err != nil {
				return
			}
			go serveFake(nc, cfg)
		}
	}()
	return ln.Addr().String(), signer.PublicKey()
}

func serveFake(nc net.Conn, cfg *ssh.ServerConfig) {
	conn, chans, reqs, err := ssh.NewServerConn(nc, cfg)
	if err != nil {
		return
	}
	defer conn.Close()
	go ssh.DiscardRequests(reqs)
	for nch := range chans {
		ch, creqs, _ := nch.Accept()
		go func() {
			for r := range creqs {
				r.Reply(true, nil)
				if r.Type == "shell" {
					go fakeShell(ch)
				}
			}
		}()
	}
}

func fakeShell(ch ssh.Channel) {
	defer ch.Close()
	mode := ">"
	prompt := func() { ch.Write([]byte("\r\nOLT" + mode)) }
	ch.Write([]byte("Welcome\r\nOLT>"))
	var line []byte
	one := make([]byte, 1)
	readKey := func() byte {
		for {
			ch.Read(one)
			if one[0] != '\n' && one[0] != '\r' {
				return one[0]
			}
		}
	}
	for {
		if _, err := ch.Read(one); err != nil {
			return
		}
		if one[0] != '\r' && one[0] != '\n' {
			line = append(line, one[0])
			continue
		}
		cmd := strings.TrimSpace(string(line))
		line = nil
		if cmd == "" {
			continue
		}
		ch.Write([]byte(cmd + "\r\n")) // echo
		switch {
		case cmd == "enable":
			mode = "#"
		case cmd == "config":
			mode = "(config)#"
		case cmd == "quit":
			return
		case strings.HasPrefix(cmd, "display ont info 0 4 7 all"):
			ch.Write([]byte("  0/4/7    0  485754439785B59A  active      online   normal   match    no\r\n"))
			ch.Write([]byte("---- More ( Press 'Q' to break ) ----"))
			readKey()
			ch.Write([]byte("\x1b[37D                                     \x1b[37D  0/4/7    1  48575443AABBCCDD  active      offline  failed   mismatch no\r\n"))
		case strings.HasPrefix(cmd, "undo service-port"):
			ch.Write([]byte("  Are you sure to undo it? (y/n)[n]:"))
			if readKey() == 'y' {
				ch.Write([]byte("y\r\n"))
			}
		default:
			ch.Write([]byte("  % Unknown command, the error locates at '^'\r\n"))
		}
		prompt()
	}
}

func dialFake(t *testing.T) *SSHExec {
	addr, hk := startFakeOLT(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	e, err := DialSSH(ctx, SSHConfig{Addr: addr, User: "nms", Pass: "secret", HostKey: hk, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Close() })
	return e
}

func TestSSHPagerAndErrors(t *testing.T) {
	e := dialFake(t)
	ctx := context.Background()

	c, _ := DisplayONTPort(0, 4, 7)
	out, err := e.Run(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	rows := ParseONTTable(out)
	if len(rows) != 2 {
		t.Fatalf("pager lost rows: got %d rows from %q", len(rows), out)
	}

	if _, err := e.Run(ctx, DisplayVersion()); err == nil {
		t.Fatal("expected unknown-command failure to surface as error")
	}
}

func TestSSHConfirmation(t *testing.T) {
	e := dialFake(t)
	undo, _ := ServicePortUndo(969)
	if _, err := e.Run(context.Background(), undo); err != nil {
		t.Fatalf("approved undo should succeed: %v", err)
	}
	// A command that is not pre-approved must not be auto-confirmed.
	unapproved := Cmd{text: "undo service-port 5", write: true}
	if _, err := e.Run(context.Background(), unapproved); err != ErrNeedsConfirmation {
		t.Fatalf("want ErrNeedsConfirmation, got %v", err)
	}
}

func TestHostKeyMismatchRejected(t *testing.T) {
	addr, _ := startFakeOLT(t)
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	other, _ := ssh.NewSignerFromKey(priv)
	_, err := DialSSH(context.Background(), SSHConfig{Addr: addr, User: "nms", Pass: "secret", HostKey: other.PublicKey()})
	if err == nil {
		t.Fatal("connection must fail when host key differs from the pinned key")
	}
}

func TestFetchHostKey(t *testing.T) {
	addr, hk := startFakeOLT(t)
	got, err := FetchHostKey(addr)
	if err != nil || string(got.Marshal()) != string(hk.Marshal()) {
		t.Fatalf("fetch host key: %v", err)
	}
}
