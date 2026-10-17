package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nepalairlink/nms/internal/olt"
)

func (s *Server) listOLTs(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if u.OriginalRole == "reseller" && u.ID > 0 {
		s.respondRows(w, r, `
			SELECT o.device_id AS id, d.name, d.ip, d.status, o.software_version, o.ssh_port, o.pon_ports,
			       o.detected_version, o.detected_patch, o.last_sync_at,
			       o.protocol, o.login_user, (o.login_pass_enc IS NOT NULL AND o.login_pass_enc<>'') AS has_password,
			       (o.protocol='telnet' OR o.ssh_host_key<>'') AS host_key_pinned,
			       (SELECT count(*) FROM ont_inventory i WHERE i.olt_id=o.device_id AND i.reseller_id=?) AS onts,
			       (SELECT count(*) FROM ont_inventory i WHERE i.olt_id=o.device_id AND i.run_state='online' AND i.reseller_id=?) AS onts_online,
			       d.vlan, d.gem_port, d.gem_port_untagged, d.default_tag_mode, d.line_profile_id, d.srv_profile_id, d.line_profile_id_untagged, d.srv_profile_id_untagged
			FROM olts o
			JOIN devices d ON d.id=o.device_id
			JOIN olt_resellers rel ON rel.olt_id=o.device_id AND rel.reseller_id=?
			ORDER BY d.name`, u.ID, u.ID, u.ID)
		return
	}

	s.respondRows(w, r, `
		SELECT o.device_id AS id, d.name, d.ip, d.status, o.software_version, o.ssh_port, o.pon_ports,
		       o.detected_version, o.detected_patch, o.last_sync_at,
		       o.protocol, o.login_user, (o.login_pass_enc IS NOT NULL AND o.login_pass_enc<>'') AS has_password,
		       (o.protocol='telnet' OR o.ssh_host_key<>'') AS host_key_pinned,
		       (SELECT count(*) FROM ont_inventory i WHERE i.olt_id=o.device_id) AS onts,
		       (SELECT count(*) FROM ont_inventory i WHERE i.olt_id=o.device_id AND i.run_state='online') AS onts_online,
		       d.vlan, d.gem_port, d.gem_port_untagged, d.default_tag_mode, d.line_profile_id, d.srv_profile_id, d.line_profile_id_untagged, d.srv_profile_id_untagged,
		       (SELECT GROUP_CONCAT(reseller_id) FROM olt_resellers r WHERE r.olt_id=o.device_id) AS reseller_ids
		FROM olts o JOIN devices d ON d.id=o.device_id ORDER BY d.name`)
}

func (s *Server) getOLTResellers(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	s.respondRows(w, r, `
		SELECT u.id, u.username, u.name,
		       (EXISTS(SELECT 1 FROM olt_resellers r WHERE r.olt_id=? AND r.reseller_id=u.id)=1) AS assigned
		FROM users u
		WHERE u.role='reseller' AND u.status='active'
		ORDER BY u.name, u.username`, id)
}

func (s *Server) updateOLTResellers(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		ResellerIDs []int64 `json:"reseller_ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(r.Context(), `DELETE FROM olt_resellers WHERE olt_id=?`, id); err != nil {
		s.dbError(w, err)
		return
	}
	for _, rid := range in.ResellerIDs {
		if rid <= 0 {
			continue
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO olt_resellers (olt_id, reseller_id) VALUES (?,?)`, id, rid); err != nil {
			s.dbError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "olt.update_resellers", fmt.Sprint("olt:", id), fmt.Sprintf("resellers: %v", in.ResellerIDs))
	writeJSON(w, 200, map[string]any{"ok": true, "olt_id": id, "reseller_ids": in.ResellerIDs})
}

func (s *Server) updateONTReseller(w http.ResponseWriter, r *http.Request) {
	oltID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		fail(w, 400, "invalid olt id")
		return
	}
	ontID, err := strconv.ParseInt(chi.URLParam(r, "ontId"), 10, 64)
	if err != nil {
		fail(w, 400, "invalid ont id")
		return
	}
	var in struct {
		ResellerID *int64 `json:"reseller_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE ont_inventory SET reseller_id=? WHERE olt_id=? AND id=?`, in.ResellerID, oltID, ontID); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "ont.reassign_reseller", fmt.Sprintf("ont:%d", ontID), fmt.Sprintf("olt:%d reseller:%v", oltID, in.ResellerID))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func validPonPorts(list string) bool {
	for _, p := range strings.Split(list, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		if _, _, _, err := parseFSPStrict(p); err != nil {
			return false
		}
	}
	return true
}

