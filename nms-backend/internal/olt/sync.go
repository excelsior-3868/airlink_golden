package olt

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

type readOnlyExec struct{ Executor }

var ErrReadOnly = errors.New("write command refused in read-only sync")

func (r readOnlyExec) Run(ctx context.Context, c Cmd) (string, error) {
	if c.IsWrite() || !strings.HasPrefix(c.String(), "display ") {
		return "", ErrReadOnly
	}
	return r.Executor.Run(ctx, c)
}

func (s *Service) SetReadOnlyDialer(d Dialer) { s.roDialer = d }

type SyncRun struct {
	ID         int64          `json:"id"`
	OLTID      int64          `json:"olt_id"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at"`
	Status     string         `json:"status"`
	Trigger    string         `json:"triggered_by"`
	Counts     map[string]int `json:"counts"`
	Error      string         `json:"error"`
}

func (s *Service) Sync(ctx context.Context, oltID int64, actor string) (*SyncRun, error) {
	runID, release, err := s.beginSync(ctx, oltID, actor)
	if err != nil {
		return nil, err
	}
	defer release()
	return s.execSync(ctx, oltID, runID)
}

func (s *Service) StartSync(ctx context.Context, oltID int64, actor string) (*SyncRun, error) {
	runID, release, err := s.beginSync(ctx, oltID, actor)
	if err != nil {
		return nil, err
	}
	go func() {
		defer release()
		bg, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		if _, err := s.execSync(bg, oltID, runID); err != nil {
			slog.Error("background sync", "olt", oltID, "err", err)
		}
	}()
	return s.SyncRunByID(ctx, runID)
}

