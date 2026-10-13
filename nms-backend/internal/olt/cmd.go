// Package olt drives Huawei MA5683T OLTs: allow-listed CLI commands, an SSH session driver,
// output parsers, ONT state monitoring and the safe provisioning job pipeline.
//
// Command syntax follows the MA5683T V800R015C00 SPC107 field manual and the billing integration
// design. Both stress that syntax varies by release and must be validated on the target OLT; that is
// why every command is built here from validated arguments and nothing else can reach the device.
package olt

import (
	"fmt"
	"regexp"
	"strings"
)

// Cmd is a CLI line that passed validation. Its text field is unexported, so the only way to obtain
// one is a constructor below: raw strings (for example from a billing form) can never be executed.
type Cmd struct {
	text    string
	confirm bool // the OLT asks "(y/n)" for this command and we pre-approve it (only undo/delete forms)
	write   bool
}

func (c Cmd) String() string { return c.text }
func (c Cmd) IsWrite() bool  { return c.write }

var (
	snRe   = regexp.MustCompile(`^[0-9A-Fa-f]{16}$`)
	descRe = regexp.MustCompile(`^[A-Za-z0-9 _.\-]{0,64}$`)
)

func rng(name string, v, lo, hi int) error {
	if v < lo || v > hi {
		return fmt.Errorf("%s %d out of range %d..%d", name, v, lo, hi)
	}
	return nil
}

func ValidSN(sn string) error {
	if !snRe.MatchString(sn) {
		return fmt.Errorf("invalid ONT serial %q (want 16 hex characters)", sn)
	}
	return nil
}

func read(s string) Cmd { return Cmd{text: s} }

func DisplayVersion() Cmd             { return read("display version") }
func DisplayBoard() Cmd               { return read("display board 0") }
func DisplayAutofind() Cmd            { return read("display ont autofind all") }
func DisplayNextFreeServicePort() Cmd { return read("display service-port next-free-index") }
func DisplayDBAProfiles() Cmd         { return read("display dba-profile all") }
func DisplayLineProfiles() Cmd        { return read("display ont-lineprofile gpon all") }
func DisplaySrvProfiles() Cmd         { return read("display ont-srvprofile gpon all") }
func DisplayVLANAll() Cmd             { return read("display vlan all") }
func DisplayServicePortAll() Cmd      { return read("display service-port all") }
func DisplayActiveAlarms() Cmd        { return read("display alarm active") }

func DisplayVLAN(v int) (Cmd, error) {
	if err := rng("vlan", v, 1, 4094); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display vlan %d", v)), nil
}

func DisplayServicePort(id int) (Cmd, error) {
	if err := rng("service-port id", id, 0, 65534); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display service-port %d", id)), nil
}

// DisplaySrvProfile shows one ONT service profile (used to confirm that it exists before registering an ONT with it).
func DisplaySrvProfile(id int) (Cmd, error) {
	if err := rng("service profile id", id, 0, 1023); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display ont-srvprofile gpon profile-id %d", id)), nil
}

// DisplayLineProfile shows one ONT line profile, including its GEM-to-VLAN mapping.
func DisplayLineProfile(id int) (Cmd, error) {
	if err := rng("line profile id", id, 0, 1023); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display ont-lineprofile gpon profile-id %d", id)), nil
}

func DisplayServicePortOnt(f, s, p, ont int) (Cmd, error) {
	if err := validFSP(f, s, p); err != nil {
		return Cmd{}, err
	}
	if err := rng("ont id", ont, 0, 127); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display service-port port %d/%d/%d ont %d", f, s, p, ont)), nil
}

func DisplayONTBySN(sn string) (Cmd, error) {
	if err := ValidSN(sn); err != nil {
		return Cmd{}, err
	}
	return read("display ont info by-sn " + strings.ToUpper(sn)), nil
}

// DisplayONTInfo shows one ONT by position: `display ont info <frame> <slot> <port> <ont-id>`.
func DisplayONTInfo(f, s, p, ont int) (Cmd, error) {
	if err := validFSP(f, s, p); err != nil {
		return Cmd{}, err
	}
	if err := rng("ont id", ont, 0, 127); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display ont info %d %d %d %d", f, s, p, ont)), nil
}

// DisplayONTPort lists every ONT on one PON port: `display ont info <frame> <slot> <port> all`.
func DisplayONTPort(f, s, p int) (Cmd, error) {
	if err := validFSP(f, s, p); err != nil {
		return Cmd{}, err
	}
	return read(fmt.Sprintf("display ont info %d %d %d all", f, s, p)), nil
}

func DisplayONTOptical(sn string) (Cmd, error) {
	if err := ValidSN(sn); err != nil {
		return Cmd{}, err
	}
	return read("display ont optical-info by-sn " + strings.ToUpper(sn)), nil
}

