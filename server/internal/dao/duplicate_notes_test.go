package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func duplicateFixture(t *testing.T) *FileDAO {
	d := statisticsFixture(t)
	_, e := d.DB.Exec(`UPDATE files SET content='same saved body',updated_at=1 WHERE id IN ('note-a','note-b')`)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func duplicateRead(t *testing.T, d *FileDAO) *DuplicateNotesSnapshot {
	t.Helper()
	s, e := d.DuplicateNotes(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestDuplicateNotesExactScopeAndNoWrites(t *testing.T) {
	d := duplicateFixture(t)
	for _, q := range []string{`INSERT INTO files(id,title,content,updated_at,is_folder)VALUES('folder','目录','same saved body',1,1)`, `INSERT INTO files(id,title,content,updated_at)VALUES('template','__tpl__模板','same saved body',1)`, `INSERT INTO files(id,title,content,updated_at,is_deleted)VALUES('trash','回收','same saved body',1,1)`, `INSERT INTO files(id,title,content,updated_at)VALUES('empty','零字节','',1)`, `UPDATE files SET parent_id='folder' WHERE id='note-b'`} {
		if _, e := d.DB.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	addWorkspaceTag(t, &TagDAO{DB: d.DB}, "t", "保留标签", "note-a", "trash")
	var before int
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&before)
	s := duplicateRead(t, d)
	if !s.Complete || s.Version != 1 || s.Totals.Notes != 3 || s.Totals.Groups != 1 || s.Totals.DuplicateNotes != 2 || s.Totals.AdditionalCopies != 1 || s.Totals.Empty != 1 || s.Totals.Templates != 1 || s.Totals.Trash != 1 || s.Totals.Folders != 1 {
		t.Fatalf("%+v", s)
	}
	if strings.Join(s.Groups[0].IDs, ",") != "note-a,note-b" || s.Groups[0].ContentBytes != 15 {
		t.Fatal(s.Groups)
	}
	var changes int
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&changes)
	if changes != before {
		t.Fatal("read performed writes")
	}
	encoded, _ := json.Marshal(s)
	if strings.Contains(string(encoded), "same saved body") {
		t.Fatal("body leaked")
	}
	var body string
	d.DB.QueryRow(`SELECT content FROM files WHERE id='note-a'`).Scan(&body)
	if body != "same saved body" {
		t.Fatal(body)
	}
	var links int
	d.DB.QueryRow(`SELECT count(*) FROM file_tags`).Scan(&links)
	if links != 2 {
		t.Fatal(links)
	}
}
func TestDuplicateNotesNoSemanticNormalization(t *testing.T) {
	d := duplicateFixture(t)
	for _, pair := range [][2]string{{"x", "x "}, {"e\u0301", "é"}, {"a\r\nb", "a\nb"}, {`{"a":1,"b":2}`, `{"b":2,"a":1}`}, {"- [ ] test", "- [x] test"}} {
		d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, pair[0])
		d.DB.Exec(`UPDATE files SET content=? WHERE id='note-b'`, pair[1])
		if duplicateRead(t, d).Totals.Groups != 0 {
			t.Fatal("semantic normalization", pair)
		}
	}
	d.DB.Exec(`UPDATE files SET content='　'`)
	s := duplicateRead(t, d)
	if s.Totals.Groups != 1 || s.Groups[0].ContentBytes != 3 {
		t.Fatal("nonzero whitespace is stored data", s)
	}
}
func TestDuplicateNotesEmptyBodiesAndEmptyLibrary(t *testing.T) {
	d := duplicateFixture(t)
	d.DB.Exec(`UPDATE files SET content=''`)
	s := duplicateRead(t, d)
	if s.Totals.Empty != 2 || s.Totals.Groups != 0 {
		t.Fatal(s)
	}
	d.DB.Exec(`DELETE FROM files`)
	s = duplicateRead(t, d)
	if s.Notes == nil || s.Groups == nil || s.Totals.Notes != 0 {
		t.Fatal(s)
	}
}
func TestDuplicateNotesRevisionAndFormerGroup(t *testing.T) {
	d := duplicateFixture(t)
	a := duplicateRead(t, d)
	if duplicateRead(t, d).Revision != a.Revision {
		t.Fatal("unstable")
	}
	d.DB.Exec(`UPDATE files SET content='changed' WHERE id='note-b'`)
	b := duplicateRead(t, d)
	if b.Totals.Groups != 0 || a.Revision == b.Revision {
		t.Fatal("body change missed")
	}
	d.DB.Exec(`UPDATE files SET title='renamed' WHERE id='note-a'`)
	c := duplicateRead(t, d)
	if b.Revision == c.Revision {
		t.Fatal("rename missed")
	}
	d.DB.Exec(`UPDATE files SET parent_id='unavailable' WHERE id='note-a'`)
	e := duplicateRead(t, d)
	if c.Revision == e.Revision {
		t.Fatal("move missed")
	}
	for _, n := range e.Notes {
		if n.ID == "note-a" && n.Folder != "位置不可用" {
			t.Fatal(n)
		}
	}
}
func TestDuplicateNotesRejectsLimitsAndCancellation(t *testing.T) {
	d := duplicateFixture(t)
	for _, v := range [][2]int64{{1, duplicateNotesBodyBudget}, {DuplicateNotesLimit, 1}} {
		if s, e := d.duplicateNotesAt(context.Background(), time.Now(), int(v[0]), v[1]); s != nil || e == nil {
			t.Fatal("partial accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s, e := d.DuplicateNotes(ctx); s != nil || e == nil {
		t.Fatal("cancel accepted")
	}
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, strings.Repeat("x", duplicateNoteBodyLimit+1))
	if s, e := d.DuplicateNotes(context.Background()); s != nil || e == nil {
		t.Fatal("oversize accepted")
	}
}
func TestDuplicateNotesRejectsInvalidMetadataAndEncoding(t *testing.T) {
	for name, q := range map[string]string{"id": `UPDATE files SET id=char(10)||'bad' WHERE id='note-a'`, "parent": `UPDATE files SET parent_id=char(1) WHERE id='note-a'`, "time": `UPDATE files SET updated_at=-1 WHERE id='note-a'`, "body": `UPDATE files SET content=CAST(x'80' AS TEXT) WHERE id='note-a'`} {
		t.Run(name, func(t *testing.T) {
			d := duplicateFixture(t)
			if _, e := d.DB.Exec(q); e != nil {
				t.Fatal(e)
			}
			if s, e := d.DuplicateNotes(context.Background()); s != nil || e == nil {
				t.Fatal("invalid accepted")
			}
		})
	}
}
func TestDuplicateNotesCompleteLargeGroupAndCrossFolder(t *testing.T) {
	d := duplicateFixture(t)
	for i := 0; i < 51; i++ {
		id := strings.Repeat("z", i+1)
		_, e := d.DB.Exec(`INSERT INTO files(id,title,content,updated_at,parent_id)VALUES(?,?,?,1,'unknown')`, id, "same name", "same saved body")
		if e != nil {
			t.Fatal(e)
		}
	}
	s := duplicateRead(t, d)
	if s.Totals.DuplicateNotes != 53 || len(s.Groups) != 1 || len(s.Groups[0].IDs) != 53 {
		t.Fatal(s.Totals)
	}
}

func TestDuplicateNotesNullLegacyBodyRefused(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, e = db.Exec(`CREATE TABLE files(id TEXT,title TEXT,parent_id TEXT,updated_at INTEGER,is_folder INTEGER,is_deleted INTEGER,content TEXT); INSERT INTO files VALUES('a','a','',1,0,0,NULL)`)
	if e != nil {
		t.Fatal(e)
	}
	if result, e := (&FileDAO{DB: db}).DuplicateNotes(context.Background()); e == nil || result != nil {
		t.Fatal("legacy nullable body accepted")
	}
}
