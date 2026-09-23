package main

import (
	"context"
	"database/sql"
	"notepad-server/internal/backup"
	"os"
	"path/filepath"
	"testing"
)

func TestDataSafetyRejectsInvalidCommandsAndMissingDB(t *testing.T) {
	p := filepath.Join(t.TempDir(), "data.db")
	for _, args := range [][]string{nil, {"restore"}, {"create", "elsewhere"}, {"inspect", "../data.db"}, {"create"}} {
		if _, e := dataSafety(context.Background(), args, p); e == nil {
			t.Fatalf("accepted %v", args)
		}
	}
	if _, e := os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("created empty db")
	}
}
func TestDataSafetyCreateAndInspectRealMigratedDatabase(t *testing.T) {
	p := filepath.Join(t.TempDir(), "data.db")
	db, e := sql.Open("sqlite", p)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	configureDatabasePool(db)
	if e = migrate(context.Background(), db); e != nil {
		t.Fatal(e)
	}
	var latest int
	db.QueryRow("SELECT MAX(version) FROM schema_migrations").Scan(&latest)
	if latest != backup.SupportedSchemaVersion {
		t.Fatalf("update supported backup schema: migration %d, inspector %d", latest, backup.SupportedSchemaVersion)
	}
	got, e := dataSafety(context.Background(), []string{"create"}, p)
	if e != nil {
		t.Fatal(e)
	}
	checked, e := dataSafety(context.Background(), []string{"inspect", got.Name}, p)
	if e != nil || got.SHA256 != checked.SHA256 {
		t.Fatalf("%#v %v", checked, e)
	}
}
