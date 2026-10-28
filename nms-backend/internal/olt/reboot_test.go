package olt

import (
	"context"
	"strings"
	"testing"
)

func TestOntReset(t *testing.T) {
	c, err := OntReset(1, 5)
	if err != nil || c.String() != "ont reset 1 5" || !c.IsWrite() {
		t.Fatalf("OntReset(1,5) = %q write=%v err=%v", c.String(), c.IsWrite(), err)
	}
	for _, bad := range [][2]int{{-1, 5}, {16, 5}, {1, -1}, {1, 128}} {
		if _, err := OntReset(bad[0], bad[1]); err == nil {
			t.Errorf("OntReset(%d,%d) accepted", bad[0], bad[1])
		}
	}
}

type rebootExec struct {
	ran    []string
	closed bool
	out    map[string]string
}

func (f *rebootExec) Run(_ context.Context, c Cmd) (string, error) {
	f.ran = append(f.ran, c.String())
	return f.out[c.String()], nil
}
func (f *rebootExec) Close() error { f.closed = true; return nil }

type rebootDialer struct{ ex *rebootExec }

func (d rebootDialer) Dial(context.Context, int64) (Executor, error) { return d.ex, nil }

func TestRebootONTCommandSequence(t *testing.T) {
	ex := &rebootExec{}
	s := &Service{dialer: rebootDialer{ex}}
	if err := s.RebootONT(context.Background(), 1, 0, 0, 3, 17); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(ex.ran, " | ")
	if got != "interface gpon 0/0 | ont reset 3 17 | quit" || !ex.closed {
		t.Fatalf("ran %q closed=%v", got, ex.closed)
	}
}

func TestRebootONTReportsOLTError(t *testing.T) {
	ex := &rebootExec{out: map[string]string{"ont reset 3 17": "  Failure: The ONT does not exist\r\n"}}
	s := &Service{dialer: rebootDialer{ex}}
	err := s.RebootONT(context.Background(), 1, 0, 0, 3, 17)
	if err == nil || !strings.Contains(err.Error(), "Failure") {
		t.Fatalf("err = %v, want OLT failure", err)
	}
}

func TestRebootONTRejectsBadPosition(t *testing.T) {
	ex := &rebootExec{}
	s := &Service{dialer: rebootDialer{ex}}
	if err := s.RebootONT(context.Background(), 1, 0, 0, 99, 1); err == nil || len(ex.ran) != 0 {
		t.Fatalf("bad port ran %v err=%v", ex.ran, err)
	}
}
