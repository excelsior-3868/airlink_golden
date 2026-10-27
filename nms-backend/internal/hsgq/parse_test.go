package hsgq

import (
	"os"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("testdata/ont_info_port.txt")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParseONTTable(t *testing.T) {
	tab := ParseONTTable(fixture(t))
	if !tab.Recognised {
		t.Fatal("table not recognised")
	}
	if len(tab.Rows) != 12 {
		t.Fatalf("rows = %d, want 12 (log line and prompt must be ignored)", len(tab.Rows))
	}
	r := tab.Rows[0]
	if r.PON != 1 || r.ONU != 0 || r.SN != "4D48415206B409E3" || r.Admin != "active" ||
		r.RunState != "online" || r.ConfigState != "normal" || r.MatchState != "initial" ||
		r.DownReason != "Laser out" || r.Name != "ONT01/000" {
		t.Fatalf("row0 = %+v", r)
	}
}

func TestParseONTTableEmptyDownReason(t *testing.T) {
	var got ONTRow
	for _, r := range ParseONTTable(fixture(t)).Rows {
		if r.PON == 1 && r.ONU == 35 {
			got = r
		}
	}
	if got.SN != "48575443E4C5989D" || got.DownReason != "" || got.Name != "ONT01/035" || got.RunState != "online" {
		t.Fatalf("1/35 = %+v", got)
	}
}

func TestParseONTTableInactive(t *testing.T) {
	for _, r := range ParseONTTable(fixture(t)).Rows {
		if r.PON == 1 && r.ONU == 1 {
			if r.Admin != "inactive" || r.RunState != "initial" || r.ConfigState != "initial" || r.DownReason != "" {
				t.Fatalf("1/1 = %+v", r)
			}
			if r.SN != "47504F4E00851C18" { // "GPON" + 00851c18
				t.Fatalf("SN = %s", r.SN)
			}
			return
		}
	}
	t.Fatal("1/1 missing")
}

func TestParseONTTableEmpty(t *testing.T) {
	out := "show ont-info 7 all \n" + header + "\nGolden-Hub-Jalpa-HSGQ-Gpon-OLT(config)# \n"
	tab := ParseONTTable(out)
	if !tab.Recognised || len(tab.Rows) != 0 {
		t.Fatalf("%+v", tab)
	}
	if ParseONTTable("vty% Command incomplete.\n").Recognised {
		t.Fatal("error output must not look like an empty table")
	}
}

const header = `----------------------------------------------------------------------------------------------------
PON/ONU ONU    Serial            State     Run        Config    Match     Last Link         ONT
        Type   Number                      State      State     State     down reason       Name
----------------------------------------------------------------------------------------------------`

func TestParseONTTableEmptyPortMessage(t *testing.T) {
	// What the OLT prints for a PON with no ONTs (seen for PON 9..16 on a G08R).
	tab := ParseONTTable("show ont-info 9 all \nIn port 9 , the total of ONTs are: 0, online: 0\n\nGolden-Hub-Jalpa-HSGQ-Gpon-OLT(config)# \n")
	if !tab.Recognised || len(tab.Rows) != 0 || tab.Total != 0 {
		t.Fatalf("%+v", tab)
	}
	// A non-zero count with no rows is output we do not understand, not an empty port.
	if ParseONTTable("In port 9 , the total of ONTs are: 5, online: 5\n").Recognised {
		t.Fatal("non-empty count without rows must not count as recognised")
	}
}

func TestParseONTTableFooterTotal(t *testing.T) {
	tab := ParseONTTable(fixture(t) + "  Total: 12   Online:5  Offline:7\n")
	if tab.Total != 12 {
		t.Fatalf("Total = %d, want 12", tab.Total)
	}
	if got := ParseONTTable(fixture(t)).Total; got != -1 {
		t.Fatalf("Total without footer = %d, want -1", got)
	}
}

func TestNormalizeSN(t *testing.T) {
	cases := map[string]string{
		"HWTCc086869d":     "48575443C086869D",
		"zTEGcf50c6fc":     "7A544547CF50C6FC",
		"48575443C086869D": "48575443C086869D", // already canonical
		"48575443c086869d": "48575443C086869D",
	}
	for in, want := range cases {
		if got := NormalizeSN(in); got != want {
			t.Errorf("NormalizeSN(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseVersion(t *testing.T) {
	out := ` Software Version              : HSGQ-G08R_IGD_V1.0.13C_Rel
 System Version                : HSGQ-G08R_IGD_V2.0.1_Rel
 Product                       : HSGQ-G08R
`
	v, p := ParseVersion(out)
	if v != "HSGQ-G08R_IGD_V2.0.1_Rel" || p != "HSGQ-G08R" {
		t.Fatalf("%q %q", v, p)
	}
}

func TestIsHSGQ(t *testing.T) {
	for in, want := range map[string]bool{"HSGQ": true, "hsgq": true, " Hsgq ": true, "HSGQ Technology": true, "Huawei": false, "": false} {
		if IsVendor(in) != want {
			t.Errorf("IsVendor(%q) != %v", in, want)
		}
	}
}

func TestReadOnlyGuard(t *testing.T) {
	for _, ok := range []string{"show version", "show ont-info 1 all"} {
		if err := checkReadOnly(ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"reboot", "no ont 1 2", "ont-lineprofile x", "show version; reboot", "show version\nreboot", "configure terminal", ""} {
		if checkReadOnly(bad) == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestOntInfoPortCmd(t *testing.T) {
	if c, err := OntInfoPort(3); err != nil || c != "show ont-info 3 all" {
		t.Fatalf("%q %v", c, err)
	}
	for _, p := range []int{0, 17, -1} {
		if _, err := OntInfoPort(p); err == nil {
			t.Errorf("port %d accepted", p)
		}
	}
}

func TestMayClaim(t *testing.T) {
	const self, other = 4, 1
	owners := map[string]int64{"MINE": self, "THEIRS": other}
	online := ONTRow{RunState: "online"}
	for name, c := range map[string]struct {
		sn    string
		state string
		want  bool
	}{
		"new serial, inactive":     {"NEW", "initial", true},
		"new serial, online":       {"NEW", "online", true},
		"already ours":             {"MINE", "initial", true},
		"other OLT, HSGQ online":   {"THEIRS", online.RunState, true},
		"other OLT, only inactive": {"THEIRS", "initial", false},
		"other OLT, offline":       {"THEIRS", "offline", false},
	} {
		if got := mayClaim(owners, self, ONTRow{SN: c.sn, RunState: c.state}); got != c.want {
			t.Errorf("%s: mayClaim = %v, want %v", name, got, c.want)
		}
	}
}
