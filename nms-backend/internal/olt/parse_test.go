package olt

import (
	"strings"
	"testing"
)

const ontTable = `
  ------------------------------------------------------------------------------
  F/S/P   ONT         SN         Control     Run      Config   Match    Protect
          ID                     flag        state    state    state    side
  ------------------------------------------------------------------------------
  0/4/7    0  485754439785B59A  active      online   normal   match    no
  0/4/7    1  48575443AABBCCDD  active      offline  failed   mismatch no
  ------------------------------------------------------------------------------
`

func TestParseONTTable(t *testing.T) {
	rows := ParseONTTable(ontTable)
	if len(rows) != 2 {
		t.Fatalf("rows=%d", len(rows))
	}
	if rows[0].SN != "485754439785B59A" || rows[0].RunState != "online" || rows[0].MatchState != "match" {
		t.Fatalf("bad row %+v", rows[0])
	}
	if rows[1].RunState != "offline" || rows[1].ConfigState != "failed" {
		t.Fatalf("bad row %+v", rows[1])
	}
	if id, _ := FreeONTID(rows); id != 2 {
		t.Fatalf("free id=%d want 2", id)
	}
}

// Layout captured from a real MA5683T V800R015C00 SPC107: padded F/S/P ("0/ 4/4") and pager erase
// sequences glued to the start of a row after a "---- More ----" page break.
func TestParseONTTablePaddedAndPaged(t *testing.T) {
	out := "  0/ 4/4    9  48575443DB9C3AA6  active      online   normal   match    no \n" +
		"  0/ 4/4   11  44463144A6B570A1  active      offline  initial  initial  no \n" +
		"\x1b[37D                                     \x1b[37D  0/ 4/4   27  45434F4D103E8F9B  active      online   normal   match    no \n"
	rows := ParseONTTable(out)
	if len(rows) != 3 {
		t.Fatalf("rows=%d want 3: %+v", len(rows), rows)
	}
	if rows[0].F != 0 || rows[0].S != 4 || rows[0].P != 4 || rows[0].OntID != 9 || rows[0].SN != "48575443DB9C3AA6" {
		t.Fatalf("bad row %+v", rows[0])
	}
	if rows[2].OntID != 27 || rows[2].SN != "45434F4D103E8F9B" || rows[2].RunState != "online" {
		t.Fatalf("bad paged row %+v", rows[2])
	}
	if ONTIDInUse(rows, 9) == false || ONTIDInUse(rows, 10) {
		t.Fatal("ONTIDInUse wrong")
	}
}

// Captured from line profile 4 ("FTTH") on a live MA5683T. The pager split GEM 2's table after its first
// row and glued the erase sequence plus the next rows to the page-break text.
const lineProfile4 = `  Profile-ID          :4
  <T-CONT   0>          DBA Profile-ID:1
  <T-CONT   4>          DBA Profile-ID:10
   <Gem Index 2>
   --------------------------------------------------------------------
   |Serv-Type:ETH |Encrypt:off |Cascade:off |GEM-CAR:-            |
   --------------------------------------------------------------------
    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent
    index                  type    ID    ID      CAR
   --------------------------------------------------------------------
    0       2208  -        -       -     -       -     -
` + "\x1b[37D                                     \x1b[37D" + `    1       2050  -        -       -     -       -     -
    2       100   -        -       -     -       -     -
   --------------------------------------------------------------------
   <Gem Index 3>
    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent
    index                  type    ID    ID      CAR
   --------------------------------------------------------------------
    0       39    -        -       -     -       -     -
   --------------------------------------------------------------------
   <Gem Index 4>
  Binding times       :1249
`

func TestParseLineProfileMapping(t *testing.T) {
	m := ParseLineProfileMapping(lineProfile4)
	if got := m[2]; len(got) != 3 || got[0] != 2208 || got[1] != 2050 || got[2] != 100 {
		t.Fatalf("GEM 2 = %v", got)
	}
	if got := m[3]; len(got) != 1 || got[0] != 39 {
		t.Fatalf("GEM 3 = %v", got)
	}
	if len(m[4]) != 0 {
		t.Fatalf("GEM 4 should map nothing: %v", m[4])
	}
	if !gemMapsVLAN(m, 2, 100) || gemMapsVLAN(m, 2, 2190) || gemMapsVLAN(m, 3, 100) {
		t.Fatal("gemMapsVLAN wrong")
	}
	if err := Expect("gem_maps:2:100", lineProfile4, nil, ""); err != nil {
		t.Fatalf("VLAN 100 on GEM 2 should pass: %v", err)
	}
	if err := Expect("gem_maps:2:2190", lineProfile4, nil, ""); err == nil {
		t.Fatal("VLAN 2190 is not mapped and must fail")
	}
}

