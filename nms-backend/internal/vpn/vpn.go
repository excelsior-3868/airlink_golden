// Package vpn supervises an OpenVPN client so the NMS can reach OLTs that sit behind a VPN.
package vpn

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Config describes the tunnel. Secrets are written to a private temp dir, never to argv.
type Config struct {
	ConfigFile string   // path to the .ovpn profile
	Username   string   // auth-user-pass username
	Password   string   // auth-user-pass password
	KeyPass    string   // passphrase of the encrypted private key in the profile
	Binary     string   // openvpn executable (default "openvpn")
	Routes     []string // CIDRs (e.g. 172.16.16.0/24) to send through the tunnel
}

// Enabled reports whether a profile is configured.
func (c Config) Enabled() bool { return c.ConfigFile != "" }

// Run keeps the tunnel up until ctx is cancelled, restarting openvpn if it exits.
func Run(ctx context.Context, c Config) error {
	if !c.Enabled() {
		return nil
	}
	if _, err := os.Stat(c.ConfigFile); err != nil {
		return fmt.Errorf("vpn: profile: %w", err)
	}
	dir, err := os.MkdirTemp("", "ovpn-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	// redirect-gateway in the profile itself (not just pushed) would send the database and all
	// other container traffic through the tunnel, so run from a sanitized copy.
	raw, err := os.ReadFile(c.ConfigFile)
	if err != nil {
		return fmt.Errorf("vpn: profile: %w", err)
	}
	var kept []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "redirect-gateway") {
			continue
		}
		kept = append(kept, line)
	}
	cfgFile := filepath.Join(dir, "client.ovpn")
	if err := os.WriteFile(cfgFile, []byte(strings.Join(kept, "\n")), 0o600); err != nil {
		return err
	}

	authFile := filepath.Join(dir, "auth")
	keyFile := filepath.Join(dir, "keypass")
	if err := os.WriteFile(authFile, []byte(c.Username+"\n"+c.Password+"\n"), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(keyFile, []byte(c.KeyPass+"\n"), 0o600); err != nil {
		return err
	}

	bin := c.Binary
	if bin == "" {
		bin = "openvpn"
	}
	args := []string{
		"--config", cfgFile,
		"--auth-user-pass", authFile,
		"--askpass", keyFile,
		// The profile pushes redirect-gateway; honouring it would send the database and
		// all other container traffic through the tunnel. Only the pushed OLT routes are kept.
		"--pull-filter", "ignore", "redirect-gateway",
		"--pull-filter", "ignore", "dhcp-option",
		// The OLT-side server still negotiates the legacy AES-256-CBC cipher from the profile.
		"--data-ciphers", "AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-256-CBC",
		"--script-security", "2",
	}

	for _, r := range c.Routes {
		_, n, err := net.ParseCIDR(r)
		if err != nil {
			return fmt.Errorf("vpn: bad route %q: %w", r, err)
		}
		args = append(args, "--route", n.IP.String(), net.IP(n.Mask).String())
	}

	for backoff := 5 * time.Second; ctx.Err() == nil; {
		started := time.Now()
		slog.Info("vpn: starting openvpn", "profile", c.ConfigFile)
		cmd := exec.CommandContext(ctx, bin, args...)
		cmd.Stdout = slogWriter{slog.LevelInfo}
		cmd.Stderr = slogWriter{slog.LevelWarn}
		err := cmd.Run()
		if ctx.Err() != nil {
			break
		}
		if time.Since(started) > time.Minute {
			backoff = 5 * time.Second
		}
		slog.Error("vpn: openvpn exited, restarting", "err", err, "in", backoff)
		select {
		case <-ctx.Done():
		case <-time.After(backoff):
		}
		if backoff < 2*time.Minute {
			backoff *= 2
		}
	}
	return nil
}

type slogWriter struct{ level slog.Level }

func (w slogWriter) Write(p []byte) (int, error) {
	slog.Log(context.Background(), w.level, "openvpn", "line", string(p))
	return len(p), nil
}
