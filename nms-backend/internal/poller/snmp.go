// Package poller collects device health and interface telemetry and feeds the alert engine.
package poller

import (
	"fmt"
	"math/big"
	"net"
	"strconv"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/nepalairlink/nms/internal/config"
)

const (
	oidSysDescr  = "1.3.6.1.2.1.1.1.0"
	oidSysUpTime = "1.3.6.1.2.1.1.3.0"

	oidIfOperStatus = "1.3.6.1.2.1.2.2.1.8"
	oidIfInErrors   = "1.3.6.1.2.1.2.2.1.14"
	oidIfOutErrors  = "1.3.6.1.2.1.2.2.1.20"
	oidIfName       = "1.3.6.1.2.1.31.1.1.1.1"
	oidIfHCIn       = "1.3.6.1.2.1.31.1.1.1.6"
	oidIfHCOut      = "1.3.6.1.2.1.31.1.1.1.10"
	oidIfHighSpeed  = "1.3.6.1.2.1.31.1.1.1.15"
	oidIfAlias      = "1.3.6.1.2.1.31.1.1.1.18"

	oidHrProcessorLoad = "1.3.6.1.2.1.25.3.3.1.2"
	oidHrStorageType   = "1.3.6.1.2.1.25.2.3.1.2"
	oidHrStorageUnits  = "1.3.6.1.2.1.25.2.3.1.4"
	oidHrStorageSize   = "1.3.6.1.2.1.25.2.3.1.5"
	oidHrStorageUsed   = "1.3.6.1.2.1.25.2.3.1.6"
	hrStorageRAM       = ".1.3.6.1.2.1.25.2.1.2"
)

type ifSample struct {
	Index      int
	Name       string
	Alias      string
	SpeedBps   int64
	OperStatus string
	InOctets   *big.Int
	OutOctets  *big.Int
	InErrors   int64
	OutErrors  int64
}

type snmpResult struct {
	Descr      string
	UptimeSecs int64
	CPU        *float64
	Mem        *float64
	Interfaces []ifSample
}

type Target struct {
	IP          string
	Port        int
	Version     string // 2c | 3
	CredRef     string
	WithIfTable bool
}

func newClient(t Target) (*gosnmp.GoSNMP, error) {
	g := &gosnmp.GoSNMP{
		Target:         t.IP,
		Port:           uint16(t.Port),
		Timeout:        4 * time.Second,
		Retries:        1,
		MaxRepetitions: 20,
	}
	if t.Version == "3" {
		user := config.Secret("SNMPV3_USER", t.CredRef)
		if user == "" {
			return nil, fmt.Errorf("no SNMPv3 credentials for ref %q", t.CredRef)
		}
		authPass := config.Secret("SNMPV3_AUTHPASS", t.CredRef)
		privPass := config.Secret("SNMPV3_PRIVPASS", t.CredRef)
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		g.MsgFlags = gosnmp.AuthPriv
		g.SecurityParameters = &gosnmp.UsmSecurityParameters{
			UserName:                 user,
			AuthenticationProtocol:   gosnmp.SHA,
			AuthenticationPassphrase: authPass,
			PrivacyProtocol:          gosnmp.AES,
			PrivacyPassphrase:        privPass,
		}
		if privPass == "" {
			g.MsgFlags = gosnmp.AuthNoPriv
		}
		return g, nil
	}
	community := config.Secret("SNMP_COMMUNITY", t.CredRef)
	if community == "" {
		community = "public"
	}
	g.Version = gosnmp.Version2c
	g.Community = community
	return g, nil
}

func pduInt(p gosnmp.SnmpPDU) int64 {
	return gosnmp.ToBigInt(p.Value).Int64()
}

func lastIndex(oid string) int {
	for i := len(oid) - 1; i >= 0; i-- {
		if oid[i] == '.' {
			n, _ := strconv.Atoi(oid[i+1:])
			return n
		}
	}
	return -1
}

func pduString(p gosnmp.SnmpPDU) string {
	if b, ok := p.Value.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(p.Value)
}

