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


func insertTrashTreeFile(
	t *testing.T,
	dao *FileDAO,
	id string,
	title string,
	parentID string,
	isFolder bool,
	deleted bool,
	deletedAt int64,
) {
	t.Helper()
	isDeleted := 0
	isFolderInt := 0
	if deleted {
		isDeleted = 1
	}
	if isFolder {
		isFolderInt = 1
	}

	_, err := dao.DB.Exec(
		`INSERT INTO files
			(id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned)
		 VALUES (?, ?, '', 1, 1, ?, ?, 0, ?, ?, 0)`,
		id, title, isFolderInt, parentID, isDeleted, deletedAt,
	)
	if err != nil {
		t.Fatalf("insert trash tree file %s: %v", id, err)
	}
}

func TestListTrashRootsHidesDeletedDescendants(t *testing.T) {
	dao := newCleanupTestDAO(t)
	ctx := context.Background()

	insertTrashTreeFile(t, dao, "folder", "Folder", "", true, true, 300)
	insertTrashTreeFile(t, dao, "child", "Child.md", "folder", false, true, 300)
	insertTrashTreeFile(t, dao, "active-folder", "Active", "", true, false, 0)
	insertTrashTreeFile(t, dao, "nested-delete", "Nested.md", "active-folder", false, true, 200)
	insertTrashTreeFile(t, dao, "template", "__tpl__Hidden", "", false, true, 400)

	items, err := dao.ListTrashRoots(ctx)
	if err != nil {
		t.Fatalf("ListTrashRoots: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("ListTrashRoots returned %d items, want 2: %#v", len(items), items)
	}

	if items[0].ID != "folder" || items[1].ID != "nested-delete" {
		t.Fatalf("unexpected trash roots order/content: %#v", items)
	}

	for _, item := range items {
		if item.ID == "child" || item.ID == "template" {
			t.Fatalf("hidden trash item leaked into roots: %#v", items)
		}
		if item.Content != "" {
			t.Fatalf("trash list should omit content for %s", item.ID)
		}
	}
}

func TestPermanentDeleteRecursiveRemovesSubtreeDependenciesOnly(t *testing.T) {
	dao := newCleanupTestDAO(t)
	ctx := context.Background()

	insertTrashTreeFile(t, dao, "folder", "Folder", "", true, true, 300)
	insertTrashTreeFile(t, dao, "child", "Child.md", "folder", false, true, 300)
	insertTrashTreeFile(t, dao, "active", "Active.md", "", false, false, 0)

	for _, fileID := range []string{"folder", "child", "active"} {
		if _, err := dao.DB.Exec(`INSERT INTO file_tags (file_id, tag_id) VALUES (?, 'tag')`, fileID); err != nil {
			t.Fatalf("insert tag for %s: %v", fileID, err)
		}
		if _, err := dao.DB.Exec(
			`INSERT INTO file_versions (file_id, content, title, created_at) VALUES (?, '', ?, 1)`,
			fileID, fileID,
		); err != nil {
			t.Fatalf("insert version for %s: %v", fileID, err)
		}
	}

	for _, pair := range [][2]string{
		{"folder", "active"},
		{"active", "child"},
		{"active", "active"},
	} {
		if _, err := dao.DB.Exec(
			`INSERT INTO links (source_id, target_id, created_at) VALUES (?, ?, 1)`,
			pair[0], pair[1],
		); err != nil {
			t.Fatalf("insert link %#v: %v", pair, err)
		}
	}

	if err := dao.PermanentDeleteRecursive(ctx, "folder"); err != nil {
		t.Fatalf("PermanentDeleteRecursive: %v", err)
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id IN ('folder', 'child')`); got != 0 {
		t.Fatalf("deleted subtree file count = %d, want 0", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id = 'active'`); got != 1 {
		t.Fatalf("active file count = %d, want 1", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_tags WHERE file_id IN ('folder', 'child')`); got != 0 {
		t.Fatalf("deleted subtree tags remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_versions WHERE file_id IN ('folder', 'child')`); got != 0 {
		t.Fatalf("deleted subtree versions remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id IN ('folder', 'child') OR target_id IN ('folder', 'child')`); got != 0 {
		t.Fatalf("deleted subtree links remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id = 'active' AND target_id = 'active'`); got != 1 {
		t.Fatalf("unrelated link changed: %d", got)
	}
}

func TestEmptyTrashKeepsActiveFilesAndClearsDeletedDependencies(t *testing.T) {
	dao := newCleanupTestDAO(t)
	ctx := context.Background()

	insertTrashTreeFile(t, dao, "deleted-a", "A.md", "", false, true, 100)
	insertTrashTreeFile(t, dao, "deleted-b", "B.md", "", false, true, 200)
	insertTrashTreeFile(t, dao, "active", "Active.md", "", false, false, 0)

	for _, fileID := range []string{"deleted-a", "deleted-b", "active"} {
		if _, err := dao.DB.Exec(`INSERT INTO file_tags (file_id, tag_id) VALUES (?, 'tag')`, fileID); err != nil {
			t.Fatalf("insert tag for %s: %v", fileID, err)
		}
		if _, err := dao.DB.Exec(
			`INSERT INTO file_versions (file_id, content, title, created_at) VALUES (?, '', ?, 1)`,
			fileID, fileID,
		); err != nil {
			t.Fatalf("insert version for %s: %v", fileID, err)
		}
	}

	if _, err := dao.DB.Exec(
		`INSERT INTO links (source_id, target_id, created_at) VALUES ('active', 'deleted-a', 1), ('active', 'active', 1)`,
	); err != nil {
		t.Fatalf("insert links: %v", err)
	}

	if err := dao.EmptyTrash(ctx); err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}

	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE is_deleted = 1`); got != 0 {
		t.Fatalf("deleted file count = %d, want 0", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM files WHERE id = 'active'`); got != 1 {
		t.Fatalf("active file missing after empty trash: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_tags WHERE file_id LIKE 'deleted-%'`); got != 0 {
		t.Fatalf("deleted tags remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM file_versions WHERE file_id LIKE 'deleted-%'`); got != 0 {
		t.Fatalf("deleted versions remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id LIKE 'deleted-%' OR target_id LIKE 'deleted-%'`); got != 0 {
		t.Fatalf("deleted links remain: %d", got)
	}
	if got := countRows(t, dao.DB, `SELECT COUNT(*) FROM links WHERE source_id = 'active' AND target_id = 'active'`); got != 1 {
		t.Fatalf("active link changed: %d", got)
	}
}
