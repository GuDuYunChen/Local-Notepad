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

func TestCreateAssignsNewestFirstSortOrder(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	first, err := logic.Create(ctx, "First.md", "", false, "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := logic.Create(ctx, "Second.md", "", false, "")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	if second.SortOrder <= first.SortOrder {
		t.Fatalf("newer root item sort_order = %d, want greater than %d", second.SortOrder, first.SortOrder)
	}

	files, err := logic.List(ctx, "", 1, 20)
	if err != nil {
		t.Fatalf("list root items: %v", err)
	}
	if len(files) < 2 || files[0].ID != second.ID {
		t.Fatalf("newest root item was not first: %#v", files)
	}

	folder, err := logic.Create(ctx, "Folder", "", true, "")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	childA, err := logic.Create(ctx, "Child A.md", "", false, folder.ID)
	if err != nil {
		t.Fatalf("create first child: %v", err)
	}
	childB, err := logic.Create(ctx, "Child B.md", "", false, folder.ID)
	if err != nil {
		t.Fatalf("create second child: %v", err)
	}

	if childB.SortOrder <= childA.SortOrder {
		t.Fatalf("newer child sort_order = %d, want greater than %d", childB.SortOrder, childA.SortOrder)
	}
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

func TestRestoreRejectsNameCollision(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	original, err := logic.Create(ctx, "Notes.md", "old", false, "")
	if err != nil {
		t.Fatalf("create original: %v", err)
	}
	if err := logic.Delete(ctx, original.ID); err != nil {
		t.Fatalf("delete original: %v", err)
	}
	if _, err := logic.Create(ctx, "notes.md", "new", false, ""); err != nil {
		t.Fatalf("create replacement: %v", err)
	}

	if err := logic.Restore(ctx, original.ID); err == nil {
		t.Fatal("expected restore collision to fail")
	} else if !strings.Contains(err.Error(), "目标位置已存在同名文件或文件夹") {
		t.Fatalf("unexpected restore error: %v", err)
	}

	deleted, err := logic.FileDAO.GetByIDIncludingDeleted(ctx, original.ID)
	if err != nil {
		t.Fatalf("read deleted original: %v", err)
	}
	if !deleted.IsDeleted {
		t.Fatal("conflicting original should remain deleted")
	}
}

func TestRestoreRecursiveSucceedsWithoutConflict(t *testing.T) {
	logic := newFileLogicTestDB(t)
	ctx := context.Background()

	folder, err := logic.Create(ctx, "Folder", "", true, "")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	child, err := logic.Create(ctx, "Child.md", "content", false, folder.ID)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if err := logic.Delete(ctx, folder.ID); err != nil {
		t.Fatalf("delete subtree: %v", err)
	}
	if err := logic.Restore(ctx, folder.ID); err != nil {
		t.Fatalf("restore subtree: %v", err)
	}

	if _, err := logic.Get(ctx, folder.ID); err != nil {
		t.Fatalf("restored folder missing: %v", err)
	}
	if _, err := logic.Get(ctx, child.ID); err != nil {
		t.Fatalf("restored child missing: %v", err)
	}
}

func TestParseWikiLinksPrefersSerializedWikiNodeIDsAndKeepsLegacySyntax(t *testing.T) {
	content := `{"root":{"children":[
		{"type":"paragraph","children":[
			{"type":"wiki-link","id":"target-id","title":"Target title","sectionPath":["第一卷","第一章"]},
			{"type":"text","text":" legacy [[legacy-id]] duplicate [[legacy-id]]"}
		]}
	]}}`

	links := parseWikiLinks(content)
	if len(links) != 2 {
		t.Fatalf("parseWikiLinks() = %#v, want 2 unique links", links)
	}

	got := map[string]bool{}
	for _, id := range links {
		got[id] = true
	}
	if !got["target-id"] || !got["legacy-id"] {
		t.Fatalf("missing parsed link IDs: %#v", links)
	}
}

func TestParseWikiLinksIgnoresDuplicateWikiNodes(t *testing.T) {
	content := `{"root":{"children":[
		{"type":"wiki-link","id":"same-id","title":"One"},
		{"type":"wiki-link","id":"same-id","title":"Two"}
	]}}`

	links := parseWikiLinks(content)
	if len(links) != 1 || links[0] != "same-id" {
		t.Fatalf("unexpected duplicate link result: %#v", links)
	}
}

func TestCreateSyncsSerializedWikiLinksImmediately(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()

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
		`CREATE TABLE links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(source_id, target_id)
		)`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}

	fileLogic := &FileLogic{
		FileDAO: &dao.FileDAO{DB: db},
		LinkDAO: &dao.LinkDAO{DB: db},
	}
	content := `{"root":{"children":[{"type":"wiki-link","id":"target-id","title":"Target","sectionPath":["第一卷","第一章"]}]}}`

	file, err := fileLogic.Create(context.Background(), "Source.md", content, false, "")
	if err != nil {
		t.Fatalf("Create with WikiLink: %v", err)
	}

	links, err := fileLogic.LinkDAO.GetOutgoingLinks(context.Background(), file.ID)
	if err != nil {
		t.Fatalf("GetOutgoingLinks: %v", err)
	}
	if len(links) != 1 || links[0].TargetID != "target-id" {
		t.Fatalf("unexpected links after create: %#v", links)
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


func TestCreateVersionSnapshotCapturesPreRepairContent(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()

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
		`CREATE TABLE file_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			file_id TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}

	fileLogic := &FileLogic{
		FileDAO:    &dao.FileDAO{DB: db},
		VersionDAO: &dao.VersionDAO{DB: db},
	}

	file, err := fileLogic.Create(context.Background(), "Source.md", "before repair", false, "")
	if err != nil {
		t.Fatalf("create file: %v", err)
	}

	if err := fileLogic.CreateVersionSnapshot(context.Background(), file.ID); err != nil {
		t.Fatalf("create explicit snapshot: %v", err)
	}

	versions, err := fileLogic.VersionDAO.GetVersions(context.Background(), file.ID)
	if err != nil {
		t.Fatalf("get versions after explicit snapshot: %v", err)
	}
	if len(versions) != 1 || versions[0].Content != "before repair" {
		t.Fatalf("snapshot content = %#v, want pre-repair content", versions)
	}

	after := "after repair"
	if _, err := fileLogic.Update(context.Background(), file.ID, nil, &after, nil, nil, nil, nil); err != nil {
		t.Fatalf("apply repair update: %v", err)
	}

	rows, err := db.Query(`SELECT content FROM file_versions WHERE file_id = ? ORDER BY id ASC`, file.ID)
	if err != nil {
		t.Fatalf("query version contents: %v", err)
	}
	defer rows.Close()

	var contents []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatalf("scan version content: %v", err)
		}
		contents = append(contents, value)
	}

	if len(contents) != 2 || contents[0] != "before repair" || contents[1] != "after repair" {
		t.Fatalf("version contents = %#v, want explicit pre-repair then repaired snapshot", contents)
	}
}
