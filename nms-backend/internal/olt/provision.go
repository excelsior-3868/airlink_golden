package olt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"database/sql"
)

var (
	ErrConflict = errors.New("conflict")
	ErrBusy     = errors.New("OLT or ONT is busy with another job")
	ErrState    = errors.New("job is not in a state that allows this action")
)

// Dialer opens an authenticated, host-key-verified session to an OLT.
type Dialer interface {
	Dial(ctx context.Context, oltID int64) (Executor, error)
}

type Service struct {
	db        *sql.DB
	dialer    Dialer
	roDialer  Dialer // optional: read-only sessions used by Sync
	saveAfter bool
	retryWait time.Duration

	mu     sync.Mutex
	locked map[string]bool // in-process per-OLT / per-ONT locks
}

func NewService(db *sql.DB, d Dialer, saveAfter bool) *Service {
	return &Service{db: db, dialer: d, saveAfter: saveAfter, retryWait: 2 * time.Second, locked: map[string]bool{}}
}

type PlanRequest struct {
	OLTID          int64  `json:"olt_id"`
	ResellerID     *int64 `json:"reseller_id,omitempty"`
	Operation      string `json:"operation"` // register_ont | add_service_port | change_vlan
	Serial         string `json:"serial"`
	Frame          int    `json:"frame"`
	Slot           int    `json:"slot"`
	Port           int    `json:"port"`
	OntID          *int   `json:"ont_id,omitempty"` // register_ont: optional, otherwise the lowest free ID is used
	TemplateID     int64  `json:"template_id"`
	Description    string `json:"description"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`

	// add_service_port without a saved template: the service is given inline (tagged, tag-transform translate,
	// customer VLAN = service VLAN). LineProfileID is only used when the OLT does not report the ONT's profile.
	ServiceVLAN   int    `json:"service_vlan,omitempty"`
	Gem           int    `json:"gem,omitempty"`
	LineProfileID int    `json:"line_profile_id,omitempty"`
	SrvProfileID  int    `json:"srv_profile_id,omitempty"` // register_ont with an inline service
	Untagged      bool   `json:"untagged,omitempty"`       // Case 2: user-vlan untagged, tag-transform default
	UplinkPort    string `json:"uplink_port,omitempty"`    // optional F/S/P the VLAN must be carried on
	// register_ont: register an ONT the OLT has not detected with autofind yet (for example a CPE that is not connected).
	AllowUndetected bool `json:"allow_undetected,omitempty"`
	// add_service_port, untagged: remove the ONT's existing untagged service-port on the same GEM first (two
	// untagged services on one GEM cannot coexist). Opt-in; the removal is rolled back by re-adding it.
	ReplaceUntagged bool `json:"replace_untagged,omitempty"`

	// change_vlan: the service being replaced, as recorded in the customer record.
	OldServicePortID int    `json:"old_service_port_id,omitempty"`
	OldVLAN          int    `json:"old_vlan,omitempty"`
	OldUserVLAN      int    `json:"old_user_vlan,omitempty"`
	OldGem           int    `json:"old_gem,omitempty"`
	OldTransform     string `json:"old_transform,omitempty"`
}

type Step struct {
	Seq      int      `json:"seq"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"` // read | write | verify | rollback
	Commands []string `json:"commands"`
	Rollback []string `json:"rollback_commands"`
	Expect   string   `json:"expect"`
	Result   string   `json:"result"`
	Output   string   `json:"output"`

	// Evidence gathered while planning (read steps only): the OLT's answer and whether the expectation held.
	PlanResult string `json:"plan_result"`
	PlanOutput string `json:"plan_output"`
}

type Job struct {
	ID             int64           `json:"id"`
	OLTID          int64           `json:"olt_id"`
	ResellerID     *int64          `json:"reseller_id,omitempty"`
	Operation      string          `json:"operation"`
	IdempotencyKey string          `json:"idempotency_key"`
	Params         json.RawMessage `json:"params"`
	Status         string          `json:"status"`
	RequestedBy    string          `json:"requested_by"`
	ApprovedBy     *string         `json:"approved_by"`
	BeforeState    string          `json:"before_state"`
	ErrorSummary   string          `json:"error_summary"`
	CreatedAt      time.Time       `json:"created_at"`
	StartedAt      *time.Time      `json:"started_at"`
	CompletedAt    *time.Time      `json:"completed_at"`
	SavedAt        *time.Time      `json:"saved_at"` // when the change was written to the OLT's saved configuration
	SavedBy        *string         `json:"saved_by"`
	Steps          []Step          `json:"steps,omitempty"`
}

type template struct {
	ID            int64
	Name          string
	ServiceVLAN   int
	UserVLAN      int
	Gem           int
	Transform     string
	LineProfileID int
	SrvProfileID  int
	Untagged      bool
}

// Dialer exposes the session factory for read-only endpoints such as autofind.
func (s *Service) Dialer() Dialer { return s.dialer }

func idemKey(r PlanRequest) string {
	if r.IdempotencyKey != "" {
		return "client:" + r.IdempotencyKey
	}
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s|%d/%d/%d|%d|%d|%d|%d|%t|%s|%d|%d|%t|%t", r.Operation, r.OLTID, strings.ToUpper(r.Serial), r.Frame, r.Slot, r.Port, r.TemplateID, r.OldServicePortID, r.ServiceVLAN, r.Gem, r.Untagged, r.UplinkPort, r.LineProfileID, r.SrvProfileID, r.AllowUndetected, r.ReplaceUntagged)))
	return "auto:" + hex.EncodeToString(h[:12])
}

// inlineService reports whether an add_service_port request carries its own service instead of a template.
func inlineService(r PlanRequest) bool {
	return (r.Operation == "add_service_port" || r.Operation == "register_ont" || r.Operation == "change_vlan") && r.TemplateID == 0 && r.ServiceVLAN != 0
}

func inlineTemplate(r PlanRequest) (*template, error) {
	if r.ServiceVLAN < 1 || r.ServiceVLAN > 4094 {
		return nil, errors.New("service VLAN must be between 1 and 4094")
	}
	if r.Gem < 0 || r.Gem > 1023 {
		return nil, errors.New("GEM port must be between 0 and 1023")
	}
	if r.LineProfileID < 0 || r.LineProfileID > 1023 {
		return nil, errors.New("line profile ID must be between 0 and 1023")
	}
	if r.SrvProfileID < 0 || r.SrvProfileID > 1023 {
		return nil, errors.New("service profile ID must be between 0 and 1023")
	}
	if r.Untagged {
		return &template{Name: "inline", ServiceVLAN: r.ServiceVLAN, Gem: r.Gem, Transform: "default", Untagged: true, LineProfileID: r.LineProfileID, SrvProfileID: r.SrvProfileID}, nil
	}
	return &template{Name: "inline", ServiceVLAN: r.ServiceVLAN, UserVLAN: r.ServiceVLAN, Gem: r.Gem, Transform: "translate", LineProfileID: r.LineProfileID, SrvProfileID: r.SrvProfileID}, nil
}

