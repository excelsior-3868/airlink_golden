package olt

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// Apply runs the planned and approved job against the real OLT.
func (s *Service) Apply(ctx context.Context, id int64, actor string) (*Job, error) {
	j, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if j.Status != "planned" && j.Status != "approved" {
		return nil, fmt.Errorf("%w: job is %s", ErrState, j.Status)
	}
	if j.Operation == "change_vlan" && j.Status != "approved" {
		return nil, fmt.Errorf("%w: change_vlan needs approval first", ErrState)
	}


	var req PlanRequest
	if err := json.Unmarshal(j.Params, &req); err != nil {
		return nil, fmt.Errorf("corrupt job params: %w", err)
	}

	locks := []string{fmt.Sprintf("olt:%d", j.OLTID), "ont:" + strings.ToUpper(req.Serial)}
	if err := s.lock(locks...); err != nil {
		return nil, err
	}
	defer s.unlock(locks...)

	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	var got int
	lockName := fmt.Sprintf("nms_olt_lock_%d", j.OLTID)
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 0)", lockName).Scan(&got); err != nil {
		return nil, err
	}
	if got != 1 {
		return nil, ErrBusy
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK(?)", lockName)

	res, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET status='running', started_at=NOW()
		WHERE id=? AND status IN ('planned','approved')`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrState
	}
	s.audit(ctx, actor, "job.apply", id, "")

	status, summary := s.run(ctx, j, req)
	if _, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET status=?, error_summary=?, completed_at=NOW() WHERE id=?`, status, summary, id); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, "job."+status, id, summary)
	return s.Get(ctx, id)
}

func (s *Service) setStep(ctx context.Context, jobID int64, seq int, result, output string) {
	if _, err := s.db.ExecContext(ctx, `UPDATE provisioning_job_steps SET result=?, output=?, executed_at=NOW() WHERE job_id=? AND seq=?`,
		result, output, jobID, seq); err != nil {
		slog.Error("update step", "job", jobID, "seq", seq, "err", err)
	}
}

