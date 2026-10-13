package poller

import (
	"context"
	"database/sql"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/nepalairlink/nms/internal/alerts"
)

type Poller struct {
	db       *sql.DB
	engine   *alerts.Engine
	pollerID string
	interval time.Duration
	workers  int
}

func New(db *sql.DB, e *alerts.Engine, pollerID string, interval time.Duration, workers int) *Poller {
	return &Poller{db: db, engine: e, pollerID: pollerID, interval: interval, workers: workers}
}

type deviceRow struct {
	ID          int64
	Name, IP    string
	Role        string
	Method      string
	SNMPVersion string
	SNMPPort    int
	TCPPort     int
	CredRef     string
	Failures    int
	Status      string
}

func (p *Poller) Run(ctx context.Context) {
	p.cycle(ctx)
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.cycle(ctx)
		}
	}
}

func (p *Poller) cycle(ctx context.Context) {
	rows, err := p.db.QueryContext(ctx, `
		SELECT id,name,ip,role,poll_method,snmp_version,snmp_port,tcp_port,credential_ref,consecutive_failures,status
		FROM devices WHERE enabled=1 AND poll_method<>'none' AND poller_id=?`, p.pollerID)
	if err != nil {
		slog.Error("poller: list devices", "err", err)
		return
	}
	var devs []deviceRow
	for rows.Next() {
		var d deviceRow
		if err := rows.Scan(&d.ID, &d.Name, &d.IP, &d.Role, &d.Method, &d.SNMPVersion, &d.SNMPPort, &d.TCPPort, &d.CredRef, &d.Failures, &d.Status); err != nil {
			slog.Error("poller: scan", "err", err)
			rows.Close()
			return
		}
		devs = append(devs, d)
	}
	rows.Close()

	jobs := make(chan deviceRow)
	var wg sync.WaitGroup
	for i := 0; i < p.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range jobs {
				p.pollOne(ctx, d)
			}
		}()
	}
	for _, d := range devs {
		jobs <- d
	}
	close(jobs)
	wg.Wait()
}

func (p *Poller) pollOne(ctx context.Context, d deviceRow) {
	var (
		res *snmpResult
		err error
	)
	switch d.Method {
	case "snmp":
		res, err = pollSNMP(Target{IP: d.IP, Port: d.SNMPPort, Version: d.SNMPVersion, CredRef: d.CredRef, WithIfTable: true})
	case "tcp":
		err = tcpReachable(d.IP, d.TCPPort)
	}

	reachable := err == nil || res != nil
	if err := p.recordReachability(ctx, d, reachable, res); err != nil {
		slog.Error("poller: record", "device", d.Name, "err", err)
		return
	}
	down := 1.0
	if reachable {
		down = 0
	}
	p.observe(ctx, alerts.Signal{Metric: "device_down", DeviceID: d.ID, Role: d.Role, Value: down, Label: d.Name})
	if !reachable {
		slog.Debug("poll failed", "device", d.Name, "err", err)
		return
	}
	if res == nil {
		return
	}
	if res.CPU != nil {
		p.observe(ctx, alerts.Signal{Metric: "cpu", DeviceID: d.ID, Role: d.Role, Value: *res.CPU, Label: d.Name + " CPU"})
		p.metric(ctx, d.ID, nil, "cpu_pct", *res.CPU)
	}
	if res.Mem != nil {
		p.observe(ctx, alerts.Signal{Metric: "mem", DeviceID: d.ID, Role: d.Role, Value: *res.Mem, Label: d.Name + " memory"})
		p.metric(ctx, d.ID, nil, "mem_pct", *res.Mem)
	}
	if err := p.recordInterfaces(ctx, d, res.Interfaces); err != nil {
		slog.Error("poller: interfaces", "device", d.Name, "err", err)
	}
}

func (p *Poller) observe(ctx context.Context, s alerts.Signal) {
	if err := p.engine.Observe(ctx, s); err != nil {
		slog.Error("alert engine", "metric", s.Metric, "err", err)
	}
}

func (p *Poller) metric(ctx context.Context, dev int64, iface *int64, name string, v float64) {
	if _, err := p.db.ExecContext(ctx, `INSERT INTO metrics(device_id, interface_id, name, value) VALUES(?,?,?,?)`, dev, iface, name, v); err != nil {
		slog.Error("poller: metric insert", "err", err)
	}
}