func (s *Service) lock(keys ...string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, k := range keys {
		if s.locked[k] {
			return ErrBusy
		}
	}
	for _, k := range keys {
		s.locked[k] = true
	}
	return nil
}

func (s *Service) unlock(keys ...string) {
	s.mu.Lock()
	for _, k := range keys {
		delete(s.locked, k)
	}
	s.mu.Unlock()
}

func (s *Service) loadTemplate(ctx context.Context, oltID, id int64) (*template, error) {
	t := &template{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id,name,service_vlan,user_vlan,gem_index,tag_transform,line_profile_id,srv_profile_id
		FROM service_templates WHERE id=? AND enabled=1`, id).
		Scan(&t.ID, &t.Name, &t.ServiceVLAN, &t.UserVLAN, &t.Gem, &t.Transform, &t.LineProfileID, &t.SrvProfileID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: service template not found or disabled", ErrConflict)
	}
	if err != nil {
		return nil, err
	}
	// Templates reference numeric profile IDs that differ per OLT: refuse unless this OLT's catalogue has them verified.
	for _, p := range []struct {
		typ string
		id  int
	}{{"line", t.LineProfileID}, {"srv", t.SrvProfileID}} {
		var ok bool
		if err := s.db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM olt_profiles WHERE olt_id=? AND profile_type=? AND profile_id=?)`,
			oltID, p.typ, p.id).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("%w: %s profile %d is not in this OLT's verified profile catalogue", ErrConflict, p.typ, p.id)
		}
	}
	return t, nil
}

// planner accumulates steps and runs the read-only discovery needed to build them.
type planner struct {
	ctx context.Context
	ex  Executor
	seq int
	st  []Step
}

func (p *planner) add(name, kind, expect string, cmds, rollback []Cmd) {
	p.seq++
	st := Step{Seq: p.seq, Name: name, Kind: kind, Expect: expect}
	for _, c := range cmds {
		st.Commands = append(st.Commands, c.String())
	}
	for _, c := range rollback {
		st.Rollback = append(st.Rollback, c.String())
	}
	p.st = append(p.st, st)
}

// addRead records a read-only check together with the OLT's answer and whether its expectation held, so the
// reviewer sees real evidence for every check before anything is applied. Apply re-runs the check regardless.
func (p *planner) addRead(name, expect string, c Cmd, out string, rerr error, before string) {
	p.add(name, "read", expect, []Cmd{c}, nil)
	st := &p.st[len(p.st)-1]
	st.PlanOutput = out
	if strings.TrimSpace(out) == "" && rerr == nil {
		st.PlanOutput = "(the OLT returned no output - for a service-port listing this means the ONT has no services yet)"
	}
	if rerr != nil {
		st.PlanOutput += "\n" + rerr.Error()
	}
	if len(st.PlanOutput) > 20000 {
		st.PlanOutput = st.PlanOutput[:20000] + "\n[truncated]"
	}
	if e := Expect(expect, out, rerr, before); e != nil {
		st.PlanResult = "failed: " + e.Error()
	} else {
		st.PlanResult = "ok"
	}
}

// discover runs a read command during planning. CLI failures are returned as output+err so the caller
// can apply an expectation; transport failures abort planning.
func (p *planner) discover(c Cmd) (string, error) {
	return p.ex.Run(p.ctx, c)
}

func isCLI(err error) bool {
	var c *CLIError
	return errors.As(err, &c)
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(planError{err})
	}
	return v
}

type planError struct{ err error }

func (s *Service) Plan(ctx context.Context, req PlanRequest, actor string) (job *Job, err error) {
	defer func() {
		if r := recover(); r != nil {
			if pe, ok := r.(planError); ok {
				job, err = nil, fmt.Errorf("%w: %v", ErrConflict, pe.err)
				return
			}
			panic(r)
		}
	}()

	if req.Operation != "register_ont" && req.Operation != "add_service_port" && req.Operation != "change_vlan" {
		return nil, fmt.Errorf("%w: unknown operation %q", ErrConflict, req.Operation)
	}
	req.Serial = strings.ToUpper(strings.TrimSpace(req.Serial))
	if err := ValidSN(req.Serial); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConflict, err)
	}
	key := idemKey(req)
	if existing, err := s.byKey(ctx, key); err != nil {
		return nil, err
	} else if existing != nil {
		switch existing.Status {
		case "failed", "rolled_back", "rejected":
			// A finished-and-unsuccessful job must not block a corrected retry: retire its key.
			if _, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET idempotency_key=CONCAT(idempotency_key,'#',id) WHERE id=?`, existing.ID); err != nil {
				return nil, err
			}
		case "planned":
			// A guided "run the checks" must show current evidence, not a stale earlier plan: an unapplied plan
			// for the same inline service is superseded. Anything else returns the existing job unchanged.
			if !inlineService(req) {
				return existing, nil
			}
			if err := s.Reject(ctx, existing.ID, actor); err != nil {
				return nil, err
			}
			if _, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET idempotency_key=CONCAT(idempotency_key,'#',id) WHERE id=?`, existing.ID); err != nil {
				return nil, err
			}
		default:
			return existing, nil
		}
	}

	var tpl *template
	if inlineService(req) {
		if tpl, err = inlineTemplate(req); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConflict, err)
		}
	} else if tpl, err = s.loadTemplate(ctx, req.OLTID, req.TemplateID); err != nil {
		return nil, err
	}
	if req.UplinkPort != "" {
		if _, _, _, err := splitFSP(req.UplinkPort); err != nil {
			return nil, fmt.Errorf("%w: uplink port: %v", ErrConflict, err)
		}
	}
	// Planning only reads, so it uses the read-only session that never enters configuration mode.
	planDialer := s.dialer
	if s.roDialer != nil {
		planDialer = s.roDialer
	}
	ex, err := planDialer.Dial(ctx, req.OLTID)
	if err != nil {
		return nil, fmt.Errorf("connect to OLT: %w", err)
	}
	defer ex.Close()

	p := &planner{ctx: ctx, ex: ex}
	var before string
	switch req.Operation {
	case "register_ont":
		before, err = s.planRegister(p, req, tpl)
	case "add_service_port":
		before, err = s.planAddServicePort(p, req, tpl)
	case "change_vlan":
		before, err = s.planChangeVLAN(p, req, tpl)
	}
	if err != nil {
		return nil, err
	}
	return s.persist(ctx, req, key, actor, before, p.st)
}