// pollSNMP gathers system info, CPU/memory (HOST-RESOURCES) and the interface table (IF-MIB, 64-bit counters).
func pollSNMP(t Target) (*snmpResult, error) {
	g, err := newClient(t)
	if err != nil {
		return nil, err
	}
	if err := g.Connect(); err != nil {
		return nil, err
	}
	defer g.Conn.Close()

	pkt, err := g.Get([]string{oidSysDescr, oidSysUpTime})
	if err != nil {
		return nil, err
	}
	res := &snmpResult{}
	for _, v := range pkt.Variables {
		switch v.Name {
		case "." + oidSysDescr:
			res.Descr = pduString(v)
		case "." + oidSysUpTime:
			res.UptimeSecs = pduInt(v) / 100
		}
	}

	// CPU: average of hrProcessorLoad rows. Devices without HOST-RESOURCES simply yield no value.
	if rows, err := g.BulkWalkAll(oidHrProcessorLoad); err == nil && len(rows) > 0 {
		var sum float64
		for _, r := range rows {
			sum += float64(pduInt(r))
		}
		avg := sum / float64(len(rows))
		res.CPU = &avg
	}
	res.Mem = memoryPct(g)

	if t.WithIfTable {
		res.Interfaces, err = walkInterfaces(g)
		if err != nil {
			return res, fmt.Errorf("interface walk: %w", err)
		}
	}
	return res, nil
}

func memoryPct(g *gosnmp.GoSNMP) *float64 {
	types, err := g.BulkWalkAll(oidHrStorageType)
	if err != nil {
		return nil
	}
	for _, tp := range types {
		if s, ok := tp.Value.(string); !ok || s != hrStorageRAM {
			continue
		}
		idx := lastIndex(tp.Name)
		pkt, err := g.Get([]string{
			fmt.Sprintf("%s.%d", oidHrStorageUnits, idx),
			fmt.Sprintf("%s.%d", oidHrStorageSize, idx),
			fmt.Sprintf("%s.%d", oidHrStorageUsed, idx)})
		if err != nil || len(pkt.Variables) < 3 {
			return nil
		}
		size, used := pduInt(pkt.Variables[1]), pduInt(pkt.Variables[2])
		if size <= 0 {
			return nil
		}
		p := float64(used) / float64(size) * 100
		return &p
	}
	return nil
}

func walkInterfaces(g *gosnmp.GoSNMP) ([]ifSample, error) {
	byIdx := map[int]*ifSample{}
	get := func(i int) *ifSample {
		if s, ok := byIdx[i]; ok {
			return s
		}
		s := &ifSample{Index: i}
		byIdx[i] = s
		return s
	}
	walk := func(oid string, fn func(*ifSample, gosnmp.SnmpPDU)) error {
		rows, err := g.BulkWalkAll(oid)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fn(get(lastIndex(r.Name)), r)
		}
		return nil
	}
	steps := []struct {
		oid string
		fn  func(*ifSample, gosnmp.SnmpPDU)
	}{
		{oidIfName, func(s *ifSample, p gosnmp.SnmpPDU) { s.Name = pduString(p) }},
		{oidIfAlias, func(s *ifSample, p gosnmp.SnmpPDU) { s.Alias = pduString(p) }},
		{oidIfHighSpeed, func(s *ifSample, p gosnmp.SnmpPDU) { s.SpeedBps = pduInt(p) * 1_000_000 }},
		{oidIfOperStatus, func(s *ifSample, p gosnmp.SnmpPDU) {
			s.OperStatus = map[int64]string{1: "up", 2: "down", 3: "testing", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}[pduInt(p)]
		}},
		{oidIfHCIn, func(s *ifSample, p gosnmp.SnmpPDU) { s.InOctets = gosnmp.ToBigInt(p.Value) }},
		{oidIfHCOut, func(s *ifSample, p gosnmp.SnmpPDU) { s.OutOctets = gosnmp.ToBigInt(p.Value) }},
		{oidIfInErrors, func(s *ifSample, p gosnmp.SnmpPDU) { s.InErrors = pduInt(p) }},
		{oidIfOutErrors, func(s *ifSample, p gosnmp.SnmpPDU) { s.OutErrors = pduInt(p) }},
	}
	for _, st := range steps {
		if err := walk(st.oid, st.fn); err != nil {
			return nil, err
		}
	}
	out := make([]ifSample, 0, len(byIdx))
	for _, s := range byIdx {
		if s.Name == "" {
			s.Name = "if" + strconv.Itoa(s.Index)
		}
		out = append(out, *s)
	}
	return out, nil
}

// tcpReachable is the fallback probe for devices without SNMP (and for OLT SSH reachability).
func tcpReachable(ip string, port int) error {
	c, err := net.DialTimeout("tcp", net.JoinHostPort(ip, strconv.Itoa(port)), 4*time.Second)
	if err != nil {
		return err
	}
	return c.Close()
}
