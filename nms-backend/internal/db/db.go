// Package db opens the MariaDB connection pool and applies embedded migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"github.com/nepalairlink/nms/migrations"
)

func Open(ctx context.Context, dsn string) (*sql.DB, error) {
	// Accept mysql://user:pass@host:port/dbname or user:pass@tcp(host:port)/dbname
	dsn = NormalizeDSN(dsn)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(32)
	db.SetMaxIdleConns(16)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// NormalizeDSN turns URL-like DSNs (mysql://user:pass@host:port/db) into Go MySQL driver format:
// user:pass@tcp(host:port)/db?parseTime=true
func NormalizeDSN(raw string) string {
	s := raw
	if strings.HasPrefix(s, "mysql://") {
		s = strings.TrimPrefix(s, "mysql://")
		// parse user:pass@host:port/db
		parts := strings.SplitN(s, "@", 2)
		if len(parts) == 2 {
			userInfo := parts[0]
			hostAndDB := parts[1]
			hParts := strings.SplitN(hostAndDB, "/", 2)
			if len(hParts) == 2 {
				hostPort := hParts[0]
				dbName := hParts[1]
				s = fmt.Sprintf("%s@tcp(%s)/%s", userInfo, hostPort, dbName)
			}
		}
	}
	if !strings.Contains(s, "parseTime=") {
		if strings.Contains(s, "?") {
			s += "&parseTime=true"
		} else {
			s += "?parseTime=true"
		}
	}
	if !strings.Contains(s, "multiStatements=") {
		s += "&multiStatements=true"
	}
	return s
}

// Migrate applies each embedded *.sql file once, in filename order.
// Uses GET_LOCK / RELEASE_LOCK for cross-instance safety.
func Migrate(ctx context.Context, db *sql.DB) error {
	var locked int
	err := db.QueryRowContext(ctx, "SELECT GET_LOCK('nms_migration_lock', 60)").Scan(&locked)
	if err != nil {
		return fmt.Errorf("acquiring migration lock: %w", err)
	}
	if locked != 1 {
		return fmt.Errorf("failed to acquire migration lock within timeout")
	}
	defer db.ExecContext(context.Background(), "SELECT RELEASE_LOCK('nms_migration_lock')")

	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS nms_schema_migrations (
		name VARCHAR(191) PRIMARY KEY,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`); err != nil {
		return fmt.Errorf("creating nms_schema_migrations: %w", err)
	}

	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return err
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var done int
		err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM nms_schema_migrations WHERE name = ?", name).Scan(&done)
		if err != nil {
			return err
		}
		if done > 0 {
			continue
		}

		sqlBytes, err := migrations.FS.ReadFile(name)
		if err != nil {
			return err
		}

		statements := splitSQLStatements(string(sqlBytes))
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		for _, stmt := range statements {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, stmt); err != nil {
				tx.Rollback()
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO nms_schema_migrations(name) VALUES(?)", name); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func splitSQLStatements(sql string) []string {
	var stmts []string
	var current strings.Builder
	inComment := false
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		if strings.HasPrefix(trimmed, "/*") {
			inComment = true
		}
		if inComment {
			if strings.Contains(trimmed, "*/") {
				inComment = false
			}
			continue
		}
		current.WriteString(line)
		current.WriteString("\n")
		if strings.HasSuffix(trimmed, ";") {
			s := strings.TrimSpace(current.String())
			if s != "" {
				stmts = append(stmts, s)
			}
			current.Reset()
		}
	}
	s := strings.TrimSpace(current.String())
	if s != "" {
		stmts = append(stmts, s)
	}
	return stmts
}