// freeServicePort chooses the service-port ID the way the field guide says (Workflow 0, step 3): the OLT's own
// next-free-index; if that is not usable, the whole table is read and an unused index is taken, checking for gaps
// rather than trusting the largest visible index.
func (s *Service) freeServicePort(p *planner) (spID int, cmd Cmd, out, expect, note string, err error) {
	cmd = DisplayNextFreeServicePort()
	var cerr error
	out, cerr = p.discover(cmd)
	if cerr != nil && !isCLI(cerr) {
		return 0, cmd, out, "", "", cerr
	}
	if cerr == nil {
		if spID, cerr = ParseNextFreeIndex(out); cerr == nil {
			return spID, cmd, out, fmt.Sprintf("next_free:%d", spID), "", nil
		}
	}
	cmd = DisplayServicePortAll()
	if out, err = p.discover(cmd); err != nil {
		if isCLI(err) {
			return 0, cmd, out, "", "", fmt.Errorf("%w: neither next-free-index nor the service-port table could be read: %v", ErrConflict, err)
		}
		return 0, cmd, out, "", "", err
	}
	rows := ParseServicePorts(out)
	if len(rows) == 0 {
		return 0, cmd, out, "", "", fmt.Errorf("%w: could not read the service-port table, so no free index can be chosen safely", ErrConflict)
	}
	if spID, err = LowestFreeServicePort(rows); err != nil {
		return 0, cmd, out, "", "", fmt.Errorf("%w: %v", ErrConflict, err)
	}
	note = fmt.Sprintf("`display service-port next-free-index` was not usable on this OLT, so the whole table (%d service-ports) was read and the lowest unused index %d was chosen.", len(rows), spID)
	return spID, cmd, out, fmt.Sprintf("sp_free:%d", spID), note, nil
}

