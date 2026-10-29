package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	_ "modernc.org/sqlite"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func folderDB(t *testing.T) *FileDAO {
	t.Helper()
	db, e := sql.Open("sqlite", filepath.Join(t.TempDir(), "folders.db")+"?_pragma=busy_timeout(5000)")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { db.Close() })
	_, e = db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at INTEGER DEFAULT 1,updated_at INTEGER DEFAULT 1,is_folder INTEGER DEFAULT 0,parent_id TEXT DEFAULT '',sort_order INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0);
 CREATE TABLE file_tags(file_id TEXT,tag_id TEXT);CREATE TABLE file_versions(file_id TEXT,content TEXT);CREATE TABLE save_receipts(id TEXT,result TEXT);
 INSERT INTO files(id,title,content,is_folder) VALUES('a','来源','',1),('b','目标','',1),('empty','空目录','',1);
 INSERT INTO files(id,title,content,parent_id,is_pinned) VALUES('n1','笔记一','BODY-ONE','a',1),('n2','笔记二','BODY-TWO','a',0);
 INSERT INTO file_tags VALUES('n1','tag');INSERT INTO file_versions VALUES('n1','history');INSERT INTO save_receipts VALUES('receipt','unchanged');
 CREATE TRIGGER forbid_folder_content_write BEFORE UPDATE OF content ON files BEGIN SELECT RAISE(ABORT,'content write forbidden');END;`)
	if e != nil {
		t.Fatal(e)
	}
	return &FileDAO{DB: db}
}
func folderCommand(t *testing.T, d *FileDAO, kind string, ids ...string) FolderWorkspaceChange {
	t.Helper()
	s, e := d.FolderWorkspace(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return FolderWorkspaceChange{RequestID: uuid.NewString(), ExpectedRevision: s.Revision, Kind: kind, IDs: ids}
}
func folderRead(t *testing.T, d *FileDAO) *FolderWorkspaceSnapshot {
	t.Helper()
	s, e := d.FolderWorkspace(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestFolderWorkspaceReadNoBodiesAndStable(t *testing.T) {
	d := folderDB(t)
	s := folderRead(t, d)
	again := folderRead(t, d)
	if s.Revision != again.Revision || !s.Complete || s.Version != 1 || len(s.Items) != 5 {
		t.Fatal(s, again)
	}
	raw, _ := json.Marshal(s)
	if strings.Contains(string(raw), "BODY-") || strings.Contains(string(raw), "content") {
		t.Fatal("body was read into result")
	}
	d.DB.Exec(`INSERT INTO files(id,title,content,parent_id,is_deleted) VALUES('trash','旧笔记','trash-secret','a',1);INSERT INTO files(id,title,content,parent_id) VALUES('template','__tpl__模板','template-secret','a')`)
	next := folderRead(t, d)
	if next.HiddenCount != 2 || len(next.Items) != 5 || next.Revision == s.Revision {
		t.Fatal(next)
	}
	for _, n := range next.Items {
		if n.ID == "a" && n.HiddenChildren != 2 {
			t.Fatal(n)
		}
	}
	d.DB.Exec(`UPDATE files SET is_pinned=0 WHERE id='n1'`)
	if folderRead(t, d).Revision != next.Revision {
		t.Fatal("pin-only changes must not change structure identity")
	}
}
func TestFolderWorkspaceCompleteCreateRenameMoveTrash(t *testing.T) {
	d := folderDB(t)
	ctx := context.Background()
	newID := uuid.NewString()
	c := folderCommand(t, d, "create", newID)
	c.Name = "新资料"
	c.ParentID = "b"
	r, e := d.ChangeFolderWorkspace(ctx, c)
	if e != nil || r.RequestID != c.RequestID || r.Kind != c.Kind || len(r.Snapshot.Items) != 6 {
		t.Fatal(r, e)
	}
	c = folderCommand(t, d, "rename", newID)
	c.Name = "整理结果"
	if _, e = d.ChangeFolderWorkspace(ctx, c); e != nil {
		t.Fatal(e)
	}
	c = folderCommand(t, d, "move", "n1", "n2")
	c.ParentID = newID
	if _, e = d.ChangeFolderWorkspace(ctx, c); e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{"n1", "n2"} {
		var p, b string
		if e = d.DB.QueryRow(`SELECT parent_id,content FROM files WHERE id=?`, id).Scan(&p, &b); e != nil || p != newID || !strings.HasPrefix(b, "BODY-") {
			t.Fatal(p, b, e)
		}
	}
	// The now-empty source is soft-deleted, never permanently removed.
	c = folderCommand(t, d, "trash-empty", "a")
	if _, e = d.ChangeFolderWorkspace(ctx, c); e != nil {
		t.Fatal(e)
	}
	var deleted, pinned int
	var body, tag, version, receipt string
	d.DB.QueryRow(`SELECT is_deleted,content FROM files WHERE id='a'`).Scan(&deleted, &body)
	if deleted != 1 || body != "" {
		t.Fatal(deleted, body)
	}
	d.DB.QueryRow(`SELECT is_pinned FROM files WHERE id='n1'`).Scan(&pinned)
	d.DB.QueryRow(`SELECT tag_id FROM file_tags WHERE file_id='n1'`).Scan(&tag)
	d.DB.QueryRow(`SELECT content FROM file_versions WHERE file_id='n1'`).Scan(&version)
	d.DB.QueryRow(`SELECT result FROM save_receipts WHERE id='receipt'`).Scan(&receipt)
	if pinned != 1 || tag != "tag" || version != "history" || receipt != "unchanged" {
		t.Fatal(pinned, tag, version, receipt)
	}
	// Parent moves carry descendants by stable parent IDs; no body rewrite needed.
	c = folderCommand(t, d, "move", newID)
	c.ParentID = ""
	if _, e = d.ChangeFolderWorkspace(ctx, c); e != nil {
		t.Fatal(e)
	}
	var p string
	d.DB.QueryRow(`SELECT parent_id FROM files WHERE id='n1'`).Scan(&p)
	if p != newID {
		t.Fatal(p)
	}
}
func TestFolderWorkspaceRefusesInvalidPlansWithoutAnyMutation(t *testing.T) {
	tests := map[string]func(*FileDAO, *FolderWorkspaceChange){
		"stale":                   func(d *FileDAO, c *FolderWorkspaceChange) { c.ExpectedRevision = strings.Repeat("0", 64) },
		"target-is-note":          func(d *FileDAO, c *FolderWorkspaceChange) { c.ParentID = "n1" },
		"target-missing":          func(d *FileDAO, c *FolderWorkspaceChange) { c.ParentID = "absent" },
		"duplicate-source":        func(d *FileDAO, c *FolderWorkspaceChange) { c.IDs = []string{"n1", "n1"} },
		"ancestor-and-descendant": func(d *FileDAO, c *FolderWorkspaceChange) { c.IDs = []string{"a", "n1"} },
		"cycle": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`INSERT INTO files(id,title,is_folder,parent_id) VALUES('sub','sub',1,'a')`)
			c.ExpectedRevision = folderRead(t, d).Revision
			c.IDs = []string{"a"}
			c.ParentID = "sub"
		},
		"same-location": func(d *FileDAO, c *FolderWorkspaceChange) { c.ParentID = "a" },
		"destination-case-collision": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`INSERT INTO files(id,title,parent_id) VALUES('other','笔记一','b')`)
			c.ExpectedRevision = folderRead(t, d).Revision
		},
		"selected-case-collision": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`UPDATE files SET title='ABC' WHERE id='n1';UPDATE files SET title='abc' WHERE id='n2'`)
			c.ExpectedRevision = folderRead(t, d).Revision
			c.IDs = []string{"n1", "n2"}
		},
		"hidden-source": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='n1'`)
			c.ExpectedRevision = folderRead(t, d).Revision
		},
		"invalid-name": func(d *FileDAO, c *FolderWorkspaceChange) {
			c.Kind = "rename"
			c.IDs = []string{"a"}
			c.Name = "a/b"
			c.ParentID = ""
		},
		"template-name": func(d *FileDAO, c *FolderWorkspaceChange) {
			c.Kind = "rename"
			c.IDs = []string{"a"}
			c.Name = "__tpl__secret"
			c.ParentID = ""
		},
		"rename-note":     func(d *FileDAO, c *FolderWorkspaceChange) { c.Kind = "rename"; c.Name = "not allowed"; c.ParentID = "" },
		"invalid-request": func(d *FileDAO, c *FolderWorkspaceChange) { c.RequestID = "bad" },
		"nonempty-trash": func(d *FileDAO, c *FolderWorkspaceChange) {
			c.Kind = "trash-empty"
			c.IDs = []string{"a"}
			c.ParentID = ""
		},
		"hidden-child-trash": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`INSERT INTO files(id,title,parent_id,is_deleted) VALUES('trash','hidden','empty',1)`)
			c.ExpectedRevision = folderRead(t, d).Revision
			c.Kind = "trash-empty"
			c.IDs = []string{"empty"}
			c.ParentID = ""
		},
		"sort-overflow": func(d *FileDAO, c *FolderWorkspaceChange) {
			d.DB.Exec(`INSERT INTO files(id,title,parent_id,sort_order) VALUES('max','max','b',9007199254740000)`)
			c.ExpectedRevision = folderRead(t, d).Revision
		},
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			d := folderDB(t)
			c := folderCommand(t, d, "move", "n1")
			c.ParentID = "b"
			change(d, &c)
			before := folderRead(t, d).Revision
			if _, e := d.ChangeFolderWorkspace(context.Background(), c); e == nil {
				t.Fatal("accepted invalid operation")
			}
			if folderRead(t, d).Revision != before {
				t.Fatal("partial mutation")
			}
		})
	}
}
func TestFolderWorkspaceBatchRollsBackAndConcurrentSnapshotHasOneWinner(t *testing.T) {
	d := folderDB(t)
	c := folderCommand(t, d, "move", "n1", "n2")
	c.ParentID = "b"
	before := folderRead(t, d).Revision
	d.DB.Exec(`CREATE TRIGGER refuse_second BEFORE UPDATE OF parent_id ON files WHEN OLD.id='n2' BEGIN SELECT RAISE(ABORT,'second row refused');END;`)
	if _, e := d.ChangeFolderWorkspace(context.Background(), c); e == nil {
		t.Fatal("accepted partial batch")
	}
	if folderRead(t, d).Revision != before {
		t.Fatal("first row not rolled back")
	}
	d.DB.Exec(`DROP TRIGGER refuse_second`)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"one", "two"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			cmd := FolderWorkspaceChange{RequestID: uuid.NewString(), ExpectedRevision: before, Kind: "create", IDs: []string{uuid.NewString()}, Name: name}
			_, err := d.ChangeFolderWorkspace(context.Background(), cmd)
			results <- err
		}(name)
	}
	wg.Wait()
	close(results)
	wins := 0
	for e := range results {
		if e == nil {
			wins++
		}
	}
	if wins != 1 || len(folderRead(t, d).Items) != 6 {
		t.Fatal(wins)
	}
}
func TestFolderWorkspaceRejectsBrokenForestAndLimits(t *testing.T) {
	for _, query := range []string{`UPDATE files SET parent_id='n1' WHERE id='a'`, `UPDATE files SET parent_id='missing' WHERE id='n1'`, `UPDATE files SET parent_id='b' WHERE id='a';UPDATE files SET parent_id='a' WHERE id='b'`, `UPDATE files SET is_deleted=1 WHERE id='a'`, `UPDATE files SET sort_order=-9007199254740001 WHERE id='a'`, `UPDATE files SET title=printf('%04001d',0) WHERE id='n1'`} {
		t.Run(query, func(t *testing.T) {
			d := folderDB(t)
			if _, e := d.DB.Exec(query); e != nil {
				t.Fatal(e)
			}
			if _, e := d.FolderWorkspace(context.Background()); e == nil {
				t.Fatal("invalid forest accepted")
			}
		})
	}
	d := folderDB(t)
	_, e := d.DB.Exec(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO files(id,title) SELECT 'bulk-'||x,'item'||x FROM n`)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = d.FolderWorkspace(context.Background()); e == nil {
		t.Fatal("partial limit result accepted")
	}
}
func TestFolderWorkspaceCancellationAndNewFolderIdNotReplayed(t *testing.T) {
	d := folderDB(t)
	c := folderCommand(t, d, "create", uuid.NewString())
	c.Name = "文件夹"
	before := folderRead(t, d).Revision
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := d.ChangeFolderWorkspace(ctx, c); e == nil {
		t.Fatal("cancelled request committed")
	}
	if folderRead(t, d).Revision != before {
		t.Fatal("cancelled mutation")
	}
	if _, e := d.ChangeFolderWorkspace(context.Background(), c); e != nil {
		t.Fatal(e)
	}
	after := folderRead(t, d).Revision
	if _, e := d.ChangeFolderWorkspace(context.Background(), c); e == nil {
		t.Fatal("same intent replayed")
	}
	c.ExpectedRevision = after
	if _, e := d.ChangeFolderWorkspace(context.Background(), c); e == nil {
		t.Fatal("existing generated identity overwritten")
	}
}

func TestFolderWorkspaceRetainsOriginalNegativeDragOrder(t *testing.T) {
	d := folderDB(t)
	_, err := d.DB.Exec(`UPDATE files SET sort_order=-1000 WHERE id='a'`)
	if err != nil {
		t.Fatal(err)
	}
	s, err := d.FolderWorkspace(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range s.Items {
		if r.ID == "a" {
			found = true
			if r.SortOrder != -1000 {
				t.Fatal("legitimate order was normalized")
			}
		}
	}
	if !found {
		t.Fatal("original folder missing")
	}
}
