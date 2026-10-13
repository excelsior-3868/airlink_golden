package olt

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ONTRow is one line of `display ont info <f> <s> <p> all`.
type ONTRow struct {
	F, S, P     int
	OntID       int
	SN          string
	ControlFlag string
	RunState    string
	ConfigState string
	MatchState  string
}

// Row layout assumed (field manual section 6.6):
//
//	0/4/7    0  485754439785B59A  active  online  normal  match  no
//
// The MA5683T pads the numbers to fixed width ("0/ 4/4   10  ..."), so spaces are allowed after the slashes.
var ontRowRe = regexp.MustCompile(`(\d+)/\s*(\d+)/\s*(\d+)\s+(\d+)\s+([0-9A-Fa-f]{16})\s+(\w+)\s+(\w+)\s+(\w+)\s+(\w+)`)

func ParseONTTable(out string) []ONTRow {
	var rows []ONTRow
	for _, m := range ontRowRe.FindAllStringSubmatch(out, -1) {
		r := ONTRow{SN: strings.ToUpper(m[5]), ControlFlag: m[6], RunState: m[7], ConfigState: m[8], MatchState: m[9]}
		r.F, _ = strconv.Atoi(m[1])
		r.S, _ = strconv.Atoi(m[2])
		r.P, _ = strconv.Atoi(m[3])
		r.OntID, _ = strconv.Atoi(m[4])
		rows = append(rows, r)
	}
	return rows
}

// ONTDetail is the key/value form printed by `display ont info by-sn <SN>`.
type ONTDetail struct {
	Found       bool
	F, S, P     int
	OntID       int
	ControlFlag string
	RunState    string
	ConfigState string
	MatchState  string
	SN          string // 16 hex characters, when the output carries an SN line
	LineProfile string
	SrvProfile  string
}

var snFieldRe = regexp.MustCompile(`[0-9A-F]{16}`)

// IsSyntaxError reports whether the OLT rejected the command's syntax (as opposed to answering "not found"),
// which is when the field guide says to check the command help and use the form this release supports.
func IsSyntaxError(err error) bool {
	var c *CLIError
	if !errors.As(err, &c) {
		return false
	}
	return syntaxRe.MatchString(c.Msg)
}

var syntaxRe = regexp.MustCompile(`(?i)unknown command|parameter error|incomplete command|too many parameters|ambiguous command|invalid (input|parameter)`)

// LowestFreeServicePort picks the lowest service-port index that no row uses. It is the fallback when
// `display service-port next-free-index` is not supported: it checks the whole table for gaps, as the guide
// says, instead of trusting the largest visible index.
func LowestFreeServicePort(rows []ServicePortRow) (int, error) {
	used := make(map[int]bool, len(rows))
	for _, r := range rows {
		used[r.Index] = true
	}
	for i := 0; i <= 65534; i++ {
		if !used[i] {
			return i, nil
		}
	}
	return 0, errors.New("no free service-port index")
}

// IsUntaggedFlow reports whether a service-port row classifies untagged customer traffic.
func IsUntaggedFlow(r ServicePortRow) bool {
	return strings.Contains(strings.ToLower(r.FlowType), "untag") || strings.Contains(strings.ToLower(r.FlowPara), "untag")
}

var kvRe = regexp.MustCompile(`(?m)^\s*([A-Za-z][A-Za-z /\-\(\)]*?)\s*:\s*(.+?)\s*$`)

func ParseONTDetail(out string) ONTDetail {
	d := ONTDetail{}
	for _, m := range kvRe.FindAllStringSubmatch(out, -1) {
		k, v := strings.ToLower(strings.TrimSpace(m[1])), strings.TrimSpace(m[2])
		switch k {
		case "f/s/p":
			if fsp := strings.Split(v, "/"); len(fsp) == 3 {
				d.F, _ = strconv.Atoi(fsp[0])
				d.S, _ = strconv.Atoi(fsp[1])
				d.P, _ = strconv.Atoi(fsp[2])
				d.Found = true
			}
		case "ont-id":
			d.OntID, _ = strconv.Atoi(v)
		case "control flag":
			d.ControlFlag = v
		case "run state":
			d.RunState = v
		case "config state":
			d.ConfigState = v
		case "match state":
			d.MatchState = v
		case "sn", "ont sn", "serial number":
			if m := snFieldRe.FindString(strings.ToUpper(v)); m != "" {
				d.SN = m
			}
		case "line profile id":
			d.LineProfile = v // the numeric ID wins over the name, which the OLT prints right after it
		case "line profile name":
			if d.LineProfile == "" {
				d.LineProfile = v
			}
		case "service profile id":
			d.SrvProfile = v
		case "service profile name":
			if d.SrvProfile == "" {
				d.SrvProfile = v
			}
		}
	}
	return d
}