func TestExpectNoVLAN(t *testing.T) {
	real := "    1041 2050 common   gpon 0/4 /8  74   2     vlan  2050       -    -    up   \n" +
		"    1941  100 common   gpon 0/4 /8  74   2     vlan  100        -    -    up   \n"
	if err := Expect("no_vlan:2190", real, nil, ""); err != nil {
		t.Fatalf("2190 is absent, must pass: %v", err)
	}
	if err := Expect("no_vlan:100", real, nil, ""); err == nil || !strings.Contains(err.Error(), "1941") {
		t.Fatalf("100 is present, must fail and name service-port 1941: %v", err)
	}
	if err := Expect("no_vlan:100", "", &CLIError{Cmd: "x", Msg: "Failure: no service virtual port"}, ""); err != nil {
		t.Fatalf("an ONT with no service-ports must pass: %v", err)
	}
}

func TestUntaggedServicePortCommandAndReparse(t *testing.T) {
	c, err := ServicePortAdd(ServicePort{ID: 494, VLAN: 100, F: 0, S: 2, P: 2, OntID: 56, Gem: 2, Untagged: true, Transform: "default"})
	want := "service-port 494 vlan 100 gpon 0/2/2 ont 56 gemport 2 multi-service user-vlan untagged tag-transform default"
	if err != nil || c.String() != want || !c.IsWrite() {
		t.Fatalf("%q %v", c.String(), err)
	}
	if _, err := ServicePortAdd(ServicePort{ID: 494, VLAN: 100, S: 2, P: 2, OntID: 56, Gem: 2, Untagged: true, Transform: "translate"}); err == nil {
		t.Fatal("untagged with translate must be refused")
	}
	tagged, err := ServicePortAdd(ServicePort{ID: 1941, VLAN: 100, S: 4, P: 8, OntID: 74, Gem: 2, UserVLAN: 100, Transform: "translate"})
	if err != nil || tagged.String() != "service-port 1941 vlan 100 gpon 0/4/8 ont 74 gemport 2 multi-service user-vlan 100 tag-transform translate" {
		t.Fatalf("%q %v", tagged.String(), err)
	}
	// Stored job steps are re-validated before they run: both forms must round-trip, nothing else may.
	for _, line := range []string{want, tagged.String(), "display ont info 0 4 8 74", "display ont-lineprofile gpon profile-id 4"} {
		if r, err := Reparse(line); err != nil || r.String() != line {
			t.Fatalf("reparse %q: %v", line, err)
		}
	}
	if _, err := Reparse("service-port 494 vlan 100 gpon 0/2/2 ont 56 gemport 2 multi-service user-vlan untagged tag-transform translate"); err == nil {
		t.Fatal("untagged + translate must not reparse")
	}
}

func TestIsSyntaxErrorAndFreeIndexFallback(t *testing.T) {
	syntax := &CLIError{Cmd: "x", Msg: "% Unknown command, the error locates at '^'"}
	notFound := &CLIError{Cmd: "x", Msg: "Failure: The ONT does not exist"}
	if !IsSyntaxError(syntax) || IsSyntaxError(notFound) || IsSyntaxError(nil) {
		t.Fatal("IsSyntaxError must only match command-syntax rejections")
	}
	rows := []ServicePortRow{{Index: 0}, {Index: 1}, {Index: 3}, {Index: 1951}}
	if id, err := LowestFreeServicePort(rows); err != nil || id != 2 {
		t.Fatalf("must find the gap, got %d %v", id, err)
	}
}

