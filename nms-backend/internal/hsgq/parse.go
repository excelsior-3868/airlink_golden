// Package hsgq drives HSGQ GPON OLTs (validated on the HSGQ-G08R). It is a separate driver from internal/olt, which
// speaks Huawei MA5683T CLI: HSGQ has its own login modes (enable, then configure), its own show commands and its own
// table layout, so nothing here assumes Huawei syntax. A device is routed here by its Hardware Vendor field.
package hsgq

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// VendorName is the value of devices.vendor that selects this driver (matched case-insensitively).
const VendorName = "HSGQ"

// IsVendor reports whether a device's Hardware Vendor field selects the HSGQ driver.
func IsVendor(vendor string) bool {
	return strings.Contains(strings.ToLower(vendor), "hsgq")
}

// ONTRow is one line of `show ont-info <pon> all`. The OLT addresses an ONT as PON/ONU (PON 1..16, ONU 0..127);
// it has no frame or slot, so the inventory stores both as 0.
type ONTRow struct {
	PON, ONU    int
	SN          string // canonical 16 hex characters, see NormalizeSN
	RawSN       string // as the OLT prints it, e.g. HWTCc086869d
	Admin       string // active | inactive
	RunState    string // online | offline | initial
	ConfigState string // normal | initial
	MatchState  string
	DownReason  string
	Name        string
}

// ONTTable is a parsed ont-info listing. Recognised tells an empty port (header with no rows, or the OLT's "total of
// ONTs are: 0" line) from output that is not a table at all (an error or a layout change), so a sync never deletes
// inventory on output it did not understand. Total is the OLT's own "Total: N" footer, or -1 when absent; a mismatch
// with len(Rows) means the output was cut short.
type ONTTable struct {
	Recognised bool
	Total      int
	Rows       []ONTRow
}

var (
	ontRowRe  = regexp.MustCompile(`(?i)^\s*(\d+)/(\d+)\s+(\S+)\s+(\S{4,})\s+(Active|Inactive)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$`)
	gapRe     = regexp.MustCompile(`\s{2,}`)
	ontNameRe = regexp.MustCompile(`^ONT\S*\d+/\d+$`)
	totalRe   = regexp.MustCompile(`(?i)^\s*Total:\s*(\d+)\b`)
	emptyRe   = regexp.MustCompile(`(?i)the total of ONTs are:\s*(\d+)`)
)

// ParseONTTable parses `show ont-info <pon> all`. "Last Link down reason" is often empty and may hold spaces
// ("Laser out"), so it and the ONT name are cut at the column offsets of the header line, not split on whitespace.
// Unsolicited device log lines and the trailing prompt never match the row pattern and are ignored.
func ParseONTTable(out string) ONTTable {
	tab := ONTTable{Total: -1}
	reasonOff, nameOff := -1, -1
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		if strings.Contains(line, "PON/ONU") && strings.Contains(line, "Serial") {
			tab.Recognised = true
			if i := strings.Index(line, "Last Link"); i >= 0 {
				reasonOff = i
				if j := strings.Index(line[i:], "ONT"); j >= 0 {
					nameOff = i + j
				}
			}
			continue
		}
		if m := totalRe.FindStringSubmatch(line); m != nil {
			tab.Total, _ = strconv.Atoi(m[1])
			continue
		}
		if m := emptyRe.FindStringSubmatch(line); m != nil {
			if n, _ := strconv.Atoi(m[1]); n == 0 {
				tab.Recognised, tab.Total = true, 0
			}
			continue
		}
		m := ontRowRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		r := ONTRow{
			RawSN:       m[4],
			SN:          NormalizeSN(m[4]),
			Admin:       strings.ToLower(m[5]),
			RunState:    strings.ToLower(m[6]),
			ConfigState: strings.ToLower(m[7]),
			MatchState:  strings.ToLower(m[8]),
		}
		r.PON, _ = strconv.Atoi(m[1])
		r.ONU, _ = strconv.Atoi(m[2])
		if reasonOff >= 0 && nameOff > reasonOff {
			r.DownReason, r.Name = cut(line, reasonOff, nameOff)
		} else {
			r.DownReason, r.Name = splitTail(m[9])
		}
		tab.Rows = append(tab.Rows, r)
	}
	return tab
}

func cut(line string, reasonOff, nameOff int) (reason, name string) {
	if len(line) > reasonOff {
		end := min(nameOff, len(line))
		reason = strings.TrimSpace(line[reasonOff:end])
	}
	if len(line) > nameOff {
		name = strings.TrimSpace(line[nameOff:])
	}
	return reason, name
}

// splitTail is the fallback when the header line was not in the output: columns are padded, so a gap of two or more
// spaces separates the down reason from the name.
func splitTail(tail string) (reason, name string) {
	parts := gapRe.Split(strings.TrimSpace(tail), -1)
	switch {
	case len(parts) >= 2:
		return parts[0], parts[len(parts)-1]
	case len(parts) == 1 && ontNameRe.MatchString(parts[0]):
		return "", parts[0]
	default:
		return strings.TrimSpace(parts[0]), ""
	}
}

var hex16Re = regexp.MustCompile(`^[0-9A-Fa-f]{16}$`)

// NormalizeSN turns the 12-character serial HSGQ prints (4-letter vendor ID + 8 hex digits, e.g. HWTCc086869d) into
// the 16-hex form the inventory and billing use for the same GPON serial (48575443C086869D), so one ONT has one key
// whichever OLT lists it.
func NormalizeSN(sn string) string {
	sn = strings.TrimSpace(sn)
	if hex16Re.MatchString(sn) {
		return strings.ToUpper(sn)
	}
	if len(sn) == 12 {
		if tail := sn[4:]; hex16Re.MatchString("00000000" + tail) {
			return strings.ToUpper(hex.EncodeToString([]byte(sn[:4])) + tail)
		}
	}
	return strings.ToUpper(sn)
}

// ParseVersion reads `show version`: the system version and the product model.
func ParseVersion(out string) (version, product string) {
	for _, line := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "System Version":
			version = strings.TrimSpace(v)
		case "Product":
			product = strings.TrimSpace(v)
		}
	}
	return version, product
}

// Commands. Everything sent to the OLT is built here from constants or range-checked numbers.
const (
	ShowVersion = "show version"
	MaxPON      = 16
)

func OntInfoPort(pon int) (string, error) {
	if pon < 1 || pon > MaxPON {
		return "", fmt.Errorf("pon port %d out of range 1..%d", pon, MaxPON)
	}
	return fmt.Sprintf("show ont-info %d all", pon), nil
}

var readOnlyRe = regexp.MustCompile(`^show [A-Za-z0-9 _./-]+$`)

// checkReadOnly refuses anything but a plain `show ...` line: sync sessions sit in config mode (the ONT listing only
// exists there), so this guard is what keeps them read-only.
func checkReadOnly(cmd string) error {
	if !readOnlyRe.MatchString(cmd) {
		return fmt.Errorf("%w: %q", ErrReadOnly, cmd)
	}
	return nil
}
