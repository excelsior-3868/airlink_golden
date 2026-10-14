package olt

import (
	"fmt"
	"regexp"
	"strconv"
)

// Reparse turns a stored command line back into a Cmd by re-validating it against the same
// constructors used to create it. Job steps are persisted as text; anything that is not exactly an
// approved command form (for example because the row was tampered with) is refused at execution time.
func Reparse(line string) (Cmd, error) {
	for _, f := range reparsers {
		if m := f.re.FindStringSubmatch(line); m != nil {
			n := make([]int, len(m)-1)
			for i := range n {
				n[i], _ = strconv.Atoi(m[i+1])
			}
			c, err := f.build(m, n)
			if err != nil {
				return Cmd{}, err
			}
			if c.text != line { // canonical-form check: no trailing junk or alternate spellings
				return Cmd{}, fmt.Errorf("command %q is not in canonical form", line)
			}
			return c, nil
		}
	}
	return Cmd{}, fmt.Errorf("command %q is not an approved command", line)
}

type reparser struct {
	re    *regexp.Regexp
	build func(m []string, n []int) (Cmd, error)
}

func rp(pattern string, b func(m []string, n []int) (Cmd, error)) reparser {
	return reparser{regexp.MustCompile("^" + pattern + "$"), b}
}

var reparsers = []reparser{
	rp(`display version`, func([]string, []int) (Cmd, error) { return DisplayVersion(), nil }),
	rp(`display board 0`, func([]string, []int) (Cmd, error) { return DisplayBoard(), nil }),
	rp(`display ont autofind all`, func([]string, []int) (Cmd, error) { return DisplayAutofind(), nil }),
	rp(`display service-port next-free-index`, func([]string, []int) (Cmd, error) { return DisplayNextFreeServicePort(), nil }),
	rp(`display vlan all`, func([]string, []int) (Cmd, error) { return DisplayVLANAll(), nil }),
	rp(`display service-port all`, func([]string, []int) (Cmd, error) { return DisplayServicePortAll(), nil }),
	rp(`display dba-profile all`, func([]string, []int) (Cmd, error) { return DisplayDBAProfiles(), nil }),
	rp(`display ont-lineprofile gpon all`, func([]string, []int) (Cmd, error) { return DisplayLineProfiles(), nil }),
	rp(`display ont-srvprofile gpon all`, func([]string, []int) (Cmd, error) { return DisplaySrvProfiles(), nil }),
	rp(`display ont-srvprofile gpon profile-id (\d+)`, func(_ []string, n []int) (Cmd, error) { return DisplaySrvProfile(n[0]) }),
	rp(`display ont-lineprofile gpon profile-id (\d+)`, func(_ []string, n []int) (Cmd, error) { return DisplayLineProfile(n[0]) }),
	rp(`display vlan (\d+)`, func(_ []string, n []int) (Cmd, error) { return DisplayVLAN(n[0]) }),
	rp(`display service-port (\d+)`, func(_ []string, n []int) (Cmd, error) { return DisplayServicePort(n[0]) }),
	rp(`display service-port port (\d+)/(\d+)/(\d+) ont (\d+)`, func(_ []string, n []int) (Cmd, error) {
		return DisplayServicePortOnt(n[0], n[1], n[2], n[3])
	}),
	rp(`display ont info by-sn ([0-9A-F]{16})`, func(m []string, _ []int) (Cmd, error) { return DisplayONTBySN(m[1]) }),
	rp(`display ont info (\d+) (\d+) (\d+) all`, func(_ []string, n []int) (Cmd, error) { return DisplayONTPort(n[0], n[1], n[2]) }),
	rp(`display ont optical-info by-sn ([0-9A-F]{16})`, func(m []string, _ []int) (Cmd, error) { return DisplayONTOptical(m[1]) }),
	rp(`display ont optical-info (\d+) (\d+) (\d+) (\d+)`, func(_ []string, n []int) (Cmd, error) {
		return DisplayONTOpticalPos(n[0], n[1], n[2], n[3])
	}),
	rp(`interface gpon (\d+)/(\d+)`, func(_ []string, n []int) (Cmd, error) { return InterfaceGpon(n[0], n[1]) }),
	rp(`quit`, func([]string, []int) (Cmd, error) { return Quit(), nil }),
	rp(`ont add (\d+) (\d+) sn-auth "([0-9A-F]{16})" omci ont-lineprofile-id (\d+) ont-srvprofile-id (\d+)(?: desc "([A-Za-z0-9 _.\-]{0,64})")?`,
		func(m []string, n []int) (Cmd, error) {
			return OntAdd(n[0], n[1], m[3], n[3], n[4], m[6])
		}),
	rp(`ont delete (\d+) (\d+)`, func(_ []string, n []int) (Cmd, error) { return OntDelete(n[0], n[1]) }),
	rp(`display ont info (\d+) (\d+) (\d+) (\d+)`, func(_ []string, n []int) (Cmd, error) { return DisplayONTInfo(n[0], n[1], n[2], n[3]) }),
	rp(`service-port (\d+) vlan (\d+) gpon (\d+)/(\d+)/(\d+) ont (\d+) gemport (\d+) multi-service user-vlan (\d+|untagged) tag-transform (translate|default|transparent)`,
		func(m []string, n []int) (Cmd, error) {
			return ServicePortAdd(ServicePort{ID: n[0], VLAN: n[1], F: n[2], S: n[3], P: n[4], OntID: n[5], Gem: n[6], UserVLAN: n[7], Untagged: m[8] == "untagged", Transform: m[9]})
		}),
	rp(`undo service-port (\d+)`, func(_ []string, n []int) (Cmd, error) { return ServicePortUndo(n[0]) }),
	rp(`save`, func([]string, []int) (Cmd, error) { return Save(), nil }),
}
