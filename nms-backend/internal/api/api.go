// Package api exposes the NMS REST API used by the web console.
package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/ssh"

	"github.com/nepalairlink/nms/internal/alerts"
	"github.com/nepalairlink/nms/internal/config"
	"github.com/nepalairlink/nms/internal/olt"
	"github.com/nepalairlink/nms/internal/secretbox"
)

type Server struct {
	db     *sql.DB
	cfg    *config.Config
	engine *alerts.Engine
	olts   *olt.Service
	box    *secretbox.Box
}

// SetSecretBox enables storing OLT passwords entered from the frontend.
func (s *Server) SetSecretBox(b *secretbox.Box) { s.box = b }

func New(db *sql.DB, cfg *config.Config, e *alerts.Engine, o *olt.Service) *Server {
	return &Server{db: db, cfg: cfg, engine: e, olts: o}
}

type ctxKey int

const userKey ctxKey = 1

type principal struct{ Name, Role string }

var roleRank = map[string]int{"viewer": 1, "operator": 2, "admin": 3}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(60*time.Second))
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	mountRoutes := func(r chi.Router) {
		r.Post("/auth/login", s.login)
		r.Group(func(r chi.Router) {
			r.Use(s.auth)
			r.Get("/me", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, userFrom(r)) })
			r.Get("/summary", s.summary)

			r.Get("/pops", s.listPops)
			r.With(need("admin")).Post("/pops", s.createPop)

			r.Get("/devices", s.listDevices)
			r.Get("/devices/{id}", s.getDevice)
			r.Get("/devices/{id}/interfaces", s.deviceInterfaces)
			r.Get("/devices/{id}/metrics", s.deviceMetrics)
			r.With(need("admin")).Post("/devices", s.createDevice)
			r.With(need("admin")).Patch("/devices/{id}", s.updateDevice)
			r.With(need("admin")).Delete("/devices/{id}", s.deleteDevice)
			r.With(need("admin")).Patch("/interfaces/{id}", s.updateInterface)

			r.Get("/alerts", s.listAlerts)
			r.With(need("operator")).Post("/alerts/{id}/ack", s.ackAlert)
			r.With(need("operator")).Post("/alerts/{id}/resolve", s.resolveAlert)
			r.Get("/alerts/{id}/notifications", s.alertNotifications)

			r.Get("/rules", s.listRules)
			r.With(need("admin")).Put("/rules/{id}", s.updateRule)
			r.Get("/contacts", s.listContacts)
			r.With(need("admin")).Post("/contacts", s.createContact)
			r.With(need("admin")).Delete("/contacts/{id}", s.deleteContact)
			r.Get("/contact-groups", s.listGroups)
			r.With(need("admin")).Put("/contact-groups/{id}/members/{contactId}", s.addGroupMember)
			r.With(need("admin")).Delete("/contact-groups/{id}/members/{contactId}", s.removeGroupMember)
			r.Get("/escalation-policies", s.listPolicies)

			r.Get("/olts", s.listOLTs)
			r.With(need("admin")).Post("/olts", s.createOLT)
			r.With(need("admin")).Post("/olts/{id}/credentials", s.updateOLTLogin)
			r.With(need("admin")).Post("/olts/{id}/test", s.testOLT)
			r.With(need("admin")).Post("/olts/{id}/host-key/fetch", s.fetchHostKey)
			r.With(need("admin")).Post("/olts/{id}/host-key/trust", s.trustHostKey)
			r.Get("/olts/{id}/onts", s.listONTs)
			r.With(need("operator")).Get("/olts/{id}/autofind", s.autofind)
			r.With(need("operator")).Post("/olts/{id}/sync", s.startSync)
			r.Get("/olts/{id}/sync-runs", s.syncRuns)
			r.Get("/olts/{id}/inventory/{kind}", s.oltInventory)
			r.Get("/olts/{id}/snapshots", s.oltSnapshots)
			r.Get("/olts/{id}/profiles", s.listProfiles)
			r.With(need("admin")).Post("/olts/{id}/profiles", s.createProfile)
			r.Get("/service-templates", s.listTemplates)
			r.With(need("admin")).Post("/service-templates", s.createTemplate)

			r.Get("/jobs", s.listJobs)
			r.Get("/jobs/{id}", s.getJob)
			r.With(need("operator")).Post("/jobs", s.planJob)
			r.With(need("admin")).Post("/jobs/{id}/approve", s.approveJob)
			r.With(need("operator")).Post("/jobs/{id}/apply", s.applyJob)
			r.With(need("operator")).Post("/jobs/{id}/reject", s.rejectJob)
			r.With(need("admin")).Post("/jobs/{id}/save", s.saveJob)

			r.With(need("admin")).Get("/audit", s.listAudit)
		})
	}

	r.Route("/api/v1", mountRoutes)
	r.Route("/api/nms/v1", mountRoutes)
	r.Route("/api/nms", mountRoutes)
	return r
}

