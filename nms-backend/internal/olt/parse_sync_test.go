package olt

import "testing"

func TestParseSyncTables(t *testing.T) {
	boards := ParseBoards("  SlotID  BoardName  Status        SubType0 SubType1\n  ------\n  0       H802SCUN   Active_normal CPCF\n  4       H805GPFD   Normal\n  9       H801X2CS   Normal\n")
	if len(boards) != 3 || boards[1].Name != "H805GPFD" || !IsGPONBoard(boards[1].Name) || IsGPONBoard(boards[2].Name) {
		t.Fatalf("%+v", boards)
	}

	v := ParseVLANs("  VLAN ID Type  Attribute STND-Port SERV-Port\n  1       smart common    2         0         0\n  199     smart common    1         0         0\n  2190    smart common    0         12        0\n")
	if len(v) != 3 || v[2].ID != 2190 || v[2].ServPorts != 12 {
		t.Fatalf("%+v", v)
	}

	sp := ParseServicePorts("  INDEX VLAN VLAN PORT F/ S/ P VPI VCI FLOW FLOW RX TX STATE\n  ---\n    32 2050 common gpon 0 /4 /2  6   2   vlan 2050   -   -   up\n   969  100 common gpon 0 /4 /1  56  1   vlan 100    -   -   up\n")
	if len(sp) != 2 || sp[0].Index != 32 || sp[0].VLAN != 2050 || sp[0].S != 4 || sp[0].P != 2 || sp[0].OntID != 6 || sp[0].Gem != 2 || sp[0].State != "up" {
		t.Fatalf("%+v", sp)
	}

	dba := ParseDBAProfiles("  Profile-ID  Type   Bandwidth   Fix  Assure  Max   Bind times\n  13  type3  No  0  1024  51200  5\n")
	if len(dba) != 1 || dba[0].ID != 13 || dba[0].Bindings == nil || *dba[0].Bindings != 5 {
		t.Fatalf("%+v", dba)
	}
	named := ParseNamedProfiles("  Profile-ID  Profile-name  Binding times\n  4   line-profile_4   120\n  40  LINE_PPPoE_V100  0\n")
	if len(named) != 2 || named[1].Name != "LINE_PPPoE_V100" || *named[0].Bindings != 120 {
		t.Fatalf("%+v", named)
	}

	ver, patch := ParseVersion("  VERSION : MA5600V800R015C00\n  PATCH   : SPC107\n")
	if ver != "MA5600V800R015C00" || patch != "SPC107" {
		t.Fatalf("%q %q", ver, patch)
	}
}
