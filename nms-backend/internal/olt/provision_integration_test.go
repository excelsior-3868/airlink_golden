//go:build integration

package olt

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nepalairlink/nms/internal/testdb"
)

// fakeOLT is a stateful stand-in for a MA5683T: it tracks registered ONTs and service-ports so the
// test can assert what really changed on the "device", not just which commands were sent.
type fakeOLT struct {
	mu          sync.Mutex
	onts        map[string]int // serial -> ont id (all on 0/4/7)
	sps         map[int]string // service-port id -> command text
	vlans       map[int]bool
	mismatch    map[string]bool // serials whose match state is "mismatch" after registration
	failSPAdd   bool
	log         []string
	existingSPs []string // preloaded service-ports of an existing customer: "id vlan N ..."

	lineProfiles map[int]string // profile id -> `display ont-lineprofile` output

	offline         map[string]bool   // serials that are registered but not powered on (state offline/initial)
	autofind        map[string]string // serial -> "F/S/P" of ONTs the OLT detected but that are not registered yet
	failSave        bool              // `save` is rejected by the OLT
	bySNUnsupported bool              // this "release" rejects `display ont info by-sn`
	noNextFree      bool              // ... and `display service-port next-free-index`
	vlanOut         map[int]string    // optional `display vlan N` output (for uplink checks)
}

var reSPcmd = regexp.MustCompile(`^service-port (\d+) vlan (\d+) gpon (\d+)/(\d+)/(\d+) ont (\d+) gemport (\d+) multi-service user-vlan (\S+)`)

// renderSP shows a service-port the way `display service-port port ...` lists it (table row layout). Hand-written
// lines that are not a service-port command are returned unchanged.
func renderSP(cmd string) string {
	m := reSPcmd.FindStringSubmatch(cmd)
	if m == nil {
		return cmd
	}
	flow, para := "vlan", m[8]
	if m[8] == "untagged" {
		flow, para = "untag", "-"
	}
	return fmt.Sprintf("  %7s %4s common   gpon %s/%2s /%s %3s %4s %-5s %-10s -    -    up   ", m[1], m[2], m[3], m[4], m[5], m[6], m[7], flow, para)
}

// lineProfileOut renders the GEM table of a line profile the way the OLT prints it.
func lineProfileOut(gem int, vlans ...int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  Profile-ID :40\n   <Gem Index %d>\n    Mapping VLAN  Priority Port\n    index\n", gem)
	for i, v := range vlans {
		fmt.Fprintf(&b, "    %d       %d  -        -\n", i, v)
	}
	return b.String()
}

func newFake() *fakeOLT {
	return &fakeOLT{onts: map[string]int{}, sps: map[int]string{}, vlans: map[int]bool{100: true, 2190: true}, mismatch: map[string]bool{}, vlanOut: map[int]string{}, offline: map[string]bool{}, autofind: map[string]string{},
		lineProfiles: map[int]string{40: lineProfileOut(1, 100)}}
}

func cliErr(c Cmd, msg string) error { return &CLIError{Cmd: c.String(), Msg: msg} }

var (
	reAdd  = regexp.MustCompile(`^ont add (\d+) (\d+) sn-auth "([0-9A-F]{16})"`)
	reDel  = regexp.MustCompile(`^ont delete (\d+) (\d+)$`)
	reSP   = regexp.MustCompile(`^service-port (\d+) vlan (\d+)`)
	reUndo = regexp.MustCompile(`^undo service-port (\d+)$`)
	reShow = regexp.MustCompile(`^display service-port (\d+)$`)
	reBySN = regexp.MustCompile(`^display ont info by-sn ([0-9A-F]{16})$`)
	reVlan = regexp.MustCompile(`^display vlan (\d+)$`)
	reLP   = regexp.MustCompile(`^display ont-lineprofile gpon profile-id (\d+)$`)
	rePos  = regexp.MustCompile(`^display ont info (\d+) (\d+) (\d+) (\d+)$`)
)

