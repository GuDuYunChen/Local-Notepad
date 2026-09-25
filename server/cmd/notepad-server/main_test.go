package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"notepad-server/internal/dao"
	"notepad-server/internal/model"

	_ "modernc.org/sqlite"
)

func openMigrationTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestFTSMigrationKeepsIndexInSyncOnUpdateAndPermanentDelete(t *testing.T) {
	db := openMigrationTestDB(t)
	ctx := context.Background()
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	fileDAO := &dao.FileDAO{DB: db}
	file := &model.File{ID: "fts-file", Title: "Search note", Content: "alpha content"}
	if err := fileDAO.Create(ctx, file); err != nil {
		t.Fatalf("create indexed file: %v", err)
	}

	alpha, err := fileDAO.List(ctx, "alpha", 1, 20)
	if err != nil || len(alpha) != 1 {
		t.Fatalf("initial FTS search failed: %#v, %v", alpha, err)
	}

	file.Content = "beta content"
	if err := fileDAO.Update(ctx, file); err != nil {
		t.Fatalf("update indexed file: %v", err)
	}

	alpha, err = fileDAO.List(ctx, "alpha", 1, 20)
	if err != nil {
		t.Fatalf("search old term: %v", err)
	}
	if len(alpha) != 0 {
		t.Fatalf("old FTS term still matched after update: %#v", alpha)
	}
	beta, err := fileDAO.List(ctx, "beta", 1, 20)
	if err != nil || len(beta) != 1 || beta[0].ID != file.ID {
		t.Fatalf("updated FTS term missing: %#v, %v", beta, err)
	}

	if err := fileDAO.DeleteRecursive(ctx, file.ID); err != nil {
		t.Fatalf("soft delete file: %v", err)
	}
	if _, err := db.Exec(`UPDATE files SET deleted_at = 1 WHERE id = ?`, file.ID); err != nil {
		t.Fatalf("age deleted file: %v", err)
	}
	if err := fileDAO.CleanupOldDeleted(ctx, 2); err != nil {
		t.Fatalf("permanent cleanup: %v", err)
	}

	var ftsCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM files_fts WHERE files_fts MATCH '"beta"*'`).Scan(&ftsCount); err != nil {
		t.Fatalf("query FTS after delete: %v", err)
	}
	if ftsCount != 0 {
		t.Fatalf("deleted file remained in FTS index: %d", ftsCount)
	}
}

func TestFTSMigrationRebuildsExistingRowsWhenUpgradingFromV4(t *testing.T) {
	db := openMigrationTestDB(t)
	ctx := context.Background()

	setup := []string{
		`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
		`INSERT INTO schema_migrations (version, applied_at) VALUES (4, 1)`,
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
		 VALUES ('legacy-file', 'Legacy note', 'historical searchable content', 1, 1, 0, '', 0, 0, 0, 0)`,
	}
	for _, stmt := range setup {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("prepare v4 database: %v", err)
		}
	}

	if err := migrate(ctx, db); err != nil {
		t.Fatalf("upgrade migrate: %v", err)
	}

	fileDAO := &dao.FileDAO{DB: db}
	files, err := fileDAO.List(ctx, "historical", 1, 20)
	if err != nil {
		t.Fatalf("search rebuilt index: %v", err)
	}
	if len(files) != 1 || files[0].ID != "legacy-file" {
		t.Fatalf("legacy row missing from rebuilt FTS index: %#v", files)
	}
}

func TestSQLitePragmasEnableBusyTimeoutAndForeignKeys(t *testing.T) {
	db := openMigrationTestDB(t)
	ctx := context.Background()
	configureDatabasePool(db)
	applySQLitePragmas(ctx, db)

	var busyTimeout int
	if err := db.QueryRow(`PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
		t.Fatalf("read busy_timeout: %v", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout = %d, want 5000", busyTimeout)
	}

	var foreignKeys int
	if err := db.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatalf("read foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d, want 1", foreignKeys)
	}
}