// ---- auth ----

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username, Password string }
	if !decode(w, r, &in) {
		return
	}
	for _, u := range s.cfg.Users {
		userOK := subtle.ConstantTimeCompare([]byte(u.Name), []byte(in.Username)) == 1
		passOK := subtle.ConstantTimeCompare([]byte(u.Password), []byte(in.Password)) == 1
		if userOK && passOK {
			tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"sub": u.Name, "role": u.Role, "exp": time.Now().Add(12 * time.Hour).Unix(),
			}).SignedString(s.cfg.JWTSecret)
			if err != nil {
				fail(w, 500, "could not issue token")
				return
			}
			writeJSON(w, 200, map[string]any{"token": tok, "user": principal{u.Name, u.Role}})
			return
		}
	}
	fail(w, 401, "invalid credentials")
}

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		raw, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || strings.TrimSpace(raw) == "" {
			fail(w, 401, "missing bearer token")
			return
		}
		raw = strings.TrimSpace(raw)

		// 1. Try Airlink Sanctum SSO token verification against personal_access_tokens
		var username, role, status string
		var tokenHash string
		var tokenID int64

		if strings.Contains(raw, "|") {
			parts := strings.SplitN(raw, "|", 2)
			if id, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
				tokenID = id
				sum := sha256.Sum256([]byte(parts[1]))
				tokenHash = hex.EncodeToString(sum[:])
			}
		} else {
			sum := sha256.Sum256([]byte(raw))
			tokenHash = hex.EncodeToString(sum[:])
		}

		var queryErr error
		if tokenID > 0 {
			queryErr = s.db.QueryRowContext(r.Context(), `
				SELECT u.username, u.role, u.status
				FROM personal_access_tokens t
				JOIN users u ON u.id = t.tokenable_id
				WHERE t.id = ? AND t.token = ? AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
				tokenID, tokenHash).Scan(&username, &role, &status)
		} else {
			queryErr = s.db.QueryRowContext(r.Context(), `
				SELECT u.username, u.role, u.status
				FROM personal_access_tokens t
				JOIN users u ON u.id = t.tokenable_id
				WHERE t.token = ? AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
				tokenHash).Scan(&username, &role, &status)
		}

		if queryErr == nil && status == "active" {
			nmsRole := "viewer"
			if role == "admin" {
				nmsRole = "admin"
			} else if role == "reseller" {
				nmsRole = "operator"
			}
			ctx := context.WithValue(r.Context(), userKey, principal{Name: username, Role: nmsRole})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// 2. Fall back to NMS JWT verification
		tok, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) { return s.cfg.JWTSecret, nil },
			jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
		if err == nil && tok.Valid {
			if c, ok := tok.Claims.(jwt.MapClaims); ok {
				name, _ := c["sub"].(string)
				role, _ := c["role"].(string)
				if roleRank[role] > 0 && name != "" {
					ctx := context.WithValue(r.Context(), userKey, principal{Name: name, Role: role})
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}
		}

		fail(w, 401, "invalid token")
	})
}

func need(minRole string) func(http.Handler) http.Handler {
	min := roleRank[minRole]
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if roleRank[userFrom(r).Role] < min {
				fail(w, 403, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func userFrom(r *http.Request) principal {
	if p, ok := r.Context().Value(userKey).(principal); ok {
		return p
	}
	return principal{}
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		fail(w, 400, "invalid JSON body")
		return false
	}
	return true
}

func idParam(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		fail(w, 400, "invalid id")
		return 0, false
	}
	return id, true
}

func (s *Server) queryJSON(ctx context.Context, sqlQuery string, args ...any) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		valPtrs := make([]any, len(cols))
		for i := range vals {
			valPtrs[i] = &vals[i]
		}
		if err := rows.Scan(valPtrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			val := vals[i]
			if b, ok := val.([]byte); ok {
				// Only attempt JSON unmarshal for JSON objects/arrays (starting with { or [)
				trimmed := bytes.TrimSpace(b)
				if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
					var parsed any
					if json.Unmarshal(trimmed, &parsed) == nil {
						m[c] = parsed
						continue
					}
				}
				m[c] = string(b)
			} else {
				m[c] = val
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Server) respondRows(w http.ResponseWriter, r *http.Request, sqlQuery string, args ...any) {
	rows, err := s.queryJSON(r.Context(), sqlQuery, args...)
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, 200, rows)
}

func (s *Server) dbError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sql.ErrNoRows):
		fail(w, 404, "not found")
	case strings.Contains(err.Error(), "1062") || strings.Contains(err.Error(), "Duplicate"):
		fail(w, 409, "already exists")
	case strings.Contains(err.Error(), "1452") || strings.Contains(err.Error(), "1451"):
		fail(w, 400, "invalid reference or value")
	default:
		fail(w, 500, "internal error: "+err.Error())
	}
}

func (s *Server) audit(r *http.Request, action, target, detail string) {
	s.db.ExecContext(context.Background(), `INSERT INTO audit_log(actor, action, target, detail) VALUES (?,?,?,?)`,
		userFrom(r).Name, action, target, detail)
}

func fingerprint(k ssh.PublicKey) string {
	h := sha256.Sum256(k.Marshal())
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(h[:])
}