func parseCmds(lines []string) ([]Cmd, error) {
	out := make([]Cmd, 0, len(lines))
	for _, l := range lines {
		c, err := Reparse(l)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func runCmds(ctx context.Context, ex Executor, cmds []Cmd) (string, error) {
	var last string
	for i, c := range cmds {
		out, err := ex.Run(ctx, c)
		last = out
		if err != nil {
			for _, rest := range cmds[i+1:] {
				if rest.String() == "quit" {
					ex.Run(context.Background(), rest)
				}
			}
			return out, err
		}
	}
	return last, nil
}

func (s *Service) run(ctx context.Context, j *Job, req PlanRequest) (status, summary string) {
	type prepared struct {
		Step
		cmds, rollback []Cmd
	}
	steps := make([]prepared, len(j.Steps))
	for i, st := range j.Steps {
		cmds, err := parseCmds(st.Commands)
		if err != nil {
			return "failed", "refused to execute: " + err.Error()
		}
		rb, err := parseCmds(st.Rollback)
		if err != nil {
			return "failed", "refused to execute rollback: " + err.Error()
		}
		steps[i] = prepared{st, cmds, rb}
	}

	ex, err := s.dialer.Dial(ctx, j.OLTID)
	if err != nil {
		return "failed", "connect to OLT: " + err.Error()
	}
	defer ex.Close()

	if err := s.checkVersion(ctx, ex, j.OLTID); err != nil {
		return "failed", err.Error()
	}

	var done []prepared
	fail := func(seq int, name string, cause error, partial *prepared) (string, string) {
		msg := fmt.Sprintf("step %d (%s): %v", seq, name, cause)
		if partial != nil {
			if s.writeApplied(ctx, ex, partial.Step, req) {
				done = append(done, *partial)
			}
		}
		if len(done) == 0 {
			return "failed", msg + " (no changes were made)"
		}
		ok := true
		for i := len(done) - 1; i >= 0; i-- {
			d := done[i]
			if len(d.rollback) == 0 {
				ok = false
				continue
			}
			out, err := runCmds(ctx, ex, d.rollback)
			rs := "rolled back: " + d.Name
			res := "ok"
			if err != nil {
				ok, res, rs = false, "failed", "rollback failed: "+d.Name+": "+err.Error()
			}
			s.setStep(ctx, j.ID, d.Seq, "rolled_back_"+res, out)
			slog.Warn(rs, "job", j.ID)
		}
		if ok {
			return "rolled_back", msg + "; all changes made by this job were undone"
		}
		return "failed_needs_review", msg + "; rollback incomplete - inspect the OLT before any retry"
	}

	for _, st := range steps {
		switch st.Kind {
		case "read", "verify":
			out, rerr := runCmds(ctx, ex, st.cmds)
			if rerr != nil && !isCLI(rerr) {
				s.setStep(ctx, j.ID, st.Seq, "failed", out)
				return fail(st.Seq, st.Name, rerr, nil)
			}
			eerr := Expect(st.Expect, out, rerr, j.BeforeState)
			for try := 0; eerr != nil && st.Kind == "verify" && try < 3; try++ {
				select {
				case <-ctx.Done():
					eerr = ctx.Err()
				case <-time.After(s.retryWait):
					out, rerr = runCmds(ctx, ex, st.cmds)
					if rerr != nil && !isCLI(rerr) {
						eerr = rerr
					} else {
						eerr = Expect(st.Expect, out, rerr, j.BeforeState)
					}
				}
			}
			if eerr != nil {
				s.setStep(ctx, j.ID, st.Seq, "failed", out)
				return fail(st.Seq, st.Name, eerr, nil)
			}
			s.setStep(ctx, j.ID, st.Seq, "ok", out)
		case "write":
			out, werr := runCmds(ctx, ex, st.cmds)
			if werr != nil {
				s.setStep(ctx, j.ID, st.Seq, "failed", out)
				st := st
				return fail(st.Seq, st.Name, werr, &st)
			}
			s.setStep(ctx, j.ID, st.Seq, "ok", out)
			done = append(done, st)
		}
	}

	if s.saveAfter {
		out, err := ex.Run(ctx, Save())
		if err != nil {
			return "succeeded", "applied and verified, but `save` failed: " + err.Error() + " (configuration is not persisted)"
		}
		s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET saved_at=NOW(), saved_by='automatic (OLT_SAVE_AFTER_APPLY)', save_output=? WHERE id=?`, out, j.ID)
	}
	s.syncInventory(ctx, j.OLTID, req)
	return "succeeded", ""
}

func (s *Service) writeApplied(ctx context.Context, ex Executor, st Step, req PlanRequest) bool {
	var (
		probe  Cmd
		expect string
		err    error
	)
	switch st.Name {
	case "ont_add":
		probe, err = DisplayONTBySN(req.Serial)
		expect = "ont_present"
	case "service_port_add", "service_port_remove_old":
		id := 0
		for _, l := range st.Commands {
			fmt.Sscanf(l, "service-port %d", &id)
			fmt.Sscanf(l, "undo service-port %d", &id)
		}
		probe, err = DisplayServicePort(id)
		expect = ""
		if st.Name == "service_port_remove_old" {
			expect = "absent"
		}
	default:
		return true
	}
	if err != nil {
		return true
	}
	out, perr := ex.Run(ctx, probe)
	if perr != nil && !isCLI(perr) {
		return true
	}
	return Expect(expect, out, perr, "") == nil
}

func (s *Service) checkVersion(ctx context.Context, ex Executor, oltID int64) error {
	var want string
	if err := s.db.QueryRowContext(ctx, `SELECT software_version FROM olts WHERE device_id=?`, oltID).Scan(&want); err != nil {
		return err
	}
	if want == "" {
		return nil
	}
	out, err := ex.Run(ctx, DisplayVersion())
	if err != nil {
		return fmt.Errorf("display version: %w", err)
	}
	if !strings.Contains(out, want) {
		return fmt.Errorf("OLT software version does not match the catalogue (%q expected): approved templates were validated for that release", want)
	}
	return nil
}

func (s *Service) syncInventory(ctx context.Context, oltID int64, req PlanRequest) {
	if req.Operation != "register_ont" {
		return
	}
	ex, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		slog.Warn("inventory sync: dial", "err", err)
		return
	}
	defer ex.Close()
	c, err := DisplayONTBySN(req.Serial)
	if err != nil {
		return
	}
	out, _ := ex.Run(ctx, c)
	d := ParseONTDetail(out)
	if !d.Found {
		return
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO ont_inventory (serial_number, olt_id, frame, slot, pon_port, ont_id, description, line_profile_id, srv_profile_id, run_state, config_state, match_state)
		SELECT ?,?,?,?,?,?,?, t.line_profile_id, t.srv_profile_id, ?,?,? FROM service_templates t WHERE t.id=?
		ON DUPLICATE KEY UPDATE olt_id=VALUES(olt_id), frame=VALUES(frame), slot=VALUES(slot),
		  pon_port=VALUES(pon_port), ont_id=VALUES(ont_id), description=VALUES(description),
		  line_profile_id=VALUES(line_profile_id), srv_profile_id=VALUES(srv_profile_id)`,
		req.Serial, oltID, d.F, d.S, d.P, d.OntID, req.Description,
		strings.ToLower(d.RunState), strings.ToLower(d.ConfigState), strings.ToLower(d.MatchState), req.TemplateID); err != nil {
		slog.Warn("inventory sync", "err", err)
	}
}
