package olt

import (
	"strings"
	"testing"
)

// Output captured from a live Huawei MA5683T V800R015C00 SPC107 (Bijule OLT), read-only commands, trimmed.
// Fakes cannot catch format mistakes; these did: the free-index wording, the "Total" footer, the uplink table.

const realByPos = `display ont info 0 4 8 74
  -----------------------------------------------------------------------------
  F/S/P                   : 0/4/8
  ONT-ID                  : 74
  Control flag            : active
  Run state               : online
  Config state            : normal
  Match state             : match
  SN                      : 48575443AA960FC8 (HWTC-AA960FC8)
  Description             : 48575443AA960FC8
  -----------------------------------------------------------------------------
  Line profile ID      : 4
  Line profile name    : FTTH
  -----------------------------------------------------------------------------
  <T-CONT   0>          DBA Profile-ID:1
   <Gem Index 2>
    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent
    index                  type    ID    ID      CAR
    0       2208  -        -       -     -       -     -
    1       2050  -        -       -     -       -     -
    2       100   -        -       -     -       -     -
   <Gem Index 3>
    Mapping VLAN  Priority Port    Port  Bundle  Flow  Transparent
    0       39    -        -       -     -       -     -
  -----------------------------------------------------------------------------
  Service profile ID   : 4
  Service profile name : FTTH
`

const realSPPort = `{ <cr>|e2e<K>|gemport<K>|sort-by<K> }:

  Command:
          display service-port port 0/4/8 ont 74
  Switch-Oriented Flow List
  -----------------------------------------------------------------------------
   INDEX VLAN VLAN     PORT F/ S/ P VPI  VCI   FLOW  FLOW       RX   TX   STATE
         ID   ATTR     TYPE                    TYPE  PARA
  -----------------------------------------------------------------------------
    1041 2050 common   gpon 0/4 /8  74   2     vlan  2050       -    -    up
    1042 2208 common   gpon 0/4 /8  74   2     vlan  2208       -    -    up
    1941  100 common   gpon 0/4 /8  74   2     vlan  100        -    -    up
  -----------------------------------------------------------------------------
   Total : 3  (Up/Down :    3/0)
`

const realVLAN100 = `  VLAN ID: 100
  VLAN type: smart
  -------------------------------
   F /S /P     Native VLAN  State
  -------------------------------
   0 /9 /1               1  up
  -------------------------------
  Standard port number: 1
  -----------------------------------------------------------
   INDEX  TYPE  STATE F /S /P   VPI  VCI   FLOWTYPE FLOWPARA
  -----------------------------------------------------------
      32  gpon  up    0 /4 /2   6    2     vlan     100
    1941  gpon  up    0 /4 /8   74   2     vlan     100
  -----------------------------------------------------------
  Service virtual port number: 21
`

func dropLine(s, contains string) string {
	var keep []string
	for _, l := range strings.Split(s, "\n") {
		if !strings.Contains(strings.Join(strings.Fields(l), " "), contains) {
			keep = append(keep, l)
		}
	}
	return strings.Join(keep, "\n")
}

func TestRealNextFreeIndexWording(t *testing.T) {
	if id, err := ParseNextFreeIndex("  Next valid free service virtual port ID: 1954\n\nBijule-Olt-hauwei#"); err != nil || id != 1954 {
		t.Fatalf("real wording: %d %v", id, err)
	}
	if id, err := ParseNextFreeIndex("Next free index : 969"); err != nil || id != 969 {
		t.Fatalf("older wording: %d %v", id, err)
	}
	if _, err := ParseNextFreeIndex("Failure: nothing here"); err == nil {
		t.Fatal("text without a number must not parse")
	}
}