func (f *fakeOLT) Run(_ context.Context, c Cmd) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t := c.String()
	f.log = append(f.log, t)
	switch {
	case t == "display version":
		return "  VERSION : MA5600V800R015C00\n  PATCH   : SPC107\n", nil
	case t == "display board 0":
		return "  SlotID  BoardName  Status\n  0       H802SCUN   Active_normal\n  4       H805GPFD   Normal\n", nil
	case t == "display ont autofind all":
		var b strings.Builder
		n := 0
		for sn, fsp := range f.autofind {
			if _, registered := f.onts[sn]; registered {
				continue // autofind only lists ONTs that are not registered yet
			}
			n++
			fmt.Fprintf(&b, "  -----------------------------\n  Number              : %d\n  F/S/P               : %s\n  Ont SN              : %s (HWTC-%s)\n", n, fsp, sn, sn[8:])
		}
		if n == 0 {
			return "", cliErr(c, "Failure: The automatically found ONTs do not exist")
		}
		return b.String(), nil
	case t == "display vlan all":
		return "  VLAN ID Type  Attribute STND-Port SERV-Port\n  100     smart common    1         2         0\n  2190    smart common    0         3         0\n", nil
	case t == "display service-port all":
		var b strings.Builder
		for id, line := range f.sps {
			fmt.Fprintf(&b, "  %d 100 common gpon 0 /4 /7 %d 1 vlan 100 - - up\n", id, len(line)%100)
		}
		return b.String(), nil
	case t == "display dba-profile all":
		return "  13  type3  No  0  1024  51200  5\n", nil
	case t == "display ont-lineprofile gpon all":
		return "  4   line-profile_4   10\n  40  LINE_PPPoE_V100  0\n", nil
	case t == "display ont-srvprofile gpon all":
		return "  40  SRV_ONT_4ETH  0\n", nil
	case t == "save" && f.failSave:
		return "", cliErr(c, "Failure: the configuration could not be saved")
	case t == "interface gpon 0/4" || t == "quit" || t == "save":
		return "", nil
	case reVlan.MatchString(t):
		var v int
		fmt.Sscanf(t, "display vlan %d", &v)
		if !f.vlans[v] {
			return "", cliErr(c, "Failure: VLAN does not exist")
		}
		if out, ok := f.vlanOut[v]; ok {
			return out, nil
		}
		return fmt.Sprintf("VLAN ID: %d", v), nil
	case reBySN.MatchString(t):
		if f.bySNUnsupported {
			return "", cliErr(c, "% Unknown command, the error locates at '^'")
		}
		sn := reBySN.FindStringSubmatch(t)[1]
		id, ok := f.onts[sn]
		if !ok {
			return "", cliErr(c, "Failure: The ONT does not exist")
		}
		match, run, cfg := "match", "online", "normal"
		if f.mismatch[sn] {
			match = "mismatch"
		}
		if f.offline[sn] {
			match, run, cfg = "initial", "offline", "initial"
		}
		return fmt.Sprintf("F/S/P : 0/4/7\nONT-ID : %d\nControl flag : active\nRun state : %s\nConfig state : %s\nMatch state : %s\nLine profile ID : 40\nService profile ID : 40\n", id, run, cfg, match), nil
	case rePos.MatchString(t):
		var ff, ss, pp, id int
		fmt.Sscanf(t, "display ont info %d %d %d %d", &ff, &ss, &pp, &id)
		for sn, oid := range f.onts {
			if oid == id && ff == 0 && ss == 4 && pp == 7 {
				return fmt.Sprintf("F/S/P : 0/4/7\nONT-ID : %d\nSN : %s (HWTC-%s)\nControl flag : active\nRun state : online\nConfig state : normal\nMatch state : match\n", id, sn, sn[8:]), nil
			}
		}
		return "", cliErr(c, "Failure: The ONT does not exist")
	case t == "display ont info 0 4 7 all":
		var sns []string
		for sn := range f.onts {
			sns = append(sns, sn)
		}
		sort.Strings(sns)
		var b strings.Builder
		for _, sn := range sns {
			fmt.Fprintf(&b, "  0/4/7  %d  %s  active  online  normal  match  no\n", f.onts[sn], sn)
		}
		return b.String(), nil
	case strings.HasPrefix(t, "display ont-srvprofile gpon profile-id "):
		var id int
		fmt.Sscanf(t, "display ont-srvprofile gpon profile-id %d", &id)
		if id == 40 {
			return "  Service profile ID   : 40\n  Service profile name : SRV_ONT_4ETH\n", nil
		}
		return "", cliErr(c, "Failure: The service profile does not exist")
	case reLP.MatchString(t):
		var id int
		fmt.Sscanf(t, "display ont-lineprofile gpon profile-id %d", &id)
		if m, ok := f.lineProfiles[id]; ok {
			return m, nil
		}
		return "", cliErr(c, "Failure: The line profile does not exist")
	case t == "display service-port next-free-index":
		if f.noNextFree {
			return "", cliErr(c, "% Unknown command, the error locates at '^'")
		}
		for i := 969; ; i++ {
			if _, used := f.sps[i]; !used {
				return fmt.Sprintf("Next free index : %d", i), nil
			}
		}
	case reAdd.MatchString(t):
		m := reAdd.FindStringSubmatch(t)
		var id int
		fmt.Sscanf(m[2], "%d", &id)
		f.onts[m[3]] = id
		return "success: 1", nil
	case reDel.MatchString(t):
		var id int
		fmt.Sscanf(reDel.FindStringSubmatch(t)[2], "%d", &id)
		for sn, i := range f.onts {
			if i == id {
				delete(f.onts, sn)
			}
		}
		return "", nil
	case reSP.MatchString(t):
		if f.failSPAdd {
			return "", cliErr(c, "Failure: service virtual port already exists")
		}
		var id int
		fmt.Sscanf(t, "service-port %d", &id)
		f.sps[id] = t
		return "", nil
	case reUndo.MatchString(t):
		var id int
		fmt.Sscanf(t, "undo service-port %d", &id)
		delete(f.sps, id)
		return "", nil
	case reShow.MatchString(t):
		var id int
		fmt.Sscanf(t, "display service-port %d", &id)
		if line, ok := f.sps[id]; ok {
			return line, nil
		}
		return "", cliErr(c, "Failure: Service virtual port does not exist")
	case strings.HasPrefix(t, "display service-port port"):
		var ids []int
		for id := range f.sps {
			ids = append(ids, id)
		}
		sort.Ints(ids)
		var b strings.Builder
		for _, e := range f.existingSPs {
			b.WriteString(e + "\n")
		}
		for _, id := range ids {
			b.WriteString(renderSP(f.sps[id]) + "\n")
		}
		return b.String(), nil
	}
	return "", cliErr(c, "% Unknown command")
}
func (f *fakeOLT) Close() error { return nil }