// createOLT registers an OLT. Either device_id (an existing device with role 'olt') or name+ip
// (device and OLT are created together) is accepted, with the management protocol and login.
func (s *Server) createOLT(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeviceID        int64  `json:"device_id"`
		Name            string `json:"name"`
		IP              string `json:"ip"`
		Vendor          string `json:"vendor"`
		PopID           *int64 `json:"pop_id"`
		SoftwareVersion string `json:"software_version"`
		Protocol        string `json:"protocol"`
		Port            int    `json:"port"`
		SSHPort         int    `json:"ssh_port"`
		Username        string `json:"username"`
		Password        string `json:"password"`
		PonPorts        string `json:"pon_ports"`
		Vlan            *int   `json:"vlan"`
		GemPort         *int   `json:"gem_port"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Protocol == "" {
		in.Protocol = "ssh"
	}
	if in.Protocol != "ssh" && in.Protocol != "telnet" {
		fail(w, 400, "protocol must be ssh or telnet")
		return
	}
	if in.Port == 0 {
		in.Port = in.SSHPort
	}
	if in.Port == 0 {
		in.Port = map[string]int{"ssh": 22, "telnet": 23}[in.Protocol]
	}
	if !validPonPorts(in.PonPorts) {
		fail(w, 400, "pon_ports must be comma-separated F/S/P values, e.g. 0/4/0,0/4/1")
		return
	}
	var passEnc any
	if in.Password != "" {
		if s.box == nil {
			fail(w, 500, "secret storage is not configured")
			return
		}
		enc, err := s.box.Seal(in.Password)
		if err != nil {
			fail(w, 500, "could not encrypt password")
			return
		}
		passEnc = enc
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer tx.Rollback()
	devID := in.DeviceID
	if devID == 0 {
		if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.IP) == "" {
			fail(w, 400, "name and ip are required")
			return
		}
		// TCP port polling avoids needing an SNMP community for the new OLT.
		res, err := tx.ExecContext(r.Context(), `
			INSERT INTO devices (name, ip, role, vendor, pop_id, poll_method, tcp_port, credential_ref, sys_descr, vlan, gem_port)
			VALUES (?,?, 'olt', ?, ?, 'tcp', ?, 'default', '', ?, ?)`, in.Name, in.IP, in.Vendor, in.PopID, in.Port, in.Vlan, in.GemPort)
		if err != nil {
			s.dbError(w, err)
			return
		}
		if devID, err = res.LastInsertId(); err != nil {
			s.dbError(w, err)
			return
		}
	} else if in.Vlan != nil || in.GemPort != nil {
		_, _ = tx.ExecContext(r.Context(), `UPDATE devices SET vlan=COALESCE(?, vlan), gem_port=COALESCE(?, gem_port) WHERE id=?`, in.Vlan, in.GemPort, devID)
	}
	res, err := tx.ExecContext(r.Context(), `
		INSERT INTO olts (device_id, software_version, ssh_port, ssh_host_key, pon_ports, protocol, login_user, login_pass_enc)
		SELECT id, ?, ?, '', ?, ?, ?, ? FROM devices WHERE id=? AND role='olt'`,
		in.SoftwareVersion, in.Port, in.PonPorts, in.Protocol, in.Username, passEnc, devID)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 400, "device must exist and have role 'olt'")
		return
	}
	if err := tx.Commit(); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "olt.create", fmt.Sprint("olt:", devID), in.Protocol)
	writeJSON(w, 201, map[string]any{"id": devID})
}

// updateOLTLogin changes protocol, port and login. An empty password keeps the stored one.
func (s *Server) updateOLTLogin(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Protocol string `json:"protocol"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Protocol != "ssh" && in.Protocol != "telnet" {
		fail(w, 400, "protocol must be ssh or telnet")
		return
	}
	if in.Port <= 0 || in.Port > 65535 {
		fail(w, 400, "invalid port")
		return
	}
	var err error
	if in.Password != "" {
		if s.box == nil {
			fail(w, 500, "secret storage is not configured")
			return
		}
		enc, serr := s.box.Seal(in.Password)
		if serr != nil {
			fail(w, 500, "could not encrypt password")
			return
		}
		_, err = s.db.ExecContext(r.Context(), `UPDATE olts SET protocol=?, ssh_port=?, login_user=?, login_pass_enc=? WHERE device_id=?`,
			in.Protocol, in.Port, in.Username, enc, id)
	} else {
		_, err = s.db.ExecContext(r.Context(), `UPDATE olts SET protocol=?, ssh_port=?, login_user=? WHERE device_id=?`,
			in.Protocol, in.Port, in.Username, id)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.db.ExecContext(r.Context(), `UPDATE devices SET tcp_port=? WHERE id=?`, in.Port, id)
	s.audit(r, "olt.update_login", fmt.Sprint("olt:", id), in.Protocol)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// testOLT opens and closes a session so an admin can verify reachability and login.
func (s *Server) testOLT(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	ex, err := s.olts.Dialer().Dial(ctx, id)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	ex.Close()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func parseFSPStrict(s string) (int, int, int, error) {
	var f, sl, p int
	if n, err := fmt.Sscanf(s, "%d/%d/%d", &f, &sl, &p); err != nil || n != 3 {
		return 0, 0, 0, errors.New("bad F/S/P")
	}
	return f, sl, p, nil
}

func (s *Server) isTelnet(ctx context.Context, id int64) bool {
	var p string
	return s.db.QueryRowContext(ctx, `SELECT protocol FROM olts WHERE device_id=?`, id).Scan(&p) == nil && p == "telnet"
}

func (s *Server) oltAddr(ctx context.Context, id int64) (string, error) {
	var ip string
	var port int
	err := s.db.QueryRowContext(ctx, `SELECT d.ip, o.ssh_port FROM olts o JOIN devices d ON d.id=o.device_id WHERE o.device_id=?`, id).Scan(&ip, &port)
	return fmt.Sprintf("%s:%d", ip, port), err
}

func (s *Server) fetchHostKey(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if s.isTelnet(r.Context(), id) {
		fail(w, 400, "telnet OLTs have no SSH host key")
		return
	}
	addr, err := s.oltAddr(r.Context(), id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	k, err := olt.FetchHostKey(addr)
	if err != nil {
		fail(w, 502, "could not reach OLT SSH service")
		return
	}
	writeJSON(w, 200, map[string]any{"fingerprint": fingerprint(k), "key": olt.FormatHostKey(k)})
}

func (s *Server) trustHostKey(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct{ Key, Fingerprint string }
	if !decode(w, r, &in) {
		return
	}
	addr, err := s.oltAddr(r.Context(), id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	k, err := olt.FetchHostKey(addr)
	if err != nil {
		fail(w, 502, "could not reach OLT SSH service")
		return
	}
	if in.Fingerprint == "" || in.Fingerprint != fingerprint(k) {
		fail(w, 409, "fingerprint does not match the key the OLT presents now")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE olts SET ssh_host_key=? WHERE device_id=?`, olt.FormatHostKey(k), id); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "olt.trust_host_key", fmt.Sprint("olt:", id), in.Fingerprint)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) listONTs(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if !s.canAccessOLT(r.Context(), r, id) {
		fail(w, 403, "access denied to this OLT")
		return
	}
	u := userFrom(r)
	if u.OriginalRole == "reseller" && u.ID > 0 {
		s.respondRows(w, r, `
			SELECT id, serial_number, frame, slot, pon_port, ont_id, description, line_profile_id, srv_profile_id,
			       run_state, config_state, match_state, rx_power_dbm, last_seen_at, reseller_id
			FROM ont_inventory
			WHERE olt_id=? AND (reseller_id=? OR (reseller_id IS NULL AND EXISTS (SELECT 1 FROM pppoe_customers pc WHERE pc.onu_serial_number=ont_inventory.serial_number AND pc.reseller_id=?)))
			ORDER BY frame, slot, pon_port, ont_id`, id, u.ID, u.ID)
		return
	}
	s.respondRows(w, r, `
		SELECT oi.id, oi.serial_number, oi.frame, oi.slot, oi.pon_port, oi.ont_id, oi.description, oi.line_profile_id, oi.srv_profile_id,
		       oi.run_state, oi.config_state, oi.match_state, oi.rx_power_dbm, oi.last_seen_at, oi.reseller_id,
		       COALESCE(u.username, '') AS reseller_username, COALESCE(u.name, '') AS reseller_name
		FROM ont_inventory oi
		LEFT JOIN users u ON u.id = oi.reseller_id
		WHERE oi.olt_id=?
		ORDER BY oi.frame, oi.slot, oi.pon_port, oi.ont_id`, id)
}

func (s *Server) autofind(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if !s.canAccessOLT(r.Context(), r, id) {
		fail(w, 403, "access denied to this OLT")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	ex, err := s.olts.Dialer().Dial(ctx, id)
	if err != nil {
		fail(w, 502, "cannot connect to OLT: "+err.Error())
		return
	}
	defer ex.Close()
	out, err := ex.Run(ctx, olt.DisplayAutofind())
	var cli *olt.CLIError
	if err != nil && !errors.As(err, &cli) {
		fail(w, 502, "OLT command failed")
		return
	}
	res := olt.ParseAutofind(out)
	if res == nil {
		res = []olt.AutofindONT{}
	}
	writeJSON(w, 200, res)
}

func (s *Server) listProfiles(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if !s.canAccessOLT(r.Context(), r, id) {
		fail(w, 403, "access denied to this OLT")
		return
	}
	s.respondRows(w, r, `SELECT id, profile_type, profile_id, profile_name, verified_at FROM olt_profiles WHERE olt_id=? ORDER BY profile_type, profile_id`, id)
}

func (s *Server) createProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		ProfileType string `json:"profile_type"`
		ProfileID   int    `json:"profile_id"`
		ProfileName string `json:"profile_name"`
	}
	if !decode(w, r, &in) {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `
		INSERT INTO olt_profiles (olt_id, profile_type, profile_id, profile_name) VALUES (?,?,?,?)
		ON DUPLICATE KEY UPDATE profile_name=VALUES(profile_name), verified_at=NOW()`,
		id, in.ProfileType, in.ProfileID, in.ProfileName); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "olt.profile.verify", fmt.Sprint("olt:", id), fmt.Sprintf("%s %d", in.ProfileType, in.ProfileID))
	writeJSON(w, 201, map[string]any{"ok": true})
}

func (s *Server) listTemplates(w http.ResponseWriter, r *http.Request) {
	s.respondRows(w, r, `SELECT id, name, service_vlan, user_vlan, gem_index, tag_transform, line_profile_id, srv_profile_id, enabled FROM service_templates ORDER BY name`)
}

func (s *Server) createTemplate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name          string `json:"name"`
		ServiceVLAN   int    `json:"service_vlan"`
		UserVLAN      int    `json:"user_vlan"`
		GemIndex      int    `json:"gem_index"`
		TagTransform  string `json:"tag_transform"`
		LineProfileID int    `json:"line_profile_id"`
		SrvProfileID  int    `json:"srv_profile_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.TagTransform == "" {
		in.TagTransform = "translate"
	}
	if in.UserVLAN == 0 {
		in.UserVLAN = in.ServiceVLAN
	}
	switch {
	case strings.TrimSpace(in.Name) == "" || len(in.Name) > 64:
		fail(w, 400, "name is required (max 64 characters)")
		return
	case in.ServiceVLAN < 1 || in.ServiceVLAN > 4094 || in.UserVLAN < 1 || in.UserVLAN > 4094:
		fail(w, 400, "service_vlan and user_vlan must be between 1 and 4094")
		return
	case in.GemIndex < 0 || in.GemIndex > 1023:
		fail(w, 400, "gem_index must be between 0 and 1023")
		return
	case in.TagTransform != "translate" && in.TagTransform != "default" && in.TagTransform != "transparent":
		fail(w, 400, "tag_transform must be translate, default or transparent")
		return
	case in.LineProfileID < 0 || in.SrvProfileID < 0:
		fail(w, 400, "profile IDs must not be negative")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	res, err := s.db.ExecContext(r.Context(), `
		INSERT INTO service_templates (name, service_vlan, user_vlan, gem_index, tag_transform, line_profile_id, srv_profile_id)
		VALUES (?,?,?,?,?,?,?)`,
		in.Name, in.ServiceVLAN, in.UserVLAN, in.GemIndex, in.TagTransform, in.LineProfileID, in.SrvProfileID)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "template.create", fmt.Sprint("template:", id), in.Name)
	writeJSON(w, 201, map[string]any{"id": id})
}

// ---- provisioning jobs ----

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var jobs []olt.Job
	var err error
	if u.OriginalRole == "reseller" && u.ID > 0 {
		jobs, err = s.olts.List(r.Context(), 200, u.ID)
	} else {
		jobs, err = s.olts.List(r.Context(), 200)
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, 200, jobs)
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	j, err := s.olts.Get(r.Context(), id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if !s.canAccessOLT(r.Context(), r, j.OLTID) {
		fail(w, 403, "access denied to this job's OLT")
		return
	}
	writeJSON(w, 200, j)
}

func (s *Server) jobError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, olt.ErrConflict):
		fail(w, 422, err.Error())
	case errors.Is(err, olt.ErrBusy):
		fail(w, 423, err.Error())
	case errors.Is(err, olt.ErrState):
		fail(w, 409, err.Error())
	default:
		s.dbError(w, err)
	}
}

func (s *Server) planJob(w http.ResponseWriter, r *http.Request) {
	var req olt.PlanRequest
	if !decode(w, r, &req) {
		return
	}
	if !s.canAccessOLT(r.Context(), r, req.OLTID) {
		fail(w, 403, "access denied to this OLT")
		return
	}
	u := userFrom(r)
	if u.OriginalRole == "reseller" && u.ID > 0 {
		req.ResellerID = &u.ID
	}
	ctx, cancel := context.WithTimeout(r.Context(), 55*time.Second)
	defer cancel()
	j, err := s.olts.Plan(ctx, req, u.Name)
	if err != nil {
		if errors.Is(err, olt.ErrConflict) || errors.Is(err, olt.ErrBusy) || errors.Is(err, olt.ErrState) {
			s.jobError(w, err)
			return
		}
		slog.Error("plan job failed", "operation", req.Operation, "serial", req.Serial, "err", err)
		fail(w, 422, err.Error())
		return
	}
	writeJSON(w, 201, j)
}

func (s *Server) approveJob(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	j, err := s.olts.Get(r.Context(), id)
	if err != nil {
		s.jobError(w, err)
		return
	}
	if !s.canAccessOLT(r.Context(), r, j.OLTID) {
		fail(w, 403, "access denied to this job's OLT")
		return
	}
	if err := s.olts.Approve(r.Context(), id, userFrom(r).Name); err != nil {
		s.jobError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) saveJob(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	j, err := s.olts.Get(r.Context(), id)
	if err != nil {
		s.jobError(w, err)
		return
	}
	if !s.canAccessOLT(r.Context(), r, j.OLTID) {
		fail(w, 403, "access denied to this job's OLT")
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Minute)
	defer cancel()
	j, err = s.olts.SaveConfig(ctx, id, userFrom(r).Name)
	if err != nil {
		if errors.Is(err, olt.ErrConflict) || errors.Is(err, olt.ErrBusy) || errors.Is(err, olt.ErrState) {
			s.jobError(w, err)
			return
		}
		fail(w, 422, err.Error())
		return
	}
	writeJSON(w, 200, j)
}

func (s *Server) rejectJob(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	j, err := s.olts.Get(r.Context(), id)
	if err != nil {
		s.jobError(w, err)
		return
	}
	if !s.canAccessOLT(r.Context(), r, j.OLTID) {
		fail(w, 403, "access denied to this job's OLT")
		return
	}
	if err := s.olts.Reject(r.Context(), id, userFrom(r).Name); err != nil {
		s.jobError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) applyJob(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	j, err := s.olts.Get(r.Context(), id)
	if err != nil {
		s.jobError(w, err)
		return
	}
	if !s.canAccessOLT(r.Context(), r, j.OLTID) {
		fail(w, 403, "access denied to this job's OLT")
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
	defer cancel()
	j, err = s.olts.Apply(ctx, id, userFrom(r).Name)
	if err != nil {
		s.jobError(w, err)
		return
	}
	writeJSON(w, 200, j)
}
