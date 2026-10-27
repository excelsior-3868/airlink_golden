package hsgq

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strconv"

	"github.com/nepalairlink/nms/internal/config"
	"github.com/nepalairlink/nms/internal/olt"
	"github.com/nepalairlink/nms/internal/secretbox"
)

// Dialer opens a telnet session to an HSGQ OLT and leaves it in config mode, where `show ont-info` lives
// (the `enable` level only has version, history and port-module shows).
type Dialer struct {
	DB  *sql.DB
	Box *secretbox.Box
}

func (d Dialer) Dial(ctx context.Context, oltID int64) (olt.Executor, error) {
	var ip, ref, proto, user string
	var port int
	var passEnc sql.NullString
	err := d.DB.QueryRowContext(ctx, `
		SELECT dv.ip, dv.credential_ref, o.ssh_port, o.protocol, o.login_user, o.login_pass_enc
		FROM olts o JOIN devices dv ON dv.id=o.device_id WHERE o.device_id=? AND dv.enabled=1`, oltID).
		Scan(&ip, &ref, &port, &proto, &user, &passEnc)
	if err != nil {
		return nil, fmt.Errorf("OLT %d not found or disabled: %w", oltID, err)
	}
	if proto != "telnet" {
		return nil, fmt.Errorf("HSGQ OLT %d is set to %q; only telnet is supported by the HSGQ driver", oltID, proto)
	}
	pass := ""
	if passEnc.Valid && passEnc.String != "" && d.Box != nil {
		if pass, err = d.Box.Open(passEnc.String); err != nil {
			return nil, err
		}
	}
	if user == "" {
		user, pass = config.Secret("OLT_SSH_USER", ref), config.Secret("OLT_SSH_PASS", ref)
	}
	if user == "" {
		return nil, fmt.Errorf("no login credentials configured for OLT %d", oltID)
	}
	return olt.DialTelnet(ctx, olt.TelnetConfig{
		Addr:         net.JoinHostPort(ip, strconv.Itoa(port)),
		User:         user,
		Pass:         pass,
		EnterSteps:   []string{"enable", "configure"},
		DropLogLines: true,
	})
}
