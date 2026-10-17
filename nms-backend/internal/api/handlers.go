package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)


func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := map[string]any{}
	one := func(key, sqlQuery string, args ...any) {
		rows, err := s.queryJSON(ctx, sqlQuery, args...)
		if err == nil && len(rows) > 0 {
			out[key] = rows[0]
		}
	}
	u := userFrom(r)
	if u.OriginalRole == "reseller" && u.ID > 0 {
		one("devices", `SELECT count(*) AS total,
			COALESCE(SUM(status='up'), 0) AS up,
			COALESCE(SUM(status='down'), 0) AS down,
			COALESCE(SUM(status='unknown'), 0) AS unknown
			FROM devices WHERE enabled=1 AND id IN (SELECT olt_id FROM olt_resellers WHERE reseller_id=?)`, u.ID)
		one("onts", `SELECT count(*) AS total,
			COALESCE(SUM(run_state='online'), 0) AS online,
			COALESCE(SUM(run_state<>'online'), 0) AS not_online
			FROM ont_inventory
			WHERE olt_id IN (SELECT olt_id FROM olt_resellers WHERE reseller_id=?) AND reseller_id=?`, u.ID, u.ID)
	} else {
		one("devices", `SELECT count(*) AS total,
			COALESCE(SUM(status='up'), 0) AS up,
			COALESCE(SUM(status='down'), 0) AS down,
			COALESCE(SUM(status='unknown'), 0) AS unknown FROM devices WHERE enabled=1`)
		one("onts", `SELECT count(*) AS total,
			COALESCE(SUM(run_state='online'), 0) AS online,
			COALESCE(SUM(run_state<>'online'), 0) AS not_online FROM ont_inventory`)
	}
	one("alerts", `SELECT
		COALESCE(SUM(state<>'resolved' AND suppressed_by IS NULL AND severity='P1'), 0) AS p1,
		COALESCE(SUM(state<>'resolved' AND suppressed_by IS NULL AND severity='P2'), 0) AS p2,
		COALESCE(SUM(state<>'resolved' AND suppressed_by IS NULL AND severity='P3'), 0) AS p3,
		COALESCE(SUM(state='open' AND suppressed_by IS NULL), 0) AS unacknowledged,
		COALESCE(SUM(state<>'resolved' AND suppressed_by IS NOT NULL), 0) AS suppressed FROM alerts`)
	one("mtta", `SELECT COALESCE(AVG(TIMESTAMPDIFF(SECOND, opened_at, acknowledged_at)), 0) AS seconds
		FROM alerts WHERE acknowledged_at IS NOT NULL AND opened_at > NOW() - INTERVAL 30 DAY`)
	if rows, err := s.queryJSON(ctx, `
		SELECT p.id, p.name, count(d.id) AS devices, COALESCE(SUM(d.status='down'), 0) AS down
		FROM pops p LEFT JOIN devices d ON d.pop_id=p.id AND d.enabled=1 GROUP BY p.id, p.name ORDER BY p.name`); err == nil {
		out["pops"] = rows
	}
	if rows, err := s.queryJSON(ctx, `
		SELECT i.id, d.name AS device, i.name, i.speed_bps, i.in_bps, i.out_bps, i.util_pct
		FROM interfaces i JOIN devices d ON d.id=i.device_id
		WHERE i.monitored=1 AND i.util_pct IS NOT NULL ORDER BY i.util_pct DESC LIMIT 8`); err == nil {
		out["top_interfaces"] = rows
	}
	writeJSON(w, 200, out)
}

// ---- pops ----

func (s *Server) listPops(w http.ResponseWriter, r *http.Request) {
	s.respondRows(w, r, `SELECT id, name, location FROM pops ORDER BY name`)
}

func (s *Server) createPop(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Location string }
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		fail(w, 400, "name is required")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `INSERT INTO pops(name, location) VALUES(?,?)`, in.Name, in.Location)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "pop.create", fmt.Sprint("pop:", id), in.Name)
	writeJSON(w, 201, map[string]any{"id": id})
}

