// Package config loads runtime configuration and resolves secret references from the environment.
package config

import (
	"errors"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type User struct {
	Name     string
	Password string
	Role     string // admin | operator | viewer
}

type Config struct {
	HTTPAddr        string
	DatabaseURL     string
	JWTSecret       []byte
	SecretKey       []byte // encrypts OLT passwords stored in the database (NMS_SECRET_KEY, falls back to JWT_SECRET)
	Users           []User
	PollerID        string
	PollInterval    time.Duration
	PollWorkers     int
	OLTPollInterval time.Duration
	OLTSyncInterval time.Duration // scheduled read-only inventory sync; 0 disables
	WebhookURL      string        // generic notification bridge (SMS/voice/push gateway, AlertOps, ...)
	SaveAfterApply  bool          // issue `save` on the OLT after a verified job (default off, per design doc)
	DisableOLTPoll  bool

	VPNConfig  string // OPENVPN_CONFIG: path to .ovpn profile; empty disables the tunnel
	VPNUser    string
	VPNPass    string
	VPNKeyPass string
	VPNRoutes  []string // OPENVPN_ROUTES: comma-separated CIDRs to route through the tunnel
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		DatabaseURL:     env("DATABASE_URL", "airlink:airlink_pass@tcp(golden-mariadb:3306)/airlink_golden?parseTime=true"),
		PollerID:        env("POLLER_ID", "central"),
		PollInterval:    envDur("POLL_INTERVAL", 60*time.Second),
		PollWorkers:     envInt("POLL_WORKERS", 32),
		OLTPollInterval: envDur("OLT_POLL_INTERVAL", 5*time.Minute),
		OLTSyncInterval: envDur("OLT_SYNC_INTERVAL", 6*time.Hour),
		WebhookURL:      os.Getenv("NOTIFY_WEBHOOK_URL"),
		SaveAfterApply:  env("OLT_SAVE_AFTER_APPLY", "false") == "true",
		DisableOLTPoll:  env("OLT_POLL_DISABLE", "false") == "true",
		VPNConfig:       os.Getenv("OPENVPN_CONFIG"),
		VPNUser:         os.Getenv("OPENVPN_USER"),
		VPNPass:         os.Getenv("OPENVPN_PASS"),
		VPNKeyPass:      os.Getenv("OPENVPN_KEY_PASS"),
		VPNRoutes:       splitList(os.Getenv("OPENVPN_ROUTES")),
	}
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 16 {
		return nil, errors.New("JWT_SECRET must be set to a random value of at least 16 characters")
	}
	c.JWTSecret = []byte(secret)
	c.SecretKey = c.JWTSecret
	if k := os.Getenv("NMS_SECRET_KEY"); len(k) >= 16 {
		c.SecretKey = []byte(k)
	} else {
		// Kept for compatibility: OLT passwords already stored were encrypted with
		// the JWT secret. Set NMS_SECRET_KEY (and re-save OLT passwords) to decouple.
		log.Println("WARNING: NMS_SECRET_KEY not set; OLT passwords are encrypted with JWT_SECRET")
	}

	// Static NMS accounts ("name:password:role,..."). There is no built-in default:
	// the web console signs in through Airlink (Sanctum) tokens, so when NMS_USERS is
	// unset the direct /auth/login endpoint simply has no accounts.
	usersEnv := os.Getenv("NMS_USERS")
	if usersEnv == "" {
		log.Println("NMS_USERS not set; direct NMS login disabled (Airlink tokens only)")
	}
	for _, part := range strings.Split(usersEnv, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		f := strings.SplitN(part, ":", 3)
		if len(f) != 3 || (f[2] != "admin" && f[2] != "operator" && f[2] != "viewer") {
			continue
		}
		c.Users = append(c.Users, User{f[0], f[1], f[2]})
	}
	return c, nil
}

// Secret resolves a credential reference ("default", "olt-bijule") to an environment value.
// The database only ever stores the reference; e.g. SNMP_COMMUNITY_DEFAULT, OLT_SSH_USER_OLT_BIJULE.
func Secret(kind, ref string) string {
	if ref == "" {
		ref = "default"
	}
	key := strings.ToUpper(strings.NewReplacer("-", "_", ".", "_").Replace(kind + "_" + ref))
	return os.Getenv(key)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}

func envDur(k string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}

func splitList(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
