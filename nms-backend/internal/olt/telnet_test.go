package olt

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

// fakeTelnetOLT mimics a Huawei login: IAC negotiation, "User name:"/"User password:" then a CLI.
func fakeTelnetOLT(t *testing.T, wantUser, wantPass string) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		c.Write([]byte{telIAC, telDO, 24, telIAC, telWILL, 1, telIAC, telWILL, 3})
		rd := bufio.NewReader(c)
		c.Write([]byte("\r\n>>User name:"))
		u, _ := rd.ReadString('\n')
		c.Write([]byte("\r\n>>User password:"))
		p, _ := rd.ReadString('\n')
		clean := func(v string) string { // drop our IAC negotiation replies like a real telnetd
			for {
				i := strings.IndexByte(v, telIAC)
				if i < 0 || i+2 >= len(v) {
					return strings.TrimSpace(v)
				}
				v = v[:i] + v[i+3:]
			}
		}
		if clean(u) != wantUser || clean(p) != wantPass {
			c.Write([]byte("\r\nUsername or password invalid.\r\n>>User name:"))
			return
		}
		c.Write([]byte("\r\nMA5683T>"))
		prompt := "MA5683T>"
		for {
			l, err := rd.ReadString('\n')
			if err != nil {
				return
			}
			switch strings.TrimSpace(l) {
			case "enable":
				prompt = "MA5683T#"
			case "config":
				prompt = "MA5683T(config)#"
			}
			c.Write([]byte(strings.TrimSpace(l) + "\r\n" + prompt))
		}
	}()
	return ln.Addr().String()
}

func TestTelnetLogin(t *testing.T) {
	addr := fakeTelnetOLT(t, "doppler", "pw")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	e, err := DialTelnet(ctx, TelnetConfig{Addr: addr, User: "doppler", Pass: "pw", Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	e.Close()
}

func TestTelnetBadPassword(t *testing.T) {
	addr := fakeTelnetOLT(t, "doppler", "pw")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := DialTelnet(ctx, TelnetConfig{Addr: addr, User: "doppler", Pass: "nope", Timeout: 5 * time.Second}); err == nil {
		t.Fatal("expected login failure")
	}
}