type fakeDialer struct{ f *fakeOLT }

func (d fakeDialer) Dial(context.Context, int64) (Executor, error) { return d.f, nil }

// mustInsert runs an INSERT and returns the new row's id.
func mustInsert(t *testing.T, db *sql.DB, ctx context.Context, q string, args ...any) int64 {
	t.Helper()
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func setup(t *testing.T) (*Service, *fakeOLT, int64, int64, context.Context) {
	pool := testdb.Open(t)
	ctx := context.Background()
	// the schema persists between tests, so start each one from empty tables
	for _, q := range []string{`DELETE FROM provisioning_job_steps`, `DELETE FROM provisioning_jobs`, `DELETE FROM service_templates`, `DELETE FROM devices`} {
		if _, err := pool.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	dev := mustInsert(t, pool, ctx, `INSERT INTO devices(name,ip,role,poll_method,sys_descr) VALUES('olt-bijule','10.9.9.1','olt','tcp','')`)
	mustInsert(t, pool, ctx, `INSERT INTO olts(device_id,ssh_host_key,pon_ports) VALUES(?,'','')`, dev)
	mustInsert(t, pool, ctx, `INSERT INTO olt_profiles(olt_id,profile_type,profile_id,detail) VALUES(?,'line',40,''),(?,'srv',40,'')`, dev, dev)
	tpl := mustInsert(t, pool, ctx, `INSERT INTO service_templates(name,service_vlan,user_vlan,gem_index,line_profile_id,srv_profile_id)
		VALUES('PPPoE-100',100,100,1,40,40)`)
	f := newFake()
	f.autofind[sn1], f.autofind[sn2] = "0/4/7", "0/4/7" // both test ONTs are connected on 0/4/7 and not registered yet
	svc := NewService(pool, fakeDialer{f}, false)
	svc.retryWait = 10 * time.Millisecond
	return svc, f, dev, tpl, ctx
}

const sn1 = "485754439785B59A"
const sn2 = "48575443AABBCCDD"

func TestRegisterONTHappyPathAndIdempotency(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	req := PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Frame: 0, Slot: 4, Port: 7, TemplateID: tpl, Description: "Customer-001"}

	job, err := svc.Plan(ctx, req, "operator")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != "planned" || len(job.Steps) != 15 {
		t.Fatalf("plan: status=%s steps=%d", job.Status, len(job.Steps))
	}
	if len(f.onts) != 0 {
		t.Fatal("planning must be read-only")
	}
	for _, l := range f.log {
		if !strings.HasPrefix(l, "display") {
			t.Fatalf("planning issued a non-read command: %q", l)
		}
	}
	dup, err := svc.Plan(ctx, req, "operator")
	if err != nil || dup.ID != job.ID {
		t.Fatalf("duplicate request must return the same job: %v %v", dup, err)
	}

	done, err := svc.Apply(ctx, job.ID, "operator")
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "succeeded" {
		t.Fatalf("status=%s summary=%s", done.Status, done.ErrorSummary)
	}
	if _, ok := f.onts[sn1]; !ok || len(f.sps) != 1 {
		t.Fatalf("device state wrong: onts=%v sps=%v", f.onts, f.sps)
	}
	var n int
	svc.db.QueryRowContext(ctx, `SELECT count(*) FROM ont_inventory WHERE serial_number=? AND pon_port=7`, sn1).Scan(&n)
	if n != 1 {
		t.Fatal("inventory not updated")
	}
	if _, err := svc.Apply(ctx, job.ID, "operator"); !errors.Is(err, ErrState) {
		t.Fatalf("re-applying a finished job must be refused, got %v", err)
	}
	for _, l := range f.log {
		if l == "save" {
			t.Fatal("save must not be issued unless the save policy is enabled")
		}
	}

	// Registering the same serial again is refused (never re-register an existing ONT).
	req2 := req
	req2.IdempotencyKey = "second"
	if _, err := svc.Plan(ctx, req2, "operator"); !errors.Is(err, ErrConflict) {
		t.Fatalf("want conflict for already-registered ONT, got %v", err)
	}
}

func TestVerificationFailureRollsBack(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	f.mismatch[sn2] = true // after registration the OLT reports a profile/capability mismatch
	job, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn2, Frame: 0, Slot: 4, Port: 7, TemplateID: tpl}, "operator")
	if err != nil {
		t.Fatal(err)
	}
	// The fake only reports a mismatch once the ONT exists; make the pre-registration check pass.
	done, err := svc.Apply(ctx, job.ID, "operator")
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "rolled_back" {
		t.Fatalf("status=%s (%s), want rolled_back", done.Status, done.ErrorSummary)
	}
	if len(f.onts) != 0 || len(f.sps) != 0 {
		t.Fatalf("rollback left residue: onts=%v sps=%v", f.onts, f.sps)
	}
	var n int
	svc.db.QueryRowContext(ctx, `SELECT count(*) FROM ont_inventory`).Scan(&n)
	if n != 0 {
		t.Fatal("failed job must not create inventory")
	}
}

