package logic

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"notepad-server/internal/dao"
	"notepad-server/internal/model"

	_ "modernc.org/sqlite"
)

func newSettingsLogicTest(t *testing.T) (*SettingsLogic, *sql.DB, string) {
	t.Helper()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "data.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	schema := []string{
		`CREATE TABLE settings (
			id INTEGER PRIMARY KEY,
			theme TEXT NOT NULL,
			editor_opts TEXT,
			sync_enabled INTEGER,
			sync_endpoint TEXT,
			sync_provider TEXT,
			sync_username TEXT,
			sync_password TEXT
		)`,
		`INSERT INTO settings (id, theme, editor_opts, sync_enabled, sync_endpoint, sync_provider, sync_username, sync_password)
		 VALUES (1, 'light', '{"fontSize":15,"lineHeight":1.8}', 1, 'http://sync.local', 'local-lab', '', '')`,
		`CREATE TABLE files (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			is_folder INTEGER DEFAULT 0,
			parent_id TEXT DEFAULT '',
			sort_order INTEGER DEFAULT 0,
			is_deleted INTEGER DEFAULT 0,
			deleted_at INTEGER DEFAULT 0,
			is_pinned INTEGER DEFAULT 0
		)`,
		`INSERT INTO files
			(id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned)
		 VALUES
			('note', 'Note.md', '', 1, 1, 0, '', 0, 0, 0, 0),
			('folder', 'Folder', '', 1, 1, 1, '', 0, 0, 0, 0),
			('trash', 'Trash.md', '', 1, 1, 0, '', 0, 1, 1, 0),
			('template', '__tpl__Hidden', '', 1, 1, 0, '', 0, 0, 0, 0)`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create settings test schema: %v", err)
		}
	}

	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=5000`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		t.Fatal(err)
	}

	logic := &SettingsLogic{SettingsDAO: &dao.SettingsDAO{DB: db}}
	return logic, db, dbPath
}

func TestSettingsGetAndPartialUpdatePreserveExistingPreferences(t *testing.T) {
	logic, _, _ := newSettingsLogicTest(t)
	ctx := context.Background()

	settings, err := logic.Get(ctx)
	if err != nil {
		t.Fatalf("Get settings: %v", err)
	}
	if settings.Theme != "light" || !settings.SyncEnabled || settings.SyncEndpoint != "http://sync.local" || settings.SyncProvider != "local-lab" {
		t.Fatalf("unexpected settings: %#v", settings)
	}
	if settings.EditorOpts["fontSize"] != float64(15) {
		t.Fatalf("editor opts were not parsed from JSON: %#v", settings.EditorOpts)
	}

	dark := "dark"
	updated, err := logic.Update(ctx, &model.SettingsPatch{Theme: &dark})
	if err != nil {
		t.Fatalf("partial theme update: %v", err)
	}
	if updated.Theme != "dark" {
		t.Fatalf("theme = %q, want dark", updated.Theme)
	}
	if !updated.SyncEnabled || updated.SyncEndpoint != "http://sync.local" || updated.SyncProvider != "local-lab" {
		t.Fatalf("partial update cleared sync settings: %#v", updated)
	}
	if updated.EditorOpts["lineHeight"] != 1.8 {
		t.Fatalf("partial update cleared editor opts: %#v", updated.EditorOpts)
	}

	invalid := "sepia"
	if _, err := logic.Update(ctx, &model.SettingsPatch{Theme: &invalid}); err == nil {
		t.Fatal("expected invalid theme to fail")
	}
	provider := "webdav"
	endpoint := "https://dav.example.test/notepad"
	username := "alice"
	password := "secret-value"
	webdav, err := logic.Update(ctx, &model.SettingsPatch{
		SyncProvider: &provider, SyncEndpoint: &endpoint, SyncUsername: &username, SyncPassword: &password,
	})
	if err != nil { t.Fatalf("enable webdav settings: %v", err) }
	if webdav.SyncProvider != "webdav" || webdav.SyncUsername != "alice" || !webdav.SyncPasswordSet {
		t.Fatalf("unexpected webdav settings: %#v", webdav)
	}
	encoded, err := json.Marshal(webdav)
	if err != nil { t.Fatal(err) }
	if strings.Contains(string(encoded), password) || strings.Contains(string(encoded), "sync_password\"") {
		t.Fatalf("password leaked in settings JSON: %s", encoded)
	}
	insecure := "http://dav.example.test/notepad"
	if _, err := logic.Update(ctx, &model.SettingsPatch{SyncEndpoint: &insecure}); err == nil {
		t.Fatal("expected insecure non-loopback WebDAV endpoint to fail")
	}
}

func TestDiagnosticsReportsStorageHealthAndBackups(t *testing.T) {
	logic, _, dbPath := newSettingsLogicTest(t)
	ctx := context.Background()

	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"backup-20260917-010203.db",
		"backup-20260918-040506.db",
		"ignore.txt",
	} {
		if err := os.WriteFile(filepath.Join(backupDir, name), []byte("backup"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	diag, err := logic.Diagnostics(ctx)
	if err != nil {
		t.Fatalf("Diagnostics: %v", err)
	}

	if diag.Status != "ok" || diag.Integrity != "ok" {
		t.Fatalf("database health not ok: %#v", diag)
	}
	if diag.DatabasePath != dbPath {
		t.Fatalf("database path = %q, want %q", diag.DatabasePath, dbPath)
	}
	if diag.DataDir != filepath.Dir(dbPath) {
		t.Fatalf("data dir = %q", diag.DataDir)
	}
	if diag.UploadDir != filepath.Join(filepath.Dir(dbPath), "uploads") {
		t.Fatalf("upload dir = %q", diag.UploadDir)
	}
	if diag.BackupCount != 2 || diag.LatestBackupAt == 0 {
		t.Fatalf("unexpected backup diagnostics: %#v", diag)
	}
	if diag.ActiveNotes != 1 || diag.ActiveFolders != 1 || diag.TrashItems != 1 {
		t.Fatalf("unexpected item counts: %#v", diag)
	}
	if !diag.ForeignKeys || diag.BusyTimeout != 5000 {
		t.Fatalf("unexpected SQLite pragmas: %#v", diag)
	}
	if diag.DatabaseSize <= 0 {
		t.Fatalf("database size should be positive: %#v", diag)
	}
}
