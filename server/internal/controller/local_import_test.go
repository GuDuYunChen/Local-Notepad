package controller

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"notepad-server/internal/dao"
	"notepad-server/internal/logic"
	"notepad-server/internal/model"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func TestLocalImportNativeRoutesPreserveReceiptsAndDefiniteRejections(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	for _, query := range []string{
		`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,is_folder INTEGER DEFAULT 0,parent_id TEXT DEFAULT '',sort_order INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0)`,
		dao.ResearchRequestsSchema,
	} {
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	content, err := os.ReadFile("../logic/testdata/local_import_rich.json")
	if err != nil {
		t.Fatal(err)
	}
	fileLogic := &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}
	c := &FileController{FileLogic: fileLogic}
	s := ghttp.GetServer("local-import-" + uuid.NewString())
	s.SetAddr("127.0.0.1:0")
	s.SetClientMaxBodySize(100 * 1024 * 1024)
	s.SetDumpRouterMap(false)
	s.SetAccessLogEnabled(false)
	s.SetErrorLogEnabled(false)
	s.SetLogStdout(false)
	s.Use(func(r *ghttp.Request) {
		if r.Header.Get("X-Synthetic-Cancel") == "yes" {
			ctx, cancel := context.WithCancel(r.GetCtx())
			cancel()
			r.SetCtx(ctx)
		}
		r.Middleware.Next()
	})
	// The production registration method, router and JSON buffer are exercised
	// with one ephemeral local listener for all cases. No bridge is replaced.
	c.Register(s.Group("/api"))
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Shutdown(); err != nil {
			t.Error(err)
		}
	})
	base := fmt.Sprintf("http://127.0.0.1:%d/api/local-import/requests/", s.GetListenedPort())
	client := &http.Client{Timeout: 5 * time.Second}
	type envelope struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	call := func(t *testing.T, method, path, body string, cancelled bool) envelope {
		t.Helper()
		req, err := http.NewRequest(method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if cancelled {
			req.Header.Set("X-Synthetic-Cancel", "yes")
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil || res.StatusCode != http.StatusOK || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("native response mismatch status=%d err=%v body=%s", res.StatusCode, err, raw)
		}
		var result envelope
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatalf("native JSON response did not decode: %s %v", raw, err)
		}
		return result
	}
	payload := func(title, parent string) string {
		encoded, err := json.Marshal(logic.LocalImportInput{Title: title, Content: string(content), ParentID: parent})
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	rejected := func(t *testing.T, result envelope, id, reason string) {
		t.Helper()
		var data logic.LocalImportResult
		if result.Code != 0 || json.Unmarshal(result.Data, &data) != nil || data.Status != "rejected" || data.RequestID != id || data.Reason != reason || data.Receipt != nil || data.Message == "" {
			t.Fatalf("expected %s rejection; got %+v %s", reason, result, result.Data)
		}
	}
	id, other := uuid.NewString(), uuid.NewString()
	var first model.ResearchReceipt
	t.Run("unknown-receipt-is-read-only", func(t *testing.T) {
		result := call(t, "GET", id, "", false)
		var receipt model.ResearchReceipt
		if result.Code != 0 || json.Unmarshal(result.Data, &receipt) != nil || receipt.Found || receipt.RequestID != id {
			t.Fatal(result, receipt)
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM research_note_requests`).Scan(&count); err != nil || count != 0 {
			t.Fatal(count, err)
		}
	})
	t.Run("commit-uses-path-id-and-preserves-rich-content", func(t *testing.T) {
		result := call(t, "POST", id+"?requestId="+other, payload("Native.md", ""), false)
		var data logic.LocalImportResult
		if result.Code != 0 || json.Unmarshal(result.Data, &data) != nil || data.Status != "committed" || data.Receipt == nil || data.Receipt.RequestID != id || !data.Receipt.Found {
			t.Fatal(result, data)
		}
		first = *data.Receipt
		file, err := fileLogic.Get(context.Background(), first.FileID)
		if err != nil || file.Content != string(content) {
			t.Fatal(file, err)
		}
		wrong, err := fileLogic.LocalImportReceipt(context.Background(), other)
		if err != nil || wrong.Found {
			t.Fatal("query shadowed route identity", wrong, err)
		}
	})
	t.Run("receipt-lookup-after-unobserved-response", func(t *testing.T) {
		result := call(t, "GET", id+"?requestId="+other, "", false)
		var recovered model.ResearchReceipt
		if result.Code != 0 || json.Unmarshal(result.Data, &recovered) != nil || recovered != first {
			t.Fatal(result, recovered, first)
		}
	})
	t.Run("repeat-does-not-create-another-file", func(t *testing.T) {
		result := call(t, "POST", id, payload("Native.md", ""), false)
		var data logic.LocalImportResult
		if result.Code != 0 || json.Unmarshal(result.Data, &data) != nil || data.Receipt == nil || *data.Receipt != first {
			t.Fatal(result, data)
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&count); err != nil || count != 1 {
			t.Fatal(count, err)
		}
	})
	t.Run("bound-id-cannot-be-repaired-as-new-payload", func(t *testing.T) {
		rejected(t, call(t, "POST", id, payload("Changed.md", ""), false), id, "payload-mismatch")
		rejected(t, call(t, "POST", id, `{broken`, false), id, "payload-mismatch")
	})
	t.Run("malformed-new-request-is-definitely-uncommitted", func(t *testing.T) {
		newID := uuid.NewString()
		for _, body := range []string{`{broken`, `{"title":"a","content":"b","parent_id":"","title":"c"}`, `{"title":"a","content":"b","parent_id":"","extra":true}`} {
			rejected(t, call(t, "POST", newID, body, false), newID, "invalid-payload")
		}
		receipt, err := fileLogic.LocalImportReceipt(context.Background(), newID)
		if err != nil || receipt.Found {
			t.Fatal(receipt, err)
		}
	})
	t.Run("bad-path-cannot-be-shadowed-by-valid-query", func(t *testing.T) {
		rejected(t, call(t, "POST", "not-a-uuid?requestId="+id, payload("Bad.md", ""), false), "not-a-uuid", "invalid-payload")
		result := call(t, "GET", "not-a-uuid?requestId="+id, "", false)
		if result.Code == 0 || string(result.Data) != "null" {
			t.Fatal(result)
		}
	})
	t.Run("oversize-envelope-is-bounded-before-json-parse", func(t *testing.T) {
		newID := uuid.NewString()
		rejected(t, call(t, "POST", newID, strings.Repeat(" ", logic.LocalImportRequestLimit+1024), false), newID, "invalid-payload")
		receipt, err := fileLogic.LocalImportReceipt(context.Background(), newID)
		if err != nil || receipt.Found {
			t.Fatal(receipt, err)
		}
	})
	t.Run("same-name-and-missing-folder-reject", func(t *testing.T) {
		newID := uuid.NewString()
		rejected(t, call(t, "POST", newID, payload("native.MD", ""), false), newID, "name-conflict")
		rejected(t, call(t, "POST", newID, payload("New.md", uuid.NewString()), false), newID, "folder-unavailable")
	})
	t.Run("request-cancellation-is-unknown", func(t *testing.T) {
		result := call(t, "POST", uuid.NewString(), payload("Cancelled.md", ""), true)
		if result.Code != 1006 || string(result.Data) != "null" {
			t.Fatal(result)
		}
	})
	t.Run("database-failure-is-unknown-without-leaking-detail", func(t *testing.T) {
		if _, err := db.Exec(`CREATE TRIGGER fail_import BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'synthetic private database detail'); END`); err != nil {
			t.Fatal(err)
		}
		result := call(t, "POST", uuid.NewString(), payload("Unknown.md", ""), false)
		if result.Code != 1006 || string(result.Data) != "null" || strings.Contains(result.Message, "private") {
			t.Fatal(result)
		}
		if _, err := db.Exec(`DROP TRIGGER fail_import`); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("deleted-note-receipt-prevents-resurrection", func(t *testing.T) {
		if _, err := db.Exec(`DELETE FROM files WHERE id=?`, first.FileID); err != nil {
			t.Fatal(err)
		}
		result := call(t, "POST", id, payload("Native.md", ""), false)
		var data logic.LocalImportResult
		if result.Code != 0 || json.Unmarshal(result.Data, &data) != nil || data.Status != "committed" || data.Receipt == nil || data.Receipt.State != "missing" || data.Receipt.FileID != first.FileID {
			t.Fatal(result, data)
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&count); err != nil || count != 0 {
			t.Fatal(count, err)
		}
	})
}
