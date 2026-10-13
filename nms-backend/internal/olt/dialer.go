package olt

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"

	"github.com/nepalairlink/nms/internal/config"
	"github.com/nepalairlink/nms/internal/secretbox"
)

// PGDialer resolves OLT address, pinned host key and credentials, then opens an SSH session.
// Named PGDialer for interface compatibility, backed by *sql.DB.
type PGDialer struct {
	DB       *sql.DB
	ReadOnly bool
	Box      *secretbox.Box // decrypts passwords saved from the frontend; nil falls back to env refs only
}

func (d PGDialer) Dial(ctx context.Context, oltID int64) (Executor, error) {
	var ip, ref, hostKey, proto, dbUser string
	var dbPassEnc sql.NullString
	var port int
	err := d.DB.QueryRowContext(ctx, `
		SELECT dv.ip, dv.credential_ref, o.ssh_port, o.ssh_host_key, o.protocol, o.login_user, o.login_pass_enc
		FROM olts o JOIN devices dv ON dv.id=o.device_id WHERE o.device_id=? AND dv.enabled=1`, oltID).
		Scan(&ip, &ref, &port, &hostKey, &proto, &dbUser, &dbPassEnc)
	if err != nil {
		return nil, fmt.Errorf("OLT %d not found or disabled: %w", oltID, err)
	}
	user, pass := dbUser, ""
	if dbPassEnc.Valid && dbPassEnc.String != "" && d.Box != nil {
		if pass, err = d.Box.Open(dbPassEnc.String); err != nil {
			return nil, err
		}
	}
	if user == "" { // legacy OLTs: credentials come from OLT_SSH_USER_<ref> / OLT_SSH_PASS_<ref>
		user, pass = config.Secret("OLT_SSH_USER", ref), config.Secret("OLT_SSH_PASS", ref)
	}
	if user == "" {
		return nil, fmt.Errorf("no login credentials configured for OLT %d", oltID)
	}
	addr := net.JoinHostPort(ip, strconv.Itoa(port))
	if proto == "telnet" {
		return DialTelnet(ctx, TelnetConfig{Addr: addr, User: user, Pass: pass, ReadOnly: d.ReadOnly})
	}
	if hostKey == "" {
		return nil, fmt.Errorf("OLT %d has no pinned SSH host key; approve it via the host-key endpoint first", oltID)
	}
	pk, _, _, _, err := ssh.ParseAuthorizedKey([]byte(hostKey))
	if err != nil {
		return nil, fmt.Errorf("stored host key is invalid: %w", err)
	}
	e, err := DialSSH(ctx, SSHConfig{Addr: addr, User: user, Pass: pass, HostKey: pk, ReadOnly: d.ReadOnly})
	if err != nil {
		return nil, err
	}
	return e, nil
}

// FormatHostKey renders a key as an authorized_keys line for storage.
func FormatHostKey(k ssh.PublicKey) string {
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(k)))
}
