package dao

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func compareFixture(t *testing.T) *FileDAO {
	t.Helper()
	d := statisticsFixture(t)
	_, e := d.DB.Exec(`UPDATE files SET content='alpha',updated_at=1 WHERE id='note-a'; UPDATE files SET content='beta',updated_at=2 WHERE id='note-b'`)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func compareRead(t *testing.T, d *FileDAO) *NoteComparison {
	t.Helper()
	v, e := d.CompareNotes(context.Background(), "note-a", "note-b")
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestComparisonCompleteReadonlySavedPair(t *testing.T) {
	d := compareFixture(t)
	addWorkspaceTag(t, &TagDAO{DB: d.DB}, "keep", "保留标签", "note-a")
	var before, after int
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&before)
	r := compareRead(t, d)
	if !r.Complete || r.Version != 1 || r.RawEqual || r.Notes[0].Content != "alpha" || r.Notes[1].Content != "beta" || len(r.Revision) != 64 || r.Notes[0].ContentBytes != 5 || r.Notes[1].ContentBytes != 4 {
		t.Fatalf("%+v", r)
	}
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&after)
	if before != after {
		t.Fatal("comparison wrote data")
	}
	var links int
	d.DB.QueryRow(`SELECT count(*) FROM file_tags WHERE tag_id='keep'`).Scan(&links)
	if links != 1 {
		t.Fatal("tags changed")
	}
	if compareRead(t, d).Revision != r.Revision {
		t.Fatal("capture time contaminated revision")
	}
	reverse, e := d.CompareNotes(context.Background(), "note-b", "note-a")
	if e != nil || reverse.Revision == r.Revision || reverse.Notes[0] != r.Notes[1] {
		t.Fatal("direction lost", e)
	}
}
func TestComparisonExactBytesAndEmptyBody(t *testing.T) {
	d := compareFixture(t)
	for _, p := range [][2]string{{"", ""}, {"", " "}, {"x\n", "x\r\n"}, {"e\u0301", "é"}, {"<script>x</script>", "<script>x</script>"}, {`{"root":{"children":[]}}`, `{"root": {"children": []}}`}} {
		d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, p[0])
		d.DB.Exec(`UPDATE files SET content=? WHERE id='note-b'`, p[1])
		v := compareRead(t, d)
		if v.RawEqual != (p[0] == p[1]) || v.Notes[0].Content != p[0] || v.Notes[1].Content != p[1] {
			t.Fatal("normalization", p)
		}
		b, e := json.Marshal(v)
		if e != nil || !json.Valid(b) {
			t.Fatal(e)
		}
	}
}
func TestComparisonRevisionBindsMetadataAndBodies(t *testing.T) {
	for _, sql := range []string{`UPDATE files SET content='changed' WHERE id='note-b'`, `UPDATE files SET title='renamed' WHERE id='note-a'`, `UPDATE files SET updated_at=90 WHERE id='note-a'`, `INSERT INTO files(id,title,is_folder)VALUES('folder','目录',1); UPDATE files SET parent_id='folder' WHERE id='note-b'`} {
		t.Run(sql, func(t *testing.T) {
			d := compareFixture(t)
			a := compareRead(t, d)
			if _, e := d.DB.Exec(sql); e != nil {
				t.Fatal(e)
			}
			if a.Revision == compareRead(t, d).Revision {
				t.Fatal("stale revision")
			}
		})
	}
}
func TestComparisonRejectsUnavailableAndInvalidInput(t *testing.T) {
	for _, p := range [][2]string{{"", "note-b"}, {"note-a", "note-a"}, {"missing", "note-b"}, {"note-a ", "note-b"}, {"a\x00", "note-b"}, {"a\u0085", "note-b"}, {strings.Repeat("a", 129), "note-b"}, {"a' OR 1=1--", "note-b"}} {
		d := compareFixture(t)
		v, e := d.CompareNotes(context.Background(), p[0], p[1])
		if v != nil || e == nil {
			t.Fatal("accepted invalid source", p)
		}
	}
	for _, sql := range []string{`UPDATE files SET is_folder=1 WHERE id='note-a'`, `UPDATE files SET is_deleted=1 WHERE id='note-b'`, `UPDATE files SET title='__tpl__hidden' WHERE id='note-a'`, `UPDATE files SET updated_at=-1 WHERE id='note-a'`, `UPDATE files SET parent_id='a'||char(0)||'b' WHERE id='note-a'`, `UPDATE files SET content=CAST(x'FF' AS TEXT) WHERE id='note-b'`} {
		t.Run(sql, func(t *testing.T) {
			d := compareFixture(t)
			if _, e := d.DB.Exec(sql); e != nil {
				t.Fatal(e)
			}
			v, e := d.CompareNotes(context.Background(), "note-a", "note-b")
			if v != nil || e == nil {
				t.Fatal("returned partial/invalid pair")
			}
		})
	}
}
func TestComparisonBudgetAndCancellation(t *testing.T) {
	d := compareFixture(t)
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-b'`, strings.Repeat("a", ComparisonBodyLimit))
	if compareRead(t, d).Notes[1].ContentBytes != ComparisonBodyLimit {
		t.Fatal("boundary")
	}
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-b'`, strings.Repeat("a", ComparisonBodyLimit+1))
	if v, e := d.CompareNotes(context.Background(), "note-a", "note-b"); e == nil || v != nil {
		t.Fatal("oversize not refused")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if v, e := d.CompareNotes(ctx, "note-a", "note-b"); e == nil || v != nil {
		t.Fatal("cancel returned partial pair")
	}
}
func TestComparisonFolderIdentityAndUnrelatedData(t *testing.T) {
	d := compareFixture(t)
	d.DB.Exec(`INSERT INTO files(id,title,is_folder)VALUES('folder','目录',1); UPDATE files SET parent_id='folder' WHERE id='note-a'`)
	a := compareRead(t, d)
	if a.Notes[0].Folder != "目录" {
		t.Fatal(a)
	}
	d.DB.Exec(`UPDATE files SET title='新目录' WHERE id='folder'`)
	b := compareRead(t, d)
	if b.Revision == a.Revision {
		t.Fatal("folder rename omitted")
	}
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='folder'`)
	if compareRead(t, d).Notes[0].Folder != "位置不可用" {
		t.Fatal("hidden folder disclosed")
	}
	a = compareRead(t, d)
	d.DB.Exec(`INSERT INTO files(id,title,content)VALUES('unrelated','other','not part of this pair')`)
	if compareRead(t, d).Revision != a.Revision {
		t.Fatal("unrelated body included")
	}
}
