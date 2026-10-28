package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nepalairlink/nms/internal/hsgq"
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

// rebootDriver picks the OLT driver from the device vendor, refusing anything ambiguous.
func rebootDriver(vendor string, frame, slot int) (string, error) {
	if hsgq.IsVendor(vendor) {
		if frame != 0 || slot != 0 {
			return "", fmt.Errorf("ONT record has Huawei frame/slot %d/%d but the OLT is HSGQ; re-sync the OLT", frame, slot)
		}
		return "hsgq", nil
	}
	v := strings.TrimSpace(strings.ToLower(vendor))
	if v == "" || strings.Contains(v, "huawei") {
		return "huawei", nil
	}
	return "", fmt.Errorf("restart is not supported for vendor %q", vendor)
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
	var vendorNS sql.NullString
	var frame, slot, pon, ontID int
	var ontReseller, customerReseller sql.NullInt64
	err := s.db.QueryRowContext(r.Context(), `
		SELECT oi.serial_number, oi.frame, oi.slot, oi.pon_port, oi.ont_id, oi.reseller_id, dv.vendor,
		       (SELECT pc.reseller_id FROM pppoe_customers pc WHERE pc.onu_serial_number=oi.serial_number LIMIT 1)
		FROM ont_inventory oi JOIN devices dv ON dv.id=oi.olt_id WHERE oi.olt_id=? AND oi.id=?`, oltID, ontRowID).
		Scan(&serial, &frame, &slot, &pon, &ontID, &ontReseller, &vendorNS, &customerReseller)
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
	driver, derr := rebootDriver(vendorNS.String, frame, slot)
	if derr != nil {
		fail(w, 400, derr.Error())
		return
	}
	if ok, wait := s.rebootCD.Allow(ontRowID, time.Now()); !ok {
		fail(w, 429, fmt.Sprintf("this ONT was restarted moments ago; try again in %d seconds", int(wait.Seconds())+1))
		return
	}

	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 45*time.Second)
	defer cancel()
	if driver == "hsgq" {
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
