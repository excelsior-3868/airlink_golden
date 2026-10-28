# ONT Restart (Restart CPE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins (any ONT) and resellers (their own ONTs) restart a customer's ONT from the Online Customers detail view, on Huawei and HSGQ OLTs.

**Architecture:** The Go NMS gets one route, `POST /olts/{id}/onts/{ontId}/reboot`. It loads the ONT from `ont_inventory`, checks access, then calls a per-vendor `RebootONT` (Huawei in `internal/olt`, HSGQ in `internal/hsgq`). Commands come only from validated integer constructors. Laravel exposes the ONT's inventory id on the customer detail response, and the React modal gets a button that calls the NMS route.

**Tech Stack:** Go (chi, database/sql), PHP/Laravel, React + TypeScript + Tailwind, axios.

Spec: `docs/superpowers/specs/2026-10-28-ont-restart-design.md`

## Global Constraints

- Huawei command: `ont reset <port> <ont_id>` run inside `interface gpon <frame>/<slot>`, ont_id 0-127. Session steps are `enable`, `config` (already done by `olt.PGDialer`).
- HSGQ command: `ont reset <pon> <ont_id>` in config mode (`enable`, `configure`, already done by `hsgq.Dialer`), pon 1-16, ont_id 0-127.
- `all` and a bare `reboot` must never be producible. Builders take integers only.
- HSGQ sync stays on `readOnlyExec`; the restart uses its own path.
- Access: admin any ONT; reseller only when `canAccessOLT` is true AND the ONT belongs to them (same rule as `listONTs`: `reseller_id = user` OR (`reseller_id IS NULL` AND a `pppoe_customers` row with that serial has `reseller_id = user`)). Everyone else gets 403.
- Role gate on the route: `need("operator")` (resellers map to `operator`).
- Audit action name: `ont.reboot`. Cooldown: 60 seconds per ONT (in memory).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run Go commands from `/home/airlink_golden/nms-backend`. The working tree has unrelated uncommitted changes: always `git add` explicit paths, never `git add -A`.

---

### Task 1: Huawei ONT reset command and `Service.RebootONT`

**Files:**
- Modify: `nms-backend/internal/olt/cmd.go` (after `OntDelete`, near line 195)
- Create: `nms-backend/internal/olt/reboot.go`
- Test: `nms-backend/internal/olt/reboot_test.go`

**Interfaces:**
- Produces: `func OntReset(port, ontID int) (Cmd, error)`; `func VendorWriteCmd(text string) Cmd`; `func (s *Service) RebootONT(ctx context.Context, oltID int64, frame, slot, port, ontID int) error`.
- Consumes: `Cmd`, `rng`, `InterfaceGpon`, `Quit`, `OutputError`, `Executor`, `Dialer` (all existing in package `olt`).

- [ ] **Step 1: Write the failing tests**

Create `nms-backend/internal/olt/reboot_test.go`:

```go
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

type fakeExec struct {
	ran    []string
	closed bool
	out    map[string]string
}

func (f *fakeExec) Run(_ context.Context, c Cmd) (string, error) {
	f.ran = append(f.ran, c.String())
	return f.out[c.String()], nil
}
func (f *fakeExec) Close() error { f.closed = true; return nil }

type fakeDialer struct{ ex *fakeExec }

func (d fakeDialer) Dial(context.Context, int64) (Executor, error) { return d.ex, nil }

func TestRebootONTCommandSequence(t *testing.T) {
	ex := &fakeExec{}
	s := &Service{dialer: fakeDialer{ex}}
	if err := s.RebootONT(context.Background(), 1, 0, 0, 3, 17); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(ex.ran, " | ")
	if got != "interface gpon 0/0 | ont reset 3 17 | quit" || !ex.closed {
		t.Fatalf("ran %q closed=%v", got, ex.closed)
	}
}

func TestRebootONTReportsOLTError(t *testing.T) {
	ex := &fakeExec{out: map[string]string{"ont reset 3 17": "  Failure: The ONT does not exist\r\n"}}
	s := &Service{dialer: fakeDialer{ex}}
	err := s.RebootONT(context.Background(), 1, 0, 0, 3, 17)
	if err == nil || !strings.Contains(err.Error(), "Failure") {
		t.Fatalf("err = %v, want OLT failure", err)
	}
}

func TestRebootONTRejectsBadPosition(t *testing.T) {
	ex := &fakeExec{}
	s := &Service{dialer: fakeDialer{ex}}
	if err := s.RebootONT(context.Background(), 1, 0, 0, 99, 1); err == nil || len(ex.ran) != 0 {
		t.Fatalf("bad port ran %v err=%v", ex.ran, err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/olt -run 'TestOntReset|TestRebootONT' -v`
