//go:build integration

package hsgq

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/nepalairlink/nms/internal/olt"
	"github.com/nepalairlink/nms/internal/testdb"
)

// fakeOLT answers like an HSGQ: for `show ont-info N all` the captured rows that belong to PON N, or the
// "total of ONTs are: 0" line when the port has none.
type fakeOLT struct{ table string }

func (f fakeOLT) Close() error { return nil }
func (f fakeOLT) Run(_ context.Context, c olt.Cmd) (string, error) {
	cmd := c.String()
	if cmd == ShowVersion {
		return " System Version : HSGQ-G08R_IGD_V2.0.1_Rel\n Product : HSGQ-G08R\n", nil
	}
	var n int
	if _, err := fmt.Sscanf(cmd, "show ont-info %d all", &n); err != nil {
		return "", fmt.Errorf("unexpected command %q", cmd)
	}
	var out []string
	rows := 0
	for _, line := range strings.Split(f.table, "\n") {
		switch {
		case strings.HasPrefix(line, fmt.Sprintf("%d/", n)):
			out = append(out, line)
			rows++
		case strings.Contains(line, "PON/ONU"), strings.HasPrefix(line, "        Type"), strings.HasPrefix(line, "-----"):
			out = append(out, line)
		}
	}
	if rows == 0 {
		return fmt.Sprintf("In port %d , the total of ONTs are: 0, online: 0", n), nil
	}
	return strings.Join(out, "\n"), nil
}

type fakeDialer struct{ o fakeOLT }

func (d fakeDialer) Dial(context.Context, int64) (olt.Executor, error) { return d.o, nil }

func TestSyncDoesNotStealInactiveONTFromAnotherOLT(t *testing.T) {
	pool := testdb.Open(t)
	ctx := context.Background()
	exec := func(q string, a ...any) int64 {
		t.Helper()
		r, err := pool.ExecContext(ctx, q, a...)
		if err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		id, _ := r.LastInsertId()
		return id
	}
	tag := fmt.Sprintf("%d", os.Getpid())
	huawei := exec(`INSERT INTO devices(name,ip,role,vendor,poll_method,sys_descr) VALUES(?,'10.9.9.1','olt','Huawei','tcp','')`, "hw-"+tag)
	hsgqID := exec(`INSERT INTO devices(name,ip,role,vendor,poll_method,sys_descr) VALUES(?,'10.9.9.2','olt','HSGQ','tcp','')`, "hsgq-"+tag)
	for _, id := range []int64{huawei, hsgqID} {
		exec(`INSERT INTO olts(device_id,ssh_host_key,pon_ports) VALUES(?,'','')`, id)
	}
	const online, inactive, stale = "4D48415206B409E3", "47504F4E00851C18", "AAAAAAAAAAAAAAAA"
	// Both serials are held by the Huawei OLT; the HSGQ lists `online` as online and `inactive` as registered-only.
	exec(`INSERT INTO ont_inventory(serial_number,olt_id,frame,slot,pon_port,ont_id,reseller_id) VALUES(?,?,0,4,0,5,NULL)`, online, huawei)
	exec(`INSERT INTO ont_inventory(serial_number,olt_id,frame,slot,pon_port,ont_id,reseller_id) VALUES(?,?,0,4,1,6,NULL)`, inactive, huawei)
	// An ONT the HSGQ no longer lists on PON 1 must be removed.
	exec(`INSERT INTO ont_inventory(serial_number,olt_id,frame,slot,pon_port,ont_id) VALUES(?,?,0,0,1,99)`, stale, hsgqID)

	table := fixture(t)
	svc := NewService(pool, fakeDialer{fakeOLT{table}})
	for i := 1; i <= 2; i++ { // twice: a second sync must change nothing
		run, err := svc.Sync(ctx, hsgqID, "test")
		if err != nil || run.Status != "succeeded" {
			t.Fatalf("sync %d: %+v %v", i, run, err)
		}
		if run.Counts["left_to_other_olt"] != 1 {
			t.Fatalf("sync %d counts = %v, want exactly the inactive serial left to the other OLT", i, run.Counts)
		}
	}

	owner := func(sn string) (id int64, pon, ont int) {
		t.Helper()
		if err := pool.QueryRowContext(ctx, `SELECT olt_id,pon_port,ont_id FROM ont_inventory WHERE serial_number=?`, sn).Scan(&id, &pon, &ont); err != nil {
			t.Fatalf("%s: %v", sn, err)
		}
		return
	}
	if id, pon, ont := owner(online); id != hsgqID || pon != 1 || ont != 0 {
		t.Errorf("online ONT: olt=%d pon=%d ont=%d, want the HSGQ OLT at 1/0", id, pon, ont)
	}
	if id, pon, ont := owner(inactive); id != huawei || pon != 1 || ont != 6 {
		t.Errorf("inactive ONT was taken from the Huawei OLT: olt=%d pon=%d ont=%d", id, pon, ont)
	}
	var n int
	pool.QueryRowContext(ctx, `SELECT COUNT(*) FROM ont_inventory WHERE serial_number=?`, stale).Scan(&n)
	if n != 0 {
		t.Error("ONT the HSGQ no longer lists was not pruned")
	}
	pool.QueryRowContext(ctx, `SELECT COUNT(*) FROM ont_inventory WHERE olt_id=?`, hsgqID).Scan(&n)
	if want := len(ParseONTTable(table).Rows) - 1; n != want {
		t.Errorf("HSGQ OLT holds %d ONTs, want %d (every listed ONT except the one owned elsewhere)", n, want)
	}
}
