package dao

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newCleanupTestDAO(t *testing.T) *FileDAO {
	t.Helper()

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	schema := []string{
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
		`CREATE TABLE file_tags (file_id TEXT NOT NULL, tag_id TEXT NOT NULL)`,
		`CREATE TABLE file_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			file_id TEXT NOT NULL,
			content TEXT NOT NULL,
			title TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	}

	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create cleanup schema: %v", err)
		}
	}

	return &FileDAO{DB: db}
}

func insertCleanupFile(t *testing.T, dao *FileDAO, id string, deleted bool, deletedAt int64) {
	t.Helper()
	isDeleted := 0
	if deleted {
		isDeleted = 1
	}
	_, err := dao.DB.Exec(
		`INSERT INTO files
			(id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned)
		 VALUES (?, ?, '', 1, 1, 0, '', 0, ?, ?, 0)`,
		id, id, isDeleted, deletedAt,
	)
	if err != nil {
		t.Fatalf("insert file %s: %v", id, err)
	}
}

func countRows(t *testing.T, db *sql.DB, query string, args ...interface{}) int {
	t.Helper()
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

func TestCleanupOldDeletedRemovesOnlyExpiredFileDependencies(t *testing.T) {
	dao := newCleanupTestDAO(t)
	ctx := context.Background()
	const threshold int64 = 1000

	insertCleanupFile(t, dao, "expired", true, 100)
	insertCleanupFile(t, dao, "recent", true, 1500)
	insertCleanupFile(t, dao, "active", false, 0)

	for _, fileID := range []string{"expired", "recent", "active"} {
		if _, err := dao.DB.Exec(`INSERT INTO file_tags (file_id, tag_id) VALUES (?, ?)`, fileID, "tag-1"); err != nil {
			t.Fatalf("insert file tag: %v", err)
		}
		if _, err := dao.DB.Exec(
			`INSERT INTO file_versions (file_id, content, title, created_at) VALUES (?, '', ?, 1)`,
			fileID, fileID,
		); err != nil {
			t.Fatalf("insert file version: %v", err)
		}
	}

	links := [][2]string{
		{"expired", "active"},
		{"active", "expired"},
		{"recent", "active"},
		{"active", "recent"},
		{"active", "active"},
		{"active", "future-missing-id"},
	}
	for _, link := range links {
		if _, err := dao.DB.Exec(
			`INSERT INTO links (source_id, target_id, created_at) VALUES (?, ?, 1)`,
			link[0], link[1],
		); err != nil {
			t.Fatalf("insert link: %v", err)
		}
	}

	if err := dao.CleanupOldDeleted(ctx, threshold); err != nil {
		t.Fatalf("CleanupOldDeleted: %v", err)
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id = 'expired'`); got != 0 {
		t.Fatalf("expired file count = %d, want 0", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id IN ('recent', 'active')`); got != 2 {
		t.Fatalf("retained file count = %d, want 2", got)
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_tags WHERE file_id = 'expired'`); got != 0 {
		t.Fatalf("expired file_tags count = %d, want 0", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_versions WHERE file_id = 'expired'`); got != 0 {
		t.Fatalf("expired versions count = %d, want 0", got)
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id = 'expired' OR target_id = 'expired'`); got != 0 {
		t.Fatalf("expired links count = %d, want 0", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id = 'active' AND target_id = 'future-missing-id'`); got != 1 {
		t.Fatalf("unresolved active link count = %d, want 1", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id = 'recent' OR target_id = 'recent'`); got != 2 {
		t.Fatalf("recent deleted links count = %d, want 2", got)
	}
}

func TestCleanupOldDeletedRollsBackWhenDependentCleanupFails(t *testing.T) {
	dao := newCleanupTestDAO(t)
	ctx := context.Background()
	insertCleanupFile(t, dao, "expired", true, 100)

	if _, err := dao.DB.Exec(`DROP TABLE file_versions`); err != nil {
		t.Fatalf("drop file_versions: %v", err)
	}

	if err := dao.CleanupOldDeleted(ctx, 1000); err == nil {
		t.Fatal("expected cleanup failure")
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id = 'expired'`); got != 1 {
		t.Fatalf("expired file should remain after rollback, got count %d", got)
	}
}
