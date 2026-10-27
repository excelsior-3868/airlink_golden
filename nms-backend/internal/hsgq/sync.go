package hsgq

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nepalairlink/nms/internal/olt"
)

var ErrReadOnly = errors.New("write command refused in read-only sync")

// Service syncs HSGQ OLTs into the same inventory tables the Huawei sync fills, so the rest of the NMS
// (inventory pages, customer matching, snapshots) works unchanged.
type Service struct {
	db     *sql.DB
	dialer olt.Dialer

	mu     sync.Mutex
	locked map[int64]bool
}

func NewService(db *sql.DB, d olt.Dialer) *Service {
	return &Service{db: db, dialer: d, locked: map[int64]bool{}}
}

type readOnlyExec struct{ olt.Executor }

func (r readOnlyExec) Run(ctx context.Context, c olt.Cmd) (string, error) {
	if err := checkReadOnly(c.String()); err != nil {
		return "", err
	}
	return r.Executor.Run(ctx, c)
}

func (s *Service) Sync(ctx context.Context, oltID int64, actor string) (*olt.SyncRun, error) {
	runID, release, err := s.begin(ctx, oltID, actor)
	if err != nil {
		return nil, err
	}
	defer release()
	return s.exec(ctx, oltID, runID)
}

func (s *Service) StartSync(ctx context.Context, oltID int64, actor string) (*olt.SyncRun, error) {
	runID, release, err := s.begin(ctx, oltID, actor)
	if err != nil {
		return nil, err
	}
	go func() {
		defer release()
		bg, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		if _, err := s.exec(bg, oltID, runID); err != nil {
			slog.Error("hsgq background sync", "olt", oltID, "err", err)
		}
	}()
	return s.runByID(ctx, runID)
}

func (s *Service) begin(ctx context.Context, oltID int64, actor string) (int64, func(), error) {
	s.mu.Lock()
	if s.locked[oltID] {
		s.mu.Unlock()
		return 0, nil, olt.ErrBusy
	}
	s.locked[oltID] = true
	s.mu.Unlock()
	unlock := func() { s.mu.Lock(); delete(s.locked, oltID); s.mu.Unlock() }

	res, err := s.db.ExecContext(ctx, `INSERT INTO olt_sync_runs(olt_id, triggered_by, counts, error) VALUES(?,?,'{}','')`, oltID, actor)
	if err != nil {
		unlock()
		return 0, nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		unlock()
		return 0, nil, err
	}
	return id, unlock, nil
}

