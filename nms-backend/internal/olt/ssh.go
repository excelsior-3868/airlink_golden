package olt

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Executor runs validated commands on one OLT session. Implemented by the SSH driver and by test fakes.
type Executor interface {
	Run(ctx context.Context, c Cmd) (string, error)
	Close() error
}

type SSHConfig struct {
	Addr    string
	User    string
	Pass    string
	HostKey ssh.PublicKey // required; use FetchHostKey + explicit admin approval to obtain it
	Timeout time.Duration // per-command
	// ReadOnly stops at enable mode: the session never enters `config`, so only display commands are possible.
	ReadOnly bool
}

var (
	// MA5683T follows the prompt with bell characters ("Name#\a \a "), so allow \a after [>#].
	promptRe   = regexp.MustCompile(`(?:^|\n)[^\s\n]+(?:\([^)\n]*\))?[>#][\s\x07]*$`)
	moreRe     = regexp.MustCompile(`-{2,}\s*More\s*\(.*?\)\s*-{2,}`)
	crPromptRe = regexp.MustCompile(`\{\s*<cr>[^\n]*\}\s*:\s*$`)
	moreTailRe = regexp.MustCompile(`-{2,}\s*More\s*\(.*?\)\s*-{2,}\s*$`)
	yesNoRe    = regexp.MustCompile(`\(y/n\)[^\n]*:?\s*$`)
)

// CLIError is a failure reported by the OLT's CLI (as opposed to a transport/timeout problem).
type CLIError struct{ Cmd, Msg string }

func (e *CLIError) Error() string { return e.Cmd + ": " + e.Msg }

var ErrNeedsConfirmation = errors.New("device asked for confirmation that this command is not approved to answer")

type SSHExec struct {
	client  *ssh.Client
	sess    *ssh.Session
	conn    io.Closer // set for non-SSH transports (telnet)
	stdin   io.Writer
	timeout time.Duration

	mu   sync.Mutex
	buf  bytes.Buffer
	wake chan struct{}
	done chan struct{}
}

// Huawei MA56xx OLTs run the DOPRA-1.5 SSH server, which only offers SHA-1 era algorithms
// (diffie-hellman-group1-sha1, ssh-rsa host key, aes128-cbc). Go disables these by default, so they are
// appended after the modern defaults: a current server still negotiates strong crypto, only a legacy
// device falls back. The host key is pinned by an admin, which limits what the weak kex can expose.
func legacyAlgorithms() ssh.Config {
	a := ssh.SupportedAlgorithms()
	return ssh.Config{
		KeyExchanges: append(a.KeyExchanges, ssh.InsecureKeyExchangeDH1SHA1, ssh.InsecureKeyExchangeDHGEXSHA1),
		Ciphers:      append(a.Ciphers, ssh.InsecureCipherAES128CBC),
		MACs:         a.MACs,
	}
}

func clientConfig(user, pass string, cb ssh.HostKeyCallback) *ssh.ClientConfig {
	hostKeys := append(ssh.SupportedAlgorithms().HostKeys, ssh.KeyAlgoRSA)
	return &ssh.ClientConfig{
		Config:            legacyAlgorithms(),
		HostKeyAlgorithms: hostKeys,
		User:              user,
		Auth: []ssh.AuthMethod{
			ssh.Password(pass),
			ssh.KeyboardInteractive(func(_, _ string, qs []string, _ []bool) ([]string, error) {
				ans := make([]string, len(qs))
				for i := range ans {
					ans[i] = pass
				}
				return ans, nil
			}),
		},
		HostKeyCallback: cb,
		Timeout:         10 * time.Second,
	}
}

// FetchHostKey connects without trusting and returns the server's host key so an admin can approve
// and pin it. No credentials are sent: authentication is attempted only after the callback returns.
func FetchHostKey(addr string) (ssh.PublicKey, error) {
	var got ssh.PublicKey
	cfg := clientConfig("probe", "", func(_ string, _ net.Addr, k ssh.PublicKey) error {
		got = k
		return errors.New("host key captured") // abort before any authentication
	})
	_, err := ssh.Dial("tcp", addr, cfg)
	if got != nil {
		return got, nil
	}
	return nil, fmt.Errorf("could not read host key: %w", err)
}