// ---- devices ----

const deviceCols = `d.id, d.name, d.ip, d.role, d.vendor, d.pop_id, p.name AS pop, d.parent_id, d.poll_method, d.snmp_version,
	d.snmp_port, d.tcp_port, d.credential_ref, d.poller_id, d.enabled, d.status, d.status_since, d.last_polled_at,
	d.sys_descr, d.uptime_seconds, d.cpu_pct, d.mem_pct, d.vlan, d.gem_port, d.gem_port_untagged, d.default_tag_mode, d.line_profile_id, d.srv_profile_id, d.line_profile_id_untagged, d.srv_profile_id_untagged,
	res.reseller_ids`

func (s *Server) listDevices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sqlQuery := `SELECT ` + deviceCols + ` FROM devices d 
		LEFT JOIN pops p ON p.id=d.pop_id 
		LEFT JOIN (
			SELECT olt_id, GROUP_CONCAT(reseller_id ORDER BY reseller_id SEPARATOR ',') AS reseller_ids
			FROM olt_resellers
			GROUP BY olt_id
		) res ON res.olt_id = d.id
		WHERE 1=1`
	args := []any{}
	u := userFrom(r)
	if u.OriginalRole == "reseller" && u.ID > 0 {
		sqlQuery += ` AND d.id IN (SELECT olt_id FROM olt_resellers WHERE reseller_id=?)`
		args = append(args, u.ID)
	}
	for _, f := range []string{"status", "role"} {
		if v := q.Get(f); v != "" {
			args = append(args, v)
			sqlQuery += fmt.Sprintf(" AND d.%s=?", f)
		}
	}
	if v := q.Get("pop_id"); v != "" {
		args = append(args, v)
		sqlQuery += ` AND d.pop_id=?`
	}
	s.respondRows(w, r, sqlQuery+` ORDER BY d.name`, args...)
}

func (s *Server) getDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if !s.canAccessOLT(r.Context(), r, id) {
		fail(w, 403, "access denied to this device")
		return
	}
	rows, err := s.queryJSON(r.Context(), `SELECT `+deviceCols+` FROM devices d 
		LEFT JOIN pops p ON p.id=d.pop_id 
		LEFT JOIN (
			SELECT olt_id, GROUP_CONCAT(reseller_id ORDER BY reseller_id SEPARATOR ',') AS reseller_ids
			FROM olt_resellers
			GROUP BY olt_id
		) res ON res.olt_id = d.id
		WHERE d.id=?`, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if len(rows) == 0 {
		fail(w, 404, "not found")
		return
	}
	writeJSON(w, 200, rows[0])
}

type deviceIn struct {
	Name             string `json:"name"`
	IP               string `json:"ip"`
	Role             string `json:"role"`
	Vendor           string `json:"vendor"`
	PopID            *int64 `json:"pop_id"`
	ParentID         *int64 `json:"parent_id"`
	PollMethod       string `json:"poll_method"`
	SNMPVersion      string `json:"snmp_version"`
	SNMPPort         int    `json:"snmp_port"`
	TCPPort          int    `json:"tcp_port"`
	CredentialRef    string `json:"credential_ref"`
	PollerID         string `json:"poller_id"`
	Vlan             *int   `json:"vlan"`
	GemPort          *int   `json:"gem_port"`
	GemPortUntagged  *int   `json:"gem_port_untagged"`
	DefaultTagMode   string `json:"default_tag_mode"`
	LineProfileID    *int   `json:"line_profile_id"`
	SrvProfileID     *int   `json:"srv_profile_id"`
	LineProfileIDUntagged *int `json:"line_profile_id_untagged"`
	SrvProfileIDUntagged  *int `json:"srv_profile_id_untagged"`
}

