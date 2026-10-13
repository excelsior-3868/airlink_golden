package alerts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

type Message struct {
	AlertID     int64  `json:"alert_id"`
	Channel     string `json:"channel"` // push | sms | voice | email
	Recipient   string `json:"recipient"`
	ContactName string `json:"contact_name"`
	Severity    string `json:"severity"`
	Title       string `json:"title"`
	Detail      string `json:"detail"`
	Device      string `json:"device"`
}

type Notifier interface {
	Send(ctx context.Context, m Message) error
}

type LogNotifier struct{}

func (LogNotifier) Send(_ context.Context, m Message) error {
	slog.Warn("NOTIFY", "channel", m.Channel, "to", m.Recipient, "name", m.ContactName, "sev", m.Severity, "title", m.Title)
	return nil
}

type WebhookNotifier struct {
	URL    string
	Client *http.Client
}

func (w WebhookNotifier) Send(ctx context.Context, m Message) error {
	body, _ := json.Marshal(m)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c := w.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %s", resp.Status)
	}
	return nil
}

type Escalator struct {
	db       *sql.DB
	notifier Notifier
}

func NewEscalator(db *sql.DB, n Notifier) *Escalator {
	return &Escalator{db: db, notifier: n}
}

func (x *Escalator) Run(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := x.Tick(ctx); err != nil {
				slog.Error("escalation tick", "err", err)
			}
		}
	}
}

type liveAlert struct {
	id       int64
	severity string
	title    string
	detail   string
	device   string
	minutes  float64
}

func (x *Escalator) Tick(ctx context.Context) error {
	rows, err := x.db.QueryContext(ctx, `
		SELECT a.id, a.severity, a.title, a.detail, COALESCE(d.name,''),
		       TIMESTAMPDIFF(SECOND, a.escalation_base, NOW()) / 60.0
		FROM alerts a LEFT JOIN devices d ON d.id=a.device_id
		WHERE a.state='open' AND a.suppressed_by IS NULL`)
	if err != nil {
		return err
	}
	var live []liveAlert
	for rows.Next() {
		var a liveAlert
		if err := rows.Scan(&a.id, &a.severity, &a.title, &a.detail, &a.device, &a.minutes); err != nil {
			rows.Close()
			return err
		}
		live = append(live, a)
	}
	rows.Close()

	for _, a := range live {
		if err := x.fireDue(ctx, a); err != nil {
			slog.Error("escalate alert", "alert", a.id, "err", err)
		}
	}
	return nil
}

func (x *Escalator) fireDue(ctx context.Context, a liveAlert) error {
	rows, err := x.db.QueryContext(ctx, `
		SELECT s.id, s.channel, c.name, c.phone, c.email, c.push_token
		FROM escalation_steps s
		JOIN escalation_policies p ON p.id=s.policy_id AND p.severity=?
		JOIN contact_group_members m ON m.group_id=s.group_id
		JOIN contacts c ON c.id=m.contact_id
		WHERE s.after_minutes <= ?
		  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.alert_id=? AND n.step_id=s.id AND n.recipient = c.name)`,
		a.severity, a.minutes, a.id)
	if err != nil {
		return err
	}
	type target struct {
		step                       int64
		channel, name, phone, mail string
		push                       string
	}
	var ts []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.step, &t.channel, &t.name, &t.phone, &t.mail, &t.push); err != nil {
			rows.Close()
			return err
		}
		ts = append(ts, t)
	}
	rows.Close()

	for _, t := range ts {
		addr := map[string]string{"push": t.push, "sms": t.phone, "voice": t.phone, "email": t.mail}[t.channel]
		res, err := x.db.ExecContext(ctx,
			`INSERT IGNORE INTO notifications (alert_id, step_id, channel, recipient, status) VALUES (?,?,?,?,'pending')`,
			a.id, t.step, t.channel, t.name)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		status, errMsg := "sent", ""
		if addr == "" {
			status, errMsg = "failed", "contact has no address for channel "+t.channel
		} else if err := x.notifier.Send(ctx, Message{
			AlertID: a.id, Channel: t.channel, Recipient: addr, ContactName: t.name,
			Severity: a.severity, Title: a.title, Detail: a.detail, Device: a.device,
		}); err != nil {
			status, errMsg = "failed", err.Error()
		}
		if _, err := x.db.ExecContext(ctx,
			`UPDATE notifications SET status=?, error=?, sent_at=NOW() WHERE alert_id=? AND step_id=? AND recipient=?`,
			status, errMsg, a.id, t.step, t.name); err != nil {
			return err
		}
	}
	return nil
}
