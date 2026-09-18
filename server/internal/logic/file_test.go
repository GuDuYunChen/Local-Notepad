package logic

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"notepad-server/internal/dao"

	_ "modernc.org/sqlite"
)

func newFileLogicTestDB(t *testing.T) *FileLogic {
	t.Helper()

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	_, err = db.Exec(`CREATE TABLE files (
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
	)`)
	if err != nil {
		t.Fatalf("create files table: %v", err)
	}

	return &FileLogic{FileDAO: &dao.FileDAO{DB: db}}
}

func TestCreateRejectsDuplicateNamesInRoot(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	if _, err := logic.Create(ctx, "Notes.md", "", false, ""); err != nil {
		t.Fatalf("first create failed: %v", err)
	}
	if _, err := logic.Create(ctx, "notes.md", "", false, ""); err == nil {
		t.Fatal("expected case-insensitive duplicate root name to fail")
	} else if !strings.Contains(err.Error(), "已存在同名文件或文件夹") {
		t.Fatalf("unexpected duplicate error: %v", err)
	}
}

func TestUpdateRejectsRenameCollision(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	first, err := logic.Create(ctx, "Alpha.md", "", false, "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := logic.Create(ctx, "Beta.md", "", false, "")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	name := "alpha.md"
	if _, err := logic.Update(ctx, second.ID, &name, nil, nil, nil, nil, nil); err == nil {
		t.Fatal("expected rename collision to fail")
	}

	unchanged, err := logic.Get(ctx, first.ID)
	if err != nil || unchanged.Title != "Alpha.md" {
		t.Fatalf("first file changed unexpectedly: %#v, %v", unchanged, err)
	}
}

func TestUpdateRejectsMoveCollision(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	folderA, err := logic.Create(ctx, "A", "", true, "")
	if err != nil {
		t.Fatalf("create folder A: %v", err)
	}
	folderB, err := logic.Create(ctx, "B", "", true, "")
	if err != nil {
		t.Fatalf("create folder B: %v", err)
	}
	if _, err := logic.Create(ctx, "same.md", "", false, folderA.ID); err != nil {
		t.Fatalf("create first child: %v", err)
	}
	moving, err := logic.Create(ctx, "same.md", "", false, folderB.ID)
	if err != nil {
		t.Fatalf("create second child: %v", err)
	}

	targetParent := folderA.ID
	if _, err := logic.Update(ctx, moving.ID, nil, nil, &targetParent, nil, nil, nil); err == nil {
		t.Fatal("expected move collision to fail")
	}
}

func TestNormalizeTitleSanitizesAndLimitsLength(t *testing.T) {
	title, err := normalizeTitle("  bad/name?.md  ")
	if err != nil {
		t.Fatalf("normalize valid title: %v", err)
	}
	if title != "bad_name_.md" {
		t.Fatalf("unexpected sanitized title: %q", title)
	}

	if _, err := normalizeTitle(strings.Repeat("界", 256)); err == nil {
		t.Fatal("expected title length limit to fail")
	}
}
