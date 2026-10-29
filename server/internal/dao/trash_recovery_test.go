package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func recoveryDB(t *testing.T) *FileDAO {
	t.Helper()
	db, e := sql.Open("sqlite", filepath.Join(t.TempDir(), "recovery.db")+"?_pragma=busy_timeout(5000)")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { db.Close() })
	_, e = db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at INTEGER DEFAULT 1,updated_at INTEGER DEFAULT 1,is_folder INTEGER DEFAULT 0,parent_id TEXT DEFAULT '',sort_order INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0,content_version INTEGER DEFAULT 7);
 CREATE TABLE file_tags(file_id TEXT,tag_id TEXT);CREATE TABLE file_versions(file_id TEXT,content TEXT);CREATE TABLE save_receipts(id TEXT,result TEXT);
 INSERT INTO files(id,title,is_folder) VALUES('live','现存目录',1);
 INSERT INTO files(id,title,content) VALUES('anchor','当前笔记','KEEP-ANCHOR');
 INSERT INTO files(id,title,parent_id,is_folder,is_deleted,deleted_at) VALUES('gone','归档目录','live',1,1,20),('nested','内层','gone',1,1,20);
 INSERT INTO files(id,title,content,parent_id,is_deleted,deleted_at,sort_order,is_pinned) VALUES('n1','笔记一','KEEP-ONE','gone',1,20,-1000,1),('n2','笔记二','KEEP-TWO','nested',1,20,1000,0),('sibling','独立','KEEP-SIBLING','live',1,30,2000,0),('template','__tpl__不可恢复','KEEP-TEMPLATE','',1,25,0,0);
 INSERT INTO file_tags VALUES('n1','tag');INSERT INTO file_versions VALUES('n1','old content');INSERT INTO save_receipts VALUES('receipt','unchanged');
 CREATE TRIGGER no_recovery_body_write BEFORE UPDATE OF content ON files BEGIN SELECT RAISE(ABORT,'body writes forbidden');END;`)
	if e != nil {
		t.Fatal(e)
	}
	return &FileDAO{DB: db}
}
func recoveryRead(t *testing.T, d *FileDAO) *TrashRecoverySnapshot {
	t.Helper()
	s, e := d.TrashRecovery(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func recoveryCommand(t *testing.T, d *FileDAO, ids ...string) TrashRecoveryChange {
	t.Helper()
	return TrashRecoveryChange{RequestID: uuid.NewString(), ExpectedRevision: recoveryRead(t, d).Revision, IDs: ids, Mode: "original"}
}
func recoveryUntouched(t *testing.T, d *FileDAO) string {
	t.Helper()
	rows, e := d.DB.Query(`SELECT id,title,content,created_at,is_pinned,content_version FROM files ORDER BY id`)
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	var out []any
	for rows.Next() {
		var id, title, body string
		var created, pin, version int64
		if e = rows.Scan(&id, &title, &body, &created, &pin, &version); e != nil {
			t.Fatal(e)
		}
		out = append(out, []any{id, title, body, created, pin, version})
	}
	if e = rows.Err(); e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{`SELECT group_concat(file_id||':'||tag_id) FROM file_tags`, `SELECT group_concat(file_id||':'||content) FROM file_versions`, `SELECT group_concat(id||':'||result) FROM save_receipts`} {
		var v string
		if e = d.DB.QueryRow(q).Scan(&v); e != nil {
			t.Fatal(e)
		}
		out = append(out, v)
	}
	b, _ := json.Marshal(out)
	return string(b)
}
func TestTrashRecoverySnapshotIsCompleteMetadataOnly(t *testing.T) {
	d := recoveryDB(t)
	s := recoveryRead(t, d)
	if len(s.Items) != 8 || !s.Complete || s.Version != 1 || s.Revision != recoveryRead(t, d).Revision {
		t.Fatal(s)
	}
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), "KEEP-") || strings.Contains(string(b), "content") {
		t.Fatal("body leaked")
	}
	d.DB.Exec(`UPDATE files SET deleted_at=21 WHERE id='gone'`)
	if recoveryRead(t, d).Revision == s.Revision {
		t.Fatal("deleted timestamp not bound")
	}
}
func TestTrashRecoveryWholeOriginalBatchPreservesOtherData(t *testing.T) {
	d := recoveryDB(t)
	keep := recoveryUntouched(t, d)
	c := recoveryCommand(t, d, "gone", "sibling")
	r, e := d.RecoverTrash(context.Background(), c)
	if e != nil {
		t.Fatal(e)
	}
	if len(r.RestoredIDs) != 5 || len(r.AppliedIDs) != 2 || r.RequestID != c.RequestID || r.BeforeRevision != c.ExpectedRevision || r.Snapshot.Revision == c.ExpectedRevision {
		t.Fatal(r)
	}
	for _, id := range r.RestoredIDs {
		var deleted, at int64
		if e = d.DB.QueryRow(`SELECT is_deleted,deleted_at FROM files WHERE id=?`, id).Scan(&deleted, &at); e != nil || deleted != 0 || at != 0 {
			t.Fatal(id, e)
		}
	}
	if keep != recoveryUntouched(t, d) {
		t.Fatal("non-recovery fields changed")
	}
	var parent string
	var order int64
	d.DB.QueryRow(`SELECT parent_id,sort_order FROM files WHERE id='n1'`).Scan(&parent, &order)
	if parent != "gone" || order != -1000 {
		t.Fatal(parent, order)
	}
	if _, e = d.RecoverTrash(context.Background(), c); e == nil {
		t.Fatal("replay accepted")
	}
}
func TestTrashRecoveryMissingParentRequiresExplicitDestination(t *testing.T) {
	for _, target := range []string{"", "live"} {
		t.Run(target, func(t *testing.T) {
			d := recoveryDB(t)
			d.DB.Exec(`UPDATE files SET parent_id='missing' WHERE id='gone'`)
			c := recoveryCommand(t, d, "gone")
			if _, e := d.RecoverTrash(context.Background(), c); e == nil {
				t.Fatal("original missing parent accepted")
			}
			c.Mode = "target"
			c.ParentID = target
			r, e := d.RecoverTrash(context.Background(), c)
			if e != nil || len(r.RestoredIDs) != 4 {
				t.Fatal(r, e)
			}
			for _, row := range r.Snapshot.Items {
				if row.ID == "gone" && (row.ParentID != target || row.SortOrder != 1000) {
					t.Fatal(row)
				}
				if row.ID == "nested" && row.ParentID != "gone" {
					t.Fatal(row)
				}
			}
		})
	}
}
func TestTrashRecoverySelectedChildCanLeaveDeletedAncestor(t *testing.T) {
	d := recoveryDB(t)
	c := recoveryCommand(t, d, "n1")
	if _, e := d.RecoverTrash(context.Background(), c); e == nil {
		t.Fatal("deleted parent accepted")
	}
	c.Mode = "target"
	c.ParentID = "live"
	r, e := d.RecoverTrash(context.Background(), c)
	if e != nil || len(r.RestoredIDs) != 1 {
		t.Fatal(r, e)
	}
	var gone int
	d.DB.QueryRow(`SELECT is_deleted FROM files WHERE id='gone'`).Scan(&gone)
	if gone != 1 {
		t.Fatal("unselected ancestor restored")
	}
}
func TestTrashRecoveryRefusesUnsafeWholeBatches(t *testing.T) {
	cases := []struct {
		name, sql    string
		ids          []string
		mode, parent string
	}{
		{"duplicate", "", []string{"gone", "gone"}, "original", ""},
		{"mixed ancestor", "", []string{"gone", "n1"}, "target", ""},
		{"reverse mixed ancestor", "", []string{"n1", "gone"}, "target", ""},
		{"active source", "", []string{"anchor"}, "original", ""},
		{"template source", "", []string{"template"}, "original", ""},
		{"deleted destination", "", []string{"sibling"}, "target", "gone"},
		{"note destination", "", []string{"sibling"}, "target", "anchor"},
		{"missing destination", "", []string{"gone"}, "target", "missing"},
		{"broken target chain", `UPDATE files SET parent_id='missing' WHERE id='live'`, []string{"gone"}, "target", "live"},
		{"active descendant", `UPDATE files SET is_deleted=0 WHERE id='n1'`, []string{"gone"}, "original", ""},
		{"hidden descendant", `UPDATE files SET parent_id='gone' WHERE id='template'`, []string{"gone"}, "original", ""},
		{"note has children", `UPDATE files SET parent_id='n1' WHERE id='n2'`, []string{"gone"}, "original", ""},
		{"cycle", `UPDATE files SET parent_id='nested' WHERE id='gone'`, []string{"gone"}, "target", ""},
		{"root collision", `INSERT INTO files(id,title,parent_id) VALUES('collision','归档目录','live')`, []string{"gone"}, "original", ""},
		{"ASCII collision", `UPDATE files SET title='NAME' WHERE id='sibling';INSERT INTO files(id,title,parent_id) VALUES('collision','name','live')`, []string{"sibling"}, "original", ""},
		{"batch collision", `UPDATE files SET title='归档目录' WHERE id='sibling'`, []string{"gone", "sibling"}, "target", ""},
		{"nested collision", `UPDATE files SET parent_id='gone',title='笔记一' WHERE id='n2'`, []string{"gone"}, "original", ""},
		{"overflow", `UPDATE files SET sort_order=9007199254740000 WHERE id='anchor'`, []string{"gone"}, "target", ""},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			d := recoveryDB(t)
			if tt.sql != "" {
				if _, e := d.DB.Exec(tt.sql); e != nil {
					t.Fatal(e)
				}
			}
			before := recoveryRead(t, d)
			c := recoveryCommand(t, d, tt.ids...)
			c.Mode = tt.mode
			c.ParentID = tt.parent
			if _, e := d.RecoverTrash(context.Background(), c); e == nil {
				t.Fatal("unsafe recovery accepted")
			}
			if recoveryRead(t, d).Revision != before.Revision {
				t.Fatal("refused batch changed metadata")
			}
		})
	}
}
func TestTrashRecoveryStaleChildOrOtherChangeRefuses(t *testing.T) {
	for _, q := range []string{`INSERT INTO files(id,title,parent_id,is_deleted) VALUES('late','新子项','gone',1)`, `UPDATE files SET title='changed' WHERE id='anchor'`, `UPDATE files SET deleted_at=999 WHERE id='n1'`} {
		d := recoveryDB(t)
		c := recoveryCommand(t, d, "gone")
		d.DB.Exec(q)
		before := recoveryRead(t, d).Revision
		if _, e := d.RecoverTrash(context.Background(), c); e == nil {
			t.Fatal("stale accepted")
		}
		if before != recoveryRead(t, d).Revision {
			t.Fatal("changed")
		}
	}
}
func TestTrashRecoveryRollsBackOnLateRowFailure(t *testing.T) {
	d := recoveryDB(t)
	c := recoveryCommand(t, d, "gone")
	before := recoveryRead(t, d).Revision
	keep := recoveryUntouched(t, d)
	d.DB.Exec(`CREATE TRIGGER reject_second_recovery BEFORE UPDATE OF is_deleted ON files WHEN OLD.id='n2' BEGIN SELECT RAISE(ABORT,'injected failure');END;`)
	if _, e := d.RecoverTrash(context.Background(), c); e == nil {
		t.Fatal("failed row accepted")
	}
	if recoveryRead(t, d).Revision != before || recoveryUntouched(t, d) != keep {
		t.Fatal("partial batch committed")
	}
}
func TestTrashRecoveryConcurrentVersionAdmitsExactlyOne(t *testing.T) {
	d := recoveryDB(t)
	a := recoveryCommand(t, d, "gone")
	b := a
	b.RequestID = uuid.NewString()
	b.IDs = []string{"sibling"}
	start := make(chan struct{})
	out := make(chan error, 2)
	var wg sync.WaitGroup
	for _, c := range []TrashRecoveryChange{a, b} {
		wg.Add(1)
		go func(c TrashRecoveryChange) {
			defer wg.Done()
			<-start
			_, e := d.RecoverTrash(context.Background(), c)
			out <- e
		}(c)
	}
	close(start)
	wg.Wait()
	close(out)
	success := 0
	for e := range out {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal(success)
	}
}
func TestTrashRecoveryBoundsAndCancellation(t *testing.T) {
	d := recoveryDB(t)
	for _, c := range []TrashRecoveryChange{{}, {RequestID: uuid.NewString(), ExpectedRevision: strings.Repeat("a", 64), IDs: []string{"gone"}, Mode: "delete"}, {RequestID: uuid.NewString(), ExpectedRevision: strings.Repeat("a", 64), IDs: []string{"bad\n"}, Mode: "original"}} {
		if _, e := d.RecoverTrash(context.Background(), c); e == nil {
			t.Fatal(c)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := recoveryCommand(t, d, "gone")
	if _, e := d.RecoverTrash(ctx, c); e == nil {
		t.Fatal("cancelled write")
	}
	if _, e := d.TrashRecovery(ctx); e == nil {
		t.Fatal("cancelled read")
	}
	d.DB.Exec(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO files(id,title,parent_id,is_deleted) SELECT 'many-'||x,'many-'||x,'gone',1 FROM n`)
	c = recoveryCommand(t, d, "gone")
	if _, e := d.RecoverTrash(context.Background(), c); e == nil {
		t.Fatal("oversized subtree")
	}
	d.DB.Exec(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO files(id,title) SELECT 'limit-'||x,'limit-'||x FROM n`)
	if _, e := d.TrashRecovery(context.Background()); e == nil {
		t.Fatal("partial snapshot")
	}
}
func TestTrashRecoveryRejectsInvalidMetadata(t *testing.T) {
	for _, q := range []string{`UPDATE files SET updated_at=-1 WHERE id='gone'`, `UPDATE files SET deleted_at=-1 WHERE id='gone'`, `UPDATE files SET sort_order=9007199254740992 WHERE id='gone'`, `UPDATE files SET id=char(10) WHERE id='gone'`, `UPDATE files SET title=replace(hex(zeroblob(2100)),'0','x') WHERE id='gone'`} {
		d := recoveryDB(t)
		d.DB.Exec(q)
		if _, e := d.TrashRecovery(context.Background()); e == nil {
			t.Fatal(q)
		}
	}
}
