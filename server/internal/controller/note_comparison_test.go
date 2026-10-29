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

func TestComparisonActualHTTPReadonlyScope(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,parent_id TEXT DEFAULT '',updated_at INTEGER DEFAULT 1,is_folder INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0)`, `INSERT INTO files(id,title,content)VALUES('a','左','私人正文A'),('b','右','私人正文B'),('c','__tpl__模板','hidden')`} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	c := &FileController{FileLogic: &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}}
	s := ghttp.GetServer("comparison-" + uuid.NewString())
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
	base := fmt.Sprintf("http://127.0.0.1:%d/api/note-comparison", s.GetListenedPort())
	client := &http.Client{Timeout: 10 * time.Second}
	for _, q := range []string{"?left=a&right=b", "?left=b&right=a", "?left=a", "?left=a&left=b&right=a", "?left=a&right=a", "?left=a&right=c", "?left=a&right=missing", "?left=a&right=b&other=1", "?left=a%00&right=b"} {
		res, e := client.Get(base + q)
		if e != nil {
			t.Fatal(e)
		}
		b, e := io.ReadAll(res.Body)
		res.Body.Close()
		if e != nil || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal(e)
		}
		var v struct {
			Code int                 `json:"code"`
			Data *dao.NoteComparison `json:"data"`
		}
		if e = json.Unmarshal(b, &v); e != nil {
			t.Fatal(e)
		}
		ok := q == "?left=a&right=b" || q == "?left=b&right=a"
		if ok {
			if v.Code != 0 || v.Data == nil || !v.Data.Complete || v.Data.RawEqual {
				t.Fatal(string(b))
			}
		} else if v.Code == 0 || v.Data != nil || strings.Contains(string(b), "私人正文") {
			t.Fatal("invalid scope returned data", q, string(b))
		}
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		req, _ := http.NewRequest(method, base+"?left=a&right=b", nil)
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode == 200 {
			t.Fatal("write route accepted", method)
		}
	}
	var body string
	db.QueryRow(`SELECT content FROM files WHERE id='a'`).Scan(&body)
	if body != "私人正文A" {
		t.Fatal("write")
	}
}
