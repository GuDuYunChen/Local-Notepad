package logic

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"notepad-server/internal/dao"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

const researchBody = `{"root":{"type":"root","version":1,"children":[{"type":"paragraph","children":[{"type":"text","text":"人工批注 😀 [[不是链接]]"},{"type":"wiki-link","id":"source-note"},{"type":"wiki-link","id":"source-note"}]}]}}`

func researchFixture(t *testing.T) *FileLogic {
	t.Helper()
	l := newFileLogicTestDB(t)
	for _, q := range []string{dao.ResearchRequestsSchema, `CREATE TABLE links(id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,target_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(source_id,target_id))`} {
		if _, err := l.FileDAO.DB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return l
}
func TestResearchCreatesFileLinksAndReceiptTogether(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	r, err := l.CreateResearch(ctx, id, "研究😀.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	got, err := l.Get(ctx, r.FileID)
	if err != nil || got.Content != researchBody {
		t.Fatal(got, err)
	}
	if !r.Found || r.State != "available" || r.RequestID != id {
		t.Fatal(r)
	}
	var n int
	l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM links WHERE source_id=?`, r.FileID).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
	hash := sha256.Sum256([]byte("研究😀.md\x00\x00" + researchBody))
	if r.PayloadSHA256 != hex.EncodeToString(hash[:]) {
		t.Fatal(r)
	}
}
func TestResearchSameRequestReplaysOriginalIdentity(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	first, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		r, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
		if err != nil || r.FileID != first.FileID || r.CreatedAt != first.CreatedAt {
			t.Fatal(r, err)
		}
	}
	var n int
	l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestResearchRequestCannotBeReboundToDifferentPayload(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	original, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][3]string{{"另一.md", researchBody, ""}, {"研究.md", strings.Replace(researchBody, "人工", "另一", 1), ""}, {"研究.md", researchBody, "different-folder"}} {
		if _, err := l.CreateResearch(ctx, id, args[0], args[1], args[2]); err == nil {
			t.Fatal("accepted different payload")
		}
	}
	f, _ := l.Get(ctx, original.FileID)
	if f.Content != researchBody || f.Title != "研究.md" {
		t.Fatal(f)
	}
}
func TestResearchReplayDoesNotRevertLaterEditsOrRename(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	r, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	l.FileDAO.DB.Exec(`UPDATE files SET title='人工改名',content='后来补充的结论' WHERE id=?`, r.FileID)
	replay, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil || replay.FileID != r.FileID {
		t.Fatal(replay, err)
	}
	f, _ := l.Get(ctx, r.FileID)
	if f.Content != "后来补充的结论" || f.Title != "人工改名" {
		t.Fatal(f)
	}
}
func TestResearchReceiptSurvivesSoftAndPermanentDeletion(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	r, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	l.FileDAO.DB.Exec(`UPDATE files SET is_deleted=1 WHERE id=?`, r.FileID)
	replay, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil || replay.State != "deleted" {
		t.Fatal(replay, err)
	}
	l.FileDAO.DB.Exec(`DELETE FROM files WHERE id=?`, r.FileID)
	replay, err = l.CreateResearch(ctx, id, "研究.md", researchBody, "")
	if err != nil || replay.State != "missing" {
		t.Fatal(replay, err)
	}
	var n int
	l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&n)
	if n != 0 {
		t.Fatal("resurrected", n)
	}
}
func TestResearchMissingReceiptIsExplicitAndReadOnly(t *testing.T) {
	l := researchFixture(t)
	r, err := l.ResearchReceipt(context.Background(), uuid.NewString())
	if err != nil || r.Found {
		t.Fatal(r, err)
	}
	var n int
	l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM research_note_requests`).Scan(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestResearchLinkFailureRollsBackAllThreeRecords(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	l.FileDAO.DB.Exec(`CREATE TRIGGER reject_research_link BEFORE INSERT ON links BEGIN SELECT RAISE(ABORT,'fixture failure'); END`)
	if _, err := l.CreateResearch(ctx, id, "研究.md", researchBody, ""); err == nil {
		t.Fatal("expected transaction failure")
	}
	for _, table := range []string{"files", "links", "research_note_requests"} {
		var n int
		l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n)
		if n != 0 {
			t.Fatal(table, n)
		}
	}
	l.FileDAO.DB.Exec(`DROP TRIGGER reject_research_link`)
	if _, err := l.CreateResearch(ctx, id, "研究.md", researchBody, ""); err != nil {
		t.Fatal("same ID retry failed", err)
	}
}
func TestResearchRefusesMissingDeletedNonFolderAndCyclicParents(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	l.FileDAO.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,is_deleted) VALUES('deleted','deleted','',1,1,1,'',1),('child','child','',1,1,1,'deleted',0),('note','note','',1,1,0,'',0),('loop','loop','',1,1,1,'loop',0)`)
	for _, parent := range []string{"missing", "deleted", "child", "note", "loop"} {
		id := uuid.NewString()
		if _, err := l.CreateResearch(ctx, id, "研究.md", researchBody, parent); err == nil {
			t.Fatal(parent)
		}
		r, _ := l.ResearchReceipt(ctx, id)
		if r.Found {
			t.Fatal("published failed reservation")
		}
	}
}
func TestResearchDuplicateNameRejectsWithoutOverwritingOrReservation(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	l.Create(ctx, "Note.md", "original", false, "")
	id := uuid.NewString()
	if _, err := l.CreateResearch(ctx, id, "note.md", researchBody, ""); err == nil {
		t.Fatal("overwrote")
	}
	r, _ := l.ResearchReceipt(ctx, id)
	if r.Found {
		t.Fatal("reserved failed task")
	}
}
func TestResearchReplayRemainsValidAfterParentIsDeleted(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	folder, _ := l.Create(ctx, "Folder", "", true, "")
	id := uuid.NewString()
	first, err := l.CreateResearch(ctx, id, "研究.md", researchBody, folder.ID)
	if err != nil {
		t.Fatal(err)
	}
	l.FileDAO.DeleteRecursive(ctx, folder.ID)
	next, err := l.CreateResearch(ctx, id, "研究.md", researchBody, folder.ID)
	if err != nil || next.FileID != first.FileID || next.State != "deleted" {
		t.Fatal(next, err)
	}
}
func TestResearchValidatesIdentityTitleBodyAndNodeTypes(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	for _, id := range []string{"", "../../file", strings.ToUpper(uuid.NewString()), "00000000-0000-0000-0000-000000000000"} {
		if _, err := l.CreateResearch(ctx, id, "研究.md", researchBody, ""); err == nil {
			t.Fatal(id)
		}
	}
	for _, title := range []string{"", " bad", "bad:name", "bad\x00name", strings.Repeat("界", 256)} {
		if _, err := l.CreateResearch(ctx, uuid.NewString(), title, researchBody, ""); err == nil {
			t.Fatal(title)
		}
	}
	for _, content := range []string{"", "not json", `{"root":null}`, `{"root":{"type":"root","children":[null]}}`, `{"root":{"type":"root","children":[{"type":"html"}]}}`, strings.Repeat("x", 2*1024*1024+1)} {
		if _, err := l.CreateResearch(ctx, uuid.NewString(), "研究.md", content, ""); err == nil {
			t.Fatal("invalid content accepted")
		}
	}
}
func TestResearchCanceledRequestLeavesNoReceipt(t *testing.T) {
	l := researchFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	id := uuid.NewString()
	if _, err := l.CreateResearch(ctx, id, "研究.md", researchBody, ""); err == nil {
		t.Fatal("accepted cancelled request")
	}
	r, _ := l.ResearchReceipt(context.Background(), id)
	if r.Found {
		t.Fatal(r)
	}
}
func TestResearchConcurrentDuplicateConfirmationsCreateOnlyOneFile(t *testing.T) {
	l := researchFixture(t)
	ctx := context.Background()
	id := uuid.NewString()
	var wg sync.WaitGroup
	results := make(chan string, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := l.CreateResearch(ctx, id, "研究.md", researchBody, "")
			if err != nil {
				results <- "error:" + err.Error()
				return
			}
			results <- r.FileID
		}()
	}
	wg.Wait()
	close(results)
	first := ""
	for result := range results {
		if strings.HasPrefix(result, "error:") {
			t.Fatal(result)
		}
		if first == "" {
			first = result
		}
		if result != first {
			t.Fatal("duplicate", result, first)
		}
	}
}
func TestResearchReceiptPersistsAcrossDatabaseReopen(t *testing.T) {
	l := researchFixture(t)
	path := filepath.Join(t.TempDir(), "研究 数据.db")
	// VACUUM creates an isolated on-disk copy of the fixture, not a user database.
	if _, err := l.FileDAO.DB.Exec(`VACUUM INTO ?`, path); err != nil {
		t.Fatal(err)
	}
	open := func() *FileLogic {
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		return &FileLogic{FileDAO: &dao.FileDAO{DB: db}}
	}
	first := open()
	id := uuid.NewString()
	r, err := first.CreateResearch(context.Background(), id, "研究.md", researchBody, "")
	if err != nil {
		t.Fatal(err)
	}
	first.FileDAO.DB.Close()
	second := open()
	defer second.FileDAO.DB.Close()
	replay, err := second.CreateResearch(context.Background(), id, "研究.md", researchBody, "")
	if err != nil || replay.FileID != r.FileID {
		t.Fatal(replay, err)
	}
}
func TestResearchConcurrentIndependentConnectionsSerializeByReservation(t *testing.T) {
	l := researchFixture(t)
	path := filepath.Join(t.TempDir(), "concurrent.db")
	if _, err := l.FileDAO.DB.Exec(`VACUUM INTO ?`, path); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id := uuid.NewString()
	out := make(chan string, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		defer db.Close()
		other := &FileLogic{FileDAO: &dao.FileDAO{DB: db}}
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := other.CreateResearch(ctx, id, "研究.md", researchBody, "")
			if err != nil {
				out <- fmt.Sprint(err)
				return
			}
			out <- r.FileID
		}()
	}
	wg.Wait()
	close(out)
	a, b := <-out, <-out
	if a != b {
		t.Fatal(a, b)
	}
	if _, err := uuid.Parse(a); err != nil {
		t.Fatal(a)
	}
}
