package olt

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Expectations are small strings stored with each job step and evaluated against the command output.
// "A successful CLI response does not prove the service works" (design doc): every write is followed
// by a read-back whose expectation must hold before the job may succeed.
//
//	""                 command must not fail
//	ont_absent         serial is not registered
//	ont_present        serial is registered
//	ont_healthy        registered, config state normal, match state match
//	autofind_at:SN:F/S/P  the OLT detected that serial on that PON port (autofind)
//	autofind_optional     autofind is informational (registering an ONT that is not connected yet)
//	ont_registered_at:F/S/P:L:S  registered on that port, healthy, with line profile L and service profile S
//	ont_registered_ok  registered; not a mismatch and not a failed configuration (offline "initial" is fine)
//	ont_id_free:N      ONT-ID N is unused in the port table
//	next_free:N        next free service-port index is N
//	gem_maps:G:V       line profile output maps VLAN V to GEM port G
//	no_vlan:V          no service-port in the output carries VLAN V (an empty or failed listing passes)
//	ont_at:SN          the ONT shown has serial SN (when the output carries an SN line)
//	sp_free:N          no service-port in the listing uses index N
//	sp_listed:N:V      service-port N carries VLAN V in the listing
//	no_untagged_gem:G  the ONT has no untagged service-port on GEM port G
//	vlan_port:F/S/P    the VLAN output lists that uplink port
//	vlan_has_uplink    the VLAN has at least one standard (uplink) port
//	vlan_exists        command succeeded
//	absent             command failed (object does not exist)
//	contains:X         command succeeded and output contains X
//	preserved:ID       every line of the before-state still appears (except the line for service-port ID)
func Expect(expect, out string, runErr error, beforeState string) error {
	var cli *CLIError
	cliFailed := errors.As(runErr, &cli)
	if runErr != nil && !cliFailed {
		return runErr // transport failure is never an expectation result
	}
	name, arg, _ := strings.Cut(expect, ":")
	switch name {
	case "":
		if cliFailed {
			return runErr
		}
	case "ont_absent":
		if ParseONTDetail(out).Found {
			return errors.New("ONT is already registered on this OLT")
		}
	case "ont_present":
		if !ParseONTDetail(out).Found {
			return errors.New("ONT is not registered on this OLT")
		}
	case "ont_healthy":
		d := ParseONTDetail(out)
		if !d.Found {
			return errors.New("ONT not found after registration")
		}
		if !strings.EqualFold(d.ConfigState, "normal") || !strings.EqualFold(d.MatchState, "match") {
			return fmt.Errorf("ONT not healthy: config state %q, match state %q", d.ConfigState, d.MatchState)
		}
	case "autofind_optional":
		// Autofind is informational for an ONT that is registered before it is connected.
	case "autofind_at":
		sn, fsp, _ := strings.Cut(arg, ":")
		if cliFailed {
			return errors.New("the OLT has not detected any new ONT (autofind is empty): check the optical connection and run the command again")
		}
		f, sl, p, err := splitFSP(fsp)
		if err != nil {
			return err
		}
		for _, a := range ParseAutofind(out) {
			if !strings.EqualFold(a.SN, sn) {
				continue
			}
			if a.F != f || a.S != sl || a.P != p {
				return fmt.Errorf("the OLT detected this ONT on %d/%d/%d, not on %d/%d/%d", a.F, a.S, a.P, f, sl, p)
			}
			return nil
		}
		return fmt.Errorf("the OLT has not detected ONT %s (autofind does not list it): check the optical connection and run the command again", sn)
	case "ont_registered_at":
		parts := strings.Split(arg, ":")
		if len(parts) != 3 {
			return fmt.Errorf("bad expectation %q", expect)
		}
		d := ParseONTDetail(out)
		if !d.Found {
			return errors.New("ONT not found after registration")
		}
		f, sl, p, err := splitFSP(parts[0])
		if err != nil {
			return err
		}
		if d.F != f || d.S != sl || d.P != p {
			return fmt.Errorf("ONT is registered on %d/%d/%d, not on %d/%d/%d", d.F, d.S, d.P, f, sl, p)
		}
		if strings.EqualFold(d.MatchState, "mismatch") || strings.EqualFold(d.ConfigState, "failed") {
			return fmt.Errorf("ONT registered but not healthy: config state %q, match state %q", d.ConfigState, d.MatchState)
		}
		// The intended profiles must be the ones assigned (only checked when the OLT prints them as numbers).
		if _, err := strconv.Atoi(d.LineProfile); err == nil && d.LineProfile != parts[1] {
			return fmt.Errorf("line profile %s is assigned, not %s", d.LineProfile, parts[1])
		}
		if _, err := strconv.Atoi(d.SrvProfile); err == nil && d.SrvProfile != parts[2] {
			return fmt.Errorf("service profile %s is assigned, not %s", d.SrvProfile, parts[2])
		}
	case "ont_registered_ok":
		d := ParseONTDetail(out)
		if !d.Found {
			return errors.New("ONT not found after registration")
		}
		// An ONT that is not powered on yet is registered with config state "initial"; only a real mismatch or a
		// failed configuration is a problem.
		if strings.EqualFold(d.MatchState, "mismatch") || strings.EqualFold(d.ConfigState, "failed") {
			return fmt.Errorf("ONT registered but not healthy: config state %q, match state %q", d.ConfigState, d.MatchState)
		}
	case "ont_id_free":
		id, _ := strconv.Atoi(arg)
		if ONTIDInUse(ParseONTTable(out), id) {
			return fmt.Errorf("ONT-ID %d is already in use on the PON port", id)
		}
	case "next_free":
		want, _ := strconv.Atoi(arg)
		got, err := ParseNextFreeIndex(out)
		if err != nil {
			return err
		}
		if got != want {
			return fmt.Errorf("service-port index %d is no longer the next free index (now %d); re-plan the job", want, got)
		}
	case "no_vlan":
		v, _ := strconv.Atoi(arg)
		for _, sp := range ParseServicePorts(out) {
			if sp.VLAN == v {
				return fmt.Errorf("ONT already has service-port %d for VLAN %d", sp.Index, v)
			}
		}
	case "ont_at":
		d := ParseONTDetail(out)
		if !d.Found {
			return errors.New("ONT not found at this position")
		}
		if d.SN != "" && !strings.EqualFold(d.SN, arg) {
			return fmt.Errorf("the ONT at this position has serial %s, not %s", d.SN, arg)
		}
	case "sp_free":
		id, _ := strconv.Atoi(arg)
		for _, r := range ParseServicePorts(out) {
			if r.Index == id {
				return fmt.Errorf("service-port index %d is already in use (VLAN %d)", id, r.VLAN)
			}
		}
	case "sp_listed":
		g, v, _ := strings.Cut(arg, ":")
		id, _ := strconv.Atoi(g)
		vlan, _ := strconv.Atoi(v)
		found := false
		for _, r := range ParseServicePorts(out) {
			if r.Index == id && r.VLAN == vlan {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("service-port %d for VLAN %d is not in the ONT's service list", id, vlan)
		}
	case "no_untagged_gem":
		gem, _ := strconv.Atoi(arg)
		for _, r := range ParseServicePorts(out) {
			if r.Gem == gem && IsUntaggedFlow(r) {
				return fmt.Errorf("the ONT already has untagged service-port %d on GEM port %d; a second untagged service on the same GEM can conflict, so verify the design first", r.Index, gem)
			}
		}
	case "vlan_port":
		if cliFailed {
			return runErr
		}
		f, s, p, err := splitFSP(arg)
		if err != nil {
			return err
		}
		if !regexp.MustCompile(fmt.Sprintf(`(^|[^\d])%d\s*/\s*%d\s*/\s*%d([^\d]|$)`, f, s, p)).MatchString(uplinkSection(out)) {
			return fmt.Errorf("VLAN output does not list uplink port %s; the VLAN may not be carried on that uplink", arg)
		}
	case "vlan_has_uplink":
		if cliFailed {
			return fmt.Errorf("VLAN does not exist on the OLT: %v", runErr)
		}
		if m := stdPortRe.FindStringSubmatch(out); m != nil {
			if n, _ := strconv.Atoi(m[1]); n == 0 {
				return errors.New("the VLAN has no standard (uplink) port, so it is not carried to the uplink")
			}
		}
	case "gem_maps":
		if cliFailed {
			return runErr
		}
		g, v, _ := strings.Cut(arg, ":")
		gem, _ := strconv.Atoi(g)
		vlan, _ := strconv.Atoi(v)
		if !gemMapsVLAN(ParseLineProfileMapping(out), gem, vlan) {
			return fmt.Errorf("line profile does not map VLAN %d to GEM port %d", vlan, gem)
		}
	case "vlan_exists":
		if cliFailed {
			return fmt.Errorf("VLAN does not exist on the OLT: %v", runErr)
		}
	case "absent":
		if !cliFailed {
			return errors.New("object still exists")
		}
	case "contains":
		if cliFailed {
			return runErr
		}
		if !strings.Contains(out, arg) {
			return fmt.Errorf("output does not contain %q", arg)
		}
	case "preserved":
		return preserved(beforeState, out, arg)
	default:
		return fmt.Errorf("unknown expectation %q", expect)
	}
	return nil
}

func gemMapsVLAN(m map[int][]int, gem, vlan int) bool {
	for _, v := range m[gem] {
		if v == vlan {
			return true
		}
	}
	return false
}

func spKey(r ServicePortRow) string {
	return fmt.Sprintf("%d|%d|%d/%d/%d|%d|%d|%s|%s", r.Index, r.VLAN, r.F, r.S, r.P, r.OntID, r.Gem, strings.ToLower(r.FlowType), r.FlowPara)
}

// preserved checks that no existing service disappeared or changed. When the listing is the OLT's service-port
// table, rows are compared (not state, which may legitimately change); the table's "Total : N" footer must not
// count, because it changes whenever a service-port is added. Otherwise every line is compared.
func preserved(before, after, skipID string) error {
	if rows := ParseServicePorts(before); len(rows) > 0 {
		have := map[string]bool{}
		for _, r := range ParseServicePorts(after) {
			have[spKey(r)] = true
		}
		for _, r := range rows {
			if skipID != "" && strconv.Itoa(r.Index) == skipID {
				continue
			}
			if !have[spKey(r)] {
				return fmt.Errorf("existing service-port %d (VLAN %d, GEM %d) is no longer listed unchanged", r.Index, r.VLAN, r.Gem)
			}
		}
		return nil
	}
	have := map[string]bool{}
	for _, l := range strings.Split(after, "\n") {
		have[strings.Join(strings.Fields(l), " ")] = true
	}
	for _, l := range strings.Split(before, "\n") {
		norm := strings.Join(strings.Fields(l), " ")
		if norm == "" || strings.HasPrefix(norm, "-") {
			continue
		}
		// An ONT with no service-ports answers with this failure line; it is the absence of a service, not one to preserve.
		if strings.Contains(norm, "No service virtual port can be operated") {
			continue
		}
		if f := strings.Fields(norm); skipID != "" && len(f) > 0 && f[0] == skipID {
			continue
		}
		if !have[norm] {
			return fmt.Errorf("existing service changed unexpectedly: %q is no longer present", norm)
		}
	}
	return nil
}

// splitFSP reads "F/S/P" (for example "0/9/1") into its three numbers.
func splitFSP(s string) (f, sl, p int, err error) {
	if _, err = fmt.Sscanf(s, "%d/%d/%d", &f, &sl, &p); err != nil {
		return 0, 0, 0, fmt.Errorf("port %q must look like 0/9/1", s)
	}
	return f, sl, p, validFSP(f, sl, p)
}
