package dao

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var statisticsNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

func statisticsFixture(t *testing.T) *FileDAO {
	t.Helper()
	d := noteTagsDB(t)
	return &FileDAO{DB: d.DB}
}
func statisticsRead(t *testing.T, d *FileDAO) *LibraryStatisticsSnapshot {
	t.Helper()
	s, e := d.libraryStatisticsAt(context.Background(), statisticsNow, LibraryStatisticsLimit, libraryStatisticsBytes)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestLibraryStatisticsUnicodeAndExclusion(t *testing.T) {
	d := statisticsFixture(t)
	body := `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"你好 world"}]},{"type":"code-block","code":"ab c"}]}}`
	d.DB.Exec(`UPDATE files SET content=?,created_at=?,updated_at=?,is_pinned=1 WHERE id='note-a'`, body, statisticsNow.Unix(), statisticsNow.Unix())
	d.DB.Exec(`UPDATE files SET content='',parent_id='folder' WHERE id='note-b'`)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder) VALUES('folder','资料','folder secret',1,1,1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES('template',?,'template secret',1,1)`, TemplatePrefix+"模板")
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_deleted) VALUES('trash','已删除','trash secret',1,1,1)`)
	addWorkspaceTag(t, &TagDAO{DB: d.DB}, "a", "标签", "note-a", "trash")
	addWorkspaceTag(t, &TagDAO{DB: d.DB}, "u", "unused")
	before := body
	s := statisticsRead(t, d)
	if s.Version != 1 || !s.Complete || len(s.Notes) != 2 || s.Totals.Characters != 10 || s.Totals.NoText != 1 || s.Totals.Tagged != 1 || s.Totals.Pinned != 1 || s.Totals.Folders != 1 || s.Totals.Templates != 1 || s.Totals.Trash != 1 || s.Totals.UnusedTags != 1 {
		t.Fatalf("%+v", s)
	}
	if len(s.Activity) != 30 || s.Activity[29].Created != 1 || s.Activity[29].Updated != 1 || s.Activity[0].Day != "2026-09-29" {
		t.Fatal(s.Activity)
	}
	if s.Notes[0].ID != "note-a" || s.Notes[1].Folder != "资料" {
		t.Fatal(s.Notes)
	}
	b, _ := json.Marshal(s)
	for _, secret := range []string{"world", "folder secret", "template secret", "trash secret", "children"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("body leaked", secret)
		}
	}
	var after string
	d.DB.QueryRow(`SELECT content FROM files WHERE id='note-a'`).Scan(&after)
	if after != before {
		t.Fatal("read changed body")
	}
	if statisticsCharacters("你好 A 😀 e\u0301\ufeff\n") != 6 {
		t.Fatal("Unicode codepoints metric")
	}
}
func TestLibraryStatisticsRevisionIncludesBodiesAndRelationships(t *testing.T) {
	d := statisticsFixture(t)
	a := statisticsRead(t, d)
	if statisticsRead(t, d).Revision != a.Revision {
		t.Fatal("unstable")
	}
	d.DB.Exec(`UPDATE files SET content='different body' WHERE id='note-a'`)
	b := statisticsRead(t, d)
	if a.Revision == b.Revision {
		t.Fatal("body ignored")
	}
	addWorkspaceTag(t, &TagDAO{DB: d.DB}, "tag", "新标签", "note-a")
	c := statisticsRead(t, d)
	if b.Revision == c.Revision {
		t.Fatal("tags ignored")
	}
	d.DB.Exec(`UPDATE files SET title='改名' WHERE id='note-a'`)
	if statisticsRead(t, d).Revision == c.Revision {
		t.Fatal("metadata ignored")
	}
}
func TestLibraryStatisticsUnsupportedIsNotEmpty(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, `{"root":`)
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-b'`, "e\u0301 😀")
	s := statisticsRead(t, d)
	if s.Totals.Unsupported != 1 || s.Totals.NoText != 0 || s.Totals.Characters != 2 {
		t.Fatal(s.Totals)
	}
}
func TestLibraryStatisticsRefusesPartialAndCancelledReads(t *testing.T) {
	d := statisticsFixture(t)
	ctx := context.Background()
	for _, limits := range [][2]int64{{1, libraryStatisticsBytes}, {LibraryStatisticsLimit, 1}} {
		if s, e := d.libraryStatisticsAt(ctx, statisticsNow, int(limits[0]), limits[1]); e == nil || s != nil {
			t.Fatal("partial accepted")
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if s, e := d.LibraryStatistics(cancelled); e == nil || s != nil {
		t.Fatal("cancel accepted")
	}
	d.DB.Exec(`INSERT INTO file_tags VALUES('missing','missing')`)
	if s, e := d.LibraryStatistics(ctx); e == nil || s != nil {
		t.Fatal("dangling links accepted")
	}
}
func TestLibraryStatisticsEmptyAndUTCWindow(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`DELETE FROM files`)
	s := statisticsRead(t, d)
	if s.Notes == nil || len(s.Notes) != 0 || s.Totals.Notes != 0 || len(s.Activity) != 30 {
		t.Fatal(s)
	}
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES('future','later','x',?,?)`, statisticsNow.AddDate(0, 0, 1).Unix(), statisticsNow.AddDate(0, 0, 1).Unix())
	s = statisticsRead(t, d)
	for _, day := range s.Activity {
		if day.Created != 0 || day.Updated != 0 {
			t.Fatal(day)
		}
	}
}
func TestLibraryStatisticsRejectsInvalidMetadataAndOversizedBody(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`UPDATE files SET created_at=-1 WHERE id='note-a'`)
	if s, e := d.LibraryStatistics(context.Background()); s != nil || e == nil {
		t.Fatal("invalid time accepted")
	}
	d.DB.Exec(`UPDATE files SET created_at=1,content=? WHERE id='note-a'`, strings.Repeat("x", libraryStatisticsNoteBytes+1))
	if s, e := d.LibraryStatistics(context.Background()); s != nil || e == nil {
		t.Fatal("oversized accepted")
	}
}