func TestServicePortFailureUndoesONT(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	job, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Frame: 0, Slot: 4, Port: 7, TemplateID: tpl}, "operator")
	if err != nil {
		t.Fatal(err)
	}
	f.failSPAdd = true
	done, _ := svc.Apply(ctx, job.ID, "operator")
	if done.Status != "rolled_back" || len(f.onts) != 0 {
		t.Fatalf("status=%s onts=%v: ONT added by the failed job must be removed", done.Status, f.onts)
	}
}

func TestPlanRefusesUnverifiedProfilesAndMissingVLAN(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	bad := mustInsert(t, svc.db, ctx, `INSERT INTO service_templates(name,service_vlan,user_vlan,gem_index,line_profile_id,srv_profile_id)
		VALUES('uncatalogued',100,100,1,99,99)`)
	if _, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Slot: 4, Port: 7, TemplateID: bad}, "op"); !errors.Is(err, ErrConflict) {
		t.Fatalf("unverified profile ids must be refused, got %v", err)
	}
	novlan := mustInsert(t, svc.db, ctx, `INSERT INTO service_templates(name,service_vlan,user_vlan,gem_index,line_profile_id,srv_profile_id)
		VALUES('vlan-missing',777,777,1,40,40)`)
	if _, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Slot: 4, Port: 7, TemplateID: novlan}, "op"); !errors.Is(err, ErrConflict) {
		t.Fatalf("missing VLAN must be refused, got %v", err)
	}
	if len(f.onts) != 0 {
		t.Fatal("refused plans must not touch the device")
	}
}

func TestChangeVLANNeedsFourEyesAndPreservesOtherServices(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	f.onts[sn1] = 3
	f.vlans[2208] = true
	f.sps[32] = "  32 vlan 2208 gpon 0/4/7 ont 3 gemport 1 multi-service user-vlan 2208 tag-transform translate"
	f.existingSPs = []string{"  40 vlan 2190 gpon 0/4/7 ont 3 gemport 2 multi-service user-vlan 2190 tag-transform translate"}

	req := PlanRequest{OLTID: dev, Operation: "change_vlan", Serial: sn1, TemplateID: tpl, OldServicePortID: 32, OldVLAN: 2208, OldGem: 1}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Apply(ctx, job.ID, "alice"); !errors.Is(err, ErrState) {
		t.Fatalf("unapproved change_vlan must not run: %v", err)
	}
	if err := svc.Approve(ctx, job.ID, "alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("self-approval must be refused: %v", err)
	}
	if err := svc.Approve(ctx, job.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if _, old := f.sps[32]; old {
		t.Fatal("old service-port should be removed")
	}
	if len(f.sps) != 1 {
		t.Fatalf("expected exactly the new service-port, got %v", f.sps)
	}
}

func TestAddServicePortToExistingONT(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	f.onts[sn1] = 3
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, TemplateID: tpl}

	// Line profile maps VLAN 100 on GEM 1: the plan is built, checks the mapping, and applies.
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"check_ont_present", "check_ont_by_position", "check_existing_services", "check_line_profile_gem_mapping", "check_vlan",
		"check_service_port_free", "service_port_add", "verify_service_port", "verify_existing_services_preserved", "verify_new_service_listed"}
	if len(job.Steps) != len(want) {
		t.Fatalf("steps=%d want %d: %+v", len(job.Steps), len(want), job.Steps)
	}
	for i, s := range job.Steps {
		if s.Name != want[i] {
			t.Fatalf("step %d is %q, want %q", i+1, s.Name, want[i])
		}
		if s.Kind == "read" && (s.PlanResult != "ok" || strings.TrimSpace(s.PlanOutput) == "") {
			t.Fatalf("read step %q must carry planning evidence, got result=%q output=%q", s.Name, s.PlanResult, s.PlanOutput)
		}
		if s.Kind != "read" && (s.PlanResult != "" || s.PlanOutput != "") {
			t.Fatalf("%q is not a read step and must not claim planning evidence", s.Name)
		}
	}
	if len(f.sps) != 0 {
		t.Fatal("planning must not write")
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if len(f.sps) != 1 {
		t.Fatalf("expected one new service-port, got %v", f.sps)
	}
}

func TestAddServicePortRefusesUnmappedVLANAndDuplicates(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	f.onts[sn1] = 3
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, TemplateID: tpl}

	// The profile maps a different VLAN to GEM 1: the service-port would come up but carry no traffic.
	f.lineProfiles[40] = lineProfileOut(1, 2208, 2050)
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "does not map VLAN 100") {
		t.Fatalf("unmapped VLAN must be refused with an explanation: %v", err)
	}
	if len(f.sps) != 0 {
		t.Fatal("planning must not write")
	}

	// The ONT already has a VLAN 100 service-port: refuse a second one.
	f.lineProfiles[40] = lineProfileOut(1, 100)
	f.existingSPs = []string{"    1941  100 common   gpon 0/4 /7  3    1     vlan  100        -    -    up   "}
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "already has service-port 1941") {
		t.Fatalf("duplicate VLAN service must be refused: %v", err)
	}
}