var (
	gemHeaderRe = regexp.MustCompile(`<\s*Gem Index\s+(\d+)\s*>`)
	gemRowRe    = regexp.MustCompile(`^\s*(\d+)\s+(\d{1,4})\s+\S+\s+\S+`)
	escSeqRe    = regexp.MustCompile(`\x1b\[\d+D`)
)

// ParseLineProfileMapping reads `display ont-lineprofile gpon profile-id N` and returns, per GEM index,
// the VLANs mapped to it:
//
//	<Gem Index 2>
//	 Mapping VLAN  Priority Port ...
//	 0       2208  -        -    ...
//
// Pager erase sequences are stripped; a row that follows a "---- More ----" page break is still read.
func ParseLineProfileMapping(out string) map[int][]int {
	res := map[int][]int{}
	gem := -1
	for _, line := range strings.Split(escSeqRe.ReplaceAllString(out, ""), "\n") {
		if m := gemHeaderRe.FindStringSubmatch(line); m != nil {
			gem, _ = strconv.Atoi(m[1])
			continue
		}
		if gem < 0 {
			continue
		}
		if m := gemRowRe.FindStringSubmatch(line); m != nil {
			v, _ := strconv.Atoi(m[2])
			res[gem] = append(res[gem], v)
		}
	}
	return res
}

// AutofindONT is a discovered-but-unregistered ONT from `display ont autofind all`.
type AutofindONT struct {
	F, S, P int
	SN      string
}

var (
	afFSPRe = regexp.MustCompile(`(?i)F/S/P\s*:\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)`)
	afSNRe  = regexp.MustCompile(`(?i)Ont SN\s*:\s*([0-9A-Fa-f]{16})`)
)

func ParseAutofind(out string) []AutofindONT {
	var res []AutofindONT
	var cur *AutofindONT
	for _, line := range strings.Split(out, "\n") {
		if m := afFSPRe.FindStringSubmatch(line); m != nil {
			res = append(res, AutofindONT{})
			cur = &res[len(res)-1]
			cur.F, _ = strconv.Atoi(m[1])
			cur.S, _ = strconv.Atoi(m[2])
			cur.P, _ = strconv.Atoi(m[3])
		}
		if m := afSNRe.FindStringSubmatch(line); m != nil && cur != nil {
			cur.SN = strings.ToUpper(m[1])
		}
	}
	out2 := res[:0]
	for _, a := range res {
		if a.SN != "" {
			out2 = append(out2, a)
		}
	}
	return out2
}

// Real MA5683T wording is "Next valid free service virtual port ID: 1954"; older text says "... index : 969".
var idxRe = regexp.MustCompile(`(?i)(?:index|free[^\n:]*\bid)[^\d\n]*?(\d+)`)

// ParseNextFreeIndex reads `display service-port next-free-index` ("... : 969").
func ParseNextFreeIndex(out string) (int, error) {
	if m := idxRe.FindStringSubmatch(out); m != nil {
		return strconv.Atoi(m[1])
	}
	return 0, fmt.Errorf("could not parse next free service-port index")
}

var rxRe = regexp.MustCompile(`(?i)Rx optical power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)`)

func ParseRxPower(out string) (float64, bool) {
	if m := rxRe.FindStringSubmatch(out); m != nil {
		v, err := strconv.ParseFloat(m[1], 64)
		return v, err == nil
	}
	return 0, false
}

// FreeONTID returns the lowest ID in 0..127 not used on the port.
func FreeONTID(rows []ONTRow) (int, error) {
	used := map[int]bool{}
	for _, r := range rows {
		used[r.OntID] = true
	}
	for i := 0; i <= 127; i++ {
		if !used[i] {
			return i, nil
		}
	}
	return 0, fmt.Errorf("PON port is full (no free ONT ID)")
}

// ONTIDInUse reports whether the ID is registered on the listed port.
func ONTIDInUse(rows []ONTRow, id int) bool {
	for _, r := range rows {
		if r.OntID == id {
			return true
		}
	}
	return false
}

var (
	stdPortRe = regexp.MustCompile(`(?i)Standard port number\s*:\s*(\d+)`)
	uplinkRe  = regexp.MustCompile(`(?m)^\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)\s+\S+\s+(up|down)\b`)
)

// uplinkSection is the part of `display vlan N` that lists the VLAN's standard (uplink) ports. The rest of the
// output lists the service-ports on the VLAN, whose PON ports must not be mistaken for uplinks.
func uplinkSection(out string) string {
	if i := stdPortRe.FindStringIndex(out); i != nil {
		return out[:i[0]]
	}
	return out
}

// UplinkPorts lists the uplink ports that carry a VLAN, with their state, from `display vlan N`.
func UplinkPorts(out string) []string {
	var res []string
	for _, m := range uplinkRe.FindAllStringSubmatch(uplinkSection(out), -1) {
		res = append(res, fmt.Sprintf("%s/%s/%s (%s)", m[1], m[2], m[3], m[4]))
	}
	return res
}