// planRegister follows the field guide "New ONT - Create VLAN 100 Service-Port":
//
//	Part 1  Register the new SN ONT: find it with autofind, confirm both profiles exist, check the ONT-IDs on the
//	        PON port, register it with `ont add`, verify the registration.
//	Part 2  Find the registered ONT and the next free service-port ID.
//	Part 3  (tagged) or Part 4 (untagged): verify the ONT by position, check its existing services, the line-profile
//	        GEM mapping and the VLAN, create the service-port, verify the result.
//
// Everything that can be read before the ONT exists is read now and recorded with the OLT's real answer. The steps
// that need the ONT to exist (Part 2 and Part 3's reads) run in order during Apply, after the registration, and a
// failure there rolls the registration back. Registration alone does not create a customer service-port.
func (s *Service) planRegister(p *planner, r PlanRequest, t *template) (string, error) {
	if r.Description != "" && !descRe.MatchString(r.Description) {
		return "", fmt.Errorf("%w: invalid description (letters, digits, space, _ . - only)", ErrConflict)
	}
	mapVLAN := t.UserVLAN
	if t.Untagged {
		mapVLAN = t.ServiceVLAN
	}

	// The serial must not be registered yet. The OLT, not the local inventory, decides. This is read first so that an
	// ONT that is already registered gets that message, not "not detected" (autofind never lists a registered ONT).
	bySN := must(DisplayONTBySN(r.Serial))
	snOut, snErr := p.discover(bySN)
	if snErr != nil && !isCLI(snErr) {
		return "", snErr
	}
	if IsSyntaxError(snErr) {
		snErr, snOut = nil, "" // this release has no by-sn form; the port table below still shows a duplicate
	} else if e := Expect("ont_absent", snOut, snErr, ""); e != nil {
		return "", fmt.Errorf("%w: %v (do not re-register an existing ONT to change its package; use \"Already registered ONT\")", ErrConflict, e)
	}

	// Part 1, step 1 - find the new ONT using autofind: it must be listed on the PON port being registered on.
	afCmd := DisplayAutofind()
	afOut, afErr := p.discover(afCmd)
	if afErr != nil && !isCLI(afErr) {
		return "", afErr
	}
	for _, a := range ParseAutofind(afOut) {
		if strings.EqualFold(a.SN, r.Serial) && (a.F != r.Frame || a.S != r.Slot || a.P != r.Port) {
			return "", fmt.Errorf("%w: the OLT detected this ONT on %d/%d/%d, not on %d/%d/%d; register it on the port it is connected to", ErrConflict, a.F, a.S, a.P, r.Frame, r.Slot, r.Port)
		}
	}
	afExpect := fmt.Sprintf("autofind_at:%s:%d/%d/%d", r.Serial, r.Frame, r.Slot, r.Port)
	var afNote string
	if e := Expect(afExpect, afOut, afErr, ""); e != nil {
		if !r.AllowUndetected {
			return "", fmt.Errorf("%w: %v", ErrConflict, e)
		}
		afExpect = "autofind_optional"
		afNote = "The OLT has not detected this ONT yet. It is registered anyway, because you chose to register an ONT that is not connected yet."
		if afErr != nil {
			afOut, afErr = afOut+"\n"+afErr.Error(), nil
		}
	}

	// Part 1, step 2 - both profiles must exist, and the line profile must map the VLAN to the GEM port.
	lpCmd := must(DisplayLineProfile(t.LineProfileID))
	lpOut, err := p.discover(lpCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: line profile %d does not exist on this OLT", ErrConflict, t.LineProfileID)
		}
		return "", err
	}
	mapping := ParseLineProfileMapping(lpOut)
	// An untagged service-port rides the GEM chosen on the service-port itself, not a VLAN-to-GEM line-profile
	// mapping, so the mapping is only a hard requirement for tagged services.
	if !t.Untagged && !gemMapsVLAN(mapping, t.Gem, mapVLAN) {
		return "", fmt.Errorf("%w: line profile %d does not map VLAN %d to GEM port %d (it maps: %s). Choose a profile or GEM port that carries the VLAN; this tool never edits a profile because other ONTs share it",
			ErrConflict, t.LineProfileID, mapVLAN, t.Gem, describeMapping(mapping))
	}
	lpEvidence := fmt.Sprintf("Line profile checked: %d.\n", t.LineProfileID)
	if name, bound, ok := s.profileBinding(p.ctx, r.OLTID, t.LineProfileID); ok {
		lpEvidence += fmt.Sprintf("Profile %q is bound to %d ONTs, so it is only read here, never changed.\n", name, bound)
	}
	lpEvidence += "\n" + lpOut
	srvCmd := must(DisplaySrvProfile(t.SrvProfileID))
	srvOut, err := p.discover(srvCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: service profile %d does not exist on this OLT", ErrConflict, t.SrvProfileID)
		}
		return "", err
	}

	// Part 1, step 3 - check the ONT-IDs on the PON port and take an unused one.
	portCmd := must(DisplayONTPort(r.Frame, r.Slot, r.Port))
	tbl, err := p.discover(portCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: the PON port %d/%d/%d could not be read: %v", ErrConflict, r.Frame, r.Slot, r.Port, err)
		}
		return "", err
	}
	for _, row := range ParseONTTable(tbl) {
		if strings.EqualFold(row.SN, r.Serial) {
			return "", fmt.Errorf("%w: serial %s is already registered on %d/%d/%d as ONT-ID %d", ErrConflict, r.Serial, row.F, row.S, row.P, row.OntID)
		}
	}
	ontID := 0
	if r.OntID != nil {
		ontID = *r.OntID
		if e := Expect(fmt.Sprintf("ont_id_free:%d", ontID), tbl, nil, ""); e != nil {
			return "", fmt.Errorf("%w: %v", ErrConflict, e)
		}
	} else if ontID, err = FreeONTID(ParseONTTable(tbl)); err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}

	// Part 3, step 4 - the VLAN exists and reaches an uplink.
	vlanCmd := must(DisplayVLAN(t.ServiceVLAN))
	vlanOut, err := p.discover(vlanCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: service VLAN %d is not configured on the OLT", ErrConflict, t.ServiceVLAN)
		}
		return "", err
	}
	if e := Expect("vlan_has_uplink", vlanOut, nil, ""); e != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, e)
	}

	// Part 2, step 3 - the service-port ID comes from the OLT.
	spID, freeCmd, freeOut, freeExpect, freeNote, err := s.freeServicePort(p)
	if err != nil {
		return "", err
	}

	add := must(OntAdd(r.Port, ontID, r.Serial, t.LineProfileID, t.SrvProfileID, r.Description))
	del := must(OntDelete(r.Port, ontID))
	sp := ServicePort{ID: spID, VLAN: t.ServiceVLAN, F: r.Frame, S: r.Slot, P: r.Port, OntID: ontID, Gem: t.Gem, UserVLAN: t.UserVLAN, Untagged: t.Untagged, Transform: t.Transform}
	spAdd, err := ServicePortAdd(sp)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}
	showOnt := must(DisplayServicePortOnt(r.Frame, r.Slot, r.Port, ontID))
	posCmd := must(DisplayONTInfo(r.Frame, r.Slot, r.Port, ontID))
	existsExpect := fmt.Sprintf("no_vlan:%d", t.ServiceVLAN)
	if t.Untagged {
		existsExpect = fmt.Sprintf("no_untagged_gem:%d", t.Gem)
	}

	// Checks that can be read now, with the OLT's real answer.
	p.addRead("check_autofind", afExpect, afCmd, afOut, afErr, "")
	if afNote != "" {
		p.note("check_autofind", afNote)
	}
	lpExpect := fmt.Sprintf("gem_maps:%d:%d", t.Gem, mapVLAN)
	if t.Untagged {
		lpExpect = "" // informational only for untagged, see above
	}
	p.addRead("check_line_profile_gem_mapping", lpExpect, lpCmd, lpEvidence, nil, "")
	if t.Untagged {
		p.note("check_line_profile_gem_mapping", fmt.Sprintf("Untagged service: the profile's VLAN-to-GEM mapping is shown for reference and is not required to carry VLAN %d on GEM %d.", mapVLAN, t.Gem))
	}
	p.addRead("check_service_profile", "", srvCmd, srvOut, nil, "")
	p.addRead("check_ont_absent", "ont_absent", bySN, snOut, snErr, "")
	p.addRead("check_ont_id_free", fmt.Sprintf("ont_id_free:%d", ontID), portCmd, tbl, nil, "")
	p.note("check_ont_id_free", fmt.Sprintf("ONT-ID %d will be used on PON port %d/%d/%d.", ontID, r.Frame, r.Slot, r.Port))
	p.addRead("check_vlan", "vlan_has_uplink", vlanCmd, vlanOut, nil, "")
	if ups := UplinkPorts(vlanOut); len(ups) > 0 {
		p.note("check_vlan", "Uplink ports that carry this VLAN: "+strings.Join(ups, ", "))
	}
	p.addRead("check_service_port_free", freeExpect, freeCmd, freeOut, nil, "")
	if freeNote != "" {
		p.note("check_service_port_free", freeNote)
	}

	// Part 1, steps 4 and 5 - register, then verify the registration (position and both profiles).
	p.add("ont_add", "write", "", []Cmd{must(InterfaceGpon(r.Frame, r.Slot)), add, Quit()},
		[]Cmd{must(InterfaceGpon(r.Frame, r.Slot)), del, Quit()})
	p.add("verify_ont", "verify", fmt.Sprintf("ont_registered_at:%d/%d/%d:%d:%d", r.Frame, r.Slot, r.Port, t.LineProfileID, t.SrvProfileID), []Cmd{bySN}, nil)

	// Parts 2 and 3 - now that the ONT exists: check it by position, its (empty) service list, and that the
	// service-port ID is still free, then create the service-port and verify it.
	p.add("check_ont_by_position", "read", "ont_at:"+r.Serial, []Cmd{posCmd}, nil)
	p.add("check_existing_services", "read", existsExpect, []Cmd{showOnt}, nil)
	p.add("recheck_service_port_free", "read", freeExpect, []Cmd{freeCmd}, nil)
	p.add("service_port_add", "write", "", []Cmd{spAdd}, []Cmd{must(ServicePortUndo(spID))})
	p.add("verify_service_port", "verify", fmt.Sprintf("contains:%d", t.ServiceVLAN), []Cmd{must(DisplayServicePort(spID))}, nil)
	p.add("verify_new_service_listed", "verify", fmt.Sprintf("sp_listed:%d:%d", spID, t.ServiceVLAN), []Cmd{showOnt}, nil)
	return fmt.Sprintf("(new ONT) serial %s will be registered at %d/%d/%d id %d; service-port %d", r.Serial, r.Frame, r.Slot, r.Port, ontID, spID), nil
}