func (p *Poller) recordReachability(ctx context.Context, d deviceRow, ok bool, res *snmpResult) error {
	if ok {
		if res != nil {
			_, err := p.db.ExecContext(ctx, `
				UPDATE devices SET status='up', consecutive_failures=0, last_polled_at=NOW(),
				  status_since = CASE WHEN status='up' THEN status_since ELSE NOW() END,
				  sys_descr=?, uptime_seconds=?, cpu_pct=?, mem_pct=? WHERE id=?`,
				res.Descr, res.UptimeSecs, res.CPU, res.Mem, d.ID)
			return err
		}
		_, err := p.db.ExecContext(ctx, `
			UPDATE devices SET status='up', consecutive_failures=0, last_polled_at=NOW(),
			  status_since = CASE WHEN status='up' THEN status_since ELSE NOW() END WHERE id=?`, d.ID)
		return err
	}
	_, err := p.db.ExecContext(ctx, `
		UPDATE devices SET consecutive_failures=consecutive_failures+1, last_polled_at=NOW(),
		  status = CASE WHEN consecutive_failures+1 >= 2 THEN 'down' ELSE status END,
		  status_since = CASE WHEN consecutive_failures+1 >= 2 AND status<>'down' THEN NOW() ELSE status_since END
		WHERE id=?`, d.ID)
	return err
}

func (p *Poller) recordInterfaces(ctx context.Context, d deviceRow, samples []ifSample) error {
	now := time.Now()
	for _, s := range samples {
		var (
			ifID      int64
			monitored bool
			prevIn    *string
			prevOut   *string
			prevAt    *time.Time
		)

		if _, err := p.db.ExecContext(ctx, `
			INSERT INTO interfaces (device_id, if_index, name, alias, speed_bps, oper_status)
			VALUES (?,?,?,?,?,?)
			ON DUPLICATE KEY UPDATE name=VALUES(name), alias=VALUES(alias),
			  speed_bps=VALUES(speed_bps), oper_status=VALUES(oper_status)`,
			d.ID, s.Index, s.Name, s.Alias, s.SpeedBps, s.OperStatus); err != nil {
			return err
		}

		err := p.db.QueryRowContext(ctx, `
			SELECT id, monitored, last_in_octets, last_out_octets, last_sample_at
			FROM interfaces WHERE device_id=? AND if_index=?`, d.ID, s.Index).
			Scan(&ifID, &monitored, &prevIn, &prevOut, &prevAt)
		if err != nil {
			return err
		}

		var inBps, outBps, util *float64
		if prevAt != nil && prevIn != nil && prevOut != nil && s.InOctets != nil && s.OutOctets != nil {
			pi, _ := new(big.Int).SetString(*prevIn, 10)
			po, _ := new(big.Int).SetString(*prevOut, 10)
			dt := now.Sub(*prevAt)
			if v, ok := bitsPerSecond(pi, s.InOctets, dt); ok {
				inBps = &v
			}
			if v, ok := bitsPerSecond(po, s.OutOctets, dt); ok {
				outBps = &v
			}
			if inBps != nil && outBps != nil && s.SpeedBps > 0 {
				u := maxf(*inBps, *outBps) / float64(s.SpeedBps) * 100
				util = &u
			}
		}
		_, err = p.db.ExecContext(ctx, `
			UPDATE interfaces SET in_bps=?, out_bps=?, util_pct=?, in_errors=?, out_errors=?,
			  last_in_octets=?, last_out_octets=?, last_sample_at=? WHERE id=?`,
			inBps, outBps, util, s.InErrors, s.OutErrors, bigStr(s.InOctets), bigStr(s.OutOctets), now, ifID)
		if err != nil {
			return err
		}

		if inBps != nil {
			p.metric(ctx, d.ID, &ifID, "in_bps", *inBps)
		}
		if outBps != nil {
			p.metric(ctx, d.ID, &ifID, "out_bps", *outBps)
		}
		if !monitored {
			continue
		}
		label := d.Name + " " + s.Name
		down := 0.0
		if s.OperStatus != "up" {
			down = 1
		}
		p.observe(ctx, alerts.Signal{Metric: "if_down", DeviceID: d.ID, Key: s.Name, Role: d.Role, Value: down, Label: label})
		if util != nil {
			p.observe(ctx, alerts.Signal{Metric: "if_util", DeviceID: d.ID, Key: s.Name, Role: d.Role, Value: *util, Label: label})
		}
	}
	return nil
}

func bigStr(b *big.Int) *string {
	if b == nil {
		return nil
	}
	s := b.String()
	return &s
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