func (s *Service) exec(ctx context.Context, oltID, runID int64) (*olt.SyncRun, error) {
	counts := map[string]int{}
	var warns []string
	finish := func(status, errMsg string) (*olt.SyncRun, error) {
		cj, _ := json.Marshal(counts)
		if len(warns) > 0 {
			errMsg = strings.TrimSpace(errMsg + " " + strings.Join(warns, "; "))
		}
		bg := context.WithoutCancel(ctx)
		if _, err := s.db.ExecContext(bg, `UPDATE olt_sync_runs SET finished_at=NOW(), status=?, counts=?, error=? WHERE id=?`, status, cj, errMsg, runID); err != nil {
			slog.Error("finish hsgq sync run", "err", err)
		}
		if status != "failed" {
			s.db.ExecContext(bg, `UPDATE olts SET last_sync_at=NOW() WHERE device_id=?`, oltID)
		}
		return s.runByID(ctx, runID)
	}

	raw, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		return finish("failed", "connect: "+err.Error())
	}
	defer raw.Close()
	ex := readOnlyExec{raw}

	// collect runs one read command and stores its raw output, so a layout difference on the real box can be diagnosed
	// from the snapshots page. cliErr is the OLT rejecting the command; fatal is a transport or database failure.
	collect := func(text string) (out string, cliErr, fatal error) {
		out, err := ex.Run(ctx, olt.VendorReadCmd(text))
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		if _, e := s.db.ExecContext(ctx, `
			INSERT INTO olt_snapshots(olt_id, command, output, error, collected_at) VALUES(?,?,?,?,NOW())
			ON DUPLICATE KEY UPDATE output=VALUES(output), error=VALUES(error), collected_at=NOW()`,
			oltID, text, out, msg); e != nil {
			return out, nil, e
		}
		var ce *olt.CLIError
		if err != nil && !errors.As(err, &ce) {
			return out, nil, err
		}
		return out, err, nil
	}

	out, cliErr, fatal := collect(ShowVersion)
	switch {
	case fatal != nil:
		return finish("failed", fatal.Error())
	case cliErr != nil:
		warns = append(warns, cliErr.Error())
	default:
		if v, p := ParseVersion(out); v != "" {
			if _, err := s.db.ExecContext(ctx, `UPDATE olts SET detected_version=?, detected_patch=? WHERE device_id=?`, v, p, oltID); err != nil {
				return finish("failed", err.Error())
			}
			counts["version"] = 1
		} else if strings.TrimSpace(out) != "" {
			warns = append(warns, ShowVersion+": output received but no version recognised")
		}
	}

	ports, err := s.ponPorts(ctx, oltID)
	if err != nil {
		return finish("failed", "resolve PON ports: "+err.Error())
	}
	onts, withONTs, scanned, heldElsewhere := 0, 0, 0, 0
	for _, pon := range ports {
		text, err := OntInfoPort(pon)
		if err != nil {
			continue
		}
		out, cliErr, fatal := collect(text)
		if fatal != nil {
			return finish("failed", fatal.Error())
		}
		if cliErr != nil {
			// A port this chassis does not have: skip it, and do not touch what the OLT did not answer for.
			continue
		}
		tab := ParseONTTable(out)
		if tab.Total >= 0 && tab.Total != len(tab.Rows) {
			warns = append(warns, fmt.Sprintf("%s: OLT reports %d ONTs but %d rows were read (output cut short?) - existing data kept; see raw output", text, tab.Total, len(tab.Rows)))
			continue
		}
		if !tab.Recognised && len(tab.Rows) == 0 {
			if strings.TrimSpace(out) != "" {
				warns = append(warns, fmt.Sprintf("%s: output received but no ONT table recognised (layout differs?) - existing data kept; see raw output", text))
			}
			continue
		}
		scanned++
		if len(tab.Rows) > 0 {
			withONTs++
			onts += len(tab.Rows)
		}
		n, err := s.replacePort(ctx, oltID, pon, tab.Rows)
		if err != nil {
			return finish("failed", fmt.Sprintf("record ONTs of PON %d: %v", pon, err))
		}
		heldElsewhere += n
	}
	counts["pon_ports_scanned"] = scanned
	counts["pon_ports_with_onts"] = withONTs
	counts["onts"] = onts
	counts["left_to_other_olt"] = heldElsewhere

	if len(warns) > 0 {
		return finish("partial", "")
	}
	return finish("succeeded", "")
}

// ponPorts is the configured list (olts.pon_ports, entries "N" or "F/S/N", the last number is the PON) or every PON
// the CLI accepts. Ports a chassis lacks answer with a CLI error and are skipped.
func (s *Service) ponPorts(ctx context.Context, oltID int64) ([]int, error) {
	var cfg string
	if err := s.db.QueryRowContext(ctx, `SELECT pon_ports FROM olts WHERE device_id=?`, oltID).Scan(&cfg); err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg) == "" {
		all := make([]int, 0, MaxPON)
		for p := 1; p <= MaxPON; p++ {
			all = append(all, p)
		}
		return all, nil
	}
	var out []int
	for _, e := range strings.Split(cfg, ",") {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if i := strings.LastIndex(e, "/"); i >= 0 {
			e = e[i+1:]
		}
		p, err := strconv.Atoi(e)
		if err != nil {
			return nil, fmt.Errorf("bad PON port %q", e)
		}
		out = append(out, p)
	}
	return out, nil
}

