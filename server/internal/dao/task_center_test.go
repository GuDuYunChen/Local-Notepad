package dao

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func taskRead(t *testing.T, d *FileDAO) *TaskCenterSnapshot {
	t.Helper()
	s, e := d.TaskCenter(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestTaskCenterReadOnlyScopeAndSnapshot(t *testing.T) {
	d := statisticsFixture(t)
	const body = "- [ ] 中文待办\n- [x] 已完成"
	if _, e := d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, body); e != nil {
		t.Fatal(e)
	}
	d.DB.Exec(`UPDATE files SET content='不泄露非待办段落' WHERE id='note-b'`)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder) VALUES('folder','文件夹','folder-secret',1,1,1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES('template',?,'- [ ] template-secret',1,1)`, TemplatePrefix+"模板")
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_deleted) VALUES('trash','回收站','- [ ] trash-secret',1,1,1)`)
	s := taskRead(t, d)
	if s.Totals.Notes != 2 || s.Totals.WithTasks != 1 || s.Totals.Tasks != 2 || s.Totals.Done != 1 || s.Totals.Pending != 1 || s.Totals.Folders != 1 || s.Totals.Templates != 1 || s.Totals.Trash != 1 || !s.Complete {
		t.Fatal(s)
	}
	if s.Items[0].NoteID != "note-a" || s.Items[0].Line != 1 || s.Items[1].Line != 2 {
		t.Fatal(s.Items)
	}
	raw, _ := json.Marshal(s)
	for _, secret := range []string{"不泄露非待办段落", "folder-secret", "template-secret", "trash-secret"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("exposed unrelated content")
		}
	}
	var after string
	d.DB.QueryRow(`SELECT content FROM files WHERE id='note-a'`).Scan(&after)
	if after != body {
		t.Fatal("body changed")
	}
	if taskRead(t, d).Revision != s.Revision {
		t.Fatal("unstable revision")
	}
}
func TestTaskCenterSavedCheckboxChangesReflectedWithoutCenterWrites(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`UPDATE files SET content='- [ ] Original' WHERE id='note-a'`)
	a := taskRead(t, d)
	d.DB.Exec(`UPDATE files SET content='- [x] Original' WHERE id='note-a'`)
	b := taskRead(t, d)
	if a.Revision == b.Revision || a.Notes[0].ContentHash == b.Notes[0].ContentHash || a.Items[0].Done || !b.Items[0].Done {
		t.Fatal(a, b)
	}
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='note-a'`)
	c := taskRead(t, d)
	if c.Totals.Tasks != 0 || c.Totals.Trash != 1 {
		t.Fatal(c)
	}
}
func TestTaskCenterCoverageIsNotZeroTasksClaim(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, `{"root":`)
	d.DB.Exec(`UPDATE files SET content='    - [ ] ambiguous indentation' WHERE id='note-b'`)
	s := taskRead(t, d)
	if s.Totals.Unsupported != 2 || s.Notes[0].Supported || s.Notes[1].Supported {
		t.Fatal(s)
	}
}
func TestTaskCenterRefusesPartialAndCancellation(t *testing.T) {
	d := statisticsFixture(t)
	for _, v := range [][2]int64{{1, libraryStatisticsBytes}, {LibraryStatisticsLimit, 1}} {
		s, e := d.taskCenter(context.Background(), int(v[0]), v[1])
		if e == nil || s != nil {
			t.Fatal("partial result", s, e)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s, e := d.TaskCenter(ctx); s != nil || e == nil {
		t.Fatal("cancel accepted")
	}
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, strings.Repeat("- [ ] x\n", 10001))
	if s, e := d.TaskCenter(context.Background()); s != nil || e == nil {
		t.Fatal("too many tasks accepted")
	}
}
func TestTaskCenterMetadataFailureDoesNotReturnPartialData(t *testing.T) {
	d := statisticsFixture(t)
	d.DB.Exec(`UPDATE files SET updated_at=-1 WHERE id='note-b'`)
	if s, e := d.TaskCenter(context.Background()); s != nil || e == nil {
		t.Fatal(s, e)
	}
	d.DB.Exec(`DROP TABLE files`)
	if s, e := d.TaskCenter(context.Background()); s != nil || e == nil {
		t.Fatal(s, e)
	}
}