func DialSSH(ctx context.Context, c SSHConfig) (*SSHExec, error) {
	if c.HostKey == nil {
		return nil, errors.New("OLT host key is not pinned; approve it first")
	}
	if c.Timeout == 0 {
		c.Timeout = 30 * time.Second
	}
	d := net.Dialer{Timeout: 10 * time.Second}
	raw, err := d.DialContext(ctx, "tcp", c.Addr)
	if err != nil {
		return nil, err
	}
	conn, chans, reqs, err := ssh.NewClientConn(raw, c.Addr, clientConfig(c.User, c.Pass, ssh.FixedHostKey(c.HostKey)))
	if err != nil {
		raw.Close()
		return nil, err
	}
	cl := ssh.NewClient(conn, chans, reqs)
	sess, err := cl.NewSession()
	if err != nil {
		cl.Close()
		return nil, err
	}
	if err := sess.RequestPty("vt100", 400, 200, ssh.TerminalModes{ssh.ECHO: 0}); err != nil {
		cl.Close()
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		cl.Close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		cl.Close()
		return nil, err
	}
	e := &SSHExec{client: cl, sess: sess, stdin: stdin, timeout: c.Timeout, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go e.readLoop(stdout)
	if err := sess.Shell(); err != nil {
		cl.Close()
		return nil, err
	}
	if err := e.enterMode(ctx, c.ReadOnly); err != nil {
		return nil, err
	}
	return e, nil
}

// enterMode reaches enable/config mode so both display and configuration commands work in one session.
func (e *SSHExec) enterMode(ctx context.Context, readOnly bool) error {
	if _, err := e.expectPrompt(ctx, ""); err != nil {
		e.Close()
		return fmt.Errorf("waiting for login prompt: %w", err)
	}
	steps := []string{"enable", "config"}
	if readOnly {
		steps = steps[:1]
	}
	for _, step := range steps {
		if out, err := e.exec(ctx, step, false); err != nil {
			e.Close()
			return fmt.Errorf("%s: %w", step, err)
		} else if msg := OutputError(out); msg != "" {
			e.Close()
			return fmt.Errorf("%s: %s", step, msg)
		}
	}
	return nil
}

func (e *SSHExec) readLoop(r io.Reader) {
	defer close(e.done)
	tmp := make([]byte, 4096)
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			e.mu.Lock()
			e.buf.Write(tmp[:n])
			e.mu.Unlock()
			select {
			case e.wake <- struct{}{}:
			default:
			}
		}
		if err != nil {
			return
		}
	}
}

func (e *SSHExec) snapshot() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.buf.String()
}

func (e *SSHExec) reset() {
	e.mu.Lock()
	e.buf.Reset()
	e.mu.Unlock()
}

func (e *SSHExec) send(s string) error {
	_, err := io.WriteString(e.stdin, s)
	return err
}

// expectPrompt collects output until the CLI prompt returns and stays quiet, answering the pager
// ("---- More ----") and "{ <cr> }:" continuation prompts along the way.
func (e *SSHExec) expectPrompt(ctx context.Context, cmdText string) (string, error) {
	return e.collect(ctx, cmdText, false)
}

func (e *SSHExec) collect(ctx context.Context, cmdText string, confirm bool) (string, error) {
	deadline := time.Now().Add(e.timeout)
	var acc strings.Builder
	answered := 0
	for {
		cur := e.snapshot()
		switch {
		case moreTailRe.MatchString(cur):
			cur = cleanPager(cur)
			acc.WriteString(cur)
			e.reset()
			deadline = time.Now().Add(e.timeout) // progress: the timeout is for silence, not total time
			if err := e.send(" "); err != nil {
				return "", err
			}
			continue
		case crPromptRe.MatchString(cur) && answered < 4:
			answered++
			if err := e.send("\r\n"); err != nil {
				return "", err
			}
			acc.WriteString(cur)
			e.reset()
			continue
		case yesNoRe.MatchString(cur):
			acc.WriteString(cur)
			e.reset()
			if !confirm {
				e.send("n\r\n")
				return acc.String(), ErrNeedsConfirmation
			}
			if err := e.send("y\r\n"); err != nil {
				return "", err
			}
			continue
		case promptRe.MatchString(cur):
			// Debounce: a prompt-looking line can appear mid-output; require quiet before accepting.
			select {
			case <-time.After(150 * time.Millisecond):
			case <-ctx.Done():
				return "", ctx.Err()
			}
			if e.snapshot() == cur {
				acc.WriteString(cur)
				e.reset()
				return trimOutput(acc.String(), cmdText), nil
			}
			continue
		}
		select {
		case <-e.wake:
		case <-time.After(100 * time.Millisecond):
		case <-e.done:
			return acc.String() + cur, io.EOF
		case <-ctx.Done():
			return "", ctx.Err()
		}
		if time.Now().After(deadline) {
			return acc.String() + cur, fmt.Errorf("timeout waiting for CLI prompt after %q", cmdText)
		}
	}
}

func cleanPager(s string) string {
	s = moreRe.ReplaceAllString(s, "")
	return strings.ReplaceAll(s, "\x1b[16D", "")
}

func trimOutput(out, cmd string) string {
	out = strings.ReplaceAll(out, "\r", "")
	lines := strings.Split(out, "\n")
	// drop echoed command (first line) and trailing prompt line
	if len(lines) > 0 && cmd != "" && strings.Contains(lines[0], cmd) {
		lines = lines[1:]
	}
	if n := len(lines); n > 0 && promptRe.MatchString("\n"+lines[n-1]) {
		lines = lines[:n-1]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func (e *SSHExec) exec(ctx context.Context, text string, confirm bool) (string, error) {
	e.reset()
	if err := e.send(text + "\r\n"); err != nil {
		return "", err
	}
	return e.collect(ctx, text, confirm)
}

// Run executes one validated command and returns its output. CLI-level failures are reported
// as errors so callers cannot mistake a rejected command for success.
func (e *SSHExec) Run(ctx context.Context, c Cmd) (string, error) {
	out, err := e.exec(ctx, c.text, c.confirm)
	if err != nil {
		return out, err
	}
	if msg := OutputError(out); msg != "" {
		return out, &CLIError{Cmd: c.text, Msg: msg}
	}
	return out, nil
}

func (e *SSHExec) Close() error {
	if e.stdin != nil {
		e.send("quit\r\n")
	}
	if e.conn != nil {
		return e.conn.Close()
	}
	e.sess.Close()
	return e.client.Close()
}
