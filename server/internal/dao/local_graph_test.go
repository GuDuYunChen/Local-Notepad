package dao

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func localGraphDB(t *testing.T) *LinkDAO {
	t.Helper()
	f := templateDB(t)
	if _, err := f.DB.Exec(`CREATE TABLE links(id INTEGER PRIMARY KEY,source_id TEXT,target_id TEXT,created_at INTEGER)`); err != nil {
		t.Fatal(err)
	}
	return &LinkDAO{DB: f.DB}
}
func graphSeed(t *testing.T, d *LinkDAO, id, title string) {
	t.Helper()
	if _, err := d.DB.Exec(`INSERT INTO files(id,title,content) VALUES(?,?,'body must remain private')`, id, title); err != nil {
		t.Fatal(err)
	}
}
func graphEdge(t *testing.T, d *LinkDAO, from, to string) {
	t.Helper()
	if _, err := d.DB.Exec(`INSERT INTO links(source_id,target_id) VALUES(?,?)`, from, to); err != nil {
		t.Fatal(err)
	}
}
func TestLocalGraphEmptyCompleteArrays(t *testing.T) {
	d := localGraphDB(t)
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || r.Nodes == nil || r.Edges == nil || !r.Complete || r.Scope != "active-note-index-v1" {
		t.Fatal(r, e)
	}
}
func TestLocalGraphKeepsIsolatedNodesAndDirectedDegree(t *testing.T) {
	d := localGraphDB(t)
	for _, id := range []string{"a", "b", "c"} {
		graphSeed(t, d, id, "中文 "+id)
	}
	graphEdge(t, d, "a", "b")
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || len(r.Nodes) != 3 || len(r.Edges) != 1 {
		t.Fatal(r, e)
	}
	if r.Nodes[0].Outgoing != 1 || r.Nodes[1].Incoming != 1 || r.Nodes[2].Incoming+r.Nodes[2].Outgoing != 0 {
		t.Fatal(r.Nodes)
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), "private") {
		t.Fatal("body exposed")
	}
}
func TestLocalGraphExcludesUnavailableEndpointsNotGhostNodes(t *testing.T) {
	d := localGraphDB(t)
	for _, id := range []string{"a", "deleted", "folder", "template"} {
		graphSeed(t, d, id, id)
	}
	d.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id='deleted'`)
	d.DB.Exec(`UPDATE files SET is_folder=1 WHERE id='folder'`)
	d.DB.Exec(`UPDATE files SET title='__tpl__隐私' WHERE id='template'`)
	for _, id := range []string{"missing", "deleted", "folder", "template"} {
		graphEdge(t, d, "a", id)
		graphEdge(t, d, id, "a")
	}
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || len(r.Nodes) != 1 || len(r.Edges) != 0 || r.Nodes[0].Outgoing != 0 {
		t.Fatal(r, e)
	}
}
func TestLocalGraphDoesNotTreatSQLLikeWildcardsAsTemplatePrefix(t *testing.T) {
	d := localGraphDB(t)
	graphSeed(t, d, "ordinary", "a_tpl_b")
	graphSeed(t, d, "hidden", "__tpl__literal")
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || len(r.Nodes) != 1 || r.Nodes[0].ID != "ordinary" {
		t.Fatal(r, e)
	}
}
func TestLocalGraphDuplicateIndexPairsCollapseAndSelfReferenceCountsOnceEachDirection(t *testing.T) {
	d := localGraphDB(t)
	graphSeed(t, d, "a", "A")
	graphSeed(t, d, "b", "B")
	for i := 0; i < 3; i++ {
		graphEdge(t, d, "a", "b")
	}
	graphEdge(t, d, "b", "a")
	graphEdge(t, d, "a", "a")
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || len(r.Edges) != 3 || r.Nodes[0].Incoming != 2 || r.Nodes[0].Outgoing != 2 {
		t.Fatal(r, e)
	}
}
func TestLocalGraphDeterministicOrdering(t *testing.T) {
	d := localGraphDB(t)
	for _, id := range []string{"c", "a", "b"} {
		graphSeed(t, d, id, "same")
	}
	graphEdge(t, d, "c", "b")
	graphEdge(t, d, "a", "c")
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || r.Nodes[0].ID != "a" || r.Edges[0].Source != "a" {
		t.Fatal(r, e)
	}
}
func TestLocalGraphIsReadOnlyAndLeavesBodiesLinksAndMetadataUnchanged(t *testing.T) {
	d := localGraphDB(t)
	d.DB.SetMaxOpenConns(1)
	graphSeed(t, d, "a", "A")
	graphEdge(t, d, "a", "a")
	if _, e := d.DB.Exec(`PRAGMA query_only=ON`); e != nil {
		t.Fatal(e)
	}
	r, e := d.ReadLocalGraph(context.Background())
	if e != nil || len(r.Edges) != 1 {
		t.Fatal(r, e)
	}
	var title, body string
	var updated int64
	d.DB.QueryRow(`SELECT title,content,updated_at FROM files WHERE id='a'`).Scan(&title, &body, &updated)
	if title != "A" || body != "body must remain private" || updated != 1 {
		t.Fatal("write detected")
	}
}
func TestLocalGraphNodeOverflowReturnsNoPartialSnapshot(t *testing.T) {
	d := localGraphDB(t)
	tx, _ := d.DB.Begin()
	for i := 0; i <= LocalGraphNodeLimit; i++ {
		tx.Exec(`INSERT INTO files(id,title) VALUES(?,?)`, fmt.Sprint(i), "A")
	}
	tx.Commit()
	r, e := d.ReadLocalGraph(context.Background())
	if r != nil || !errors.Is(e, ErrLocalGraphLimit) {
		t.Fatal(r, e)
	}
}
func TestLocalGraphEdgeOverflowReturnsNoPartialSnapshot(t *testing.T) {
	d := localGraphDB(t)
	for i := 0; i < 65; i++ {
		graphSeed(t, d, fmt.Sprint(i), "A")
	}
	tx, _ := d.DB.Begin()
	for i := 0; i < 65; i++ {
		for j := 0; j < 65; j++ {
			tx.Exec(`INSERT INTO links(source_id,target_id) VALUES(?,?)`, fmt.Sprint(i), fmt.Sprint(j))
		}
	}
	tx.Commit()
	r, e := d.ReadLocalGraph(context.Background())
	if r != nil || !errors.Is(e, ErrLocalGraphLimit) {
		t.Fatal(r, e)
	}
}
func TestLocalGraphMetadataOverflowReturnsNoPartialSnapshot(t *testing.T) {
	d := localGraphDB(t)
	graphSeed(t, d, "a", strings.Repeat("中", 6000))
	r, e := d.ReadLocalGraph(context.Background())
	if r != nil || !errors.Is(e, ErrLocalGraphLimit) {
		t.Fatal(r, e)
	}
}
func TestLocalGraphInvalidMetadataRefused(t *testing.T) {
	for _, field := range []string{"id", "updated_at"} {
		t.Run(field, func(t *testing.T) {
			d := localGraphDB(t)
			graphSeed(t, d, "a", "A")
			if field == "id" {
				d.DB.Exec(`UPDATE files SET id=?`, "invalid\x00")
			} else {
				d.DB.Exec(`UPDATE files SET updated_at=-1`)
			}
			r, e := d.ReadLocalGraph(context.Background())
			if e == nil || r != nil {
				t.Fatal("invalid metadata accepted")
			}
		})
	}
}
func TestLocalGraphQueryFailureDoesNotBecomeEmptySuccess(t *testing.T) {
	d := localGraphDB(t)
	graphSeed(t, d, "a", "A")
	d.DB.Exec(`DROP TABLE links`)
	r, e := d.ReadLocalGraph(context.Background())
	if e == nil || r != nil {
		t.Fatal("query failure ignored")
	}
}
func TestLocalGraphCancelledReadHasNoResult(t *testing.T) {
	d := localGraphDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, e := d.ReadLocalGraph(ctx)
	if e == nil || r != nil {
		t.Fatal("cancelled read accepted")
	}
}
func TestLocalGraphUnavailableDatabaseIsError(t *testing.T) {
	var d *LinkDAO
	if r, e := d.ReadLocalGraph(context.Background()); e == nil || r != nil {
		t.Fatal("nil service accepted")
	}
	if r, e := (&LinkDAO{}).ReadLocalGraph(context.Background()); e == nil || r != nil {
		t.Fatal("nil database accepted")
	}
}
