package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) startSync(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	run, err := s.olts.StartSync(r.Context(), id, userFrom(r).Name)
	if err != nil {
		s.jobError(w, err)
		return
	}
	s.audit(r, "olt.sync", "olt:"+chi.URLParam(r, "id"), "read-only")
	writeJSON(w, 202, run)
}

func (s *Server) syncRuns(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	s.respondRows(w, r, `SELECT id, started_at, finished_at, status, triggered_by, counts, error
		FROM olt_sync_runs WHERE olt_id=? ORDER BY id DESC LIMIT 20`, id)
}

// oltInventory returns one parsed table from the last sync (boards, vlans, service-ports, profiles).
func (s *Server) oltInventory(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	queries := map[string]string{
		"boards":        `SELECT slot, board_name, status FROM olt_boards WHERE olt_id=? ORDER BY slot`,
		"vlans":         `SELECT vlan_id, vlan_type, attribute, std_ports, serv_ports FROM olt_vlans WHERE olt_id=? ORDER BY vlan_id`,
		"service-ports": `SELECT sp_index, vlan, vlan AS vlan_id, attribute, frame, slot, port, ont_id, gem, flow_type, flow_para, state FROM olt_service_ports WHERE olt_id=? ORDER BY sp_index`,
		"profiles":      `SELECT profile_type, profile_id, profile_name, binding_times, detail, verified_at FROM olt_profiles WHERE olt_id=? ORDER BY profile_type, profile_id`,
	}
	q, ok := queries[chi.URLParam(r, "kind")]
	if !ok {
		fail(w, 404, "unknown inventory kind")
		return
	}
	s.respondRows(w, r, q, id)
}

// oltSnapshots returns the raw output of the last run of every read command, so a parsing
// difference on the real device can be diagnosed from the console.
func (s *Server) oltSnapshots(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	s.respondRows(w, r, `SELECT command, output, error, collected_at FROM olt_snapshots WHERE olt_id=? ORDER BY command`, id)
}
