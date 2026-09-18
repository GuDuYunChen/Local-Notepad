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

func TestCreateRejectsNonFolderParent(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	file, err := logic.Create(ctx, "parent.md", "", false, "")
	if err != nil {
		t.Fatalf("create file parent: %v", err)
	}

	if _, err := logic.Create(ctx, "child.md", "", false, file.ID); err == nil {
		t.Fatal("expected non-folder parent to be rejected")
	} else if !strings.Contains(err.Error(), "目标位置不是文件夹") {
		t.Fatalf("unexpected parent error: %v", err)
	}
}

func TestUpdateRejectsFolderCycle(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	root, err := logic.Create(ctx, "Root", "", true, "")
	if err != nil {
		t.Fatalf("create root folder: %v", err)
	}
	child, err := logic.Create(ctx, "Child", "", true, root.ID)
	if err != nil {
		t.Fatalf("create child folder: %v", err)
	}
	grandchild, err := logic.Create(ctx, "Grandchild", "", true, child.ID)
	if err != nil {
		t.Fatalf("create grandchild folder: %v", err)
	}

	self := root.ID
	if _, err := logic.Update(ctx, root.ID, nil, nil, &self, nil, nil, nil); err == nil {
		t.Fatal("expected moving folder into itself to fail")
	}

	target := grandchild.ID
	if _, err := logic.Update(ctx, root.ID, nil, nil, &target, nil, nil, nil); err == nil {
		t.Fatal("expected moving folder into descendant to fail")
	} else if !strings.Contains(err.Error(), "不能将文件夹移动到其自身内部") {
		t.Fatalf("unexpected cycle error: %v", err)
	}
}

func TestUpdateRejectsMoveUnderFile(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	folder, err := logic.Create(ctx, "Folder", "", true, "")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	file, err := logic.Create(ctx, "File.md", "", false, "")
	if err != nil {
		t.Fatalf("create file: %v", err)
	}

	target := file.ID
	if _, err := logic.Update(ctx, folder.ID, nil, nil, &target, nil, nil, nil); err == nil {
		t.Fatal("expected move under ordinary file to fail")
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
