package dao

import (
	"context"
	"database/sql"
	_ "modernc.org/sqlite"
	"path/filepath"
	"sync"
	"testing"
)

func templateDB(t *testing.T) *FileDAO {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "templates.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL DEFAULT 1,is_folder BOOLEAN NOT NULL DEFAULT 0,parent_id TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,is_deleted BOOLEAN NOT NULL DEFAULT 0,deleted_at INTEGER NOT NULL DEFAULT 0,is_pinned BOOLEAN NOT NULL DEFAULT 0)`)
	if err != nil {
		t.Fatal(err)
	}
	return &FileDAO{DB: db}
}
func templateSeed(t *testing.T, d *FileDAO, id, title, body string) {
	t.Helper()
	if _, err := d.DB.Exec(`INSERT INTO files(id,title,content) VALUES(?,?,?)`, id, title, body); err != nil {
		t.Fatal(err)
	}
}
func TestTemplateLibraryListsOnlyRootTemplatesIncludingArchive(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "tpl", "__tpl__周报", "完整正文")
	templateSeed(t, d, "note", "ordinary", "笔记")
	templateSeed(t, d, "child", "__tpl__子目录", "子模板")
	d.DB.Exec(`UPDATE files SET parent_id='p' WHERE id='child'`)
	templateSeed(t, d, "folder", "__tpl__目录", "ignored")
	d.DB.Exec(`UPDATE files SET is_folder=1 WHERE id='folder'`)
	got, err := d.LibraryTemplates(ctx)
	if err != nil || len(got) != 1 || got[0].Title != "周报" {
		t.Fatalf("%v %v", got, err)
	}
	if err = d.ArchiveLibraryTemplate(ctx, "tpl"); err != nil {
		t.Fatal(err)
	}
	got, err = d.LibraryTemplates(ctx)
	if err != nil || len(got) != 1 || !got[0].Archived {
		t.Fatal("archived template inaccessible", err)
	}
}
func TestTemplateLegacyDeleteNeverDeletesOrdinaryNoteOrFolder(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	for _, id := range []string{"ordinary", "folder", "child"} {
		templateSeed(t, d, id, "__tpl__"+id, "untouched")
	}
	d.DB.Exec(`UPDATE files SET title='普通笔记' WHERE id='ordinary'`)
	d.DB.Exec(`UPDATE files SET is_folder=1 WHERE id='folder'`)
	d.DB.Exec(`UPDATE files SET parent_id='folder' WHERE id='child'`)
	for _, id := range []string{"ordinary", "folder", "child", "missing"} {
		if d.ArchiveLibraryTemplate(ctx, id) == nil {
			t.Fatal("expected refusal", id)
		}
	}
	var n int
	d.DB.QueryRow(`SELECT count(*) FROM files WHERE is_deleted=1`).Scan(&n)
	if n != 0 {
		t.Fatal("unrelated data deleted")
	}
}
func TestTemplateUpdateArchiveRestoreExactBytes(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "tpl", "__tpl__周报", "旧🙂\n%2F")
	old, _ := d.LibraryTemplate(ctx, "tpl")
	next := *old
	next.Title = "新周报"
	next.Content = "新的完整正文"
	current, err := d.ChangeLibraryTemplate(ctx, "tpl", *old, next)
	if err != nil || current.Content != next.Content {
		t.Fatal(err)
	}
	archived := *current
	archived.Archived = true
	current, err = d.ChangeLibraryTemplate(ctx, "tpl", *current, archived)
	if err != nil || !current.Archived {
		t.Fatal(err)
	}
	restored := *current
	restored.Archived = false
	current, err = d.ChangeLibraryTemplate(ctx, "tpl", *current, restored)
	if err != nil || current.Archived || current.Content != next.Content {
		t.Fatal(err)
	}
	var deleted int
	d.DB.QueryRow(`SELECT deleted_at FROM files WHERE id='tpl'`).Scan(&deleted)
	if deleted != 0 {
		t.Fatal("restore timestamp not cleared")
	}
}
func TestTemplateStaleBodyCannotOverwriteOrArchive(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "tpl", "__tpl__周报", "old")
	old, _ := d.LibraryTemplate(ctx, "tpl")
	d.DB.Exec(`UPDATE files SET content='external' WHERE id='tpl'`)
	next := *old
	next.Content = "requested"
	if _, err := d.ChangeLibraryTemplate(ctx, "tpl", *old, next); err == nil {
		t.Fatal("stale overwrite")
	}
	next = *old
	next.Archived = true
	if _, err := d.ChangeLibraryTemplate(ctx, "tpl", *old, next); err == nil {
		t.Fatal("stale archive")
	}
	got, _ := d.LibraryTemplate(ctx, "tpl")
	if got.Content != "external" || got.Archived {
		t.Fatal("changed unrelated value")
	}
}
func TestTemplateRestoreAndRenameRefuseDuplicate(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "a", "__tpl__Alpha", "one")
	templateSeed(t, d, "b", "__tpl__Beta", "two")
	a, _ := d.LibraryTemplate(ctx, "a")
	next := *a
	next.Title = "beta"
	if _, err := d.ChangeLibraryTemplate(ctx, "a", *a, next); err == nil {
		t.Fatal("duplicate rename")
	}
	if err := d.ArchiveLibraryTemplate(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	templateSeed(t, d, "c", "__tpl__Alpha", "different")
	a, _ = d.LibraryTemplate(ctx, "a")
	next = *a
	next.Archived = false
	if _, err := d.ChangeLibraryTemplate(ctx, "a", *a, next); err == nil {
		t.Fatal("duplicate restore")
	}
}
func TestTemplateLostChangeReceiptReconcilesWithoutWritingAgain(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "a", "__tpl__Alpha", "old")
	old, _ := d.LibraryTemplate(ctx, "a")
	next := *old
	next.Archived = true
	first, err := d.ChangeLibraryTemplate(ctx, "a", *old, next)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.ChangeLibraryTemplate(ctx, "a", *old, next)
	if err != nil || first.UpdatedAt != second.UpdatedAt || !second.Archived {
		t.Fatal("non-idempotent replay", err)
	}
}
func TestTemplateConcurrentRenameOnlyOneWins(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "a", "__tpl__Alpha", "a")
	templateSeed(t, d, "b", "__tpl__Beta", "b")
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, id := range []string{"a", "b"} {
		old, _ := d.LibraryTemplate(ctx, id)
		next := *old
		next.Title = "same"
		wg.Add(1)
		go func(old, next LibraryTemplate) {
			defer wg.Done()
			_, err := d.ChangeLibraryTemplate(ctx, old.ID, old, next)
			errs <- err
		}(*old, next)
	}
	wg.Wait()
	close(errs)
	success := 0
	for err := range errs {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("%d concurrent winners", success)
	}
}
func TestTemplateChangedTypeOrLocationRefuses(t *testing.T) {
	for _, update := range []string{"title='ordinary'", "is_folder=1", "parent_id='other'"} {
		t.Run(update, func(t *testing.T) {
			d := templateDB(t)
			templateSeed(t, d, "a", "__tpl__Alpha", "body")
			old, _ := d.LibraryTemplate(context.Background(), "a")
			d.DB.Exec("UPDATE files SET " + update + " WHERE id='a'")
			next := *old
			next.Archived = true
			if _, err := d.ChangeLibraryTemplate(context.Background(), "a", *old, next); err == nil {
				t.Fatal("wrong identity accepted")
			}
		})
	}
}
func TestTemplateInputValidationNoSideEffects(t *testing.T) {
	d := templateDB(t)
	ctx := context.Background()
	templateSeed(t, d, "a", "__tpl__Alpha", "body")
	old, _ := d.LibraryTemplate(ctx, "a")
	for _, title := range []string{"", "../bad", " bad", "a\nname", "__tpl__hidden"} {
		next := *old
		next.Title = title
		if _, err := d.ChangeLibraryTemplate(ctx, "a", *old, next); err == nil {
			t.Fatal("invalid title accepted", title)
		}
	}
	next := *old
	next.Content = string(make([]byte, TemplateBodyLimit+1))
	if _, err := d.ChangeLibraryTemplate(ctx, "a", *old, next); err == nil {
		t.Fatal("oversized body accepted")
	}
	next = *old
	next.Archived = true
	next.Content = "new"
	if _, err := d.ChangeLibraryTemplate(ctx, "a", *old, next); err == nil {
		t.Fatal("mixed archive edit accepted")
	}
	next = *old
	next.ID = "b"
	if _, err := d.ChangeLibraryTemplate(ctx, "a", *old, next); err == nil {
		t.Fatal("different identity accepted")
	}
}
