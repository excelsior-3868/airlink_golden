package api

import (
	"database/sql"
	"testing"
	"time"
)

func ns(v int64) sql.NullInt64 { return sql.NullInt64{Int64: v, Valid: true} }

func TestOntOwnedBy(t *testing.T) {
	admin := principal{ID: 1, Role: "admin", OriginalRole: "admin"}
	reseller := principal{ID: 7, Role: "operator", OriginalRole: "reseller"}
	operator := principal{ID: 9, Role: "operator", OriginalRole: "operator"}
	none := sql.NullInt64{}
	cases := []struct {
		name string
		u    principal
		ont  sql.NullInt64
		cust sql.NullInt64
		want bool
	}{
		{"admin any", admin, ns(3), none, true},
		{"admin unowned", admin, none, none, true},
		{"reseller own ont", reseller, ns(7), none, true},
		{"reseller other ont", reseller, ns(8), none, false},
		{"reseller via customer", reseller, none, ns(7), true},
		{"reseller other customer", reseller, none, ns(8), false},
		{"reseller unowned", reseller, none, none, false},
		{"ont owner wins over customer", reseller, ns(8), ns(7), false},
		{"non-reseller operator denied", operator, ns(9), none, false},
	}
	for _, c := range cases {
		if got := ontOwnedBy(c.u, c.ont, c.cust); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestCooldown(t *testing.T) {
	cd := newCooldown(60 * time.Second)
	t0 := time.Unix(1000, 0)
	if ok, _ := cd.Allow(5, t0); !ok {
		t.Fatal("first call blocked")
	}
	if ok, wait := cd.Allow(5, t0.Add(10*time.Second)); ok || wait != 50*time.Second {
		t.Fatalf("second call ok=%v wait=%v", ok, wait)
	}
	if ok, _ := cd.Allow(6, t0.Add(10*time.Second)); !ok {
		t.Fatal("different ONT blocked")
	}
	if ok, _ := cd.Allow(5, t0.Add(61*time.Second)); !ok {
		t.Fatal("call after cooldown blocked")
	}
}