func (s *Server) createDevice(w http.ResponseWriter, r *http.Request) {
	in := deviceIn{Role: "access", PollMethod: "snmp", SNMPVersion: "2c", SNMPPort: 161, TCPPort: 22, PollerID: "central", DefaultTagMode: "tagged"}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.IP) == "" {
		fail(w, 400, "name and ip are required")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `
		INSERT INTO devices (name, ip, role, vendor, pop_id, parent_id, poll_method, snmp_version, snmp_port, tcp_port, credential_ref, poller_id, sys_descr, vlan, gem_port, gem_port_untagged, default_tag_mode, line_profile_id, srv_profile_id, line_profile_id_untagged, srv_profile_id_untagged)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?,?,?)`,
		in.Name, in.IP, in.Role, in.Vendor, in.PopID, in.ParentID, in.PollMethod, in.SNMPVersion, in.SNMPPort, in.TCPPort, in.CredentialRef, in.PollerID, in.Vlan, in.GemPort, in.GemPortUntagged, in.DefaultTagMode, in.LineProfileID, in.SrvProfileID, in.LineProfileIDUntagged, in.SrvProfileIDUntagged)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "device.create", fmt.Sprint("device:", id), in.Name)
	writeJSON(w, 201, map[string]any{"id": id})
}

var deviceUpdatable = map[string]bool{"name": true, "ip": true, "role": true, "vendor": true, "pop_id": true, "parent_id": true,
	"poll_method": true, "snmp_version": true, "snmp_port": true, "tcp_port": true, "credential_ref": true, "poller_id": true, "enabled": true,
	"vlan": true, "gem_port": true, "gem_port_untagged": true, "default_tag_mode": true, "line_profile_id": true, "srv_profile_id": true, "line_profile_id_untagged": true, "srv_profile_id_untagged": true}

