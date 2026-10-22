package olt

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"
)

// TelnetConfig mirrors SSHConfig for OLTs that only offer Telnet. There is no host key to pin;
// the credentials cross the network in clear text, so this is meant for a private/VPN path only.
type TelnetConfig struct {
	Addr     string
	User     string
	Pass     string
	Timeout  time.Duration
	ReadOnly bool
}

const (
	telIAC  = 255
	telDONT = 254
	telDO   = 253
	telWONT = 252
	telWILL = 251
	telSB   = 250
	telSE   = 240
)

// errTelnetRejected is returned when the OLT sends the login prompt again after credentials were sent.
// The OLT does this for a bad password but also for a session that is still closing, so DialTelnet retries it.
var errTelnetRejected = errors.New("telnet login rejected: wrong username or password")

const (
	telnetLoginAttempts = 3
	telnetLoginRetryGap = 3 * time.Second
)

var (
	userPromptRe = regexp.MustCompile(`(?i)(user\s?name|login)\s*:\s*$`)
	passPromptRe = regexp.MustCompile(`(?i)pass(word)?\s*:\s*$`)
	loginFailRe  = regexp.MustCompile(`(?i)(invalid|incorrect|failed|denied|upper limit|locked)`)
)

type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// telnetReader strips IAC sequences and refuses every option except ECHO/SGA, which the server must own.
type telnetReader struct {
	r io.Reader
	w io.Writer
}

func (t *telnetReader) Read(p []byte) (int, error) {
	buf := make([]byte, len(p))
	for {
		n, err := t.r.Read(buf)
		out := 0
		for i := 0; i < n; i++ {
			b := buf[i]
			if b != telIAC {
				p[out] = b
				out++
				continue
			}
			if i+1 >= n {
				break
			}
			cmd := buf[i+1]
			switch cmd {
			case telIAC:
				p[out] = telIAC
				out++
				i++
			case telDO, telDONT, telWILL, telWONT:
				if i+2 >= n {
					i = n
					break
				}
				opt := buf[i+2]
				var reply byte
				switch cmd {
				case telDO:
					reply = telWONT
				case telWILL:
					reply = telDONT
					if opt == 1 || opt == 3 {
						reply = telDO
					}
				default:
					reply = 0
				}
				if reply != 0 {
					t.w.Write([]byte{telIAC, reply, opt})
				}
				i += 2
			case telSB:
				j := i + 2
				for j+1 < n && !(buf[j] == telIAC && buf[j+1] == telSE) {
					j++
				}
				i = j + 1
			default:
				i++
			}
		}
		if out > 0 || err != nil {
			return out, err
		}
	}
}

// DialTelnet logs in over Telnet and returns the same executor the SSH driver produces.
// A rejected login is retried after a short pause, since the OLT may still be tearing down a previous session.
func DialTelnet(ctx context.Context, c TelnetConfig) (*SSHExec, error) {
	var err error
	for attempt := 0; attempt < telnetLoginAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(telnetLoginRetryGap):
			}
		}
		var e *SSHExec
		if e, err = dialTelnetOnce(ctx, c); err == nil {
			return e, nil
		}
		if !errors.Is(err, errTelnetRejected) {
			return nil, err
		}
	}
	return nil, err
}

func dialTelnetOnce(ctx context.Context, c TelnetConfig) (*SSHExec, error) {
	if c.Timeout == 0 {
		c.Timeout = 30 * time.Second
	}
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", c.Addr)
	if err != nil {
		return nil, err
	}
	w := &lockedWriter{w: conn}
	e := &SSHExec{conn: conn, stdin: w, timeout: c.Timeout, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go e.readLoop(&telnetReader{r: conn, w: w})

	if err := e.telnetLogin(ctx, c); err != nil {
		conn.Close()
		return nil, err
	}
	if err := e.enterMode(ctx, c.ReadOnly); err != nil {
		return nil, err
	}
	return e, nil
}

func (e *SSHExec) telnetLogin(ctx context.Context, c TelnetConfig) error {
	deadline := time.Now().Add(e.timeout)
	sentUser, sentPass := 0, false
	for {
		cur := e.snapshot()
		trimmed := strings.TrimRight(cur, " \r\n\x07")
		switch {
		case promptRe.MatchString(cur):
			select {
			case <-time.After(150 * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}
			if e.snapshot() == cur {
				return nil // leave the prompt buffered for enterMode
			}
		case passPromptRe.MatchString(trimmed):
			if sentPass {
				return fmt.Errorf("%w (OLT said: %q)", errTelnetRejected, lastOLTText(cur))
			}
			sentPass = true
			e.reset()
			if err := e.send(c.Pass + "\r\n"); err != nil {
				return err
			}
		case userPromptRe.MatchString(trimmed):
			if sentUser > 0 && sentPass {
				return fmt.Errorf("%w (OLT said: %q)", errTelnetRejected, lastOLTText(cur))
			}
			sentUser++
			e.reset()
			if err := e.send(c.User + "\r\n"); err != nil {
				return err
			}
		case sentPass && loginFailRe.MatchString(cur):
			return fmt.Errorf("telnet login failed: %s", strings.TrimSpace(cur))
		}
		select {
		case <-e.wake:
		case <-time.After(100 * time.Millisecond):
		case <-e.done:
			return io.EOF
		case <-ctx.Done():
			return ctx.Err()
		}
		if time.Now().After(deadline) {
			return errors.New("timeout waiting for telnet login prompt")
		}
	}
}

// lastOLTText trims the OLT's login output to the last few hundred characters so a rejection says why.
func lastOLTText(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		s = s[len(s)-300:]
	}
	return s
}