Expected: FAIL (compile error: `OntReset` / `RebootONT` undefined).

- [ ] **Step 3: Implement the builder**

In `nms-backend/internal/olt/cmd.go`, directly after the `OntDelete` function, add:

```go
// OntReset restarts one ONT. It must be run inside `interface gpon <f>/<s>`. `ont reset <port> all` also exists on the
// OLT; it is deliberately not representable here. confirm only pre-approves a (y/n) prompt if this release shows one.
func OntReset(port, ontID int) (Cmd, error) {
	if err := rng("port", port, 0, 15); err != nil {
		return Cmd{}, err
	}
	if err := rng("ont id", ontID, 0, 127); err != nil {
		return Cmd{}, err
	}
	return Cmd{text: fmt.Sprintf("ont reset %d %d", port, ontID), write: true, confirm: true}, nil
}

// VendorWriteCmd wraps a state-changing command built by another vendor's driver (internal/hsgq). Like VendorReadCmd,
// the caller owns validation: pass only constant text or text assembled from range-checked integers.
func VendorWriteCmd(text string) Cmd { return Cmd{text: text, write: true} }
```

- [ ] **Step 4: Implement `RebootONT`**

Create `nms-backend/internal/olt/reboot.go`:

```go
package olt

import (
	"context"
	"fmt"
)

// RebootONT restarts one ONT on a Huawei OLT: interface gpon <f>/<s>, ont reset <port> <ont>, quit.
// Every command is built from range-checked integers before the OLT is dialled.
func (s *Service) RebootONT(ctx context.Context, oltID int64, frame, slot, port, ontID int) error {
	iface, err := InterfaceGpon(frame, slot)
	if err != nil {
		return err
	}
	reset, err := OntReset(port, ontID)
	if err != nil {
		return err
	}
	ex, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		return fmt.Errorf("cannot connect to OLT: %w", err)
	}
	defer ex.Close()
	for _, c := range []Cmd{iface, reset} {
		out, err := ex.Run(ctx, c)
		if err != nil {
			return fmt.Errorf("%s: %w", c.String(), err)
		}
		if msg := OutputError(out); msg != "" {
			return fmt.Errorf("%s: %s", c.String(), msg)
		}
	}
	_, _ = ex.Run(ctx, Quit())
	return nil
}
```

- [ ] **Step 5: Run to verify pass**

Run: `go test ./internal/olt -run 'TestOntReset|TestRebootONT' -v && go test ./internal/olt`
Expected: PASS (existing tests, including the "reboot is rejected" reparse test, still pass).

- [ ] **Step 6: Commit**

```bash
git add nms-backend/internal/olt/cmd.go nms-backend/internal/olt/reboot.go nms-backend/internal/olt/reboot_test.go
git commit -m "Add Huawei ONT reset command and RebootONT

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: HSGQ ONT reset command and `Service.RebootONT`

**Files:**
- Create: `nms-backend/internal/hsgq/reboot.go`
- Test: `nms-backend/internal/hsgq/reboot_test.go`

**Interfaces:**
- Consumes: `olt.VendorWriteCmd(text string) olt.Cmd` (Task 1), `olt.Executor`, `olt.Dialer`, `hsgq.Service` fields `dialer`.
- Produces: `func OntReset(pon, ont int) (string, error)`; `func checkOntReset(cmd string) error`; `func (s *Service) RebootONT(ctx context.Context, oltID int64, pon, ontID int) error`.

- [ ] **Step 1: Write the failing tests**

Create `nms-backend/internal/hsgq/reboot_test.go`:

```go
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