func (s *Server) updateDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in map[string]any
	if !decode(w, r, &in) {
		return
	}
	if pid, ok := in["parent_id"].(float64); ok && int64(pid) == id {
		fail(w, 400, "a device cannot be its own parent")
		return
	}
	set, args := []string{}, []any{}
	for k, v := range in {
		if !deviceUpdatable[k] {
			fail(w, 400, "field not updatable: "+k)
			return
		}
		args = append(args, v)
		set = append(set, fmt.Sprintf("%s=?", k))
	}
	if len(set) == 0 {
		fail(w, 400, "no fields")
		return
	}
	var exists int
	if err := s.db.QueryRowContext(r.Context(), `SELECT 1 FROM devices WHERE id=?`, id).Scan(&exists); err != nil {
		fail(w, 404, "not found")
		return
	}
	args = append(args, id)
	_, err := s.db.ExecContext(r.Context(), fmt.Sprintf(`UPDATE devices SET %s WHERE id=?`, strings.Join(set, ",")), args...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "device.update", fmt.Sprint("device:", id), "")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) deleteDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM devices WHERE id=?`, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 404, "not found")
		return
	}
	s.audit(r, "device.delete", fmt.Sprint("device:", id), "")
	w.WriteHeader(204)
}

func (s *Server) deviceInterfaces(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	s.respondRows(w, r, `SELECT id, if_index, name, alias, speed_bps, monitored, oper_status, in_bps, out_bps, util_pct, in_errors, out_errors, last_sample_at
		FROM interfaces WHERE device_id=? ORDER BY if_index`, id)
}

func (s *Server) updateInterface(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Monitored bool `json:"monitored"`
	}
	if !decode(w, r, &in) {
		return
	}
	res, err := s.db.ExecContext(r.Context(), `UPDATE interfaces SET monitored=? WHERE id=?`, in.Monitored, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

var metricNames = map[string]bool{"cpu_pct": true, "mem_pct": true, "in_bps": true, "out_bps": true}

func (s *Server) deviceMetrics(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	q := r.URL.Query()
	name := q.Get("name")
	if !metricNames[name] {
		fail(w, 400, "name must be one of cpu_pct, mem_pct, in_bps, out_bps")
		return
	}
	hours := 6
	if h, err := strconv.Atoi(q.Get("hours")); err == nil && h > 0 && h <= 24*30 {
		hours = h
	}
	args := []any{id, name, time.Now().Add(-time.Duration(hours) * time.Hour)}
	sqlQuery := `SELECT ts, value FROM metrics WHERE device_id=? AND name=? AND ts>=?`
	if iface := q.Get("interface_id"); iface != "" {
		args = append(args, iface)
		sqlQuery += ` AND interface_id=?`
	}
	s.respondRows(w, r, sqlQuery+` ORDER BY ts LIMIT 5000`, args...)
}

// ---- alerts ----

func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sqlQuery := `SELECT a.id, a.severity, a.title, a.detail, a.state, a.device_id, d.name AS device, a.suppressed_by,
		a.opened_at, a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.resolution_note
		FROM alerts a LEFT JOIN devices d ON d.id=a.device_id WHERE 1=1`
	args := []any{}
	switch q.Get("state") {
	case "", "active":
		sqlQuery += ` AND a.state<>'resolved'`
	case "resolved":
		sqlQuery += ` AND a.state='resolved'`
	case "all":
	default:
		fail(w, 400, "state must be active, resolved or all")
		return
	}
	if v := q.Get("severity"); v != "" {
		args = append(args, v)
		sqlQuery += ` AND a.severity=?`
	}
	if q.Get("suppressed") == "false" {
		sqlQuery += ` AND a.suppressed_by IS NULL`
	}
	s.respondRows(w, r, sqlQuery+` ORDER BY a.severity, a.opened_at DESC LIMIT 500`, args...)
}

func (s *Server) ackAlert(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	if err := s.engine.Ack(r.Context(), id, userFrom(r).Name); err != nil {
		fail(w, 409, "alert is not open (already acknowledged or resolved)")
		return
	}
	s.audit(r, "alert.ack", fmt.Sprint("alert:", id), "")
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) resolveAlert(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct{ Note string }
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Note) == "" {
		fail(w, 400, "a resolution note (cause / action taken) is required")
		return
	}
	if err := s.engine.ManualResolve(r.Context(), id, userFrom(r).Name, in.Note); err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "alert.resolve", fmt.Sprint("alert:", id), in.Note)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) alertNotifications(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	s.respondRows(w, r, `SELECT id, channel, recipient, status, error, sent_at FROM notifications WHERE alert_id=? ORDER BY sent_at`, id)
}

// ---- rules / contacts / escalation ----

func (s *Server) listRules(w http.ResponseWriter, r *http.Request) {
	s.respondRows(w, r, `SELECT id, name, metric, severity, op, threshold, for_samples, role_filter, enabled FROM alert_rules ORDER BY metric, severity`)
}

func (s *Server) updateRule(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Threshold  float64 `json:"threshold"`
		ForSamples int     `json:"for_samples"`
		Enabled    bool    `json:"enabled"`
		Severity   string  `json:"severity"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.ForSamples < 1 {
		fail(w, 400, "for_samples must be at least 1")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `UPDATE alert_rules SET threshold=?, for_samples=?, enabled=?, severity=? WHERE id=?`,
		in.Threshold, in.ForSamples, in.Enabled, in.Severity, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 404, "not found")
		return
	}
	s.engine.InvalidateRules()
	s.audit(r, "rule.update", fmt.Sprint("rule:", id), fmt.Sprintf("threshold=%v for=%d enabled=%v sev=%s", in.Threshold, in.ForSamples, in.Enabled, in.Severity))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) listContacts(w http.ResponseWriter, r *http.Request) {
	s.respondRows(w, r, `SELECT id, name, phone, email, (push_token<>'') AS has_push FROM contacts ORDER BY name`)
}

func (s *Server) createContact(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Phone, Email, PushToken string }
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		fail(w, 400, "name is required")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `INSERT INTO contacts(name, phone, email, push_token) VALUES(?,?,?,?)`,
		in.Name, in.Phone, in.Email, in.PushToken)
	if err != nil {
		s.dbError(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		s.dbError(w, err)
		return
	}
	s.audit(r, "contact.create", fmt.Sprint("contact:", id), in.Name)
	writeJSON(w, 201, map[string]any{"id": id})
}