func TestNewExpectations(t *testing.T) {
	table := "    1041 2050 common   gpon 0/4 /8  74   2     vlan  2050       -    -    up   \n" +
		"    1942  100 common   gpon 0/4 /8  74   2     untag -          -    -    up   \n"
	cases := []struct {
		expect string
		out    string
		ok     bool
	}{
		{"sp_free:1943", table, true}, {"sp_free:1041", table, false},
		{"sp_listed:1942:100", table, true}, {"sp_listed:1942:2050", table, false}, {"sp_listed:5:100", table, false},
		{"no_untagged_gem:3", table, true}, {"no_untagged_gem:2", table, false},
		{"vlan_port:0/9/1", "  Standard ports: 0 /9 /1\n", true}, {"vlan_port:0/9/1", "  ports 0/9/10 and 10/9/1\n", false},
		{"ont_at:485754439785B59A", "F/S/P : 0/4/7\nSN : 485754439785B59A (HWTC-9785B59A)\n", true},
		{"ont_at:485754439785B59A", "F/S/P : 0/4/7\nSN : 48575443AABBCCDD (HWTC-AABBCCDD)\n", false},
		{"ont_at:485754439785B59A", "F/S/P : 0/4/7\nONT-ID : 3\n", true}, // no SN line: the by-sn lookup already matched
		{"ont_at:485754439785B59A", "Failure: ONT does not exist", false},
	}
	for _, c := range cases {
		if err := Expect(c.expect, c.out, nil, ""); (err == nil) != c.ok {
			t.Errorf("%s on %q: ok=%v err=%v", c.expect, c.out, c.ok, err)
		}
	}
}

func TestDisplayLineProfileValidated(t *testing.T) {
	c, err := DisplayLineProfile(4)
	if err != nil || c.String() != "display ont-lineprofile gpon profile-id 4" || c.IsWrite() {
		t.Fatalf("%v %v", c, err)
	}
	if _, err := DisplayLineProfile(-1); err == nil {
		t.Fatal("negative id must be rejected")
	}
}

func TestParseONTDetail(t *testing.T) {
	d := ParseONTDetail("  F/S/P                 : 0/4/7\n  ONT-ID                : 23\n  Control flag          : active\n  Run state             : online\n  Config state          : normal\n  Match state           : match\n")
	if !d.Found || d.F != 0 || d.S != 4 || d.P != 7 || d.OntID != 23 || d.RunState != "online" || d.MatchState != "match" {
		t.Fatalf("%+v", d)
	}
	if ParseONTDetail("Failure: The ONT does not exist").Found {
		t.Fatal("must not report found")
	}
}

func TestParseAutofindAndMisc(t *testing.T) {
	a := ParseAutofind("  Number              : 1\n  F/S/P               : 0/4/7\n  Ont SN              : 485754439785B59A (HWTC-9785B59A)\n")
	if len(a) != 1 || a[0].SN != "485754439785B59A" || a[0].P != 7 {
		t.Fatalf("%+v", a)
	}
	if n, err := ParseNextFreeIndex("  Next free index : 969"); err != nil || n != 969 {
		t.Fatalf("%d %v", n, err)
	}
	if v, ok := ParseRxPower("Rx optical power(dBm)   : -18.52"); !ok || v != -18.52 {
		t.Fatalf("%v %v", v, ok)
	}
}

func TestCommandBuildersValidate(t *testing.T) {
	c, err := OntAdd(7, 23, "485754439785b59a", 4, 4, "Customer-001")
	if err != nil {
		t.Fatal(err)
	}
	want := `ont add 7 23 sn-auth "485754439785B59A" omci ont-lineprofile-id 4 ont-srvprofile-id 4 desc "Customer-001"`
	if c.String() != want {
		t.Fatalf("got %q", c.String())
	}
	// injection attempts must be rejected, never reach the device
	if _, err := OntAdd(7, 23, "485754439785B59A", 4, 4, `x"; undo service-port 1`); err == nil {
		t.Fatal("description injection accepted")
	}
	if _, err := DisplayONTBySN("48575443\nsave"); err == nil {
		t.Fatal("serial injection accepted")
	}
	if _, err := ServicePortAdd(ServicePort{ID: 1, VLAN: 5000, F: 0, S: 4, P: 1, OntID: 1, Gem: 1, UserVLAN: 100, Transform: "translate"}); err == nil {
		t.Fatal("bad vlan accepted")
	}
	sp, err := ServicePortAdd(ServicePort{ID: 969, VLAN: 100, F: 0, S: 4, P: 1, OntID: 56, Gem: 2, UserVLAN: 100, Transform: "translate"})
	if err != nil || sp.String() != "service-port 969 vlan 100 gpon 0/4/1 ont 56 gemport 2 multi-service user-vlan 100 tag-transform translate" {
		t.Fatalf("%v %q", err, sp.String())
	}
}

func TestOutputError(t *testing.T) {
	if OutputError("  Failure: VLAN does not exist\n") == "" {
		t.Fatal("failure not detected")
	}
	if OutputError("  % Unknown command, the error locates at '^'\n") == "" {
		t.Fatal("unknown command not detected")
	}
	if OutputError("  Run state : online\n") != "" {
		t.Fatal("false positive")
	}
}