// locateONT reads the ONT's live position from the OLT; the OLT, not our inventory, is the source of truth.
func (s *Service) locateONT(p *planner, serial string) (ONTDetail, Cmd, error) {
	bySN := must(DisplayONTBySN(serial))
	out, err := p.discover(bySN)
	if err != nil && !isCLI(err) {
		return ONTDetail{}, bySN, err
	}
	if e := Expect("ont_present", out, err, ""); e != nil {
		return ONTDetail{}, bySN, fmt.Errorf("%w: %v", ErrConflict, e)
	}
	return ParseONTDetail(out), bySN, nil
}

// lineProfileFor resolves the ONT's line profile to a numeric ID. The OLT may print an ID or a name; a name is
// looked up in this OLT's synced catalogue. If neither is available the template's profile is used, and the
// plan shows which profile was checked so the reviewer can see it.
func (s *Service) lineProfileFor(ctx context.Context, oltID int64, raw string, fallback int) (int, error) {
	raw = strings.TrimSpace(raw)
	if id, err := strconv.Atoi(raw); err == nil {
		return id, nil
	}
	if raw != "" {
		var id int
		err := s.db.QueryRowContext(ctx, `SELECT profile_id FROM olt_profiles WHERE olt_id=? AND profile_type='line' AND profile_name=?`, oltID, raw).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}
	}
	return fallback, nil
}

func describeMapping(m map[int][]int) string {
	if len(m) == 0 {
		return "nothing"
	}
	gems := make([]int, 0, len(m))
	for g := range m {
		gems = append(gems, g)
	}
	sort.Ints(gems)
	parts := make([]string, 0, len(gems))
	for _, g := range gems {
		parts = append(parts, fmt.Sprintf("GEM %d -> %v", g, m[g]))
	}
	return strings.Join(parts, "; ")
}

// positionFromInventory is the fallback when the OLT release does not accept `display ont info by-sn`: the
// guide says to use the form the release supports, so the position recorded by the last sync is used and then
// confirmed live with `display ont info <F> <S> <P> <ONT-ID>`.
func (s *Service) positionFromInventory(ctx context.Context, oltID int64, serial string) (ONTDetail, error) {
	var d ONTDetail
	err := s.db.QueryRowContext(ctx, `SELECT frame, slot, pon_port, ont_id FROM ont_inventory WHERE olt_id=? AND serial_number=?`, oltID, serial).
		Scan(&d.F, &d.S, &d.P, &d.OntID)
	if errors.Is(err, sql.ErrNoRows) {
		return d, fmt.Errorf("%w: this OLT release does not accept `display ont info by-sn`, and serial %s is not in the synced inventory; run a sync and try again", ErrConflict, serial)
	}
	d.Found = err == nil
	return d, err
}

// profileBinding returns the profile's name and how many ONTs use it, from the last sync.
func (s *Service) profileBinding(ctx context.Context, oltID int64, id int) (name string, bound int, known bool) {
	var b *int
	err := s.db.QueryRowContext(ctx, `SELECT profile_name, binding_times FROM olt_profiles WHERE olt_id=? AND profile_type='line' AND profile_id=?`, oltID, id).Scan(&name, &b)
	if err != nil {
		return "", 0, false
	}
	if b == nil {
		return name, 0, false
	}
	return name, *b, true
}

func (p *planner) note(step, text string) {
	for i := range p.st {
		if p.st[i].Name == step {
			p.st[i].PlanOutput += "\n\n" + text
		}
	}
}

