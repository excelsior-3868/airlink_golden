// Package alerts turns raw observations into deduplicated, dependency-aware alerts and escalates them.
package alerts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Signal is one observation of one metric for one entity (device, interface, ONT).
type Signal struct {
	Metric   string // device_down | if_util | cpu | mem | if_down | ont_offline | ont_rx_low
	DeviceID int64
	Key      string // distinguishes entities on a device: interface name, ONT serial; "" for the device itself
	Role     string // device role, matched against rule.role_filter
	Value    float64
	Label    string // human-readable subject used in the alert title
}

type rule struct {
	ID        int64
	Name      string
	Metric    string
	Severity  string
	Op        string
	Threshold float64
	ForSample int
	Role      string
}

type Engine struct {
	db *sql.DB

	mu         sync.Mutex
	counts     map[string]int  // sustained-breach counters, keyed rule|device|key
	live       map[string]bool // dedup keys with a live alert; lets healthy observations skip the DB
	liveLoaded bool
	rules      []rule
	rulesAt    time.Time
	rulesTTL   time.Duration
}

func NewEngine(db *sql.DB) *Engine {
	return &Engine{db: db, counts: map[string]int{}, live: map[string]bool{}, rulesTTL: 30 * time.Second}
}

func (e *Engine) loadRules(ctx context.Context) ([]rule, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.rules != nil && time.Since(e.rulesAt) < e.rulesTTL {
		return e.rules, nil
	}
	rows, err := e.db.QueryContext(ctx, `SELECT id,name,metric,severity,op,threshold,for_samples,role_filter FROM alert_rules WHERE enabled=1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []rule
	for rows.Next() {
		var r rule
		if err := rows.Scan(&r.ID, &r.Name, &r.Metric, &r.Severity, &r.Op, &r.Threshold, &r.ForSample, &r.Role); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	e.rules, e.rulesAt = out, time.Now()
	return out, rows.Err()
}

// InvalidateRules forces a reload on the next observation (call after rule edits).
func (e *Engine) InvalidateRules() {
	e.mu.Lock()
	e.rules = nil
	e.mu.Unlock()
}

func breached(op string, v, th float64) bool {
	if op == "<" {
		return v < th
	}
	return v > th
}

// Observe evaluates all rules for the signal's metric.
func (e *Engine) Observe(ctx context.Context, s Signal) error {
	rules, err := e.loadRules(ctx)
	if err != nil {
		return err
	}
	var best *rule
	anyBreach := false

	e.mu.Lock()
	for i := range rules {
		r := &rules[i]
		if r.Metric != s.Metric || (r.Role != "" && r.Role != s.Role) {
			continue
		}
		ck := fmt.Sprintf("%d|%d|%s", r.ID, s.DeviceID, s.Key)
		if breached(r.Op, s.Value, r.Threshold) {
			e.counts[ck]++
			anyBreach = true
			if e.counts[ck] >= r.ForSample && (best == nil || r.Severity < best.Severity) {
				best = r
			}
		} else {
			delete(e.counts, ck)
		}
	}
	e.mu.Unlock()

	dedup := fmt.Sprintf("%s|%d|%s", s.Metric, s.DeviceID, s.Key)
	if err := e.ensureLive(ctx); err != nil {
		return err
	}
	switch {
	case best != nil:
		return e.raise(ctx, dedup, best, s)
	case !anyBreach:
		e.mu.Lock()
		isLive := e.live[dedup]
		e.mu.Unlock()
		if !isLive {
			return nil
		}
		return e.resolve(ctx, dedup, "condition cleared")
	}
	return nil
}

func (e *Engine) ensureLive(ctx context.Context) error {
	e.mu.Lock()
	loaded := e.liveLoaded
	e.mu.Unlock()
	if loaded {
		return nil
	}
	rows, err := e.db.QueryContext(ctx, `SELECT dedup_key FROM alerts WHERE state<>'resolved'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	e.mu.Lock()
	defer e.mu.Unlock()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return err
		}
		e.live[k] = true
	}
	e.liveLoaded = true
	return rows.Err()
}

func (e *Engine) markLive(k string, v bool) {
	e.mu.Lock()
	if v {
		e.live[k] = true
	} else {
		delete(e.live, k)
	}
	e.mu.Unlock()
}

