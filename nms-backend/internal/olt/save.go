package olt

import (
	"context"
	"fmt"
)

// SaveConfig writes the OLT's running configuration to its saved configuration (the `save` command) for a job
// that has already been applied and verified.
func (s *Service) SaveConfig(ctx context.Context, id int64, actor string) (*Job, error) {
	j, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if j.Status != "succeeded" {
		return nil, fmt.Errorf("%w: only a job that was applied and verified can be saved (status is %q)", ErrState, j.Status)
	}
	if j.SavedAt != nil {
		return nil, fmt.Errorf("%w: this job's configuration was already saved", ErrState)
	}

	locks := []string{fmt.Sprintf("olt:%d", j.OLTID)}
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

	ex, err := s.dialer.Dial(ctx, j.OLTID)
	if err != nil {
		return nil, fmt.Errorf("connect to OLT: %w", err)
	}
	defer ex.Close()

	out, runErr := ex.Run(ctx, Save())
	if runErr != nil {
		s.audit(ctx, actor, "job.save_failed", id, runErr.Error())
		return nil, fmt.Errorf("save failed, the configuration is NOT persisted: %w", runErr)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE provisioning_jobs SET saved_at=NOW(), saved_by=?, save_output=? WHERE id=? AND saved_at IS NULL`, actor, out, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, fmt.Errorf("%w: this job's configuration was already saved", ErrState)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO provisioning_job_steps (job_id, seq, name, kind, command, rollback_command, expect, result, output, executed_at)
		SELECT ?, COALESCE(MAX(seq),0)+1, 'save_configuration', 'write', 'save', '', '', 'ok', ?, NOW() FROM provisioning_job_steps WHERE job_id=?`, id, out, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, "job.save", id, "")
	return s.Get(ctx, id)
}
