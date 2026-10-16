package dao

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func pb(v bool) *bool { return &v }
func pinDB(t *testing.T) *FileDAO {
	d := templateDB(t)
	templateSeed(t, d, "a", "甲.md", "A-original")
	templateSeed(t, d, "b", "乙.md", "B-original")
	return d
}
func pc(title string, from, to bool) LocalPinChange {
	return LocalPinChange{Title: title, IsFolder: pb(false), Expected: pb(from), Pinned: pb(to)}
}
func TestLocalPinsReadOrdinaryOnlyAndNeverReadBodies(t *testing.T) {
	d := pinDB(t)
	ctx := context.Background()
	templateSeed(t, d, "folder", "目录", "folder-private")
	templateSeed(t, d, "deleted", "已删除", "deleted-private")
	templateSeed(t, d, "template", "__tpl__模板", "template-private")
	d.DB.Exec(`UPDATE files SET is_folder=1 WHERE id='folder'`)
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='deleted'`)
	d.DB.Exec(`UPDATE files SET is_pinned=1 WHERE id='a'`)
	out, e := d.LocalPins(ctx)
	if e != nil || !out.Complete || len(out.Items) != 2 {
		t.Fatal(out, e)
	}
	data, _ := json.Marshal(out)
	for _, secret := range []string{"A-original", "B-original", "private", "__tpl__", "content"} {
		if strings.Contains(string(data), secret) {
			t.Fatal("body or hidden object returned", string(data))
		}
	}
	if out.Items[0].ID != "a" || !out.Items[0].IsPinned {
		t.Fatal(out)
	}
}
func TestLocalPinsEmptyIsCompleteNonNull(t *testing.T) {
	d := templateDB(t)
	out, e := d.LocalPins(context.Background())
	if e != nil || !out.Complete || out.Items == nil || len(out.Items) != 0 {
		t.Fatal(out, e)
	}
}
func TestLocalPinChangesOnlyOneColumnAndOneTarget(t *testing.T) {
	d := pinDB(t)
	ctx := context.Background()
	before, _ := d.GetByID(ctx, "a")
	other, _ := d.GetByID(ctx, "b")
	_, e := d.DB.Exec(`CREATE TRIGGER no_body_updates BEFORE UPDATE OF title,content,parent_id,sort_order,updated_at,is_deleted ON files BEGIN SELECT RAISE(ABORT,'non-pin write'); END`)
	if e != nil {
		t.Fatal(e)
	}
	got, e := d.ChangeLocalPin(ctx, "a", pc("甲.md", false, true))
	if e != nil || !got.IsPinned {
		t.Fatal(got, e)
	}
	after, _ := d.GetByID(ctx, "a")
	before.IsPinned = true
	if *after != *before {
		t.Fatal("modified another column", after, before)
	}
	still, _ := d.GetByID(ctx, "b")
	if *still != *other {
		t.Fatal("other file changed")
	}
	if _, e = d.ChangeLocalPin(ctx, "a", pc("甲.md", true, false)); e != nil {
		t.Fatal(e)
	}
}
func TestLocalPinRefusesStaleTitleTypeOrState(t *testing.T) {
	for label, change := range map[string]LocalPinChange{"name": pc("改名", false, true), "state": pc("甲.md", true, false), "missing": {Title: "甲.md", IsFolder: pb(false), Pinned: pb(true)}, "same": pc("甲.md", false, false), "type": {Title: "甲.md", IsFolder: pb(true), Expected: pb(false), Pinned: pb(true)}} {
		t.Run(label, func(t *testing.T) {
			d := pinDB(t)
			if _, e := d.ChangeLocalPin(context.Background(), "a", change); e == nil {
				t.Fatal("accepted stale request")
			}
			n, _ := d.GetByID(context.Background(), "a")
			if n.IsPinned {
				t.Fatal("changed pin")
			}
		})
	}
}
func TestLocalPinDeletedTemplateAndMissingRefused(t *testing.T) {
	d := pinDB(t)
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='a'`)
	d.DB.Exec(`UPDATE files SET title='__tpl__模板' WHERE id='b'`)
	for _, id := range []string{"a", "b", "missing", "", "a\x00"} {
		if _, e := d.LocalPin(context.Background(), id); e == nil {
			t.Fatal(id)
		}
		if _, e := d.ChangeLocalPin(context.Background(), id, pc("甲.md", false, true)); e == nil {
			t.Fatal(id)
		}
	}
}
func TestLocalPinSupportsFolderMenuButNotWorkspaceRows(t *testing.T) {
	d := pinDB(t)
	d.DB.Exec(`UPDATE files SET is_folder=1 WHERE id='a'`)
	request := pc("甲.md", false, true)
	request.IsFolder = pb(true)
	n, e := d.ChangeLocalPin(context.Background(), "a", request)
	if e != nil || !n.IsPinned || !n.IsFolder {
		t.Fatal(n, e)
	}
	out, e := d.LocalPins(context.Background())
	if e != nil || len(out.Items) != 1 || out.Items[0].ID != "b" {
		t.Fatal(out, e)
	}
}
func TestLocalPinRollsBackTriggerFailure(t *testing.T) {
	d := pinDB(t)
	d.DB.Exec(`CREATE TRIGGER refuse_pin BEFORE UPDATE OF is_pinned ON files BEGIN SELECT RAISE(ABORT,'refused'); END`)
	if _, e := d.ChangeLocalPin(context.Background(), "a", pc("甲.md", false, true)); e == nil {
		t.Fatal("expected error")
	}
	n, _ := d.GetByID(context.Background(), "a")
	if n.IsPinned {
		t.Fatal("unexpected pin")
	}
}
func TestLocalPinConcurrentCompareStateHasOneWinner(t *testing.T) {
	d := pinDB(t)
	var wg sync.WaitGroup
	ch := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := d.ChangeLocalPin(context.Background(), "a", pc("甲.md", false, true))
			ch <- e
		}()
	}
	wg.Wait()
	close(ch)
	wins := 0
	for e := range ch {
		if e == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("expected one committed decision", wins)
	}
}
func TestLocalPinLimitNeverReturnsPartialSuccess(t *testing.T) {
	d := templateDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i <= LocalPinLimit; i++ {
		tx.Exec(`INSERT INTO files(id,title) VALUES(?,?)`, fmt.Sprint(i), "title")
	}
	tx.Commit()
	if out, e := d.LocalPins(context.Background()); e == nil || out != nil {
		t.Fatal("partial read accepted", out, e)
	}
}
func TestLocalPinInvalidMetadataRefused(t *testing.T) {
	for name, sql := range map[string]string{"negative time": `UPDATE files SET updated_at=-1 WHERE id='a'`, "long name": `UPDATE files SET title=replace(hex(zeroblob(9000)),'0','a') WHERE id='a'`} {
		t.Run(name, func(t *testing.T) {
			d := pinDB(t)
			d.DB.Exec(sql)
			if out, e := d.LocalPins(context.Background()); e == nil || out != nil {
				t.Fatal(out, e)
			}
		})
	}
}
func TestLocalPinMetadataBudget(t *testing.T) {
	d := templateDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i < 200; i++ {
		tx.Exec(`INSERT INTO files(id,title) VALUES(?,?)`, fmt.Sprint(i), strings.Repeat("字", 5000))
	}
	tx.Commit()
	if out, e := d.LocalPins(context.Background()); e == nil || out != nil {
		t.Fatal("oversized snapshot", e)
	}
}
func TestLocalPinCancelledWriteAndReadRefused(t *testing.T) {
	d := pinDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := d.ChangeLocalPin(ctx, "a", pc("甲.md", false, true)); e == nil {
		t.Fatal("ignored cancel")
	}
	if _, e := d.LocalPins(ctx); e == nil {
		t.Fatal("ignored cancel")
	}
	n, _ := d.GetByID(context.Background(), "a")
	if n.IsPinned {
		t.Fatal("write after cancel")
	}
}
func TestLocalPinLegacyReadbackPreservesLatestBody(t *testing.T) {
	d := pinDB(t)
	d.DB.Exec(`UPDATE files SET content='latest',updated_at=123 WHERE id='a'`)
	f, e := d.SetLegacyPin(context.Background(), "a", true)
	if e != nil || !f.IsPinned || f.Content != "latest" || f.UpdatedAt != 123 {
		t.Fatal(f, e)
	}
}
