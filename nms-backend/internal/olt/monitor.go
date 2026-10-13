package olt

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/nepalairlink/nms/internal/alerts"
)

type Monitor struct {
	db                 *sql.DB
	dialer             Dialer
	engine             *alerts.Engine
	interval           time.Duration
	MaxOpticalPerCycle int
}

func NewMonitor(db *sql.DB, d Dialer, e *alerts.Engine, interval time.Duration) *Monitor {
	return &Monitor{db: db, dialer: d, engine: e, interval: interval, MaxOpticalPerCycle: 64}
}

func (m *Monitor) Run(ctx context.Context) {
	t := time.NewTicker(m.interval)
	defer t.Stop()
	for {
		m.Cycle(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (m *Monitor) Cycle(ctx context.Context) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT o.device_id, o.pon_ports FROM olts o JOIN devices d ON d.id=o.device_id
		WHERE d.enabled=1 AND d.status='up' AND o.ssh_host_key<>'' AND o.pon_ports<>''`)
	if err != nil {
		slog.Error("olt monitor: list", "err", err)
		return
	}
	type target struct {
		id    int64
		ports string
	}
	var ts []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.ports); err == nil {
			ts = append(ts, t)
		}
	}
	rows.Close()
	for _, t := range ts {
		if err := m.pollOLT(ctx, t.id, t.ports); err != nil {
			slog.Warn("olt monitor", "olt", t.id, "err", err)
		}
	}
}

func parseFSP(s string) (f, sl, p int, err error) {
	parts := strings.Split(strings.TrimSpace(s), "/")
	if len(parts) != 3 {
		return 0, 0, 0, fmt.Errorf("bad F/S/P %q", s)
	}
	f, e1 := strconv.Atoi(parts[0])
	sl, e2 := strconv.Atoi(parts[1])
	p, e3 := strconv.Atoi(parts[2])
	if e1 != nil || e2 != nil || e3 != nil {
		return 0, 0, 0, fmt.Errorf("bad F/S/P %q", s)
	}
	return
}

func (m *Monitor) pollOLT(ctx context.Context, oltID int64, ports string) error {
	ex, err := m.dialer.Dial(ctx, oltID)
	if err != nil {
		return err
	}
	defer ex.Close()

	for _, fsp := range strings.Split(ports, ",") {
		f, s, p, err := parseFSP(fsp)
		if err != nil {
			slog.Warn("olt monitor: skipping port", "err", err)
			continue
		}
		cmd, err := DisplayONTPort(f, s, p)
		if err != nil {
			continue
		}
		out, err := ex.Run(ctx, cmd)
		if err != nil {
			if isCLI(err) {
				continue
			}
			return err
		}
		opticalLeft := m.MaxOpticalPerCycle
		for _, r := range ParseONTTable(out) {
			online := strings.EqualFold(r.RunState, "online")
			var rx *float64
			if online && opticalLeft > 0 {
				if oc, err := DisplayONTOptical(r.SN); err == nil {
					opticalLeft--
					if o, err := ex.Run(ctx, oc); err == nil {
						if v, ok := ParseRxPower(o); ok {
							rx = &v
						}
					} else if !isCLI(err) {
						return err
					}
				}
			}
			if err := m.record(ctx, oltID, r, rx); err != nil {
				slog.Error("olt monitor: record", "sn", r.SN, "err", err)
			}
		}
	}
	return nil
}

func (m *Monitor) record(ctx context.Context, oltID int64, r ONTRow, rx *float64) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO ont_inventory (serial_number, olt_id, frame, slot, pon_port, ont_id, run_state, config_state, match_state, rx_power_dbm, last_seen_at)
		VALUES (?,?,?,?,?,?,?,?,?,?, CASE WHEN ?='online' THEN NOW() END)
		ON DUPLICATE KEY UPDATE olt_id=VALUES(olt_id), frame=VALUES(frame), slot=VALUES(slot),
		  pon_port=VALUES(pon_port), ont_id=VALUES(ont_id), run_state=VALUES(run_state), config_state=VALUES(config_state),
		  match_state=VALUES(match_state), rx_power_dbm=COALESCE(VALUES(rx_power_dbm), ont_inventory.rx_power_dbm),
		  last_seen_at=CASE WHEN VALUES(run_state)='online' THEN NOW() ELSE ont_inventory.last_seen_at END`,
		r.SN, oltID, r.F, r.S, r.P, r.OntID, strings.ToLower(r.RunState), strings.ToLower(r.ConfigState), strings.ToLower(r.MatchState), rx, strings.ToLower(r.RunState))
	if err != nil {
		return err
	}
	label := fmt.Sprintf("ONT %s (%d/%d/%d id %d)", r.SN, r.F, r.S, r.P, r.OntID)
	off := 0.0
	if !strings.EqualFold(r.RunState, "online") {
		off = 1
	}
	if err := m.engine.Observe(ctx, alerts.Signal{Metric: "ont_offline", DeviceID: oltID, Key: r.SN, Role: "olt", Value: off, Label: label}); err != nil {
		return err
	}
	if rx != nil {
		return m.engine.Observe(ctx, alerts.Signal{Metric: "ont_rx_low", DeviceID: oltID, Key: r.SN, Role: "olt", Value: *rx, Label: label})
	}
	return nil
}
