//go:build integration

// Package testdb gives integration tests a freshly migrated database.
// Tests are skipped unless TEST_DATABASE_URL is set.
package testdb


import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/nepalairlink/nms/internal/db"
)

func Open(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	sqlDB, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.Migrate(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
	return sqlDB
}