func stepNames(j *Job) []string {
	var n []string
	for _, s := range j.Steps {
		n = append(n, s.Name)
	}
	return n
}

// Case 2 of the guide: untagged customer side, user-vlan untagged with tag-transform default.
func TestAddServiceUntaggedCase2(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, Untagged: true}

	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	var wrote, exists string
	for _, s := range job.Steps {
		if s.Kind == "write" {
			wrote = s.Commands[0]
		}
		if s.Name == "check_existing_services" {
			exists = s.Expect
		}
	}
	if !strings.HasSuffix(wrote, "user-vlan untagged tag-transform default") {
		t.Fatalf("untagged command wrong: %q", wrote)
	}
	if exists != "no_untagged_gem:1" {
		t.Fatalf("untagged plan must check for an untagged service on the GEM, got %q", exists)
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if len(f.sps) != 1 {
		t.Fatalf("expected one service-port, got %v", f.sps)
	}
}

func TestAddServiceUntaggedRefusesSecondUntaggedOnSameGEM(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	f.existingSPs = []string{"       7  100 common   gpon 0/4 /7  3    1     untag -    -    -    up   "}
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, Untagged: true}
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "already has untagged service-port 7") {
		t.Fatalf("second untagged service on the same GEM must be refused: %v", err)
	}
	// A tagged service for the same VLAN is refused too: the ONT already carries VLAN 100, and the guide says
	// never to create a duplicate service classification.
	tagged := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}
	if _, err := svc.Plan(ctx, tagged, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "already has service-port 7 for VLAN 100") {
		t.Fatalf("tagged VLAN 100 next to an existing VLAN 100 service must be refused: %v", err)
	}
}

// Guide, workflow 0 step 3: if next-free-index is rejected, read the whole table and choose an unused index.
func TestAddServiceFallsBackToServicePortTable(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	f.noNextFree = true
	f.sps[0], f.sps[1], f.sps[3] = "  0 x", "  1 x", "  3 x" // index 2 is a gap
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}

	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	var free Step
	for _, s := range job.Steps {
		if s.Name == "check_service_port_free" {
			free = s
		}
	}
	if free.Commands[0] != "display service-port all" || free.Expect != "sp_free:2" {
		t.Fatalf("must use the table and pick the gap 2: %+v", free)
	}
	if !strings.Contains(free.PlanOutput, "lowest unused index 2") {
		t.Fatalf("the plan must say why: %q", free.PlanOutput)
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if _, ok := f.sps[2]; !ok {
		t.Fatalf("service-port 2 should have been created: %v", f.sps)
	}
}

// Guide, workflow 0 step 1: if `by-sn` is not accepted, use the form the release supports.
func TestAddServiceFallsBackWhenBySNIsUnsupported(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	f.bySNUnsupported = true
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}

	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "not in the synced inventory") {
		t.Fatalf("without an inventory row there is nothing to fall back on: %v", err)
	}
	if _, err := svc.db.ExecContext(ctx, `INSERT INTO ont_inventory(serial_number, olt_id, frame, slot, pon_port, ont_id) VALUES(?,?,0,4,7,3)`, sn1, dev); err != nil {
		t.Fatal(err)
	}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	first := job.Steps[0]
	if first.Commands[0] != "display ont info 0 4 7 3" || first.Expect != "ont_at:"+sn1 || !strings.Contains(first.PlanOutput, "not accepted by this OLT release") {
		t.Fatalf("first step must be the by-position confirmation: %+v", first)
	}
	if done, err := svc.Apply(ctx, job.ID, "alice"); err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
}

// Guide, "before you begin" and case step 4: the VLAN must be carried on the uplink.
func TestAddServiceChecksVLANOnUplink(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	f.vlanOut[100] = "  VLAN ID: 100\n  Standard ports: 0/9/1\n"
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, UplinkPort: "0/9/1"}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	var has bool
	for _, n := range stepNames(job) {
		has = has || n == "check_vlan_uplink"
	}
	if !has {
		t.Fatalf("an uplink check step is expected: %v", stepNames(job))
	}
	req.UplinkPort = "0/9/2"
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "does not list uplink port 0/9/2") {
		t.Fatalf("a VLAN that is not on the uplink must be refused: %v", err)
	}
	req.UplinkPort = "nonsense"
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("a malformed uplink port must be refused: %v", err)
	}
}

