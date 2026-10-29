package controller

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/google/uuid"
	"io"
	_ "modernc.org/sqlite"
	"net/http"
	"notepad-server/internal/dao"
	"notepad-server/internal/logic"
	"strings"
	"testing"
	"time"
)

func TestTrashRecoveryActualHTTPAndStrictInput(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	_, e = db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,parent_id TEXT DEFAULT '',created_at INTEGER DEFAULT 1,updated_at INTEGER DEFAULT 1,is_folder INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0);INSERT INTO files(id,title,content,is_deleted,deleted_at) VALUES('note','原笔记','正文不可改写',1,10)`)
	if e != nil {
		t.Fatal(e)
	}
	c := &FileController{FileLogic: &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}}
	s := ghttp.GetServer("recovery-" + uuid.NewString())
	s.SetAddr("127.0.0.1:0")
	s.SetDumpRouterMap(false)
	s.SetAccessLogEnabled(false)
	s.SetErrorLogEnabled(false)
	s.SetLogStdout(false)
	c.Register(s.Group("/api"))
	if e = s.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Shutdown() })
	client := &http.Client{Timeout: 5 * time.Second}
	base := fmt.Sprintf("http://127.0.0.1:%d/api/trash-recovery", s.GetListenedPort())
	call := func(method, suffix, raw string) (int, json.RawMessage) {
		t.Helper()
		req, _ := http.NewRequest(method, base+suffix, strings.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal(res.StatusCode, string(b))
		}
		var out struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if e = json.Unmarshal(b, &out); e != nil {
			t.Fatal(e, string(b))
		}
		return out.Code, out.Data
	}
	code, raw := call("GET", "", "")
	var snap dao.TrashRecoverySnapshot
	if e = json.Unmarshal(raw, &snap); e != nil || code != 0 || !snap.Complete {
		t.Fatal(code, e, string(raw))
	}
	in := dao.TrashRecoveryChange{RequestID: uuid.NewString(), ExpectedRevision: snap.Revision, IDs: []string{"note"}, Mode: "target", ParentID: ""}
	b, _ := json.Marshal(in)
	for _, invalid := range []string{`{}`, string(b[:len(b)-1]) + `,"content":"bad"}`, string(b) + ` {}`, string(b) + strings.Repeat(" ", 66000)} {
		if code, _ = call("POST", "/restore", invalid); code == 0 {
			t.Fatal("invalid body accepted", len(invalid))
		}
	}
	if code, _ = call("POST", "/restore", string(b)); code != 0 {
		t.Fatal(code)
	}
	if code, _ = call("POST", "/restore", string(b)); code == 0 {
		t.Fatal("stale replay accepted")
	}
	var body string
	db.QueryRow(`SELECT content FROM files WHERE id='note'`).Scan(&body)
	if body != "正文不可改写" {
		t.Fatal(body)
	}
}