func validFSP(f, s, p int) error {
	if err := rng("frame", f, 0, 7); err != nil {
		return err
	}
	if err := rng("slot", s, 0, 21); err != nil {
		return err
	}
	return rng("port", p, 0, 15)
}

// ---- write commands (only produced for provisioning job steps) ----

func InterfaceGpon(f, s int) (Cmd, error) {
	if err := validFSP(f, s, 0); err != nil {
		return Cmd{}, err
	}
	return Cmd{text: fmt.Sprintf("interface gpon %d/%d", f, s), write: true}, nil
}

func Quit() Cmd { return Cmd{text: "quit", write: true} }

// OntAdd registers an ONT by serial inside `interface gpon F/S`. The ONT must be new: callers verify that first.
func OntAdd(port, ontID int, sn string, lineProfile, srvProfile int, desc string) (Cmd, error) {
	if err := ValidSN(sn); err != nil {
		return Cmd{}, err
	}
	for _, c := range []error{rng("port", port, 0, 15), rng("ont id", ontID, 0, 127),
		rng("line profile", lineProfile, 0, 1023), rng("service profile", srvProfile, 0, 1023)} {
		if c != nil {
			return Cmd{}, c
		}
	}
	if !descRe.MatchString(desc) {
		return Cmd{}, fmt.Errorf("invalid description (allowed: letters, digits, space, _ . -)")
	}
	t := fmt.Sprintf(`ont add %d %d sn-auth "%s" omci ont-lineprofile-id %d ont-srvprofile-id %d`,
		port, ontID, strings.ToUpper(sn), lineProfile, srvProfile)
	if desc != "" {
		t += fmt.Sprintf(` desc "%s"`, desc)
	}
	return Cmd{text: t, write: true}, nil
}

func OntDelete(port, ontID int) (Cmd, error) {
	if err := rng("port", port, 0, 15); err != nil {
		return Cmd{}, err
	}
	if err := rng("ont id", ontID, 0, 127); err != nil {
		return Cmd{}, err
	}
	return Cmd{text: fmt.Sprintf("ont delete %d %d", port, ontID), write: true, confirm: true}, nil
}

type ServicePort struct {
	ID        int
	VLAN      int
	F, S, P   int
	OntID     int
	Gem       int
	UserVLAN  int
	Untagged  bool   // customer side carries no VLAN tag: "user-vlan untagged tag-transform default"
	Transform string // translate | default | transparent
}

func ServicePortAdd(sp ServicePort) (Cmd, error) {
	if err := validFSP(sp.F, sp.S, sp.P); err != nil {
		return Cmd{}, err
	}
	checks := []error{rng("service-port id", sp.ID, 0, 65534), rng("vlan", sp.VLAN, 1, 4094),
		rng("ont id", sp.OntID, 0, 127), rng("gemport", sp.Gem, 0, 1023)}
	if !sp.Untagged {
		checks = append(checks, rng("user-vlan", sp.UserVLAN, 1, 4094))
	}
	for _, c := range checks {
		if c != nil {
			return Cmd{}, c
		}
	}
	switch sp.Transform {
	case "translate", "default", "transparent":
	default:
		return Cmd{}, fmt.Errorf("invalid tag-transform %q", sp.Transform)
	}
	user := fmt.Sprint(sp.UserVLAN)
	if sp.Untagged {
		if sp.Transform != "default" {
			return Cmd{}, fmt.Errorf("an untagged service-port uses tag-transform default, not %q", sp.Transform)
		}
		user = "untagged"
	}
	return Cmd{text: fmt.Sprintf("service-port %d vlan %d gpon %d/%d/%d ont %d gemport %d multi-service user-vlan %s tag-transform %s",
		sp.ID, sp.VLAN, sp.F, sp.S, sp.P, sp.OntID, sp.Gem, user, sp.Transform), write: true}, nil
}

func ServicePortUndo(id int) (Cmd, error) {
	if err := rng("service-port id", id, 0, 65534); err != nil {
		return Cmd{}, err
	}
	return Cmd{text: fmt.Sprintf("undo service-port %d", id), write: true, confirm: true}, nil
}

func Save() Cmd { return Cmd{text: "save", write: true, confirm: true} }

var errRe = regexp.MustCompile(`(?im)^\s*(%\s*(Unknown command|Parameter error|Incomplete command|Too many parameters|Ambiguous command)|Failure:|Error:|Command execution failed)`)

// OutputError reports a CLI failure message found in command output ("" if none).
// A successful-looking exit is not trusted on its own: Huawei prints failures as normal output.
func OutputError(out string) string {
	if m := errRe.FindString(out); m != "" {
		line := strings.TrimSpace(out[strings.Index(out, m):])
		if i := strings.IndexAny(line, "\r\n"); i > 0 {
			line = line[:i]
		}
		return line
	}
	return ""
}