func (s *Server) deleteContact(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM contacts WHERE id=?`, id)
	if err != nil {
		s.dbError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, 404, "not found")
		return
	}
	s.audit(r, "contact.delete", fmt.Sprint("contact:", id), "")
	w.WriteHeader(204)
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name FROM contact_groups ORDER BY id`)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	type groupMember struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	type groupItem struct {
		ID      int64         `json:"id"`
		Name    string        `json:"name"`
		Members []groupMember `json:"members"`
	}
	groups := []groupItem{}
	groupMap := map[int64]int{}
	for rows.Next() {
		var g groupItem
		if err := rows.Scan(&g.ID, &g.Name); err != nil {
			s.dbError(w, err)
			return
		}
		g.Members = []groupMember{}
		groupMap[g.ID] = len(groups)
		groups = append(groups, g)
	}

	mRows, err := s.db.QueryContext(r.Context(), `
		SELECT m.group_id, c.id, c.name
		FROM contact_group_members m JOIN contacts c ON c.id=m.contact_id
		ORDER BY c.name`)
	if err == nil {
		defer mRows.Close()
		for mRows.Next() {
			var gid, cid int64
			var cname string
			if mRows.Scan(&gid, &cid, &cname) == nil {
				if idx, ok := groupMap[gid]; ok {
					groups[idx].Members = append(groups[idx].Members, groupMember{ID: cid, Name: cname})
				}
			}
		}
	}
	writeJSON(w, 200, groups)
}

func (s *Server) addGroupMember(w http.ResponseWriter, r *http.Request) {
	gid, ok1 := idParam(w, r, "id")
	cid, ok2 := idParam(w, r, "contactId")
	if !ok1 || !ok2 {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT IGNORE INTO contact_group_members(group_id, contact_id) VALUES(?,?)`, gid, cid); err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) removeGroupMember(w http.ResponseWriter, r *http.Request) {
	gid, ok1 := idParam(w, r, "id")
	cid, ok2 := idParam(w, r, "contactId")
	if !ok1 || !ok2 {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM contact_group_members WHERE group_id=? AND contact_id=?`, gid, cid); err != nil {
		s.dbError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) listPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, severity FROM escalation_policies ORDER BY severity`)
	if err != nil {
		s.dbError(w, err)
		return
	}
	defer rows.Close()
	type policyStep struct {
		AfterMinutes int    `json:"after_minutes"`
		Channel      string `json:"channel"`
		Group        string `json:"group"`
	}
	type policyItem struct {
		ID       int64        `json:"id"`
		Name     string       `json:"name"`
		Severity string       `json:"severity"`
		Steps    []policyStep `json:"steps"`
	}
	policies := []policyItem{}
	polMap := map[int64]int{}
	for rows.Next() {
		var p policyItem
		if err := rows.Scan(&p.ID, &p.Name, &p.Severity); err != nil {
			s.dbError(w, err)
			return
		}
		p.Steps = []policyStep{}
		polMap[p.ID] = len(policies)
		policies = append(policies, p)
	}

	sRows, err := s.db.QueryContext(r.Context(), `
		SELECT s.policy_id, s.after_minutes, s.channel, g.name
		FROM escalation_steps s JOIN contact_groups g ON g.id=s.group_id
		ORDER BY s.after_minutes, s.channel`)
	if err == nil {
		defer sRows.Close()
		for sRows.Next() {
			var pid int64
			var st policyStep
			if sRows.Scan(&pid, &st.AfterMinutes, &st.Channel, &st.Group) == nil {
				if idx, ok := polMap[pid]; ok {
					policies[idx].Steps = append(policies[idx].Steps, st)
				}
			}
		}
	}
	writeJSON(w, 200, policies)
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	s.respondRows(w, r, `SELECT id, ts, actor, action, target, detail FROM audit_log ORDER BY id DESC LIMIT 300`)
}