func TestMigrationV9CleansHistoricalOrphansWithoutDroppingUnresolvedTargets(t *testing.T) {
	db := openMigrationTestDB(t)
	ctx := context.Background()
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("initial migrate: %v", err)
	}

	if _, err := db.Exec(`DELETE FROM schema_migrations WHERE version >= 9`); err != nil {
		t.Fatalf("rewind migration version: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO files
		(id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned)
	 VALUES ('active-file', 'Active', '', 1, 1, 0, '', 0, 0, 0, 0)`); err != nil {
		t.Fatalf("insert active file: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO tags (id, name, color) VALUES ('active-tag', 'Active', '#000')`); err != nil {
		t.Fatalf("insert active tag: %v", err)
	}

	statements := []string{
		`INSERT INTO file_tags (file_id, tag_id) VALUES ('active-file', 'active-tag')`,
		`INSERT INTO file_tags (file_id, tag_id) VALUES ('missing-file', 'active-tag')`,
		`INSERT INTO file_versions (file_id, content, title, created_at) VALUES ('missing-file', '', 'orphan', 1)`,
		`INSERT INTO links (source_id, target_id, created_at) VALUES ('missing-file', 'active-file', 1)`,
		`INSERT INTO links (source_id, target_id, created_at) VALUES ('active-file', 'future-target', 1)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("seed v9 orphan data: %v", err)
		}
	}

	if err := migrate(ctx, db); err != nil {
		t.Fatalf("apply v9 migration: %v", err)
	}

	checks := []struct {
		query string
		want  int
		label string
	}{
		{`SELECT COUNT(*) FROM file_tags WHERE file_id = 'missing-file'`, 0, "orphan file_tags"},
		{`SELECT COUNT(*) FROM file_tags WHERE file_id = 'active-file' AND tag_id = 'active-tag'`, 1, "valid file_tags"},
		{`SELECT COUNT(*) FROM file_versions WHERE file_id = 'missing-file'`, 0, "orphan versions"},
		{`SELECT COUNT(*) FROM links WHERE source_id = 'missing-file'`, 0, "orphan source links"},
		{`SELECT COUNT(*) FROM links WHERE source_id = 'active-file' AND target_id = 'future-target'`, 1, "unresolved target link"},
	}
	for _, check := range checks {
		var got int
		if err := db.QueryRow(check.query).Scan(&got); err != nil {
			t.Fatalf("%s query failed: %v", check.label, err)
		}
		if got != check.want {
			t.Fatalf("%s count = %d, want %d", check.label, got, check.want)
		}
	}
}

func TestResolveUploadPathUsesDatabaseDirectory(t *testing.T) {
	root := t.TempDir()
	dbPath := filepath.Join(root, "data.db")
	if got, want := resolveUploadPath(dbPath), filepath.Join(root, "uploads"); got != want {
		t.Fatalf("resolveUploadPath() = %q, want %q", got, want)
	}
}

func TestMigrateLegacyUploadsCopiesDirectAndNestedEntries(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "legacy")
	target := filepath.Join(root, "target")
	if err := os.MkdirAll(filepath.Join(legacy, "nested-name"), 0755); err != nil {
		t.Fatalf("mkdir nested legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "direct.jpg"), []byte("direct"), 0644); err != nil {
		t.Fatalf("write direct file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "nested-name", "original.png"), []byte("nested"), 0644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	copied, err := migrateLegacyUploads(legacy, target)
	if err != nil {
		t.Fatalf("migrateLegacyUploads: %v", err)
	}
	if copied != 2 {
		t.Fatalf("copied = %d, want 2", copied)
	}

	direct, err := os.ReadFile(filepath.Join(target, "direct.jpg"))
	if err != nil || string(direct) != "direct" {
		t.Fatalf("direct migration failed: %q, %v", direct, err)
	}
	nested, err := os.ReadFile(filepath.Join(target, "nested-name"))
	if err != nil || string(nested) != "nested" {
		t.Fatalf("nested migration failed: %q, %v", nested, err)
	}
}

func TestMigrateLegacyUploadsDoesNotOverwriteExistingTarget(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "legacy")
	target := filepath.Join(root, "target")
	if err := os.MkdirAll(legacy, 0755); err != nil {
		t.Fatalf("mkdir legacy: %v", err)
	}
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "same.png"), []byte("legacy"), 0644); err != nil {
		t.Fatalf("write legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(target, "same.png"), []byte("current"), 0644); err != nil {
		t.Fatalf("write target: %v", err)
	}

	copied, err := migrateLegacyUploads(legacy, target)
	if err != nil {
		t.Fatalf("migrateLegacyUploads: %v", err)
	}
	if copied != 0 {
		t.Fatalf("copied = %d, want 0", copied)
	}
	content, err := os.ReadFile(filepath.Join(target, "same.png"))
	if err != nil || string(content) != "current" {
		t.Fatalf("existing target was overwritten: %q, %v", content, err)
	}
}

func TestFlattenUploadEntriesFlattensSingleFileDirectory(t *testing.T) {
	root := t.TempDir()
	nestedDir := filepath.Join(root, "asset-key")
	if err := os.MkdirAll(nestedDir, 0755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "photo.jpg"), []byte("image"), 0644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	flattenUploadEntries(root)

	info, err := os.Stat(filepath.Join(root, "asset-key"))
	if err != nil {
		t.Fatalf("flattened file missing: %v", err)
	}
	if info.IsDir() {
		t.Fatal("asset-key should be a file after flattening")
	}
	content, err := os.ReadFile(filepath.Join(root, "asset-key"))
	if err != nil || string(content) != "image" {
		t.Fatalf("unexpected flattened content: %q, %v", content, err)
	}
}

func TestResearchMigrationIsAdditiveAndPreservesCreationReceipt(t *testing.T) {
	db := openMigrationTestDB(t)
	ctx := context.Background()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var latest int
	if err := db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&latest); err != nil || latest != 11 {
		t.Fatal(latest, err)
	}
	var syncTables int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('sync_state','sync_base','sync_conflicts')`).Scan(&syncTables); err != nil || syncTables != 3 {
		t.Fatal("schema 11 sync tables missing", syncTables, err)
	}
	if _, err := db.Exec(`INSERT INTO research_note_requests VALUES('request','hash','file','标题','',1)`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM research_note_requests`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}
