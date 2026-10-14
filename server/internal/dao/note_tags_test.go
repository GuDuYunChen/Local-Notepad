package dao

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func noteTagsDB(t *testing.T) *TagDAO {
	t.Helper()
	f := templateDB(t)
	for _, s := range []string{`CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,color TEXT)`, `CREATE TABLE file_tags(file_id TEXT NOT NULL,tag_id TEXT NOT NULL,PRIMARY KEY(file_id,tag_id))`} {
		if _, err := f.DB.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	templateSeed(t, f, "note-a", "普通A", "A正文")
	templateSeed(t, f, "note-b", "普通B", "B正文")
	return &TagDAO{DB: f.DB}
}
func tagBool(v bool) *bool { return &v }
func TestNoteTagReadCompleteEmptyAndNullLegacyColor(t *testing.T) {
	d := noteTagsDB(t)
	ctx := context.Background()
	out, e := d.NoteTags(ctx, "note-a")
	if e != nil || !out.Complete || out.Tags == nil || out.Available == nil {
		t.Fatal(out, e)
	}
	d.DB.Exec(`INSERT INTO tags(id,name) VALUES('legacy','旧标签')`)
	out, e = d.NoteTags(ctx, "note-a")
	if e != nil || len(out.Available) != 1 || out.Available[0].Color != "" {
		t.Fatal(out, e)
	}
}
func TestNoteTagCreateReuseAndOriginalFilePreservation(t *testing.T) {
	d := noteTagsDB(t)
	ctx := context.Background()
	out, e := d.CreateAndAttachNoteTag(ctx, "note-a", "中文 / 写作")
	if e != nil || len(out.Tags) != 1 {
		t.Fatal(out, e)
	}
	id := out.Tags[0].ID
	for _, note := range []string{"note-a", "note-b"} {
		out, e = d.CreateAndAttachNoteTag(ctx, note, "中文 / 写作")
		if e != nil || len(out.Tags) != 1 || out.Tags[0].ID != id {
			t.Fatal(out, e)
		}
	}
	var count int
	d.DB.QueryRow(`SELECT count(*) FROM tags`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate tag")
	}
	var body, title string
	var updated int64
	d.DB.QueryRow(`SELECT content,title,updated_at FROM files WHERE id='note-a'`).Scan(&body, &title, &updated)
	if body != "A正文" || title != "普通A" || updated != 1 {
		t.Fatal("modified body metadata", body, title, updated)
	}
}
func TestNoteTagRemoveIsOnlyOneAssociationAndCompareStateIsRequired(t *testing.T) {
	d := noteTagsDB(t)
	ctx := context.Background()
	out, _ := d.CreateAndAttachNoteTag(ctx, "note-a", "写作")
	tag := out.Tags[0]
	d.CreateAndAttachNoteTag(ctx, "note-b", "写作")
	in := NoteTagChange{TagID: tag.ID, Name: tag.Name, Expected: tagBool(true), Attached: tagBool(false)}
	out, e := d.ChangeNoteTag(ctx, "note-a", in)
	if e != nil || len(out.Tags) != 0 || len(out.Available) != 1 {
		t.Fatal(out, e)
	}
	if _, e = d.ChangeNoteTag(ctx, "note-a", in); e == nil {
		t.Fatal("stale confirmation should be refused")
	}
	other, e := d.NoteTags(ctx, "note-b")
	if e != nil || len(other.Tags) != 1 {
		t.Fatal("other association lost", e)
	}
	in.Expected = tagBool(false)
	in.Attached = tagBool(true)
	out, e = d.ChangeNoteTag(ctx, "note-a", in)
	if e != nil || len(out.Tags) != 1 {
		t.Fatal(out, e)
	}
}
func TestNoteTagTargetIdentityNeverCreatesOrWritesWrongKinds(t *testing.T) {
	d := noteTagsDB(t)
	ctx := context.Background()
	d.DB.Exec(`INSERT INTO files(id,title,content,is_folder) VALUES('folder','目录','',1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content,is_deleted) VALUES('deleted','删除','',1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content) VALUES('template','__tpl__模板','')`)
	for _, id := range []string{"missing", "folder", "deleted", "template", "", "\x00"} {
		t.Run(fmt.Sprintf("%q", id), func(t *testing.T) {
			if _, err := d.NoteTags(ctx, id); err == nil {
				t.Fatal("read accepted")
			}
			if _, err := d.CreateAndAttachNoteTag(ctx, id, "不应创建"); err == nil {
				t.Fatal("create accepted")
			}
		})
	}
	var count int
	d.DB.QueryRow(`SELECT count(*) FROM tags`).Scan(&count)
	if count != 0 {
		t.Fatal("left behind tag")
	}
}
func TestNoteTagNamesStrictAndUnicodeLength(t *testing.T) {
	for _, name := range []string{"", " ", " leading", "trailing ", "a\nB", "a\x00b", strings.Repeat("🙂", 41), string([]byte{0xff})} {
		if ValidateNoteTagName(name) == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	if err := ValidateNoteTagName(strings.Repeat("🙂", 40)); err != nil {
		t.Fatal(err)
	}
}
func TestNoteTagCreateRollbackLeavesNoUnusedGlobalTag(t *testing.T) {
	d := noteTagsDB(t)
	d.DB.Exec(`CREATE TRIGGER refuse_tags BEFORE INSERT ON file_tags BEGIN SELECT RAISE(ABORT,'blocked');END`)
	if _, e := d.CreateAndAttachNoteTag(context.Background(), "note-a", "不应留下"); e == nil {
		t.Fatal("expected failure")
	}
	var n int
	d.DB.QueryRow(`SELECT count(*) FROM tags`).Scan(&n)
	if n != 0 {
		t.Fatal("non atomic creation", n)
	}
}
func TestNoteTagConcurrentNameReuse(t *testing.T) {
	d := noteTagsDB(t)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := d.CreateAndAttachNoteTag(context.Background(), "note-a", "唯一名称")
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var n int
	d.DB.QueryRow(`SELECT count(*) FROM tags`).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
	d.DB.QueryRow(`SELECT count(*) FROM file_tags`).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestNoteTagCatalogLimitRefusesPartialResults(t *testing.T) {
	d := noteTagsDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i < 501; i++ {
		tx.Exec(`INSERT INTO tags(id,name) VALUES(?,?)`, fmt.Sprint(i), fmt.Sprintf("tag%d", i))
	}
	tx.Commit()
	if _, e := d.NoteTags(context.Background(), "note-a"); e == nil {
		t.Fatal("partial list accepted")
	}
	if _, e := d.CreateAndAttachNoteTag(context.Background(), "note-a", "one more"); e == nil {
		t.Fatal("overflow accepted")
	}
}
func TestNoteTagMembershipLimitRollsBackCreation(t *testing.T) {
	d := noteTagsDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i < 50; i++ {
		id := fmt.Sprint(i)
		tx.Exec(`INSERT INTO tags(id,name) VALUES(?,?)`, id, "tag"+id)
		tx.Exec(`INSERT INTO file_tags VALUES('note-a',?)`, id)
	}
	tx.Commit()
	if _, e := d.CreateAndAttachNoteTag(context.Background(), "note-a", "new"); e == nil {
		t.Fatal("overflow accepted")
	}
	var n int
	d.DB.QueryRow(`SELECT count(*) FROM tags WHERE name='new'`).Scan(&n)
	if n != 0 {
		t.Fatal("unused tag retained")
	}
}
func TestNoteTagStaleNamesMissingLabelsAndAbsentExpectationRejected(t *testing.T) {
	d := noteTagsDB(t)
	out, _ := d.CreateAndAttachNoteTag(context.Background(), "note-a", "写作")
	tag := out.Tags[0]
	for _, in := range []NoteTagChange{{TagID: tag.ID, Name: "wrong", Expected: tagBool(true), Attached: tagBool(false)}, {TagID: tag.ID, Name: tag.Name, Attached: tagBool(false)}, {TagID: "missing", Name: tag.Name, Expected: tagBool(true), Attached: tagBool(false)}} {
		if _, e := d.ChangeNoteTag(context.Background(), "note-a", in); e == nil {
			t.Fatal("invalid accepted")
		}
	}
	out, e := d.NoteTags(context.Background(), "note-a")
	if e != nil || len(out.Tags) != 1 {
		t.Fatal(out, e)
	}
}
func TestNoteTagOrphanRefusedRatherThanHidden(t *testing.T) {
	d := noteTagsDB(t)
	d.DB.Exec(`INSERT INTO file_tags VALUES('note-a','missing')`)
	if _, e := d.NoteTags(context.Background(), "note-a"); e == nil {
		t.Fatal("orphan ignored")
	}
}
func TestNoteTagCancelledCreateWritesNothing(t *testing.T) {
	d := noteTagsDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := d.CreateAndAttachNoteTag(ctx, "note-a", "取消"); e == nil {
		t.Fatal("cancel ignored")
	}
	var n int
	d.DB.QueryRow(`SELECT count(*) FROM tags`).Scan(&n)
	if n != 0 {
		t.Fatal("unexpected write")
	}
}