// planAddServicePort follows the field guide "Create VLAN 100 Service-Port for an Already-Registered ONT":
// Workflow 0 (find the ONT, check its services, choose the service-port ID) and then Case 1 (tagged) or
// Case 2 (untagged): verify the ONT, check existing services, the line-profile GEM mapping and the VLAN,
// create the service-port, and verify the result.
func (s *Service) planAddServicePort(p *planner, r PlanRequest, t *template) (string, error) {
	mapVLAN := t.UserVLAN // the VLAN the line profile must map to the GEM port
	if t.Untagged {
		mapVLAN = t.ServiceVLAN
	}
	if r.UplinkPort != "" {
		if _, _, _, err := splitFSP(r.UplinkPort); err != nil {
			return "", fmt.Errorf("%w: uplink port: %v", ErrConflict, err)
		}
	}

	// Workflow 0, step 1 - find the ONT by serial. The OLT, not our inventory, is the source of truth.
	bySN := must(DisplayONTBySN(r.Serial))
	snOut, snErr := p.discover(bySN)
	if snErr != nil && !isCLI(snErr) {
		return "", snErr
	}
	var d ONTDetail
	findCmd, findOut, findErr, bySNUnsupported := bySN, snOut, snErr, false
	if snErr != nil && IsSyntaxError(snErr) {
		bySNUnsupported = true
		var err error
		if d, err = s.positionFromInventory(p.ctx, r.OLTID, r.Serial); err != nil {
			return "", err
		}
		findCmd = must(DisplayONTInfo(d.F, d.S, d.P, d.OntID))
		var perr error
		if findOut, perr = p.discover(findCmd); perr != nil {
			if isCLI(perr) {
				return "", fmt.Errorf("%w: %v", ErrConflict, perr)
			}
			return "", perr
		}
		findErr = nil
		pd := ParseONTDetail(findOut)
		if pd.SN != "" && !strings.EqualFold(pd.SN, r.Serial) {
			return "", fmt.Errorf("%w: the ONT at %d/%d/%d id %d has serial %s, not %s; the synced inventory is out of date", ErrConflict, d.F, d.S, d.P, d.OntID, pd.SN, r.Serial)
		}
		d.LineProfile = pd.LineProfile
	} else {
		if e := Expect("ont_present", snOut, snErr, ""); e != nil {
			return "", fmt.Errorf("%w: %v", ErrConflict, e)
		}
		d = ParseONTDetail(snOut)
	}

	// Case, step 1 - verify the registered ONT by its position, as the guide does (`display ont info 0 4 8 74`).
	var posCmd Cmd
	var posOut string
	havePos := false
	if !bySNUnsupported {
		var posErr error
		posCmd = must(DisplayONTInfo(d.F, d.S, d.P, d.OntID))
		posOut, posErr = p.discover(posCmd)
		switch {
		case posErr == nil:
			if e := Expect("ont_at:"+r.Serial, posOut, nil, ""); e != nil {
				return "", fmt.Errorf("%w: %v", ErrConflict, e)
			}
			havePos = true
			if pd := ParseONTDetail(posOut); d.LineProfile == "" {
				d.LineProfile = pd.LineProfile
			}
		case IsSyntaxError(posErr):
			// This release does not take the by-position form; the by-sn answer above already gave the position.
		case isCLI(posErr):
			return "", fmt.Errorf("%w: the OLT does not show an ONT at %d/%d/%d id %d: %v", ErrConflict, d.F, d.S, d.P, d.OntID, posErr)
		default:
			return "", posErr
		}
	}

	// Workflow 0, step 2 / Case step 2 - existing services on that ONT; never create a conflicting classification.
	showOnt := must(DisplayServicePortOnt(d.F, d.S, d.P, d.OntID))
	before, showErr := p.discover(showOnt)
	if showErr != nil && !isCLI(showErr) {
		return "", showErr
	}
	existing := ParseServicePorts(before)
	var existsExpect string
	var replaced *ServicePortRow
	if t.Untagged {
		existsExpect = fmt.Sprintf("no_untagged_gem:%d", t.Gem)
		for _, ex := range existing {
			if ex.Gem == t.Gem && IsUntaggedFlow(ex) {
				if !r.ReplaceUntagged {
					return "", fmt.Errorf("%w: this ONT already has untagged service-port %d on GEM port %d; two untagged services cannot share a GEM, so tick \"Replace the existing untagged service-port\" to swap it, or use another GEM", ErrConflict, ex.Index, t.Gem)
				}
				if replaced != nil {
					return "", fmt.Errorf("%w: this ONT has more than one untagged service-port on GEM port %d (%d and %d); replace only handles a single one", ErrConflict, t.Gem, replaced.Index, ex.Index)
				}
				ex := ex
				replaced = &ex
			}
		}
		if replaced != nil {
			existsExpect = "" // the conflicting service-port is the one being replaced
		}
	} else {
		existsExpect = fmt.Sprintf("no_vlan:%d", t.ServiceVLAN)
		for _, ex := range existing {
			if ex.VLAN == t.ServiceVLAN {
				return "", fmt.Errorf("%w: this ONT already has service-port %d for VLAN %d (GEM %d); nothing to add", ErrConflict, ex.Index, ex.VLAN, ex.Gem)
			}
		}
	}

	// Case step 3 - the ONT's line profile must map the VLAN to the chosen GEM port, otherwise the service-port
	// comes up but carries no traffic. The profile is only read here, never edited, because other ONTs share it.
	source := "taken from the ONT's own information"
	raw := d.LineProfile
	if raw == "" {
		source = "the profile selected on the page (the OLT did not report this ONT's profile)"
	}
	lpID, err := s.lineProfileFor(p.ctx, r.OLTID, raw, t.LineProfileID)
	if err != nil {
		return "", err
	}
	lpCmd := must(DisplayLineProfile(lpID))
	lpOut, err := p.discover(lpCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: line profile %d could not be read from the OLT", ErrConflict, lpID)
		}
		return "", err
	}
	mapping := ParseLineProfileMapping(lpOut)
	// An untagged service-port rides the GEM chosen on the service-port itself, not a VLAN-to-GEM line-profile
	// mapping, so the mapping is only a hard requirement for tagged services.
	if !t.Untagged && !gemMapsVLAN(mapping, t.Gem, mapVLAN) {
		return "", fmt.Errorf("%w: line profile %d does not map VLAN %d to GEM port %d (it maps: %s). Use a GEM/VLAN that matches the profile, or add the mapping on the OLT first; this tool never edits a profile because other ONTs share it",
			ErrConflict, lpID, mapVLAN, t.Gem, describeMapping(mapping))
	}
	header := fmt.Sprintf("Profile checked: %d, %s.\n", lpID, source)
	if name, bound, ok := s.profileBinding(p.ctx, r.OLTID, lpID); ok {
		header += fmt.Sprintf("Profile %q is bound to %d ONTs, so it is only read here, never changed.\n", name, bound)
	}
	lpEvidence := header + "\n" + lpOut

	// Case step 4 - the VLAN exists, and (when an uplink is given) it is carried on that uplink.
	vlanCmd := must(DisplayVLAN(t.ServiceVLAN))
	vlanOut, err := p.discover(vlanCmd)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: service VLAN %d is not configured on the OLT", ErrConflict, t.ServiceVLAN)
		}
		return "", err
	}
	if e := Expect("vlan_has_uplink", vlanOut, nil, ""); e != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, e)
	}
	if r.UplinkPort != "" {
		if e := Expect("vlan_port:"+r.UplinkPort, vlanOut, nil, ""); e != nil {
			return "", fmt.Errorf("%w: %v (it is carried on: %s)", ErrConflict, e, strings.Join(UplinkPorts(vlanOut), ", "))
		}
	}

	// Workflow 0, step 3 - the service-port ID comes from the OLT (see freeServicePort).
	spID, freeCmd, freeOut, freeExpect, freeNote, err := s.freeServicePort(p)
	if err != nil {
		return "", err
	}

	if replaced != nil {
		// The old service-port is deleted first, so its number is free again and the new service reuses it.
		spID = replaced.Index
		freeExpect = ""
		freeNote = fmt.Sprintf("Service-port %d is deleted first and its number is reused for the new VLAN %d service.", replaced.Index, t.ServiceVLAN)
	}

	sp := ServicePort{ID: spID, VLAN: t.ServiceVLAN, F: d.F, S: d.S, P: d.P, OntID: d.OntID, Gem: t.Gem, UserVLAN: t.UserVLAN, Untagged: t.Untagged, Transform: t.Transform}
	spAdd, err := ServicePortAdd(sp)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}

	const findStep = "check_ont_present"
	p.addRead(findStep, "ont_present", findCmd, findOut, findErr, "")
	if bySNUnsupported {
		p.st[len(p.st)-1].Expect = "ont_at:" + r.Serial
		p.note(findStep, "`display ont info by-sn` is not accepted by this OLT release, so the position recorded by the last sync was used and confirmed with the by-position command above.")
	}
	if havePos {
		p.addRead("check_ont_by_position", "ont_at:"+r.Serial, posCmd, posOut, nil, "")
	} else if !bySNUnsupported {
		p.note(findStep, "This release does not accept the by-position form of `display ont info`, so that confirmation step is skipped.")
	}
	p.addRead("check_existing_services", existsExpect, showOnt, before, showErr, "")
	lpExpect := fmt.Sprintf("gem_maps:%d:%d", t.Gem, mapVLAN)
	if t.Untagged {
		lpExpect = "" // informational only for untagged, see above
	}
	p.addRead("check_line_profile_gem_mapping", lpExpect, lpCmd, lpEvidence, nil, "")
	if t.Untagged {
		p.note("check_line_profile_gem_mapping", fmt.Sprintf("Untagged service: the profile's VLAN-to-GEM mapping is shown for reference and is not required to carry VLAN %d on GEM %d.", mapVLAN, t.Gem))
	}
	p.addRead("check_vlan", "vlan_has_uplink", vlanCmd, vlanOut, nil, "")
	if ups := UplinkPorts(vlanOut); len(ups) > 0 {
		p.note("check_vlan", "Uplink ports that carry this VLAN: "+strings.Join(ups, ", "))
	}
	if r.UplinkPort != "" {
		p.addRead("check_vlan_uplink", "vlan_port:"+r.UplinkPort, vlanCmd, vlanOut, nil, "")
	}
	p.addRead("check_service_port_free", freeExpect, freeCmd, freeOut, nil, "")
	if freeNote != "" {
		p.note("check_service_port_free", freeNote)
	}
	preservedSkip := ""
	if replaced != nil {
		// The old untagged service-port goes first; if the add then fails the executor re-adds it exactly as it was.
		oldAdd, err := ServicePortAdd(ServicePort{ID: replaced.Index, VLAN: replaced.VLAN, F: d.F, S: d.S, P: d.P, OntID: d.OntID, Gem: replaced.Gem, Untagged: true, Transform: "default"})
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrConflict, err)
		}
		p.note("check_existing_services", fmt.Sprintf("Untagged service-port %d (VLAN %d, GEM %d) will be removed and replaced by the new service; it is re-added automatically if the new one fails.", replaced.Index, replaced.VLAN, replaced.Gem))
		p.add("service_port_remove_old", "write", "", []Cmd{must(ServicePortUndo(replaced.Index))}, []Cmd{oldAdd})
		preservedSkip = fmt.Sprint(replaced.Index)
	}
	p.add("service_port_add", "write", "", []Cmd{spAdd}, []Cmd{must(ServicePortUndo(spID))})
	p.add("verify_service_port", "verify", fmt.Sprintf("contains:%d", t.ServiceVLAN), []Cmd{must(DisplayServicePort(spID))}, nil)
	p.add("verify_existing_services_preserved", "verify", "preserved:"+preservedSkip, []Cmd{showOnt}, nil)
	p.add("verify_new_service_listed", "verify", fmt.Sprintf("sp_listed:%d:%d", spID, t.ServiceVLAN), []Cmd{showOnt}, nil)
	return before, nil
}

