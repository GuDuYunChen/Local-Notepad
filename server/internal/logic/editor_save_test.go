package logic

import (
	"context"
	"fmt"
	"notepad-server/internal/dao"
	"notepad-server/internal/model"
	"strings"
	"testing"
)

func saveTestLogic(t *testing.T) *FileLogic {
	l := newFileLogicTestDB(t)
	for _, q := range []string{dao.EditorSavesSchema, dao.EditorSavesIndex, dao.EditorSavesDelete, `CREATE TABLE links(source_id TEXT,target_id TEXT,created_at INTEGER,UNIQUE(source_id,target_id))`, `CREATE TABLE file_versions(id INTEGER PRIMARY KEY,file_id TEXT,title TEXT,content TEXT,created_at INTEGER)`} {
		if _, err := l.FileDAO.DB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return l
}
func headingBody(label string) string {
	return fmt.Sprintf(`{"root":{"children":[{"type":"heading","tag":"h1","children":[{"type":"text","text":%q}]}]}}`, label)
}
func TestEditorSaveCommitsBodyAndDurableStructureJob(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, err := l.Create(ctx, "a.md", headingBody("旧章"), false, "")
	if err != nil {
		t.Fatal(err)
	}
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: f.Content, Content: headingBody("新章"), Mappings: `[{"from":["旧章"],"to":["新章"]}]`}
	r, err := l.SaveEditorContent(ctx, f.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Content != in.Content || !r.SaveReceipt.ReferencePending {
		t.Fatal(r)
	}
	jobs, err := l.EditorReferenceJobs(ctx)
	if err != nil || len(jobs) != 1 || jobs[0].Before != in.Expected || jobs[0].After != in.Content || jobs[0].Mappings != in.Mappings {
		t.Fatal(jobs, err)
	}
	loaded, _ := l.Get(ctx, f.ID)
	if loaded.Content != in.Content {
		t.Fatal("body was not committed")
	}
}
func TestEditorSaveReplayNeverOverwritesLaterBody(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, _ := l.Create(ctx, "a.md", "old", false, "")
	in := model.EditorSaveInput{RequestID: strings.Repeat("b", 32), Expected: "old", Content: "first"}
	if _, err := l.SaveEditorContent(ctx, f.ID, in); err != nil {
		t.Fatal(err)
	}
	next := in
	next.RequestID = strings.Repeat("c", 32)
	next.Expected = "first"
	next.Content = "newer"
	if _, err := l.SaveEditorContent(ctx, f.ID, next); err != nil {
		t.Fatal(err)
	}
	receipt, err := l.SaveEditorContent(ctx, f.ID, in)
	if err != nil || receipt.Content != "first" {
		t.Fatal(receipt, err)
	}
	latest, _ := l.Get(ctx, f.ID)
	if latest.Content != "newer" {
		t.Fatal("late duplicate overwrote the newer body")
	}
	var count int
	l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM file_versions`).Scan(&count)
	if count != 2 {
		t.Fatal("duplicate snapshot", count)
	}
}
func TestEditorSaveRefusesTokenReuseAndChangedDatabase(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, _ := l.Create(ctx, "a.md", "old", false, "")
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: "old", Content: "first"}
	l.SaveEditorContent(ctx, f.ID, in)
	bad := in
	bad.Content = "different"
	if _, err := l.SaveEditorContent(ctx, f.ID, bad); err == nil {
		t.Fatal("accepted token reuse")
	}
	bad.RequestID = strings.Repeat("d", 32)
	if _, err := l.SaveEditorContent(ctx, f.ID, bad); err == nil {
		t.Fatal("overwrote concurrent database edit")
	}
}
func TestEditorSaveAtomicRollbackOnJournalFailure(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, _ := l.Create(ctx, "a.md", "old", false, "")
	l.FileDAO.DB.Exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE OF receipt_json ON editor_save_ops BEGIN SELECT RAISE(ABORT,'forced');END`)
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: "old", Content: "new"}
	if _, err := l.SaveEditorContent(ctx, f.ID, in); err == nil {
		t.Fatal("accepted partial commit")
	}
	current, _ := l.Get(ctx, f.ID)
	if current.Content != "old" {
		t.Fatal("body leaked without receipt")
	}
	for _, table := range []string{"editor_save_ops", "file_versions"} {
		var n int
		l.FileDAO.DB.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n)
		if n != 0 {
			t.Fatal("partial table", table)
		}
	}
}
func TestEditorReferenceCompletionIsAtomicAndDoesNotBlockBody(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, _ := l.Create(ctx, "a.md", headingBody("old"), false, "")
	source, _ := l.Create(ctx, "source.md", "source before", false, "")
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: f.Content, Content: headingBody("new")}
	l.SaveEditorContent(ctx, f.ID, in)
	change := model.ReferenceCompletion{State: "done", TargetContent: in.Content, Updates: []model.ReferenceUpdate{{ID: source.ID, Expected: "wrong", Content: "repaired"}}}
	if err := l.CompleteEditorReferences(ctx, in.RequestID, change); err == nil {
		t.Fatal("overwrote changed source")
	}
	current, _ := l.Get(ctx, f.ID)
	if current.Content != in.Content {
		t.Fatal("reference failure lost saved body")
	}
	jobs, _ := l.EditorReferenceJobs(ctx)
	if len(jobs) != 1 {
		t.Fatal("lost pending task")
	}
	change.Updates[0].Expected = "source before"
	if err := l.CompleteEditorReferences(ctx, in.RequestID, change); err != nil {
		t.Fatal(err)
	}
	if err := l.CompleteEditorReferences(ctx, in.RequestID, change); err != nil {
		t.Fatal("completion not idempotent", err)
	}
	latest, _ := l.Get(ctx, source.ID)
	if latest.Content != "repaired" {
		t.Fatal("repair not persisted")
	}
	jobs, _ = l.EditorReferenceJobs(ctx)
	if len(jobs) != 0 {
		t.Fatal("completed task still pending")
	}
}
func TestEditorSaveCancellationAndMalformedRequestsAreNotSuccess(t *testing.T) {
	l := saveTestLogic(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: "old", Content: "new"}
	if _, err := l.SaveEditorContent(ctx, "missing", in); err == nil {
		t.Fatal("ignored cancellation")
	}
	for _, token := range []string{"", strings.Repeat("z", 32), "../"} {
		in.RequestID = token
		if _, err := l.SaveEditorContent(context.Background(), "x", in); err == nil {
			t.Fatal("accepted malformed token")
		}
	}
}
func TestEditorSaveDeletesContentFromReceiptsWhenTargetIsPermanentlyDeleted(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	f, _ := l.Create(ctx, "a.md", headingBody("private-old"), false, "")
	in := model.EditorSaveInput{RequestID: strings.Repeat("a", 32), Expected: f.Content, Content: headingBody("private-new")}
	l.SaveEditorContent(ctx, f.ID, in)
	l.FileDAO.DB.Exec(`DELETE FROM files WHERE id=?`, f.ID)
	var a, b, r, state string
	l.FileDAO.DB.QueryRow(`SELECT before_content,after_content,receipt_json,state FROM editor_save_ops`).Scan(&a, &b, &r, &state)
	if a != "" || b != "" || r != "" || state != "obsolete" {
		t.Fatal("deleted content retained in journal")
	}
	if _, err := l.SaveEditorContent(ctx, f.ID, in); err == nil {
		t.Fatal("replayed deleted file")
	}
}
