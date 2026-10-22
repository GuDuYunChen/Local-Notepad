package syncengine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func addHistoryFixture(t *testing.T, e *Engine, id, item, status, resolution string, at int64) {
	t.Helper()
	_, err := e.DB.Exec(`INSERT INTO sync_conflicts(id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution,resolved_at)
        VALUES(?,?,'PRIVATE_HASH','PRIVATE_HASH','PRIVATE_HASH','PRIVATE_BODY','PRIVATE_BODY',10,?,?,?)`, id, item, status, resolution, at)
	if err != nil {
		t.Fatal(err)
	}
}
func TestConflictHistoryPagesAndTies(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	for i := 0; i < 63; i++ {
		addHistoryFixture(t, e, fmt.Sprintf("%032x", i), "note", "resolved", "local", 200)
	}
	addHistoryFixture(t, e, "open-one", "note", "open", "", 0)
	ids := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		page, err := e.ConflictHistory(context.Background(), "all", cursor, 25)
		if err != nil {
			t.Fatal(err)
		}
		if page.Version != 1 || page.Scope != "local-workspace" || page.Filter != "all" || len(page.Items) > 25 {
			t.Fatalf("invalid page %+v", page)
		}
		for _, row := range page.Items {
			if ids[row.ID] {
				t.Fatal("duplicate across pages")
			}
			ids[row.ID] = true
		}
		pages++
		if !page.HasMore {
			if page.NextCursor != "" {
				t.Fatal("unexpected cursor")
			}
			break
		}
		if page.NextCursor == cursor {
			t.Fatal("cursor did not advance")
		}
		cursor = page.NextCursor
	}
	if len(ids) != 63 || pages != 3 || ids["open-one"] {
		t.Fatalf("bad pagination %d/%d", len(ids), pages)
	}
}
func TestConflictHistoryReadOnlyProjection(t *testing.T) {
	db, root := testDB(t)
	db.SetMaxOpenConns(1)
	e := testEngine(db, root, "device-history")
	addFile(t, db, "note", "Current note title", "PRIVATE_BODY", 10)
	addHistoryFixture(t, e, "a", "note", "resolved", "remote", 300)
	addHistoryFixture(t, e, "b", "attachment:313233", "superseded", "remote-rebind", 200)
	addHistoryFixture(t, e, "c", "tag:one", "resolved", "PRIVATE_RESOLUTION", 100)
	if _, err := db.Exec(`PRAGMA query_only=ON`); err != nil {
		t.Fatal(err)
	}
	page, err := e.ConflictHistory(context.Background(), "all", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || page.Items[0].CurrentTitle != "Current note title" || page.Items[1].Kind != "attachment" || page.Items[2].Resolution != "unknown" {
		t.Fatalf("bad projection %+v", page)
	}
	bytes, _ := json.Marshal(page)
	if strings.Contains(string(bytes), "PRIVATE_") || strings.Contains(string(bytes), "local_record") || strings.Contains(string(bytes), "remote_store_id") {
		t.Fatal("private fields escaped")
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM sync_conflicts`).Scan(&count)
	if count != 3 {
		t.Fatal("records changed")
	}
}
func TestConflictHistoryFiltersAndRebind(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	addHistoryFixture(t, e, "a", "note", "resolved", "local", 100)
	addHistoryFixture(t, e, "b", "note", "open", "", 0)
	if _, err := e.Rebind(context.Background()); err != nil {
		t.Fatal(err)
	}
	chosen, err := e.ConflictHistory(context.Background(), "resolved", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	stale, err := e.ConflictHistory(context.Background(), "superseded", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if len(chosen.Items) != 1 || chosen.Items[0].ID != "a" || len(stale.Items) != 1 || stale.Items[0].Resolution != "remote-rebind" {
		t.Fatal("lost prior-target history")
	}
}
func TestConflictHistoryInvalidQueries(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	for _, filter := range []string{"", "open", "all' OR 1=1--", "constructor"} {
		if _, err := e.ConflictHistory(context.Background(), filter, "", 25); err == nil {
			t.Fatal("accepted filter", filter)
		}
	}
	for _, limit := range []int{-1, 0, 51, 1000000} {
		if _, err := e.ConflictHistory(context.Background(), "all", "", limit); err == nil {
			t.Fatal("accepted limit")
		}
	}
	bad := []string{"broken cursor", strings.Repeat("a", 1025), base64.RawURLEncoding.EncodeToString([]byte(`{"v":2,"f":"all","at":1,"id":"x"}`)),
		base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"f":"resolved","at":1,"id":"x"}`)),
		base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"f":"all","at":-1,"id":"x"}`)),
		base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"f":"all","at":1,"id":"x","extra":1}`)),
		base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"f":"all","at":1,"id":"x"}{}`))}
	for _, cursor := range bad {
		if _, err := e.ConflictHistory(context.Background(), "all", cursor, 25); err == nil {
			t.Fatal("accepted cursor")
		}
	}
	// SQL metacharacters are bound values, never query syntax.
	cursor := nextHistoryCursor(ConflictHistoryItem{ID: "' OR 1=1--", ResolvedAt: 100}, "all")
	page, err := e.ConflictHistory(context.Background(), "all", cursor, 25)
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("unbound cursor: %v", err)
	}
}
func TestConflictHistoryCancelledMissingAndCorrupt(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	page, err := e.ConflictHistory(context.Background(), "all", "", 25)
	if err != nil || page.Items == nil || len(page.Items) != 0 {
		t.Fatal("empty list must be explicit")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = e.ConflictHistory(ctx, "all", "", 25); err == nil {
		t.Fatal("ignored cancellation")
	}
	addHistoryFixture(t, e, "x", "note", "resolved", "local", 200)
	db.Exec(`UPDATE sync_conflicts SET resolved_at='PRIVATE_INVALID_TIME' WHERE id='x'`)
	page, err = e.ConflictHistory(context.Background(), "all", "", 25)
	if err == nil || page.Items != nil {
		t.Fatal("corrupt data masqueraded as a partial result")
	}
	var absent *Engine
	if _, err = absent.ConflictHistory(context.Background(), "all", "", 25); err == nil {
		t.Fatal("nil database succeeded")
	}
}
func TestConflictHistoryNewRowsDoNotShiftOlderPage(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	addHistoryFixture(t, e, "a", "note", "resolved", "local", 300)
	addHistoryFixture(t, e, "b", "note", "resolved", "remote", 200)
	first, err := e.ConflictHistory(context.Background(), "all", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	addHistoryFixture(t, e, "new", "note", "resolved", "local", 400)
	next, err := e.ConflictHistory(context.Background(), "all", first.NextCursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Items) != 1 || next.Items[0].ID != "b" {
		t.Fatal("new record shifted keyset")
	}
	refreshed, _ := e.ConflictHistory(context.Background(), "all", "", 1)
	if refreshed.Items[0].ID != "new" {
		t.Fatal("refresh missed new row")
	}
}

func TestConflictHistoryUnicodeCurrentTitleBound(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-history")
	addFile(t, db, "emoji-note", strings.Repeat("📘", 260), "PRIVATE_BODY", 10)
	addHistoryFixture(t, e, "unicode-history", "emoji-note", "resolved", "local", 300)
	page, err := e.ConflictHistory(context.Background(), "all", "", 25)
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].CurrentTitle != strings.Repeat("📘", 255) {
		t.Fatal("title was byte-truncated or not bounded")
	}
}
