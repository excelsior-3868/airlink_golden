package olt

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Parsers for the read-only inventory sync. The layouts below are the usual MA5600T-family table
// layouts but have NOT been validated against a live MA5683T SPC107 yet. Every parser is tolerant
// (rows that do not match are skipped), and the sync always stores the raw output next to the parsed
// rows so a layout difference is visible in the console instead of silently losing data.

type Board struct {
	Slot   int
	Name   string
	Status string
}

// `display board 0`:  "  4       H805GPFD   Normal"
var boardRe = regexp.MustCompile(`(?m)^\s*(\d+)\s+([A-Za-z][A-Za-z0-9]{4,})\s+(\S+)`)

func ParseBoards(out string) []Board {
	var res []Board
	for _, m := range boardRe.FindAllStringSubmatch(out, -1) {
		slot, _ := strconv.Atoi(m[1])
		res = append(res, Board{Slot: slot, Name: m[2], Status: m[3]})
	}
	return res
}

// IsGPONBoard recognises GPON service boards (H805GPFD, H802GPBD, ...).
func IsGPONBoard(name string) bool {
	return strings.Contains(strings.ToUpper(name), "GP")
}

type VLANRow struct {
	ID        int
	Type      string
	Attribute string
	StdPorts  int
	ServPorts int
}

// `display vlan all`:  "  100     smart        common      2     3     0"
var vlanRe = regexp.MustCompile(`(?m)^\s*(\d+)\s+(smart|mux|standard|super)\s+(\w+)\s+(\d+)\s+(\d+)`)

func ParseVLANs(out string) []VLANRow {
	var res []VLANRow
	for _, m := range vlanRe.FindAllStringSubmatch(out, -1) {
		r := VLANRow{Type: m[2], Attribute: m[3]}
		r.ID, _ = strconv.Atoi(m[1])
		r.StdPorts, _ = strconv.Atoi(m[4])
		r.ServPorts, _ = strconv.Atoi(m[5])
		res = append(res, r)
	}
	return res
}

type ServicePortRow struct {
	Index     int
	VLAN      int
	Attribute string
	F, S, P   int
	OntID     int
	Gem       int
	FlowType  string
	FlowPara  string
	State     string
}

// `display service-port all`:
//
//	32  2050 common gpon 0 /4 /2  6   2   vlan 2050   -   -   up
var spRe = regexp.MustCompile(`(?m)^\s*(\d+)\s+(\d+)\s+(\w+)\s+gpon\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\S+)\s+\S+\s+\S+\s+(\w+)`)

func ParseServicePorts(out string) []ServicePortRow {
	var res []ServicePortRow
	for _, m := range spRe.FindAllStringSubmatch(out, -1) {
		r := ServicePortRow{Attribute: m[3], FlowType: m[9], FlowPara: m[10], State: m[11]}
		r.Index, _ = strconv.Atoi(m[1])
		r.VLAN, _ = strconv.Atoi(m[2])
		r.F, _ = strconv.Atoi(m[4])
		r.S, _ = strconv.Atoi(m[5])
		r.P, _ = strconv.Atoi(m[6])
		r.OntID, _ = strconv.Atoi(m[7])
		r.Gem, _ = strconv.Atoi(m[8])
		res = append(res, r)
	}
	return res
}

type ProfileRow struct {
	ID       int
	Name     string
	Bindings *int
	Detail   string
}

// DBA list:   "  13  type3  No   0   1024  51200   5"
var dbaRe = regexp.MustCompile(`(?m)^\s*(\d+)\s+(type\d)\b(.*)$`)

// Line/service list:  "  40   LINE_PPPoE_V100   12"
var namedProfileRe = regexp.MustCompile(`(?m)^\s*(\d+)\s+(\S+)\s+(\d+)\s*$`)

// The MA5683T writes the type as a plain number:
//
//	"           1      1           No       5120          0             0         1"
//	 id  type  bandwidth-compensation  fix  assure  max  bind-times
var dbaNumRe = regexp.MustCompile(`(?im)^\s*(\d+)\s+(\d)\s+(yes|no)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$`)

func ParseDBAProfiles(out string) []ProfileRow {
	var res []ProfileRow
	for _, m := range dbaNumRe.FindAllStringSubmatch(out, -1) {
		id, _ := strconv.Atoi(m[1])
		bind, _ := strconv.Atoi(m[7])
		res = append(res, ProfileRow{ID: id, Name: "type" + m[2], Bindings: &bind,
			Detail: fmt.Sprintf("type%s comp=%s fix=%s assure=%s max=%s", m[2], m[3], m[4], m[5], m[6])})
	}
	for _, m := range dbaRe.FindAllStringSubmatch(out, -1) {
		id, _ := strconv.Atoi(m[1])
		row := ProfileRow{ID: id, Name: m[2], Detail: strings.Join(strings.Fields(m[2]+" "+m[3]), " ")}
		if f := strings.Fields(m[3]); len(f) > 0 {
			if n, err := strconv.Atoi(f[len(f)-1]); err == nil {
				row.Bindings = &n
			}
		}
		res = append(res, row)
	}
	return res
}

func ParseNamedProfiles(out string) []ProfileRow {
	var res []ProfileRow
	for _, m := range namedProfileRe.FindAllStringSubmatch(out, -1) {
		id, _ := strconv.Atoi(m[1])
		n, _ := strconv.Atoi(m[3])
		res = append(res, ProfileRow{ID: id, Name: m[2], Bindings: &n})
	}
	return res
}

var (
	verRe   = regexp.MustCompile(`(?im)^\s*VERSION\s*:\s*(\S+)`)
	patchRe = regexp.MustCompile(`(?im)^\s*PATCH\s*:\s*(\S+)`)
)

func ParseVersion(out string) (version, patch string) {
	if m := verRe.FindStringSubmatch(out); m != nil {
		version = m[1]
	}
	if m := patchRe.FindStringSubmatch(out); m != nil {
		patch = m[1]
	}
	return
}
