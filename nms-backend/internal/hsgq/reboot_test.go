package hsgq

import (
	"context"
	"strings"
	"testing"

	"github.com/nepalairlink/nms/internal/olt"
)

func TestOntReset(t *testing.T) {
	got, err := OntReset(3, 17)
	if err != nil || got != "ont reset 3 17" {
		t.Fatalf("OntReset(3,17) = %q, %v", got, err)
	}
	for _, bad := range [][2]int{{0, 1}, {17, 1}, {1, -1}, {1, 128}} {
		if _, err := OntReset(bad[0], bad[1]); err == nil {
			t.Errorf("OntReset(%d,%d) accepted", bad[0], bad[1])
		}
	}
}

func TestCheckOntReset(t *testing.T) {
	for _, ok := range []string{"ont reset 1 0", "ont reset 16 127"} {
		if err := checkOntReset(ok); err != nil {
			t.Errorf("rejected %q: %v", ok, err)
		}
	}
	for _, bad := range []string{
		"reboot", "ont reset 1 all", "ont reset all", "ont reset 1", "ont reset 0 5", "ont reset 17 5",
		"ont reset 1 128", "ont reset 1 5; reboot", "ont reset 1 5\nreboot", "ont delete 1 5", "", "show version",
	} {
		if err := checkOntReset(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

type rebootExec struct {
	ran    []string
	closed bool
}

func (f *rebootExec) Run(_ context.Context, c olt.Cmd) (string, error) {
	f.ran = append(f.ran, c.String())
	return "", nil
}
func (f *rebootExec) Close() error { f.closed = true; return nil }

type rebootDialer struct{ ex *rebootExec }

func (d rebootDialer) Dial(context.Context, int64) (olt.Executor, error) { return d.ex, nil }

func TestRebootONTSendsOnlyTheReset(t *testing.T) {
	ex := &rebootExec{}
	s := &Service{dialer: rebootDialer{ex}}
	if err := s.RebootONT(context.Background(), 4, 3, 17); err != nil {
		t.Fatal(err)
	}
	if strings.Join(ex.ran, "|") != "ont reset 3 17" || !ex.closed {
		t.Fatalf("ran %v closed=%v", ex.ran, ex.closed)
	}
}

func TestRebootONTRejectsBadPosition(t *testing.T) {
	ex := &rebootExec{}
	s := &Service{dialer: rebootDialer{ex}}
	if err := s.RebootONT(context.Background(), 4, 0, 1); err == nil || len(ex.ran) != 0 {
		t.Fatalf("bad pon ran %v err=%v", ex.ran, err)
	}
}