func (s *Service) beginSync(ctx context.Context, oltID int64, actor string) (int64, func(), error) {
	key := fmt.Sprintf("olt:%d", oltID)
	if err := s.lock(key); err != nil {
		return 0, nil, err
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO olt_sync_runs(olt_id, triggered_by, counts, error) VALUES(?,?,'{}','')`, oltID, actor)
	if err != nil {
		s.unlock(key)
		return 0, nil, err
	}
	runID, err := res.LastInsertId()
	if err != nil {
		s.unlock(key)
		return 0, nil, err
	}
	return runID, func() { s.unlock(key) }, nil
}

func (s *Service) execSync(ctx context.Context, oltID, runID int64) (*SyncRun, error) {
	counts := map[string]int{}
	var warns []string
	finish := func(status, errMsg string) (*SyncRun, error) {
		cj, _ := json.Marshal(counts)
		if len(warns) > 0 {
			errMsg = strings.TrimSpace(errMsg + " " + strings.Join(warns, "; "))
		}
		if _, err := s.db.ExecContext(context.WithoutCancel(ctx), `UPDATE olt_sync_runs SET finished_at=NOW(), status=?, counts=?, error=? WHERE id=?`,
			status, cj, errMsg, runID); err != nil {
			slog.Error("finish sync run", "err", err)
		}
		if status != "failed" {
			s.db.ExecContext(context.WithoutCancel(ctx), `UPDATE olts SET last_sync_at=NOW() WHERE device_id=?`, oltID)
		}
		return s.SyncRunByID(ctx, runID)
	}

	d := s.roDialer
	if d == nil {
		d = s.dialer
	}
	raw, err := d.Dial(ctx, oltID)
	if err != nil {
		return finish("failed", "connect: "+err.Error())
	}
	defer raw.Close()
	ex := readOnlyExec{raw}

	collect := func(c Cmd) (out string, cliErr error, fatal error) {
		out, err := ex.Run(ctx, c)
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		if _, e := s.db.ExecContext(ctx, `
			INSERT INTO olt_snapshots(olt_id, command, output, error, collected_at) VALUES(?,?,?,?,NOW())
			ON DUPLICATE KEY UPDATE output=VALUES(output), error=VALUES(error), collected_at=NOW()`,
			oltID, c.String(), out, msg); e != nil {
			return out, nil, e
		}
		if err != nil && !isCLI(err) {
			return out, nil, err
		}
		return out, err, nil
	}

	step := func(name string, c Cmd, apply func(out string) (int, error)) error {
		out, cliErr, fatal := collect(c)
		if fatal != nil {
			return fatal
		}
		if cliErr != nil {
			warns = append(warns, fmt.Sprintf("%s: %v", c, cliErr))
			return nil
		}
		n, err := apply(out)
		if err != nil {
			return err
		}
		counts[name] = n
		if n == 0 && strings.TrimSpace(out) != "" {
			warns = append(warns, fmt.Sprintf("%s: output received but no rows recognised (layout differs?) - existing data kept; see raw output", c))
		}
		return nil
	}

	var boards []Board
	steps := []struct {
		name  string
		cmd   Cmd
		apply func(string) (int, error)
	}{
		{"version", DisplayVersion(), func(out string) (int, error) {
			v, p := ParseVersion(out)
			if v == "" {
				return 0, nil
			}
			_, err := s.db.ExecContext(ctx, `UPDATE olts SET detected_version=?, detected_patch=? WHERE device_id=?`, v, p, oltID)
			return 1, err
		}},
		{"boards", DisplayBoard(), func(out string) (int, error) {
			boards = ParseBoards(out)
			return replaceRows(ctx, s, oltID, "olt_boards", len(boards), func(tx *sql.Tx) error {
				for _, b := range boards {
					if _, err := tx.ExecContext(ctx, `INSERT INTO olt_boards(olt_id, slot, board_name, status) VALUES(?,?,?,?)`, oltID, b.Slot, b.Name, b.Status); err != nil {
						return err
					}
				}
				return nil
			})
		}},
		{"dba_profiles", DisplayDBAProfiles(), s.syncProfiles(ctx, oltID, "dba", ParseDBAProfiles)},
		{"line_profiles", DisplayLineProfiles(), s.syncProfiles(ctx, oltID, "line", ParseNamedProfiles)},
		{"srv_profiles", DisplaySrvProfiles(), s.syncProfiles(ctx, oltID, "srv", ParseNamedProfiles)},
		{"vlans", DisplayVLANAll(), func(out string) (int, error) {
			rows := ParseVLANs(out)
			return replaceRows(ctx, s, oltID, "olt_vlans", len(rows), func(tx *sql.Tx) error {
				for _, v := range rows {
					if _, err := tx.ExecContext(ctx, `INSERT IGNORE INTO olt_vlans(olt_id, vlan_id, vlan_type, attribute, std_ports, serv_ports) VALUES(?,?,?,?,?,?)`,
						oltID, v.ID, v.Type, v.Attribute, v.StdPorts, v.ServPorts); err != nil {
						return err
					}
				}
				return nil
			})
		}},
		{"service_ports", DisplayServicePortAll(), func(out string) (int, error) {
			rows := ParseServicePorts(out)
			return replaceRows(ctx, s, oltID, "olt_service_ports", len(rows), func(tx *sql.Tx) error {
				for _, r := range rows {
					if _, err := tx.ExecContext(ctx, `INSERT IGNORE INTO olt_service_ports(olt_id, sp_index, vlan, attribute, frame, slot, port, ont_id, gem, flow_type, flow_para, state)
						VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
						oltID, r.Index, r.VLAN, r.Attribute, r.F, r.S, r.P, r.OntID, r.Gem, r.FlowType, r.FlowPara, r.State); err != nil {
						return err
					}
				}
				return nil
			})
		}},
	}
	for _, st := range steps {
		if err := step(st.name, st.cmd, st.apply); err != nil {
			return finish("failed", err.Error())
		}
	}

	ports, err := s.ponPorts(ctx, oltID, boards)
	if err != nil {
		return finish("failed", "resolve PON ports: "+err.Error())
	}
	ontCount := 0
	portsWithONTs := 0
	for _, p := range ports {
		cmd, err := DisplayONTPort(p[0], p[1], p[2])
		if err != nil {
			continue
		}
		out, cliErr, fatal := collect(cmd)
		if fatal != nil {
			return finish("failed", fatal.Error())
		}
		if cliErr != nil {
			continue
		}
		rows := ParseONTTable(out)
		if len(rows) > 0 {
			portsWithONTs++
			ontCount += len(rows)
			for _, r := range rows {
				if err := upsertONT(ctx, s, oltID, r); err != nil {
					return finish("failed", "record ONT: "+err.Error())
				}
			}
		}
	}
	counts["pon_ports_scanned"] = len(ports)
	counts["pon_ports_with_onts"] = portsWithONTs
	counts["onts"] = ontCount

	if len(warns) > 0 {
		return finish("partial", "")
	}
	return finish("succeeded", "")
}