func (e *Engine) raise(ctx context.Context, dedup string, r *rule, s Signal) error {
	title := fmt.Sprintf("%s: %s", r.Name, s.Label)
	detail := fmt.Sprintf("%s value %.2f %s %.2f", s.Metric, s.Value, r.Op, r.Threshold)

	res, err := e.db.ExecContext(ctx,
		`UPDATE alerts SET severity=?, title=?, detail=?, breach_count=breach_count+1
		 WHERE dedup_key=? AND state<>'resolved'`, r.Severity, title, detail, dedup)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		e.markLive(dedup, true)
		return nil
	}

	insRes, err := e.db.ExecContext(ctx,
		`INSERT INTO alerts (dedup_key, rule_id, device_id, severity, title, detail, breach_count)
		 VALUES (?,?,?,?,?,?,1)`,
		dedup, r.ID, s.DeviceID, r.Severity, title, detail)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "1062") {
			return nil
		}
		return err
	}
	id, _ := insRes.LastInsertId()
	e.markLive(dedup, true)
	slog.Info("alert opened", "id", id, "severity", r.Severity, "title", title)
	return e.applyDependencies(ctx, id, s)
}

func (e *Engine) applyDependencies(ctx context.Context, alertID int64, s Signal) error {
	var parentAlert int64
	err := e.db.QueryRowContext(ctx, `
		WITH RECURSIVE anc AS (
			SELECT parent_id AS id FROM devices WHERE id=? AND parent_id IS NOT NULL
			UNION
			SELECT d.parent_id FROM devices d JOIN anc ON d.id=anc.id WHERE d.parent_id IS NOT NULL)
		SELECT a.id FROM alerts a JOIN anc ON a.device_id=anc.id
		WHERE a.dedup_key LIKE 'device_down|%' AND a.state<>'resolved' AND a.suppressed_by IS NULL
		ORDER BY a.id LIMIT 1`, s.DeviceID).Scan(&parentAlert)
	if err == nil {
		_, err = e.db.ExecContext(ctx, `UPDATE alerts SET suppressed_by=? WHERE id=?`, parentAlert, alertID)
		return err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if s.Metric == "device_down" {
		_, err = e.db.ExecContext(ctx, `
			WITH RECURSIVE kids AS (
				SELECT id FROM devices WHERE parent_id=?
				UNION
				SELECT d.id FROM devices d JOIN kids ON d.parent_id=kids.id)
			UPDATE alerts SET suppressed_by=?
			WHERE device_id IN (SELECT id FROM kids) AND state<>'resolved' AND suppressed_by IS NULL AND id<>?`,
			s.DeviceID, alertID, alertID)
		return err
	}
	return nil
}

func (e *Engine) resolve(ctx context.Context, dedup, note string) error {
	// First fetch matching alert IDs
	rows, err := e.db.QueryContext(ctx, `SELECT id FROM alerts WHERE dedup_key=? AND state<>'resolved'`, dedup)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()

	if len(ids) == 0 {
		e.markLive(dedup, false)
		return nil
	}

	if _, err := e.db.ExecContext(ctx,
		`UPDATE alerts SET state='resolved', resolved_at=NOW(), resolution_note=?
		 WHERE dedup_key=? AND state<>'resolved'`, note, dedup); err != nil {
		return err
	}
	e.markLive(dedup, false)
	for _, id := range ids {
		slog.Info("alert resolved", "id", id)
		if _, err := e.db.ExecContext(ctx,
			`UPDATE alerts SET suppressed_by=NULL, escalation_base=NOW() WHERE suppressed_by=? AND state<>'resolved'`, id); err != nil {
			return err
		}
	}
	return nil
}

// Ack stops escalation.
func (e *Engine) Ack(ctx context.Context, id int64, by string) error {
	res, err := e.db.ExecContext(ctx,
		`UPDATE alerts SET state='acknowledged', acknowledged_at=NOW(), acknowledged_by=? WHERE id=? AND state='open'`, by, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ManualResolve closes an alert with an operator note.
func (e *Engine) ManualResolve(ctx context.Context, id int64, by, note string) error {
	var dedup string
	if err := e.db.QueryRowContext(ctx, `SELECT dedup_key FROM alerts WHERE id=? AND state<>'resolved'`, id).Scan(&dedup); err != nil {
		return err
	}
	return e.resolve(ctx, dedup, fmt.Sprintf("%s: %s", by, note))
}