// planChangeVLAN is make-before-break: the new service-port is created and verified first, then the
// old one is removed with a rollback that recreates it exactly. Requires four-eyes approval.
func (s *Service) planChangeVLAN(p *planner, r PlanRequest, t *template) (string, error) {
	if r.OldServicePortID <= 0 || r.OldVLAN <= 0 {
		return "", fmt.Errorf("%w: old_service_port_id and old_vlan are required (from the customer record)", ErrConflict)
	}
	d, bySN, err := s.locateONT(p, r.Serial)
	if err != nil {
		return "", err
	}
	showOld := must(DisplayServicePort(r.OldServicePortID))
	oldOut, err := p.discover(showOld)
	if err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: old service-port %d does not exist", ErrConflict, r.OldServicePortID)
		}
		return "", err
	}
	if !strings.Contains(oldOut, fmt.Sprint(r.OldVLAN)) {
		return "", fmt.Errorf("%w: service-port %d does not carry VLAN %d; refusing to touch it", ErrConflict, r.OldServicePortID, r.OldVLAN)
	}
	showOnt := must(DisplayServicePortOnt(d.F, d.S, d.P, d.OntID))
	before, err := p.discover(showOnt)
	if err != nil && !isCLI(err) {
		return "", err
	}
	vlanCmd := must(DisplayVLAN(t.ServiceVLAN))
	if _, err := p.discover(vlanCmd); err != nil {
		if isCLI(err) {
			return "", fmt.Errorf("%w: target VLAN %d is not configured on the OLT", ErrConflict, t.ServiceVLAN)
		}
		return "", err
	}
	nf, err := p.discover(DisplayNextFreeServicePort())
	if err != nil {
		return "", err
	}
	newID, err := ParseNextFreeIndex(nf)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}
	// What the old service-port really is comes from the ONT's own listing; the request only overrides it.
	oldUser, oldGem, oldTr := r.OldUserVLAN, r.OldGem, r.OldTransform
	oldUntagged := oldTr == "default"
	for _, ex := range ParseServicePorts(before) {
		if ex.Index == r.OldServicePortID {
			oldUntagged = oldUntagged || IsUntaggedFlow(ex)
			if oldGem == 0 {
				oldGem = ex.Gem
			}
			continue
		}
		if t.Untagged && ex.Gem == t.Gem && IsUntaggedFlow(ex) {
			return "", fmt.Errorf("%w: this ONT also has untagged service-port %d on GEM port %d; a second untagged service on the same GEM can conflict, so verify the design first", ErrConflict, ex.Index, t.Gem)
		}
	}
	if oldUntagged {
		oldUser, oldTr = 0, "default"
	} else {
		if oldUser == 0 {
			oldUser = r.OldVLAN
		}
		if oldTr == "" {
			oldTr = "translate"
		}
	}
	if oldGem == 0 {
		oldGem = t.Gem
	}
	newSP := ServicePort{ID: newID, VLAN: t.ServiceVLAN, F: d.F, S: d.S, P: d.P, OntID: d.OntID, Gem: t.Gem, UserVLAN: t.UserVLAN, Untagged: t.Untagged, Transform: t.Transform}
	oldSP := ServicePort{ID: r.OldServicePortID, VLAN: r.OldVLAN, F: d.F, S: d.S, P: d.P, OntID: d.OntID, Gem: oldGem, UserVLAN: oldUser, Untagged: oldUntagged, Transform: oldTr}
	oldAdd, err := ServicePortAdd(oldSP) // validates the rollback command now, not mid-incident
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}
	newAdd, err := ServicePortAdd(newSP)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrConflict, err)
	}

	p.add("check_ont_present", "read", "ont_present", []Cmd{bySN}, nil)
	p.add("check_old_service_port", "read", fmt.Sprintf("contains:%d", r.OldVLAN), []Cmd{showOld}, nil)
	p.add("check_vlan", "read", "vlan_exists", []Cmd{vlanCmd}, nil)
	p.add("check_service_port_free", "read", fmt.Sprintf("next_free:%d", newID), []Cmd{DisplayNextFreeServicePort()}, nil)
	if t.Untagged {
		// Two untagged service-ports on one GEM conflict, so the old one goes first; if the add then fails the
		// executor rolls the removal back by re-adding it.
		p.add("service_port_remove_old", "write", "", []Cmd{must(ServicePortUndo(r.OldServicePortID))}, []Cmd{oldAdd})
		p.add("service_port_add", "write", "", []Cmd{newAdd}, []Cmd{must(ServicePortUndo(newID))})
		p.add("verify_new_service_port", "verify", fmt.Sprintf("contains:%d", t.ServiceVLAN), []Cmd{must(DisplayServicePort(newID))}, nil)
	} else {
		p.add("service_port_add", "write", "", []Cmd{newAdd}, []Cmd{must(ServicePortUndo(newID))})
		p.add("verify_new_service_port", "verify", fmt.Sprintf("contains:%d", t.ServiceVLAN), []Cmd{must(DisplayServicePort(newID))}, nil)
		p.add("service_port_remove_old", "write", "", []Cmd{must(ServicePortUndo(r.OldServicePortID))}, []Cmd{oldAdd})
	}
	p.add("verify_old_removed", "verify", "absent", []Cmd{showOld}, nil)
	p.add("verify_other_services_preserved", "verify", fmt.Sprintf("preserved:%d", r.OldServicePortID), []Cmd{showOnt}, nil)
	return before, nil
}

