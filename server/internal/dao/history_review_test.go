package dao

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func historyReviewFixture(t *testing.T) *FileDAO {
	t.Helper()
	d := compareFixture(t)
	_, err := d.DB.Exec(`CREATE TABLE IF NOT EXISTS file_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,file_id TEXT,title TEXT,content TEXT,created_at INTEGER);INSERT INTO file_versions(file_id,title,content,created_at)VALUES('note-a','旧标题','old\nbody',1),('note-a','快照','older exact',2),('note-b','私有他文','private',3)`)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
func historyReviewRead(t *testing.T, d *FileDAO, id int64) *HistoryReview {
	t.Helper()
	v, e := d.ReadHistoryReview(context.Background(), "note-a", id)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestHistoryReviewCompleteSnapshotAndNoWrites(t *testing.T) {
	d := historyReviewFixture(t)
	var before, after int
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&before)
	v := historyReviewRead(t, d, 2)
	if !v.Complete || v.Total != 2 || len(v.Versions) != 2 || v.Selected.ID != 2 || v.Current.Content != "alpha" || v.Selected.Content != "older exact" {
		t.Fatalf("%+v", v)
	}
	d.DB.QueryRow(`SELECT total_changes()`).Scan(&after)
	if before != after {
		t.Fatal("read wrote data")
	}
	if historyReviewRead(t, d, 2).Revision != v.Revision {
		t.Fatal("capture time affected revision")
	}
	if historyReviewRead(t, d, 1).Selected.Content != `old\nbody` {
		t.Fatal("snapshot changed")
	}
	b, _ := json.Marshal(v)
	if strings.Contains(string(b), "private") {
		t.Fatal("other note disclosed")
	}
}
func TestHistoryReviewNoVersionsIsExplicitNotCurrent(t *testing.T) {
	d := historyReviewFixture(t)
	d.DB.Exec(`DELETE FROM file_versions WHERE file_id='note-a'`)
	v := historyReviewRead(t, d, 0)
	if v.Total != 0 || v.Selected != nil || v.Versions == nil {
		t.Fatal(v)
	}
}
func TestHistoryReviewSnapshotOrderingAndRevision(t *testing.T) {
	for _, q := range []string{`UPDATE files SET content='new' WHERE id='note-a'`, `UPDATE files SET title='rename' WHERE id='note-a'`, `UPDATE file_versions SET content='changed' WHERE id=2`, `UPDATE file_versions SET title='changed' WHERE id=1`, `DELETE FROM file_versions WHERE id=1`, `INSERT INTO file_versions(file_id,title,content,created_at)VALUES('note-a','new','new',2)`} {
		t.Run(q, func(t *testing.T) {
			d := historyReviewFixture(t)
			a := historyReviewRead(t, d, 2)
			if _, e := d.DB.Exec(q); e != nil {
				t.Fatal(e)
			}
			if historyReviewRead(t, d, 2).Revision == a.Revision {
				t.Fatal("change not bound")
			}
		})
	}
	d := historyReviewFixture(t)
	d.DB.Exec(`INSERT INTO file_versions(file_id,title,content,created_at)VALUES('note-a','same time','x',2)`)
	v := historyReviewRead(t, d, 4)
	if v.Selected.ID != 4 || v.Versions[1].ID != 2 {
		t.Fatal("unstable ordering")
	}
}
func TestHistoryReviewRefusesHiddenForeignDeletedAndInvalid(t *testing.T) {
	for _, id := range []string{"", "missing", "note-a ", "a\x00", "a' OR 1=1--"} {
		d := historyReviewFixture(t)
		if v, e := d.ReadHistoryReview(context.Background(), id, 0); v != nil || e == nil {
			t.Fatal(id)
		}
	}
	for _, id := range []int64{-1, 3, 999} {
		d := historyReviewFixture(t)
		if v, e := d.ReadHistoryReview(context.Background(), "note-a", id); v != nil || e == nil {
			t.Fatal(id)
		}
	}
	for _, q := range []string{`UPDATE files SET is_deleted=1 WHERE id='note-a'`, `UPDATE files SET is_folder=1 WHERE id='note-a'`, `UPDATE files SET title='__tpl__hidden' WHERE id='note-a'`, `UPDATE file_versions SET created_at=-1 WHERE id=1`, `UPDATE file_versions SET content=NULL WHERE id=1`, `UPDATE files SET content=CAST(x'FF' AS TEXT) WHERE id='note-a'`, `UPDATE file_versions SET content=CAST(x'FF' AS TEXT) WHERE id=2`} {
		t.Run(q, func(t *testing.T) {
			d := historyReviewFixture(t)
			if _, e := d.DB.Exec(q); e != nil {
				t.Fatal(e)
			}
			if v, e := d.ReadHistoryReview(context.Background(), "note-a", 2); v != nil || e == nil {
				t.Fatal("accepted invalid", v)
			}
		})
	}
}
func TestHistoryReviewBoundsAndCancellation(t *testing.T) {
	d := historyReviewFixture(t)
	d.DB.Exec(`UPDATE file_versions SET content=? WHERE id=2`, strings.Repeat("x", ComparisonBodyLimit))
	if historyReviewRead(t, d, 2).Selected.ContentBytes != ComparisonBodyLimit {
		t.Fatal("boundary")
	}
	d.DB.Exec(`UPDATE file_versions SET content=? WHERE id=2`, strings.Repeat("x", ComparisonBodyLimit+1))
	if v, e := d.ReadHistoryReview(context.Background(), "note-a", 2); v != nil || e == nil {
		t.Fatal("oversized snapshot")
	}
	if historyReviewRead(t, d, 1).Selected.ID != 1 {
		t.Fatal("other bounded history inaccessible")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if v, e := d.ReadHistoryReview(ctx, "note-a", 1); v != nil || e == nil {
		t.Fatal("cancelled read")
	}
	d.DB.Exec(`DELETE FROM file_versions`)
	for i := 0; i < HistoryReviewLimit; i++ {
		d.DB.Exec(`INSERT INTO file_versions(file_id,title,content,created_at)VALUES('note-a','v','x',1)`)
	}
	if historyReviewRead(t, d, 0).Total != HistoryReviewLimit {
		t.Fatal("index boundary")
	}
	d.DB.Exec(`INSERT INTO file_versions(file_id,title,content,created_at)VALUES('note-a','v','x',1)`)
	if v, e := d.ReadHistoryReview(context.Background(), "note-a", 2); v != nil || e == nil {
		t.Fatal("truncated index accepted")
	}
}
func TestHistoryReviewExactRawUnicodeAndEmpty(t *testing.T) {
	d := historyReviewFixture(t)
	for _, body := range []string{"", " ", "e\u0301\r\n中😀", `<script>alert(1)</script>`, `{"root":{"children":[]}}`} {
		d.DB.Exec(`UPDATE file_versions SET content=? WHERE id=2`, body)
		v := historyReviewRead(t, d, 2)
		if v.Selected.Content != body || v.Selected.ContentBytes != int64(len(body)) {
			t.Fatal("normalized")
		}
	}
}