func TestRealONTInfoGivesPositionSerialAndProfileID(t *testing.T) {
	d := ParseONTDetail(realByPos)
	if !d.Found || d.F != 0 || d.S != 4 || d.P != 8 || d.OntID != 74 {
		t.Fatalf("position: %+v", d)
	}
	if d.SN != "48575443AA960FC8" {
		t.Fatalf("serial: %q", d.SN)
	}
	if d.LineProfile != "4" || d.SrvProfile != "4" {
		t.Fatalf("the numeric profile ID must win over the name that follows it: line=%q srv=%q", d.LineProfile, d.SrvProfile)
	}
	if err := Expect("ont_at:48575443AA960FC8", realByPos, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := Expect("ont_at:48575443AAAAAAAA", realByPos, nil, ""); err == nil {
		t.Fatal("a different serial at that position must fail")
	}
	// The ONT's own output carries its line profile's GEM table, so the mapping can be read from it too.
	m := ParseLineProfileMapping(realByPos)
	if !gemMapsVLAN(m, 2, 100) || gemMapsVLAN(m, 2, 2190) || !gemMapsVLAN(m, 3, 39) {
		t.Fatalf("mapping: %v", m)
	}
}

func TestRealServicePortListing(t *testing.T) {
	rows := ParseServicePorts(realSPPort)
	if len(rows) != 3 || rows[2].Index != 1941 || rows[2].VLAN != 100 || rows[2].Gem != 2 || rows[2].OntID != 74 || rows[2].State != "up" {
		t.Fatalf("rows: %+v", rows)
	}
	if err := Expect("no_vlan:2190", realSPPort, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := Expect("no_vlan:100", realSPPort, nil, ""); err == nil || !strings.Contains(err.Error(), "1941") {
		t.Fatalf("VLAN 100 already there: %v", err)
	}
	if err := Expect("sp_listed:1941:100", realSPPort, nil, ""); err != nil {
		t.Fatal(err)
	}
}

// The bug the real output exposed: the table footer "Total : N" changes when a service-port is added, so
// comparing every line made a correct change look like it damaged existing services.
func TestRealPreservedIgnoresTheTotalFooter(t *testing.T) {
	after := strings.Replace(realSPPort, "   Total : 3  (Up/Down :    3/0)",
		"    1954 2190 common   gpon 0/4 /8  74   2     vlan  2190       -    -    up   \n   Total : 4  (Up/Down :    4/0)", 1)
	if err := Expect("preserved:", after, nil, realSPPort); err != nil {
		t.Fatalf("adding a service-port must not look like damage: %v", err)
	}
	removed := dropLine(after, "1042 2208")
	if removed == after {
		t.Fatal("test setup: the row was not removed")
	}
	if err := Expect("preserved:", removed, nil, realSPPort); err == nil || !strings.Contains(err.Error(), "1042") {
		t.Fatalf("a missing existing service-port must be caught and named: %v", err)
	}
	// A service-port that merely went down is still the same service.
	down := strings.Replace(after, "2050       -    -    up", "2050       -    -    down", 1)
	if down == after {
		t.Fatal("test setup: the state column was not changed")
	}
	if err := Expect("preserved:", down, nil, realSPPort); err != nil {
		t.Fatalf("a state change is not a removed service: %v", err)
	}
	// Change-VLAN deliberately removes one service-port.
	if err := Expect("preserved:1042", removed, nil, realSPPort); err != nil {
		t.Fatalf("the service-port being replaced is skipped: %v", err)
	}
}

// Guide, Part 1 step 5: after registering, the ONT must be on the intended port with the intended profiles.
func TestRealRegistrationVerification(t *testing.T) {
	if err := Expect("ont_registered_at:0/4/8:4:4", realByPos, nil, ""); err != nil {
		t.Fatalf("matching port and profiles: %v", err)
	}
	for _, c := range []struct{ expect, want string }{
		{"ont_registered_at:0/4/9:4:4", "registered on 0/4/8, not on 0/4/9"},
		{"ont_registered_at:0/4/8:5:4", "line profile 4 is assigned, not 5"},
		{"ont_registered_at:0/4/8:4:7", "service profile 4 is assigned, not 7"},
	} {
		if err := Expect(c.expect, realByPos, nil, ""); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: want error containing %q, got %v", c.expect, c.want, err)
		}
	}
	// An ONT that is not powered on yet is registered with state offline/initial: not a failure.
	offline := strings.NewReplacer("online", "offline", "normal", "initial", "match", "initial").Replace(realByPos)
	if err := Expect("ont_registered_at:0/4/8:4:4", offline, nil, ""); err != nil {
		t.Fatalf("an offline ONT is still registered: %v", err)
	}
	if err := Expect("ont_registered_at:0/4/8:4:4", "Failure: The ONT does not exist", nil, ""); err == nil {
		t.Fatal("an ONT that was not registered must fail")
	}
}

// Guide, Part 1 step 1: autofind lists the new ONT with its F/S/P.
func TestAutofindExpectation(t *testing.T) {
	out := "  -----------------------------\n  Number              : 1\n  F/S/P               : 0/4/15\n  Ont SN              : 485754439727CD9A (HWTC-9727CD9A)\n" +
		"  -----------------------------\n  Number              : 2\n  F/S/P               : 0/ 4/ 9\n  Ont SN              : 48575443AAE18AC8 (HWTC-AAE18AC8)\n"
	if err := Expect("autofind_at:485754439727CD9A:0/4/15", out, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := Expect("autofind_at:48575443AAE18AC8:0/4/9", out, nil, ""); err != nil {
		t.Fatalf("a padded F/S/P must still be read: %v", err)
	}
	if err := Expect("autofind_at:485754439727CD9A:0/4/7", out, nil, ""); err == nil || !strings.Contains(err.Error(), "detected this ONT on 0/4/15") {
		t.Fatalf("wrong port: %v", err)
	}
	if err := Expect("autofind_at:48575443FFFFFFFF:0/4/15", out, nil, ""); err == nil || !strings.Contains(err.Error(), "check the optical connection") {
		t.Fatalf("not listed must give the guide's advice: %v", err)
	}
	none := &CLIError{Cmd: "display ont autofind all", Msg: "Failure: The automatically found ONTs do not exist"}
	if err := Expect("autofind_at:485754439727CD9A:0/4/15", "", none, ""); err == nil {
		t.Fatal("empty autofind must fail")
	}
	if err := Expect("autofind_optional", "", none, ""); err != nil {
		t.Fatalf("optional autofind never fails: %v", err)
	}
}

func TestRealVLANUplinkTable(t *testing.T) {
	if got := UplinkPorts(realVLAN100); len(got) != 1 || got[0] != "0/9/1 (up)" {
		t.Fatalf("uplinks: %v", got)
	}
	if err := Expect("vlan_port:0/9/1", realVLAN100, nil, ""); err != nil {
		t.Fatal(err)
	}
	// 0/4/2 is a PON port that has VLAN 100 service-ports, not an uplink: it must not satisfy the check.
	if err := Expect("vlan_port:0/4/2", realVLAN100, nil, ""); err == nil {
		t.Fatal("a PON port listed under the VLAN's service-ports is not an uplink")
	}
	if err := Expect("vlan_has_uplink", realVLAN100, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := Expect("vlan_has_uplink", strings.Replace(realVLAN100, "Standard port number: 1", "Standard port number: 0", 1), nil, ""); err == nil {
		t.Fatal("a VLAN with no standard port does not reach the uplink")
	}
}

// Captured from a live MA5683T: the DBA profile type is a plain number, not "type3", which made every sync "partial".
const realDBAProfiles = `{ <cr>|detail<K> }:

  Command:
          display dba-profile all 
  ----------------------------------------------------------------------------
  Profile-ID   type   Bandwidth      Fix        Assure        Max        Bind
                     compensation    (kbps)     (kbps)        (kbps)     times
  ----------------------------------------------------------------------------
           0      3           No          0       8192         20480         1
           1      1           No       5120          0             0         1
           4      1           No    1024000          0             0         0
          10      4           No          0          0       1024000         1
  ----------------------------------------------------------------------------
`

func TestRealDBAProfiles(t *testing.T) {
	rows := ParseDBAProfiles(realDBAProfiles)
	if len(rows) != 4 {
		t.Fatalf("want 4 profiles, got %d: %+v", len(rows), rows)
	}
	if rows[0].ID != 0 || rows[0].Name != "type3" || rows[0].Bindings == nil || *rows[0].Bindings != 1 {
		t.Fatalf("first row: %+v", rows[0])
	}
	if last := rows[3]; last.ID != 10 || last.Bindings == nil || *last.Bindings != 1 || !strings.Contains(last.Detail, "max=1024000") {
		t.Fatalf("last row: %+v", last)
	}
	// The older layout still parses.
	if old := ParseDBAProfiles("  13  type3  No  0  1024  51200  5\n"); len(old) != 1 || old[0].ID != 13 {
		t.Fatalf("old layout: %+v", old)
	}
}
