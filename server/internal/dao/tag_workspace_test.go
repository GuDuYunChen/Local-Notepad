package dao

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"sync"
	"testing"
)

func workspaceCommand(t *testing.T, d *TagDAO, kind, id string) TagWorkspaceChange {
	t.Helper()
	s, e := d.TagWorkspace(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	return TagWorkspaceChange{RequestID: uuid.NewString(), ExpectedRevision: s.Revision, Kind: kind, ID: id}
}
func addWorkspaceTag(t *testing.T, d *TagDAO, id, name string, files ...string) {
	t.Helper()
	if _, e := d.DB.Exec(`INSERT INTO tags(id,name,color) VALUES(?,?,'#176b4a')`, id, name); e != nil {
		t.Fatal(e)
	}
	for _, f := range files {
		if _, e := d.DB.Exec(`INSERT INTO file_tags(file_id,tag_id) VALUES(?,?)`, f, id); e != nil {
			t.Fatal(e)
		}
	}
}
func TestTagWorkspaceCompleteEmptyAndStableRevision(t *testing.T) {
	d := noteTagsDB(t)
	s, e := d.TagWorkspace(context.Background())
	if e != nil || !s.Complete || s.Version != 1 || s.Tags == nil || !tagWorkspaceRevision.MatchString(s.Revision) {
		t.Fatal(s, e)
	}
	again, e := d.TagWorkspace(context.Background())
	if e != nil || again.Revision != s.Revision {
		t.Fatal(again, e)
	}
}
func TestTagWorkspaceCountsHiddenWithoutBodies(t *testing.T) {
	d := noteTagsDB(t)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder) VALUES('folder','folder','secret',1,1,1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES('template',?,'secret',1,1)`, TemplatePrefix+"模板")
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='note-b'`)
	addWorkspaceTag(t, d, "a", "标签", "note-a", "note-b", "folder", "template")
	s, e := d.TagWorkspace(context.Background())
	if e != nil || len(s.Tags) != 1 || s.Tags[0].ActiveCount != 1 || s.Tags[0].HiddenCount != 3 || s.Tags[0].TotalCount != 4 {
		t.Fatal(s, e)
	}
	raw, _ := json.Marshal(s)
	if strings.Contains(string(raw), "secret") {
		t.Fatal("body disclosed")
	}
	p, e := d.TagWorkspaceNotes(context.Background(), "a", s.Revision, 0)
	if e != nil || p.Total != 1 || p.HasMore || p.Notes[0].ID != "note-a" {
		t.Fatal(p, e)
	}
}
func TestTagWorkspaceCreateRenameMergeDeletePreservesNotes(t *testing.T) {
	d := noteTagsDB(t)
	ctx := context.Background()
	id := uuid.NewString()
	beforeRows, _ := d.DB.Query(`SELECT id,title,content,created_at,updated_at FROM files ORDER BY id`)
	var before []string
	for beforeRows.Next() {
		var id, title, body string
		var created, updated int64
		beforeRows.Scan(&id, &title, &body, &created, &updated)
		before = append(before, fmt.Sprint(id, title, body, created, updated))
	}
	beforeRows.Close()
	c := workspaceCommand(t, d, "create", id)
	c.Name = "资料"
	c.Color = "#176b4a"
	r, e := d.ChangeTagWorkspace(ctx, c)
	if e != nil || r.RequestID != c.RequestID || r.Kind != "create" || r.BeforeRevision != c.ExpectedRevision || len(r.Snapshot.Tags) != 1 {
		t.Fatal(r, e)
	}
	d.DB.Exec(`INSERT INTO file_tags VALUES('note-a',?)`, id)
	c = workspaceCommand(t, d, "rename", id)
	c.Name = "写作"
	c.Color = "#123456"
	r, e = d.ChangeTagWorkspace(ctx, c)
	if e != nil || r.Snapshot.Tags[0].Name != "写作" || r.Snapshot.Tags[0].ActiveCount != 1 {
		t.Fatal(r, e)
	}
	addWorkspaceTag(t, d, "target", "目标", "note-a", "note-b")
	c = workspaceCommand(t, d, "merge", id)
	c.TargetID = "target"
	r, e = d.ChangeTagWorkspace(ctx, c)
	if e != nil || len(r.Snapshot.Tags) != 1 || r.Snapshot.Tags[0].TotalCount != 2 || r.Snapshot.Tags[0].ID != "target" {
		t.Fatal(r, e)
	}
	c = workspaceCommand(t, d, "delete", "target")
	r, e = d.ChangeTagWorkspace(ctx, c)
	if e != nil || len(r.Snapshot.Tags) != 0 {
		t.Fatal(r, e)
	}
	rows, _ := d.DB.Query(`SELECT id,title,content,created_at,updated_at FROM files ORDER BY id`)
	defer rows.Close()
	i := 0
	for rows.Next() {
		var id, title, body string
		var created, updated int64
		rows.Scan(&id, &title, &body, &created, &updated)
		if fmt.Sprint(id, title, body, created, updated) != before[i] {
			t.Fatal("note changed")
		}
		i++
	}
	if i != len(before) {
		t.Fatal("note removed")
	}
}
func TestTagWorkspaceStaleConfirmationRefusesAssociationAndNameChanges(t *testing.T) {
	for _, mutation := range []string{`INSERT INTO file_tags VALUES('note-b','a')`, `UPDATE tags SET name='改名' WHERE id='a'`, `UPDATE files SET is_deleted=1 WHERE id='note-a'`, `UPDATE files SET title='新标题' WHERE id='note-a'`} {
		t.Run(mutation, func(t *testing.T) {
			d := noteTagsDB(t)
			addWorkspaceTag(t, d, "a", "原标签", "note-a")
			c := workspaceCommand(t, d, "delete", "a")
			d.DB.Exec(mutation)
			if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
				t.Fatal("overwrote new state")
			}
			var n int
			d.DB.QueryRow(`SELECT count(*) FROM tags WHERE id='a'`).Scan(&n)
			if n != 1 {
				t.Fatal("deleted changed tag")
			}
		})
	}
}
func TestTagWorkspaceContentSaveDoesNotInvalidateTagSnapshot(t *testing.T) {
	d := noteTagsDB(t)
	addWorkspaceTag(t, d, "a", "标签", "note-a")
	c := workspaceCommand(t, d, "rename", "a")
	c.Name = "新标签"
	c.Color = "#123456"
	d.DB.Exec(`UPDATE files SET content='new body',updated_at=9 WHERE id='note-a'`)
	if _, e := d.ChangeTagWorkspace(context.Background(), c); e != nil {
		t.Fatal(e)
	}
	var body string
	var ts int64
	d.DB.QueryRow(`SELECT content,updated_at FROM files WHERE id='note-a'`).Scan(&body, &ts)
	if body != "new body" || ts != 9 {
		t.Fatal("body modified")
	}
}
func TestTagWorkspaceMergeIncludesHiddenAndRollsBackAsOneTransaction(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			d := noteTagsDB(t)
			d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='note-b'`)
			addWorkspaceTag(t, d, "a", "源", "note-a", "note-b")
			addWorkspaceTag(t, d, "b", "目标", "note-a")
			c := workspaceCommand(t, d, "merge", "a")
			c.TargetID = "b"
			if fail {
				d.DB.Exec(`CREATE TRIGGER refuse_source_delete BEFORE DELETE ON tags BEGIN SELECT RAISE(ABORT,'blocked');END`)
			}
			r, e := d.ChangeTagWorkspace(context.Background(), c)
			if fail {
				if e == nil {
					t.Fatal("expected failure")
				}
				s, _ := d.TagWorkspace(context.Background())
				if s.Revision != c.ExpectedRevision {
					t.Fatal("partial merge", s)
				}
			} else if e != nil || len(r.Snapshot.Tags) != 1 || r.Snapshot.Tags[0].HiddenCount != 1 || r.Snapshot.Tags[0].ActiveCount != 1 {
				t.Fatal(r, e)
			}
		})
	}
}
func TestTagWorkspaceRefusesMalformedAndStaleCommands(t *testing.T) {
	d := noteTagsDB(t)
	addWorkspaceTag(t, d, "a", "源", "note-a")
	addWorkspaceTag(t, d, "b", "目标")
	for _, kind := range []string{"rename", "merge", "delete", "create"} {
		for _, change := range []func(*TagWorkspaceChange){func(c *TagWorkspaceChange) { c.RequestID = "bad" }, func(c *TagWorkspaceChange) { c.ExpectedRevision = "" }, func(c *TagWorkspaceChange) { c.ExpectedRevision = strings.Repeat("0", 64) }, func(c *TagWorkspaceChange) { c.ID = "" }} {
			c := workspaceCommand(t, d, kind, "a")
			c.Name = "新"
			c.Color = "#123456"
			if kind == "create" {
				c.ID = uuid.NewString()
			}
			if kind == "merge" || kind == "delete" {
				c.Name = ""
				c.Color = ""
			}
			if kind == "merge" {
				c.TargetID = "b"
			}
			change(&c)
			if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
				t.Fatal("accepted malformed", c)
			}
		}
	}
	for _, name := range []string{"", " leading", "tail ", "x\n", strings.Repeat("中", 41), "目标"} {
		c := workspaceCommand(t, d, "rename", "a")
		c.Name = name
		c.Color = "#123456"
		if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
			t.Fatal("invalid name accepted", name)
		}
	}
	c := workspaceCommand(t, d, "merge", "a")
	c.TargetID = "a"
	if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
		t.Fatal("self merge")
	}
	c.TargetID = "missing"
	if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
		t.Fatal("absent target")
	}
	c = workspaceCommand(t, d, "rename", "a")
	c.Name = "新"
	c.Color = "url(https://invalid)"
	if _, e := d.ChangeTagWorkspace(context.Background(), c); e == nil {
		t.Fatal("unsafe color")
	}
}
func TestTagWorkspacePaginatedViewBoundToOneSnapshot(t *testing.T) {
	d := noteTagsDB(t)
	addWorkspaceTag(t, d, "a", "资料")
	tx, _ := d.DB.Begin()
	for i := 0; i < 111; i++ {
		id := fmt.Sprintf("f%03d", i)
		tx.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES(?,?,'body',1,1)`, id, "笔记"+id)
		tx.Exec(`INSERT INTO file_tags VALUES(?,'a')`, id)
	}
	tx.Commit()
	s, _ := d.TagWorkspace(context.Background())
	seen := make(map[string]bool)
	for _, offset := range []int{0, 50, 100} {
		p, e := d.TagWorkspaceNotes(context.Background(), "a", s.Revision, offset)
		if e != nil || p.Total != 111 || p.HasMore != (offset < 100) || len(p.Notes) > 50 {
			t.Fatal(p, e)
		}
		for _, note := range p.Notes {
			if seen[note.ID] {
				t.Fatal("duplicate")
			}
			seen[note.ID] = true
		}
	}
	if len(seen) != 111 {
		t.Fatal(len(seen))
	}
	for _, offset := range []int{-1, 1, 150} {
		if _, e := d.TagWorkspaceNotes(context.Background(), "a", s.Revision, offset); e == nil {
			t.Fatal("bad offset")
		}
	}
	d.DB.Exec(`DELETE FROM file_tags WHERE file_id='f001'`)
	if _, e := d.TagWorkspaceNotes(context.Background(), "a", s.Revision, 50); e == nil {
		t.Fatal("stale page")
	}
}
func TestTagWorkspaceRefusesIncompleteCatalogAndDanglingLinks(t *testing.T) {
	for _, broken := range []string{`INSERT INTO file_tags VALUES('missing','a')`, `INSERT INTO file_tags VALUES('note-a','missing')`} {
		t.Run(broken, func(t *testing.T) {
			d := noteTagsDB(t)
			addWorkspaceTag(t, d, "a", "标签")
			d.DB.Exec(broken)
			if _, e := d.TagWorkspace(context.Background()); e == nil {
				t.Fatal("incomplete accepted")
			}
		})
	}
	d := noteTagsDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i < 501; i++ {
		tx.Exec(`INSERT INTO tags VALUES(?,?,'')`, fmt.Sprint(i), fmt.Sprint(i))
	}
	tx.Commit()
	if _, e := d.TagWorkspace(context.Background()); e == nil {
		t.Fatal("partial catalog")
	}
}
func TestTagWorkspaceConcurrentConfirmationHasOneWinner(t *testing.T) {
	d := noteTagsDB(t)
	addWorkspaceTag(t, d, "a", "标签", "note-a")
	c := workspaceCommand(t, d, "rename", "a")
	c.Name = "rename"
	c.Color = "#123456"
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := d.ChangeTagWorkspace(context.Background(), c); results <- e }()
	}
	wg.Wait()
	close(results)
	n := 0
	for e := range results {
		if e == nil {
			n++
		}
	}
	if n != 1 {
		t.Fatal("concurrent writes", n)
	}
}
func TestTagWorkspaceCancelledChangeDoesNotWrite(t *testing.T) {
	d := noteTagsDB(t)
	addWorkspaceTag(t, d, "a", "标签", "note-a")
	c := workspaceCommand(t, d, "delete", "a")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := d.ChangeTagWorkspace(ctx, c); e == nil {
		t.Fatal("cancelled commit")
	}
	s, _ := d.TagWorkspace(context.Background())
	if s.Revision != c.ExpectedRevision {
		t.Fatal("changed")
	}
}
