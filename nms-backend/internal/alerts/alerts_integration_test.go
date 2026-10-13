//go:build integration

package alerts


import (
	"context"
	"sync"
	"testing"

	"github.com/nepalairlink/nms/internal/testdb"
)

type recorder struct {
	mu   sync.Mutex
	msgs []Message
}

func (r *recorder) Send(_ context.Context, m Message) error {
	r.mu.Lock()
	r.msgs = append(r.msgs, m)
	r.mu.Unlock()
	return nil
}

func (r *recorder) count() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.msgs) }

func TestAlertLifecycleCorrelationEscalation(t *testing.T) {
	pool := testdb.Open(t)
	ctx := context.Background()
	e := NewEngine(pool)

	var core, access int64
	pool.QueryRow(ctx, `INSERT INTO devices(name,ip,role) VALUES('core-ktm','10.0.0.1','core') RETURNING id`).Scan(&core)
	pool.QueryRow(ctx, `INSERT INTO devices(name,ip,role,parent_id) VALUES('ap-lukla','10.0.1.1','access',$1) RETURNING id`, core).Scan(&access)

	down := func(id int64, role string, v float64) {
		if err := e.Observe(ctx, Signal{Metric: "device_down", DeviceID: id, Role: role, Value: v, Label: "dev"}); err != nil {
			t.Fatal(err)
		}
	}
	state := func(id int64) (sev, st string, sup *int64) {
		pool.QueryRow(ctx, `SELECT severity,state,suppressed_by FROM alerts WHERE device_id=$1 ORDER BY id DESC LIMIT 1`, id).Scan(&sev, &st, &sup)
		return
	}

	// Sustained rule: core needs 2 consecutive failed polls, a single miss must not alert.
	down(core, "core", 1)
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM alerts`).Scan(&n)
	if n != 0 {
		t.Fatalf("alert opened after a single failed poll")
	}
	down(core, "core", 1)
	if sev, st, _ := state(core); sev != "P1" || st != "open" {
		t.Fatalf("core alert = %s/%s, want P1/open", sev, st)
	}
	down(core, "core", 1) // dedup: still one alert
	pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE device_id=$1`, core).Scan(&n)
	if n != 1 {
		t.Fatalf("dedup failed: %d alerts", n)
	}

	// Access device (child) fails: its alert must be suppressed by the core alert.
	for i := 0; i < 4; i++ {
		down(access, "access", 1)
	}
	if _, _, sup := state(access); sup == nil {
		t.Fatal("child alert should be suppressed while parent is down")
	}

	// Escalation: P1 step at 0 min fires push+sms for NOC Primary once; suppressed child never notifies.
	var cid, gid int64
	pool.QueryRow(ctx, `INSERT INTO contacts(name,phone,push_token) VALUES('Asha','+97798000','tok') RETURNING id`).Scan(&cid)
	pool.QueryRow(ctx, `SELECT id FROM contact_groups WHERE name='NOC Primary'`).Scan(&gid)
	pool.Exec(ctx, `INSERT INTO contact_group_members VALUES($1,$2)`, gid, cid)
	rec := &recorder{}
	x := NewEscalator(pool, rec)
	if err := x.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	first := rec.count()
	if first != 2 {
		t.Fatalf("minute-0 P1 notifications = %d, want 2 (push+sms)", first)
	}
	x.Tick(ctx)
	if rec.count() != first {
		t.Fatal("steps must fire once, not on every tick")
	}
	for _, m := range rec.msgs {
		if m.Device == "ap-lukla" {
			t.Fatal("suppressed alert escalated")
		}
	}

	// Later step becomes due: move the clock by rewinding the escalation base 6 minutes.
	pool.Exec(ctx, `UPDATE alerts SET escalation_base = now() - interval '6 minutes' WHERE device_id=$1`, core)
	x.Tick(ctx)
	if got := rec.count(); got != first+2 { // +2 min push, +5 min voice
		t.Fatalf("after 6 min notifications = %d, want %d", got, first+2)
	}

	// Ack stops escalation.
	var coreAlert int64
	pool.QueryRow(ctx, `SELECT id FROM alerts WHERE device_id=$1`, core).Scan(&coreAlert)
	if err := e.Ack(ctx, coreAlert, "asha"); err != nil {
		t.Fatal(err)
	}
	pool.Exec(ctx, `UPDATE alerts SET escalation_base = now() - interval '20 minutes' WHERE id=$1`, coreAlert)
	before := rec.count()
	x.Tick(ctx)
	if rec.count() != before {
		t.Fatal("acknowledged alert kept escalating")
	}

	// Recovery: core clears -> resolved; child is released with a fresh escalation clock.
	down(core, "core", 0)
	if _, st, _ := state(core); st != "resolved" {
		t.Fatalf("core state=%s, want resolved after recovery (acknowledged alerts resolve too)", st)
	}
	if _, st, sup := state(access); sup != nil || st != "open" {
		t.Fatalf("child should be released and open, got sup=%v st=%s", sup, st)
	}
	down(access, "access", 0)
	if _, st, _ := state(access); st != "resolved" {
		t.Fatal("child did not resolve")
	}
}

func TestUtilisationSeverityTracksValue(t *testing.T) {
	pool := testdb.Open(t)
	ctx := context.Background()
	e := NewEngine(pool)
	var dev int64
	pool.QueryRow(ctx, `INSERT INTO devices(name,ip,role) VALUES('agg','10.0.0.2','aggregation') RETURNING id`).Scan(&dev)
	obs := func(v float64) {
		if err := e.Observe(ctx, Signal{Metric: "if_util", DeviceID: dev, Key: "sfp1", Role: "aggregation", Value: v, Label: "agg sfp1"}); err != nil {
			t.Fatal(err)
		}
	}
	sev := func() (s, st string) {
		pool.QueryRow(ctx, `SELECT severity,state FROM alerts WHERE device_id=$1 ORDER BY id DESC LIMIT 1`, dev).Scan(&s, &st)
		return
	}
	for i := 0; i < 3; i++ {
		obs(85)
	}
	if s, _ := sev(); s != "P3" {
		t.Fatalf("85%% -> %s, want P3", s)
	}
	for i := 0; i < 3; i++ {
		obs(96)
	}
	if s, st := sev(); s != "P1" || st != "open" {
		t.Fatalf("96%% -> %s/%s, want P1 (single alert upgraded in place)", s, st)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE device_id=$1`, dev).Scan(&n)
	if n != 1 {
		t.Fatalf("%d alerts, want 1", n)
	}
	obs(40)
	if _, st := sev(); st != "resolved" {
		t.Fatal("did not resolve when utilisation dropped")
	}
}
