package dao

import (
	"context"
	"encoding/json"
	"errors"
	"notepad-server/internal/model"
	notesearch "notepad-server/internal/search"
	"testing"
)

func TestGlobalSearchReadsFormattedTextNotJSONMetadata(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "first", `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"关"},{"type":"text","text":"关","format":1}]}]}}`)
	seedSearchFile(t, d, "b", "second", `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"other"}]}]}}`)
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "关关"})
	if err != nil || r.Total != 1 || r.Items[0].ID != "a" {
		t.Fatal(r, err)
	}
	r, err = d.GlobalSearch(context.Background(), notesearch.Options{Query: "paragraph"})
	if err != nil || r.Total != 0 {
		t.Fatal(r, err)
	}
}
func TestGlobalSearchRevisionRechecksSameSecondBodyEdits(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "match", "old")
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "match"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.DB.Exec(`UPDATE files SET content='new' WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	_, err = d.GlobalSearch(context.Background(), notesearch.Options{Query: "match", Revision: r.Revision})
	if !errors.Is(err, notesearch.ErrChanged) {
		t.Fatal(err)
	}
}
func TestGlobalSearchDoesNotModifyDatabaseOrReturnFullContent(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "match", "secret-prefix-body-content")
	before, _ := d.GetByID(context.Background(), "a")
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "match"})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := d.GetByID(context.Background(), "a")
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("search modified file")
	}
	if len(r.Items) != 1 || r.Items[0].ContentHash == "" {
		t.Fatal(r)
	}
}
func TestGlobalSearchFiltersDirectoriesAndTemplates(t *testing.T) {
	d := newSearchTestDAO(t)
	for _, f := range []model.File{{ID: "p", Title: "project", IsFolder: true}, {ID: "v", Title: "volume", IsFolder: true, ParentID: "p"}, {ID: "a", Title: "match", ParentID: "v"}, {ID: "b", Title: "match"}, {ID: "c", Title: "__tpl__match"}} {
		if err := d.Create(context.Background(), &f); err != nil {
			t.Fatal(err)
		}
	}
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "match", FolderID: "p"})
	if err != nil || r.Total != 1 || r.Items[0].FolderPath != "project / volume" {
		t.Fatal(r, err)
	}
}
func TestGlobalSearchCanceledRequestIsNotEmptySuccess(t *testing.T) {
	d := newSearchTestDAO(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.GlobalSearch(ctx, notesearch.Options{}); err == nil {
		t.Fatal("cancellation lost")
	}
}
func TestGlobalSearchPagesDoNotStopAtLegacyLimit(t *testing.T) {
	d := newSearchTestDAO(t)
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		seedSearchFile(t, d, id, "match", "body")
	}
	first, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "match", PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	last, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "match", PageSize: 2, Page: 3, Revision: first.Revision})
	if err != nil || last.Total != 5 || len(last.Items) != 1 || last.Items[0].ID != "e" {
		t.Fatal(last, err)
	}
}

func TestGlobalSearchCacheReusesParsingButSeesRawDatabaseChanges(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "A", "needle unique a")
	seedSearchFile(t, d, "b", "B", "needle unique b")
	first, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || first.Parsed != 2 {
		t.Fatal(first, err)
	}
	next, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || next.CacheHits != 2 || next.Parsed != 0 {
		t.Fatal(next, err)
	}
	if _, err = d.DB.Exec(`UPDATE files SET content='absent unique a' WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	fresh, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || fresh.Total != 1 || fresh.Parsed != 1 || fresh.CacheHits != 1 {
		t.Fatal(fresh, err)
	}
	if _, err = d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle", Revision: next.Revision}); !errors.Is(err, notesearch.ErrChanged) {
		t.Fatal(err)
	}
}
func TestGlobalSearchCacheCannotResurrectDeletedOrMovedNotes(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "A", "needle")
	d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if _, err := d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || r.Total != 0 || r.CacheHits != 0 {
		t.Fatal(r, err)
	}
	if _, err := d.DB.Exec(`UPDATE files SET is_deleted=0,parent_id='missing' WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	r, err = d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || r.Total != 0 {
		t.Fatal(r, err)
	}
}
func TestGlobalSearchMetadataOnlyChangeStillInvalidatesCachedPagination(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "A", "needle")
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.DB.Exec(`UPDATE files SET title='Renamed' WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	_, err = d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle", Revision: r.Revision})
	if !errors.Is(err, notesearch.ErrChanged) {
		t.Fatal(err)
	}
	fresh, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle"})
	if err != nil || fresh.Items[0].Title != "Renamed" || fresh.CacheHits != 1 {
		t.Fatal(fresh, err)
	}
}

func TestSearchAnchorRepositionsAfterSavedRename(t *testing.T) {
	d := newSearchTestDAO(t)
	for _, id := range []string{"a", "b", "c"} {
		seedSearchFile(t, d, id, id, "needle")
	}
	before, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle", Sort: "title", PageSize: 1, AnchorID: "b"})
	if err != nil || before.Page != 2 || !before.AnchorFound {
		t.Fatal(before, err)
	}
	if _, err = d.DB.Exec(`UPDATE files SET title='zzz' WHERE id='b'`); err != nil {
		t.Fatal(err)
	}
	after, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle", Sort: "title", PageSize: 1, Page: 2, AnchorID: "b"})
	if err != nil || after.Page != 3 || !after.AnchorFound || after.Items[0].ID != "b" {
		t.Fatal(after, err)
	}
}
func TestSearchAnchorDoesNotReintroduceDeletedOrNonmatchingNotes(t *testing.T) {
	d := newSearchTestDAO(t)
	seedSearchFile(t, d, "a", "a", "needle")
	seedSearchFile(t, d, "b", "b", "needle")
	if _, err := d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='b'`); err != nil {
		t.Fatal(err)
	}
	r, err := d.GlobalSearch(context.Background(), notesearch.Options{Query: "needle", AnchorID: "b"})
	if err != nil || r.AnchorFound || r.Total != 1 || r.Items[0].ID != "a" {
		t.Fatal(r, err)
	}
}