// Registration of a new ONT with the service given inline (no saved template).
func TestRegisterONTInlineService(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	req := PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Frame: 0, Slot: 4, Port: 7, Description: "Customer-X",
		ServiceVLAN: 100, Gem: 1, LineProfileID: 40, SrvProfileID: 40}

	// A stale inventory row must not block it: the live OLT decides whether the serial is new.
	if _, err := svc.db.ExecContext(ctx, `INSERT INTO ont_inventory(serial_number, olt_id, frame, slot, pon_port, ont_id) VALUES(?,?,0,4,7,9)`, sn1, dev); err != nil {
		t.Fatal(err)
	}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	// The order of the field guide "New ONT": Part 1 (autofind, profiles, ONT-ID, register, verify), Part 2 (the
	// registered ONT, its services, the free service-port ID) and Part 3 (create the service-port, verify it).
	want := []string{"check_autofind", "check_line_profile_gem_mapping", "check_service_profile", "check_ont_absent", "check_ont_id_free", "check_vlan",
		"check_service_port_free", "ont_add", "verify_ont", "check_ont_by_position", "check_existing_services", "recheck_service_port_free",
		"service_port_add", "verify_service_port", "verify_new_service_listed"}
	if got := stepNames(job); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("steps:\n got %v\nwant %v", got, want)
	}
	// Reads that need the ONT to exist (guide Parts 2 and 3) run during Apply, after the registration, so they have no
	// planning evidence. Every other read was made now and carries the OLT's answer.
	applyTime := map[string]bool{"check_ont_by_position": true, "check_existing_services": true, "recheck_service_port_free": true}
	for _, s := range job.Steps {
		if s.Kind == "read" && applyTime[s.Name] {
			if s.PlanResult != "" || s.PlanOutput != "" {
				t.Fatalf("%q runs at apply time and must not claim planning evidence", s.Name)
			}
			continue
		}
		if s.Kind == "read" && (s.PlanResult != "ok" || strings.TrimSpace(s.PlanOutput) == "") {
			t.Fatalf("read step %q must carry evidence: %q %q", s.Name, s.PlanResult, s.PlanOutput)
		}
	}
	if len(f.onts) != 0 || len(f.sps) != 0 {
		t.Fatal("planning must not write")
	}
	// The ONT is not powered on yet (state offline/initial): that is a registration, not a failure to roll back.
	f.offline[sn1] = true
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if _, ok := f.onts[sn1]; !ok || len(f.sps) != 1 {
		t.Fatalf("expected the ONT and one service-port: %v %v", f.onts, f.sps)
	}
}

// Guide, Part 1 step 1: the new ONT is found with autofind, on the port it is registered on.
func TestRegisterONTUsesAutofind(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	req := PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Frame: 0, Slot: 4, Port: 7, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, SrvProfileID: 40}

	// Detected on the right port: the first step carries the OLT's answer.
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	first := job.Steps[0]
	if first.Name != "check_autofind" || first.Commands[0] != "display ont autofind all" || first.PlanResult != "ok" || !strings.Contains(first.PlanOutput, sn1) {
		t.Fatalf("autofind must be step 1 with the OLT's answer: %+v", first)
	}

	// Detected on a different PON port than the one chosen: never register on the wrong port.
	f.autofind[sn1] = "0/4/9"
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "detected this ONT on 0/4/9") {
		t.Fatalf("a wrong port must be refused: %v", err)
	}
	withUndetected := req
	withUndetected.AllowUndetected = true
	if _, err := svc.Plan(ctx, withUndetected, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "detected this ONT on 0/4/9") {
		t.Fatalf("a wrong port must be refused even when undetected ONTs are allowed: %v", err)
	}

	// Not detected at all: the guide says to fix the optical connection and run autofind again.
	delete(f.autofind, sn1)
	if _, err := svc.Plan(ctx, req, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "has not detected") {
		t.Fatalf("an undetected ONT must be refused with the guide's advice: %v", err)
	}
	// ... unless the operator chose to register a CPE that is not connected yet.
	job, err = svc.Plan(ctx, withUndetected, "alice")
	if err != nil {
		t.Fatal(err)
	}
	af := job.Steps[0]
	if af.Expect != "autofind_optional" || !strings.Contains(af.PlanOutput, "not detected this ONT yet") {
		t.Fatalf("an undetected registration must say so in the evidence: %+v", af)
	}
	if done, err := svc.Apply(ctx, job.ID, "alice"); err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
}

func TestRegisterONTRefusals(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	base := PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Frame: 0, Slot: 4, Port: 7, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, SrvProfileID: 40}

	bad := base
	bad.SrvProfileID = 99
	if _, err := svc.Plan(ctx, bad, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "service profile 99 does not exist") {
		t.Fatalf("an unknown service profile must be refused: %v", err)
	}
	bad = base
	bad.LineProfileID = 55
	if _, err := svc.Plan(ctx, bad, "alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("an unknown line profile must be refused: %v", err)
	}
	bad = base
	bad.ServiceVLAN = 2190 // the line profile maps only VLAN 100 on GEM 1
	if _, err := svc.Plan(ctx, bad, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "does not map VLAN 2190") {
		t.Fatalf("a VLAN the profile does not carry must be refused: %v", err)
	}
	bad = base
	bad.Description = `bad"desc`
	if _, err := svc.Plan(ctx, bad, "alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("a description with quotes must be refused: %v", err)
	}
	f.onts[sn1] = 3 // already on the OLT
	if _, err := svc.Plan(ctx, base, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "already registered") {
		t.Fatalf("an already registered serial must be refused: %v", err)
	}
}