type fakeExec struct {
	ran    []string
	closed bool
}

func (f *fakeExec) Run(_ context.Context, c olt.Cmd) (string, error) {
	f.ran = append(f.ran, c.String())
	return "", nil
}
func (f *fakeExec) Close() error { f.closed = true; return nil }

type fakeDialer struct{ ex *fakeExec }

func (d fakeDialer) Dial(context.Context, int64) (olt.Executor, error) { return d.ex, nil }

func TestRebootONTSendsOnlyTheReset(t *testing.T) {
	ex := &fakeExec{}
	s := &Service{dialer: fakeDialer{ex}}
	if err := s.RebootONT(context.Background(), 4, 3, 17); err != nil {
		t.Fatal(err)
	}
	if strings.Join(ex.ran, "|") != "ont reset 3 17" || !ex.closed {
		t.Fatalf("ran %v closed=%v", ex.ran, ex.closed)
	}
}

func TestRebootONTRejectsBadPosition(t *testing.T) {
	ex := &fakeExec{}
	s := &Service{dialer: fakeDialer{ex}}
	if err := s.RebootONT(context.Background(), 4, 0, 1); err == nil || len(ex.ran) != 0 {
		t.Fatalf("bad pon ran %v err=%v", ex.ran, err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/hsgq -run 'TestOntReset|TestCheckOntReset|TestRebootONT' -v`
Expected: FAIL (compile error: `OntReset`, `checkOntReset`, `RebootONT` undefined).

- [ ] **Step 3: Implement**

Create `nms-backend/internal/hsgq/reboot.go`:

```go
package hsgq

import (
	"context"
	"fmt"
	"regexp"
	"strconv"

	"github.com/nepalairlink/nms/internal/olt"
)

// OntReset builds the config-mode line that restarts one ONT: `ont reset <pon 1-16> <onu 0-127>`.
// `ont reset <pon> all` and a bare `reboot` (which restarts the whole OLT) are not representable.
func OntReset(pon, ont int) (string, error) {
	if pon < 1 || pon > 16 {
		return "", fmt.Errorf("pon %d out of range 1..16", pon)
	}
	if ont < 0 || ont > 127 {
		return "", fmt.Errorf("ont id %d out of range 0..127", ont)
	}
	return "ont reset " + strconv.Itoa(pon) + " " + strconv.Itoa(ont), nil
}

var ontResetRe = regexp.MustCompile(`^ont reset (\d{1,2}) (\d{1,3})$`)

// checkOntReset is the last guard before the line is sent: exactly one in-range single-ONT reset, nothing else.
func checkOntReset(cmd string) error {
	m := ontResetRe.FindStringSubmatch(cmd)
	if m == nil {
		return fmt.Errorf("%w: %q", ErrReadOnly, cmd)
	}
	pon, _ := strconv.Atoi(m[1])
	ont, _ := strconv.Atoi(m[2])
	if _, err := OntReset(pon, ont); err != nil {
		return err
	}
	return nil
}

// RebootONT restarts one ONT. The session is already in config mode (hsgq.Dialer), so only the reset line is sent.
// This is the only write the HSGQ driver performs; sync sessions stay behind readOnlyExec.
func (s *Service) RebootONT(ctx context.Context, oltID int64, pon, ontID int) error {
	line, err := OntReset(pon, ontID)
	if err != nil {
		return err
	}
	if err := checkOntReset(line); err != nil {
		return err
	}
	ex, err := s.dialer.Dial(ctx, oltID)
	if err != nil {
		return fmt.Errorf("cannot connect to OLT: %w", err)
	}
	defer ex.Close()
	out, err := ex.Run(ctx, olt.VendorWriteCmd(line))
	if err != nil {
		return fmt.Errorf("%s: %w", line, err)
	}
	if msg := olt.OutputError(out); msg != "" {
		return fmt.Errorf("%s: %s", line, msg)
	}
	return nil
}
```

- [ ] **Step 4: Run to verify pass**

Run: `go test ./internal/hsgq -v 2>&1 | tail -20`
Expected: PASS, including the existing `checkReadOnly` test that rejects `reboot`.

- [ ] **Step 5: Commit**

```bash
git add nms-backend/internal/hsgq/reboot.go nms-backend/internal/hsgq/reboot_test.go
git commit -m "Add HSGQ ONT reset command and RebootONT

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: NMS reboot route, authorization and cooldown

**Files:**
- Create: `nms-backend/internal/api/reboot_handlers.go`
- Modify: `nms-backend/internal/api/api.go:94` (add the route after the `updateONTReseller` line)
- Test: `nms-backend/internal/api/reboot_handlers_test.go`

**Interfaces:**
- Consumes: `olt.Service.RebootONT(ctx, oltID, frame, slot, port, ontID) error` (Task 1), `hsgq.Service.RebootONT(ctx, oltID, pon, ontID) error` (Task 2), `Server.isHSGQ`, `Server.canAccessOLT`, `Server.audit`, `idParam`, `fail`, `writeJSON`, `userFrom`, `principal`.
- Produces: `POST /olts/{id}/onts/{ontId}/reboot` → `200 {"ok":true,"message":"..."}`; `403`, `404`, `429`, `502` on failure. Pure helpers `ontOwnedBy(u principal, resellerID sql.NullInt64, customerResellerID sql.NullInt64) bool` and `type cooldown` with `Allow(key int64, now time.Time) (bool, time.Duration)`.

- [ ] **Step 1: Write the failing tests**

Create `nms-backend/internal/api/reboot_handlers_test.go`:

```go
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
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/api -run 'TestOntOwnedBy|TestCooldown' -v`
Expected: FAIL (compile error: `ontOwnedBy`, `newCooldown` undefined).

- [ ] **Step 3: Implement the handler**

Create `nms-backend/internal/api/reboot_handlers.go`:

```go
package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const rebootCooldown = 60 * time.Second

// cooldown allows one action per key per window (in memory; a restart of the NMS clears it, which is fine).
type cooldown struct {
	mu   sync.Mutex
	win  time.Duration
	last map[int64]time.Time
}

func newCooldown(win time.Duration) *cooldown {
	return &cooldown{win: win, last: map[int64]time.Time{}}
}

// Allow records the attempt when it is allowed; otherwise it returns how long is left.
func (c *cooldown) Allow(key int64, now time.Time) (bool, time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if t, ok := c.last[key]; ok && now.Sub(t) < c.win {
		return false, c.win - now.Sub(t)
	}
	c.last[key] = now
	return true, 0
}

// ontOwnedBy mirrors listONTs: an ONT belongs to a reseller when ont_inventory.reseller_id is theirs, or when it is
// unassigned and the PPPoE customer holding that serial is theirs. Admins own everything; other roles own nothing.
func ontOwnedBy(u principal, ontReseller, customerReseller sql.NullInt64) bool {
	if u.Role == "admin" || u.OriginalRole == "admin" {
		return true
	}
	if u.OriginalRole != "reseller" || u.ID <= 0 {
		return false
	}
	if ontReseller.Valid {
		return ontReseller.Int64 == u.ID
	}
	return customerReseller.Valid && customerReseller.Int64 == u.ID
}

func (s *Server) rebootONT(w http.ResponseWriter, r *http.Request) {
	oltID, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ontRowID, ok := idParam(w, r, "ontId")
	if !ok {
		return
	}
	if !s.canAccessOLT(r.Context(), r, oltID) {
		fail(w, 403, "access denied to this OLT")
		return
	}

	var serial string
	var frame, slot, pon, ontID int
	var ontReseller, customerReseller sql.NullInt64
	err := s.db.QueryRowContext(r.Context(), `
		SELECT oi.serial_number, oi.frame, oi.slot, oi.pon_port, oi.ont_id, oi.reseller_id,
		       (SELECT pc.reseller_id FROM pppoe_customers pc WHERE pc.onu_serial_number=oi.serial_number LIMIT 1)
		FROM ont_inventory oi WHERE oi.olt_id=? AND oi.id=?`, oltID, ontRowID).
		Scan(&serial, &frame, &slot, &pon, &ontID, &ontReseller, &customerReseller)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "ONT not found on this OLT")
		return
	}
	if err != nil {
		s.dbError(w, err)
		return
	}
	if !ontOwnedBy(userFrom(r), ontReseller, customerReseller) {
		fail(w, 403, "you do not have access to this ONT")
		return
	}
	if ok, wait := s.rebootCD.Allow(ontRowID, time.Now()); !ok {
		fail(w, 429, fmt.Sprintf("this ONT was restarted moments ago; try again in %d seconds", int(wait.Seconds())+1))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if s.isHSGQ(ctx, oltID) {
		if s.hsgq == nil {
			fail(w, 502, "HSGQ driver is not enabled")
			return
		}
		err = s.hsgq.RebootONT(ctx, oltID, pon, ontID)
	} else {
		err = s.olts.RebootONT(ctx, oltID, frame, slot, pon, ontID)
	}
	target := fmt.Sprintf("ont:%d", ontRowID)
	if err != nil {
		s.audit(r, "ont.reboot_failed", target, fmt.Sprintf("olt:%d sn:%s err:%v", oltID, serial, err))
		fail(w, 502, "restart failed: "+err.Error())
		return
	}
	s.audit(r, "ont.reboot", target, fmt.Sprintf("olt:%d sn:%s pos:%d/%d/%d/%d", oltID, serial, frame, slot, pon, ontID))
	writeJSON(w, 200, map[string]any{"ok": true, "message": "Restart command sent. The ONT will be back in about 2 minutes."})
}
```

- [ ] **Step 4: Wire the Server field and route**

In `nms-backend/internal/api/api.go`, add the field to `Server` (after `box *secretbox.Box`):

```go
	rebootCD *cooldown
```

In `New`, change the return to:

```go
	return &Server{db: db, cfg: cfg, engine: e, olts: o, rebootCD: newCooldown(rebootCooldown)}
```

Add the route right after the `updateONTReseller` route line (`r.With(need("admin")).Patch("/olts/{id}/onts/{ontId}/reseller", ...)`):

```go
			r.With(need("operator")).Post("/olts/{id}/onts/{ontId}/reboot", s.rebootONT)
```

- [ ] **Step 5: Run to verify pass and build**

Run: `go build ./... && go vet ./internal/api && go test ./internal/api ./internal/olt ./internal/hsgq`
Expected: build OK, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add nms-backend/internal/api/reboot_handlers.go nms-backend/internal/api/reboot_handlers_test.go nms-backend/internal/api/api.go
git commit -m "Add NMS route to restart an ONT with ownership check and cooldown

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Expose the customer's ONT on the customer detail response

**Files:**
- Modify: `backend/app/Http/Controllers/Api/PppoeCustomerController.php:238-243` (in `show`, before `return $this->ok($customer);`)

**Interfaces:**
- Produces: `GET /pppoe/customers/{id}` data gains `ont`: `{ "id": int, "olt_id": int, "run_state": string|null }` or `null` when the customer's serial has no inventory row.

- [ ] **Step 1: Add the lookup**

In `show()`, after `$customer->current_session = $live;` add:

```php
        // The ONT this customer's serial maps to, so the details view can offer "Restart CPE".
        $customer->ont = $customer->onu_serial_number
            ? DB::table('ont_inventory')
                ->where('serial_number', $customer->onu_serial_number)
                ->first(['id', 'olt_id', 'run_state'])
            : null;
```

- [ ] **Step 2: Verify**

Run: `php -l backend/app/Http/Controllers/Api/PppoeCustomerController.php`
Expected: `No syntax errors detected`.

Then in the running backend container, for a customer known to have a serial:
`docker exec airlink-backend-golden php artisan tinker --execute='echo json_encode(DB::table("ont_inventory")->where("serial_number", App\Models\PppoeCustomer::whereNotNull("onu_serial_number")->value("onu_serial_number"))->first(["id","olt_id","run_state"]));'`
Expected: a JSON object with `id`, `olt_id`, `run_state` (this is the exact query the controller runs).

- [ ] **Step 3: Commit**

```bash
git add backend/app/Http/Controllers/Api/PppoeCustomerController.php
git commit -m "Return the customer's ONT inventory id on the detail response

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Restart CPE button in the subscriber detail modal

**Files:**
- Modify: `frontend/src/components/SubscriberDetailModal.tsx` (imports line 2 and 4; state near line 109; handler after `handleDisconnect`; button in the action row near line 232; `ConfirmModal` near line 514)

**Interfaces:**
- Consumes: `customer.ont` (`{ id: number; olt_id: number; run_state: string | null } | null`, Task 4); `POST /olts/{oltId}/onts/{ontId}/reboot` via `nmsApi` (Task 3); `errMsg` from `lib/nmsApi`; `ConfirmModal` props `open, onClose, onConfirm, title, message, confirmText, tone`.

- [ ] **Step 1: Imports**

Change line 2 to add the `RotateCcw` icon:

```tsx
import { Users2, Activity, Power, RefreshCw, ArrowLeftRight, RotateCcw } from 'lucide-react'
```

After the `import { api } from '../lib/api'` line add:

```tsx
import { nmsApi, errMsg } from '../lib/nmsApi'
```

- [ ] **Step 2: State and handler**

After `const [confirmDisconnect, setConfirmDisconnect] = useState(false)` add:

```tsx
  const [restarting, setRestarting] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
```

After the `handleDisconnect` function add:

```tsx
  const handleRestartCpe = async () => {
    const ont = c?.ont
    if (!ont) return
    setRestarting(true)
    setActionMsg(null)
    try {
      const res = await nmsApi.post(`/olts/${ont.olt_id}/onts/${ont.id}/reboot`)
      setActionMsg({ ok: true, text: res.data?.message || 'Restart command sent.' })
    } catch (e) {
      setActionMsg({ ok: false, text: errMsg(e) })
    } finally {
      setRestarting(false)
      setConfirmRestart(false)
    }
  }
```

- [ ] **Step 3: Button**

In the action-buttons row, immediately before the `Change Package` button (the one with `onClick={() => setChangePackageOpen(true)}`), add:

```tsx
              {c.ont && (
                <button
                  type="button"
                  onClick={() => setConfirmRestart(true)}
                  disabled={restarting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 transition shadow-2xs cursor-pointer"
                  title="Restart the customer's ONT/CPE through the OLT"
                >
                  <RotateCcw size={14} className={restarting ? 'animate-spin text-indigo-500' : 'text-indigo-600'} />
                  <span>{restarting ? 'Restarting...' : 'Restart CPE'}</span>
                </button>
              )}
```

- [ ] **Step 4: Confirmation dialog**

Directly after the existing `Disconnect Session` `<ConfirmModal ... />` block add:

```tsx
      <ConfirmModal
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        onConfirm={handleRestartCpe}
        title="Restart CPE"
        message={`Restart the ONT for '${c?.username}'? The customer loses service for about 2 minutes.`}
        confirmText="Restart"
        tone="danger"
      />
```

- [ ] **Step 5: Type-check and build**

Run (from `/home/airlink_golden/frontend`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SubscriberDetailModal.tsx
git commit -m "Add Restart CPE button to the subscriber detail modal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy and verify on a live ONT

**Files:** none (verification only).

- [ ] **Step 1: Rebuild and restart**

Rebuild the NMS container and the frontend using the project's usual deploy flow (`docker-compose.golden.yml`; backend PHP changes are picked up by `deploy-backend-files.sh`). Confirm `docker logs airlink-nms-golden` shows a clean start.

- [ ] **Step 2: Verify authorization first (no ONT restart yet)**

With a reseller token, call the route for an ONT that belongs to a different reseller. Expected: `403 you do not have access to this ONT`. With the same token on an unknown ONT id: `404`.

- [ ] **Step 3: Restart one test ONT per vendor**

Pick one non-critical Huawei ONT and one HSGQ ONT (ask the user which, and warn the customer). In Online Customers, open the detail view, click **Restart CPE**, confirm. Expected: green banner, the ONT goes offline then online in about 2 minutes, an `ont.reboot` row appears in the audit log. Click again within 60 seconds: expected `429`.

- [ ] **Step 4: Record the Huawei confirmation behaviour**

Note whether the Huawei OLT showed a `(y/n)` prompt. The `confirm` flag handles it either way; if the restart fails with a confirmation error, report it and adjust `OntReset`.