func (s *Service) persist(ctx context.Context, req PlanRequest, key, actor, before string, steps []Step) (*Job, error) {
	params, _ := json.Marshal(req)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `
		INSERT INTO provisioning_jobs (olt_id, reseller_id, operation, idempotency_key, params, requested_by, before_state, error_summary, save_output)
		VALUES (?,?,?,?,?,?,?,'','')`, req.OLTID, req.ResellerID, req.Operation, key, params, actor, before)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "1062") {
			tx.Rollback()
			return s.byKey(ctx, key)
		}
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	for _, st := range steps {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO provisioning_job_steps (job_id, seq, name, kind, command, rollback_command, expect, plan_result, plan_output, output)
			VALUES (?,?,?,?,?,?,?,?,?,'')`,
			id, st.Seq, st.Name, st.Kind, strings.Join(st.Commands, "\n"), strings.Join(st.Rollback, "\n"), st.Expect,
			st.PlanResult, st.PlanOutput); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log(actor, action, target, detail) VALUES (?,'job.plan',?,?)`,
		actor, fmt.Sprintf("job:%d", id), fmt.Sprintf("%s serial=%s olt=%d", req.Operation, req.Serial, req.OLTID)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Service) byKey(ctx context.Context, key string) (*Job, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM provisioning_jobs WHERE idempotency_key=?`, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Get(ctx context.Context, id int64) (*Job, error) {
	j := &Job{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, olt_id, reseller_id, operation, idempotency_key, params, status, requested_by, approved_by, before_state,
		       error_summary, created_at, started_at, completed_at, saved_at, saved_by FROM provisioning_jobs WHERE id=?`, id).
		Scan(&j.ID, &j.OLTID, &j.ResellerID, &j.Operation, &j.IdempotencyKey, &j.Params, &j.Status, &j.RequestedBy, &j.ApprovedBy,
			&j.BeforeState, &j.ErrorSummary, &j.CreatedAt, &j.StartedAt, &j.CompletedAt, &j.SavedAt, &j.SavedBy)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT seq, name, kind, command, rollback_command, expect, result, output, COALESCE(plan_result, ''), COALESCE(plan_output, '')
		FROM provisioning_job_steps WHERE job_id=? ORDER BY seq`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st Step
		var cmd, rb string
		if err := rows.Scan(&st.Seq, &st.Name, &st.Kind, &cmd, &rb, &st.Expect, &st.Result, &st.Output, &st.PlanResult, &st.PlanOutput); err != nil {
			return nil, err
		}
		st.Commands = splitLines(cmd)
		st.Rollback = splitLines(rb)
		j.Steps = append(j.Steps, st)
	}
	return j, rows.Err()
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

func (s *Service) List(ctx context.Context, limit int, resellerID ...int64) ([]Job, error) {
	sqlQuery := `
		SELECT id, olt_id, reseller_id, operation, idempotency_key, params, status, requested_by, approved_by, before_state,
		       error_summary, created_at, started_at, completed_at, saved_at, saved_by
		FROM provisioning_jobs`
	var args []any
	if len(resellerID) > 0 && resellerID[0] > 0 {
		sqlQuery += ` WHERE reseller_id=? OR olt_id IN (SELECT olt_id FROM olt_resellers WHERE reseller_id=?)`
		args = append(args, resellerID[0], resellerID[0])
	}
	sqlQuery += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Job{}
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.OLTID, &j.ResellerID, &j.Operation, &j.IdempotencyKey, &j.Params, &j.Status, &j.RequestedBy, &j.ApprovedBy,
			&j.BeforeState, &j.ErrorSummary, &j.CreatedAt, &j.StartedAt, &j.CompletedAt, &j.SavedAt, &j.SavedBy); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *Service) Approve(ctx context.Context, id int64, actor string) error {
	j, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if j.Status != "planned" {
		return ErrState
	}
	if j.Operation == "change_vlan" && j.RequestedBy == actor {
		return fmt.Errorf("%w: approver must differ from requester for change_vlan", ErrConflict)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET status='approved', approved_by=? WHERE id=? AND status='planned'`, actor, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrState
	}
	s.audit(ctx, actor, "job.approve", id, "")
	return nil
}

func (s *Service) Reject(ctx context.Context, id int64, actor string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE provisioning_jobs SET status='rejected', completed_at=NOW() WHERE id=? AND status IN ('planned','approved')`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrState
	}
	s.audit(ctx, actor, "job.reject", id, "")
	return nil
}

func (s *Service) audit(ctx context.Context, actor, action string, jobID int64, detail string) {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO audit_log(actor, action, target, detail) VALUES (?,?,?,?)`,
		actor, action, fmt.Sprintf("job:%d", jobID), detail); err != nil {
		slog.Error("audit write failed", "err", err)
	}
}