// The change is only in the running configuration until it is saved; saving is an explicit, once-only action
// for a job that was applied and verified.
func TestSaveConfigurationAfterApply(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	countSaves := func() (n int) {
		for _, l := range f.log {
			if l == "save" {
				n++
			}
		}
		return
	}

	// Not applied yet: nothing to save.
	if _, err := svc.SaveConfig(ctx, job.ID, "bob"); !errors.Is(err, ErrState) {
		t.Fatalf("a planned job must not be saved: %v", err)
	}
	if _, err := svc.Apply(ctx, job.ID, "alice"); err != nil {
		t.Fatal(err)
	}
	if countSaves() != 0 {
		t.Fatal("applying must not save on its own when automatic saving is off")
	}
	if j, _ := svc.Get(ctx, job.ID); j.SavedAt != nil {
		t.Fatal("not saved yet")
	}

	// A failed save is reported and leaves the job unsaved, so it can be retried.
	f.failSave = true
	if _, err := svc.SaveConfig(ctx, job.ID, "bob"); err == nil || !strings.Contains(err.Error(), "NOT persisted") {
		t.Fatalf("a failed save must say so: %v", err)
	}
	if j, _ := svc.Get(ctx, job.ID); j.SavedAt != nil {
		t.Fatal("a failed save must not mark the job saved")
	}
	f.failSave = false

	saved, err := svc.SaveConfig(ctx, job.ID, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if saved.SavedAt == nil || saved.SavedBy == nil || *saved.SavedBy != "bob" {
		t.Fatalf("saved_by must record who saved: %+v", saved)
	}
	last := saved.Steps[len(saved.Steps)-1]
	if last.Name != "save_configuration" || last.Commands[0] != "save" || last.Result != "ok" {
		t.Fatalf("the save must appear as the job's last step: %+v", last)
	}
	// Once only.
	if _, err := svc.SaveConfig(ctx, job.ID, "bob"); !errors.Is(err, ErrState) {
		t.Fatalf("a second save must be refused: %v", err)
	}
}

func TestAutomaticSaveIsRecordedOnTheJob(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	svc.saveAfter = true
	f.onts[sn1] = 3
	job, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}, "alice")
	if err != nil {
		t.Fatal(err)
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if j, _ := svc.Get(ctx, job.ID); j.SavedAt == nil || j.SavedBy == nil || !strings.Contains(*j.SavedBy, "automatic") {
		t.Fatalf("an automatic save must be recorded: %+v", j)
	}
	if _, err := svc.SaveConfig(ctx, job.ID, "bob"); !errors.Is(err, ErrState) {
		t.Fatalf("an already auto-saved job must not be saved again: %v", err)
	}
}

func TestAddServiceInlineWithoutTemplate(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	req := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40}

	first, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	// Running the checks again must give fresh evidence: the unapplied plan is superseded, not returned stale.
	second, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("a second plan for the same inline service must be a new job")
	}
	old, err := svc.Get(ctx, first.ID)
	if err != nil || old.Status != "rejected" {
		t.Fatalf("superseded plan must be rejected, got %v %v", old, err)
	}
	done, err := svc.Apply(ctx, second.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if len(f.sps) != 1 {
		t.Fatalf("expected exactly one service-port, got %v", f.sps)
	}

	// A VLAN that the line profile does not map on that GEM is refused, with no job and no write.
	bad := PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 2190, Gem: 1, LineProfileID: 40}
	if _, err := svc.Plan(ctx, bad, "alice"); !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "does not map VLAN 2190") {
		t.Fatalf("unmapped inline VLAN must be refused: %v", err)
	}
	// Out-of-range input is refused before the OLT is touched.
	if _, err := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "add_service_port", Serial: sn1, ServiceVLAN: 5000, Gem: 1}, "alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("VLAN 5000 must be refused: %v", err)
	}
}

func TestTamperedStepIsRefused(t *testing.T) {
	svc, f, dev, tpl, ctx := setup(t)
	job, _ := svc.Plan(ctx, PlanRequest{OLTID: dev, Operation: "register_ont", Serial: sn1, Slot: 4, Port: 7, TemplateID: tpl}, "op")
	svc.db.ExecContext(ctx, `UPDATE provisioning_job_steps SET command='reboot' WHERE job_id=? AND name='ont_add'`, job.ID)
	done, err := svc.Apply(ctx, job.ID, "op")
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "failed" || !strings.Contains(done.ErrorSummary, "not an approved command") {
		t.Fatalf("status=%s summary=%q", done.Status, done.ErrorSummary)
	}
	for _, l := range f.log {
		if l == "reboot" {
			t.Fatal("tampered command reached the device")
		}
	}
}

