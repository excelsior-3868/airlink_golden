package olt

import (
	"errors"
	"testing"
)

func TestExpect(t *testing.T) {
	cli := &CLIError{Cmd: "x", Msg: "Failure: not found"}
	cases := []struct {
		name    string
		expect  string
		out     string
		err     error
		before  string
		wantErr bool
	}{
		{"absent ok on CLI failure", "absent", "", cli, "", false},
		{"absent fails when exists", "absent", "vlan 100", nil, "", true},
		{"ont absent", "ont_absent", "Failure: ONT does not exist", cli, "", false},
		{"ont present", "ont_present", "F/S/P : 0/4/7\nONT-ID : 3\n", nil, "", false},
		{"ont healthy", "ont_healthy", "F/S/P : 0/4/7\nRun state : offline\nConfig state : normal\nMatch state : match\n", nil, "", false},
		{"ont mismatch", "ont_healthy", "F/S/P : 0/4/7\nConfig state : normal\nMatch state : mismatch\n", nil, "", true},
		{"id in use", "ont_id_free:0", "  0/4/7    0  485754439785B59A  active online normal match no", nil, "", true},
		{"id free", "ont_id_free:5", "  0/4/7    0  485754439785B59A  active online normal match no", nil, "", false},
		{"next free changed", "next_free:969", "Next free index : 970", nil, "", true},
		{"contains", "contains:100", "vlan 100 gpon", nil, "", false},
		{"transport error propagates", "absent", "", errors.New("EOF"), "", true},
		{"preserved ok", "preserved:", "  32 vlan 2190\n  969 vlan 100", nil, "  32 vlan 2190\n", false},
		{"preserved lost", "preserved:", "  969 vlan 100", nil, "  32 vlan 2190\n", true},
		{"preserved skips replaced", "preserved:32", "  969 vlan 100", nil, "  32 vlan 2190\n", false},
	}
	for _, c := range cases {
		err := Expect(c.expect, c.out, c.err, c.before)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err=%v wantErr=%v", c.name, err, c.wantErr)
		}
	}
}

func TestReparseRoundTrip(t *testing.T) {
	good := []string{
		"display ont info by-sn 485754439785B59A",
		"display ont info 0 4 7 all",
		"interface gpon 0/4",
		`ont add 7 23 sn-auth "485754439785B59A" omci ont-lineprofile-id 4 ont-srvprofile-id 4 desc "Cust-1"`,
		"service-port 969 vlan 100 gpon 0/4/1 ont 56 gemport 2 multi-service user-vlan 100 tag-transform translate",
		"undo service-port 969",
		"save",
	}
	for _, g := range good {
		c, err := Reparse(g)
		if err != nil || c.String() != g {
			t.Errorf("reparse %q: %v %q", g, err, c.String())
		}
	}
	bad := []string{"reboot", "display current-configuration", "undo service-port 5; save", "ont add 7 23 sn-auth \"ZZ\"", "interface gpon 0/4 extra"}
	for _, b := range bad {
		if _, err := Reparse(b); err == nil {
			t.Errorf("reparse accepted %q", b)
		}
	}
}