// mayClaim reports whether the sync may record r on this OLT. A serial is unique across the whole inventory, so
// recording it here re-homes it from whichever OLT holds it. An ONT the HSGQ merely lists as registered-but-inactive
// (or offline) is not proof it moved, and the other OLT's own sync would take it straight back, so it is only claimed
// from another OLT when the HSGQ sees it online.
func mayClaim(owners map[string]int64, self int64, r ONTRow) bool {
	owner, held := owners[r.SN]
	return !held || owner == self || r.RunState == "online"
}

// owners returns, for the given rows, which OLT currently holds each serial that is already in the inventory.
func owners(ctx context.Context, tx *sql.Tx, rows []ONTRow) (map[string]int64, error) {
	out := map[string]int64{}
	if len(rows) == 0 {
		return out, nil
	}
	args := make([]any, len(rows))
	for i, r := range rows {
		args[i] = r.SN
	}
	res, err := tx.QueryContext(ctx, `SELECT serial_number, olt_id FROM ont_inventory WHERE serial_number IN (?`+strings.Repeat(",?", len(rows)-1)+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	for res.Next() {
		var sn string
		var id int64
		if err := res.Scan(&sn, &id); err != nil {
			return nil, err
		}
		out[sn] = id
	}
	return out, res.Err()
}

// replacePort makes one PON's inventory rows match what the OLT just listed: ONTs it no longer lists are removed
// first (so a replaced ONT's old serial cannot hold its position), then the listed ones are upserted. It returns how
// many listed ONTs were left to the OLT that holds them (see mayClaim).
func (s *Service) replacePort(ctx context.Context, oltID int64, pon int, rows []ONTRow) (skipped int, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	held, err := owners(ctx, tx, rows)
	if err != nil {
		return 0, err
	}

	q := `DELETE FROM ont_inventory WHERE olt_id=? AND frame=0 AND slot=0 AND pon_port=?`
	args := []any{oltID, pon}
	if len(rows) > 0 {
		q += ` AND serial_number NOT IN (?` + strings.Repeat(",?", len(rows)-1) + `)`
		for _, r := range rows {
			args = append(args, r.SN)
		}
	}
	if _, err := tx.ExecContext(ctx, q, args...); err != nil {
		return 0, err
	}
	for _, r := range rows {
		if !mayClaim(held, oltID, r) {
			skipped++
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO ont_inventory (serial_number, olt_id, frame, slot, pon_port, ont_id, description, run_state, config_state, match_state, last_seen_at)
			VALUES (?,?,0,0,?,?,?,?,?,?, CASE WHEN ?='online' THEN NOW() END)
			ON DUPLICATE KEY UPDATE olt_id=VALUES(olt_id), frame=0, slot=0, pon_port=VALUES(pon_port), ont_id=VALUES(ont_id),
			  description=IF(description='', VALUES(description), description),
			  run_state=VALUES(run_state), config_state=VALUES(config_state), match_state=VALUES(match_state),
			  last_seen_at=CASE WHEN VALUES(run_state)='online' THEN NOW() ELSE ont_inventory.last_seen_at END`,
			r.SN, oltID, r.PON, r.ONU, r.Name, r.RunState, r.ConfigState, r.MatchState, r.RunState); err != nil {
			return 0, err
		}
	}
	return skipped, tx.Commit()
}

func (s *Service) runByID(ctx context.Context, id int64) (*olt.SyncRun, error) {
	r := &olt.SyncRun{}
	var counts []byte
	err := s.db.QueryRowContext(ctx, `SELECT id, olt_id, started_at, finished_at, status, triggered_by, counts, error FROM olt_sync_runs WHERE id=?`, id).
		Scan(&r.ID, &r.OLTID, &r.StartedAt, &r.FinishedAt, &r.Status, &r.Trigger, &counts, &r.Error)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(counts, &r.Counts)
	return r, nil
}