func TestReadOnlySyncPopulatesInventory(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 0
	f.onts[sn2] = 1
	f.sps[969] = "x"
	// the OLT's profile catalogue was entered by hand earlier; sync must replace it with the live truth
	svc.db.ExecContext(ctx, `INSERT INTO olt_profiles(olt_id,profile_type,profile_id,profile_name,detail) VALUES(?,'line',99,'stale','')`, dev)

	run, err := svc.Sync(ctx, dev, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "succeeded" {
		t.Fatalf("status=%s err=%q counts=%v", run.Status, run.Error, run.Counts)
	}
	want := map[string]int{"boards": 2, "vlans": 2, "service_ports": 1, "onts": 2, "line_profiles": 2, "srv_profiles": 1, "dba_profiles": 1}
	for k, v := range want {
		if run.Counts[k] != v {
			t.Errorf("counts[%s]=%d want %d (%v)", k, run.Counts[k], v, run.Counts)
		}
	}
	var stale int
	svc.db.QueryRowContext(ctx, `SELECT count(*) FROM olt_profiles WHERE profile_id=99`).Scan(&stale)
	if stale != 0 {
		t.Error("profile removed from the OLT must leave the catalogue")
	}
	var ver string
	svc.db.QueryRowContext(ctx, `SELECT detected_version FROM olts WHERE device_id=?`, dev).Scan(&ver)
	if ver != "MA5600V800R015C00" {
		t.Errorf("version=%q", ver)
	}
	for _, l := range f.log {
		if !strings.HasPrefix(l, "display ") {
			t.Fatalf("sync issued a non-display command: %q", l)
		}
	}
	var snaps int
	svc.db.QueryRowContext(ctx, `SELECT count(*) FROM olt_snapshots WHERE olt_id=?`, dev).Scan(&snaps)
	if snaps < 8 {
		t.Errorf("only %d raw snapshots stored", snaps)
	}

	// A layout the parser does not understand must not wipe previously synced data.
	f.vlans = map[int]bool{}
	svc.roDialer = nil
	f2 := &layoutChangedOLT{fakeOLT: f}
	svc.dialer = fakeDialer2{f2}
	run2, err := svc.Sync(ctx, dev, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if run2.Status != "partial" {
		t.Fatalf("status=%s, want partial when a layout is unrecognised", run2.Status)
	}
	var vlans int
	svc.db.QueryRowContext(ctx, `SELECT count(*) FROM olt_vlans WHERE olt_id=?`, dev).Scan(&vlans)
	if vlans != 2 {
		t.Fatalf("existing VLANs were wiped (%d left)", vlans)
	}
}

type layoutChangedOLT struct{ *fakeOLT }

func (l *layoutChangedOLT) Run(ctx context.Context, c Cmd) (string, error) {
	if c.String() == "display vlan all" {
		return "completely different format\nVLAN=100;TYPE=smart\n", nil
	}
	return l.fakeOLT.Run(ctx, c)
}

type fakeDialer2 struct{ e Executor }

func (d fakeDialer2) Dial(context.Context, int64) (Executor, error) { return d.e, nil }

func TestReadOnlyExecRefusesWrites(t *testing.T) {
	f := newFake()
	ro := readOnlyExec{f}
	add, _ := OntAdd(7, 1, sn1, 4, 4, "")
	if _, err := ro.Run(context.Background(), add); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("write must be refused, got %v", err)
	}
	if len(f.log) != 0 {
		t.Fatal("refused command reached the device")
	}
}

// Untagged customer moved from VLAN 2190 to 100 on GEM 1: the old untagged service-port is removed first
// (two untagged services on one GEM conflict) and the new one is untagged too.
func TestChangeVLANUntaggedKeepsGemAndRemovesOldFirst(t *testing.T) {
	svc, f, dev, _, ctx := setup(t)
	f.onts[sn1] = 3
	f.vlans[2190] = true
	f.sps[32] = "service-port 32 vlan 2190 gpon 0/4/7 ont 3 gemport 1 multi-service user-vlan untagged tag-transform default"

	req := PlanRequest{OLTID: dev, Operation: "change_vlan", Serial: sn1, ServiceVLAN: 100, Gem: 1, LineProfileID: 40, Untagged: true, OldServicePortID: 32, OldVLAN: 2190}
	job, err := svc.Plan(ctx, req, "alice")
	if err != nil {
		t.Fatal(err)
	}
	var writes []Step
	for _, s := range job.Steps {
		if s.Kind == "write" {
			writes = append(writes, s)
		}
	}
	if len(writes) != 2 || writes[0].Name != "service_port_remove_old" || writes[1].Name != "service_port_add" {
		t.Fatalf("untagged change must remove the old service-port first: %+v", writes)
	}
	if !strings.HasSuffix(writes[1].Commands[0], "gemport 1 multi-service user-vlan untagged tag-transform default") {
		t.Fatalf("new service-port wrong: %q", writes[1].Commands[0])
	}
	if !strings.HasSuffix(writes[0].Rollback[0], "vlan 2190 gpon 0/4/7 ont 3 gemport 1 multi-service user-vlan untagged tag-transform default") {
		t.Fatalf("rollback must restore the untagged service-port: %q", writes[0].Rollback[0])
	}
	if err := svc.Approve(ctx, job.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	done, err := svc.Apply(ctx, job.ID, "alice")
	if err != nil || done.Status != "succeeded" {
		t.Fatalf("apply: %v %+v", err, done)
	}
	if _, old := f.sps[32]; old || len(f.sps) != 1 {
		t.Fatalf("expected only the new service-port, got %v", f.sps)
	}
}