func (s *Service) syncProfiles(ctx context.Context, oltID int64, typ string, parse func(string) []ProfileRow) func(string) (int, error) {
	return func(out string) (int, error) {
		rows := parse(out)
		return replaceRows(ctx, s, oltID, "", len(rows), func(tx *sql.Tx) error {
			ids := make([]any, 0, len(rows))
			for _, r := range rows {
				ids = append(ids, r.ID)
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO olt_profiles(olt_id, profile_type, profile_id, profile_name, binding_times, detail, verified_at)
					VALUES(?,?,?,?,?,?,NOW())
					ON DUPLICATE KEY UPDATE profile_name=VALUES(profile_name), binding_times=VALUES(binding_times), detail=VALUES(detail), verified_at=NOW()`,
					oltID, typ, r.ID, r.Name, r.Bindings, r.Detail); err != nil {
					return err
				}
			}
			if len(ids) > 0 {
				placeholders := strings.Repeat("?,", len(ids))
				placeholders = placeholders[:len(placeholders)-1]
				args := append([]any{oltID, typ}, ids...)
				if _, err := tx.ExecContext(ctx, `DELETE FROM olt_profiles WHERE olt_id=? AND profile_type=? AND profile_id NOT IN (`+placeholders+`)`, args...); err != nil {
					return err
				}
			} else {
				if _, err := tx.ExecContext(ctx, `DELETE FROM olt_profiles WHERE olt_id=? AND profile_type=?`, oltID, typ); err != nil {
					return err
				}
			}
			return nil
		})
	}
}

func replaceRows(ctx context.Context, s *Service, oltID int64, table string, n int, fn func(tx *sql.Tx) error) (int, error) {
	if n == 0 {
		return 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if table != "" {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE olt_id=?", oltID); err != nil {
			return 0, err
		}
	}
	if err := fn(tx); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

func upsertONT(ctx context.Context, s *Service, oltID int64, r ONTRow) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ont_inventory (serial_number, olt_id, frame, slot, pon_port, ont_id, run_state, config_state, match_state, last_seen_at)
		VALUES (?,?,?,?,?,?,?,?,?, CASE WHEN ?='online' THEN NOW() END)
		ON DUPLICATE KEY UPDATE olt_id=VALUES(olt_id), frame=VALUES(frame), slot=VALUES(slot),
		  pon_port=VALUES(pon_port), ont_id=VALUES(ont_id), run_state=VALUES(run_state), config_state=VALUES(config_state),
		  match_state=VALUES(match_state),
		  last_seen_at=CASE WHEN VALUES(run_state)='online' THEN NOW() ELSE ont_inventory.last_seen_at END`,
		r.SN, oltID, r.F, r.S, r.P, r.OntID, strings.ToLower(r.RunState), strings.ToLower(r.ConfigState), strings.ToLower(r.MatchState), strings.ToLower(r.RunState))
	return err
}

func (s *Service) ponPorts(ctx context.Context, oltID int64, boards []Board) ([][3]int, error) {
	var cfg string
	if err := s.db.QueryRowContext(ctx, `SELECT pon_ports FROM olts WHERE device_id=?`, oltID).Scan(&cfg); err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg) != "" {
		var out [][3]int
		for _, p := range strings.Split(cfg, ",") {
			f, sl, pt, err := parseFSP(p)
			if err != nil {
				return nil, err
			}
			out = append(out, [3]int{f, sl, pt})
		}
		return out, nil
	}

	if len(boards) == 0 {
		rows, err := s.db.QueryContext(ctx, `SELECT slot, board_name FROM olt_boards WHERE olt_id=?`, oltID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var b Board
			if rows.Scan(&b.Slot, &b.Name) == nil {
				boards = append(boards, b)
			}
		}
	}

	var out [][3]int
	for _, b := range boards {
		if IsGPONBoard(b.Name) {
			for p := 0; p < 16; p++ {
				out = append(out, [3]int{0, b.Slot, p})
			}
		}
	}
	return out, nil
}

func (s *Service) SyncRunByID(ctx context.Context, id int64) (*SyncRun, error) {
	r := &SyncRun{}
	var counts []byte
	err := s.db.QueryRowContext(ctx, `SELECT id, olt_id, started_at, finished_at, status, triggered_by, counts, error FROM olt_sync_runs WHERE id=?`, id).
		Scan(&r.ID, &r.OLTID, &r.StartedAt, &r.FinishedAt, &r.Status, &r.Trigger, &counts, &r.Error)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(counts, &r.Counts)
	return r, nil
}

func (s *Service) RunSyncLoop(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		rows, err := s.db.QueryContext(ctx, `SELECT o.device_id FROM olts o JOIN devices d ON d.id=o.device_id WHERE d.enabled=1 AND o.ssh_host_key<>''`)
		if err != nil {
			slog.Error("sync loop", "err", err)
			continue
		}
		var ids []int64
		for rows.Next() {
			var id int64
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			if _, err := s.Sync(ctx, id, "scheduler"); err != nil {
				slog.Warn("scheduled sync", "olt", id, "err", err)
			}
		}
	}
}
