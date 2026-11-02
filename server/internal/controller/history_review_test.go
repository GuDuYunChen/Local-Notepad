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

func TestHistoryReviewActualHTTPReadonlyAndComplete(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,parent_id TEXT DEFAULT '',updated_at INTEGER DEFAULT 1,is_folder INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0)`, `CREATE TABLE file_versions(id INTEGER PRIMARY KEY,file_id TEXT,title TEXT,content TEXT,created_at INTEGER)`, `INSERT INTO files(id,title,content)VALUES('a','当前笔记','private-current'),('b','其他笔记','private-other'),('template','__tpl__template','private-template')`, `INSERT INTO file_versions VALUES(1,'a','旧名称','private-history',1),(2,'b','其他','private-other-history',2)`} {
		if _, err = db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	c := &FileController{FileLogic: &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}}
	s := ghttp.GetServer("history-review-" + uuid.NewString())
	s.SetAddr("127.0.0.1:0")
	s.SetDumpRouterMap(false)
	s.SetAccessLogEnabled(false)
	s.SetErrorLogEnabled(false)
	s.SetLogStdout(false)
	c.Register(s.Group("/api"))
	if err = s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Shutdown() })
	base := fmt.Sprintf("http://127.0.0.1:%d/api/history-review", s.GetListenedPort())
	client := &http.Client{Timeout: 10 * time.Second}
	for _, q := range []string{"?file=a", "?file=a&version=1", "?file=b", "", "?file=", "?file=a&file=b", "?file=a&version=1&version=2", "?file=a&version=0", "?file=a&version=-1", "?file=a&version=01", "?file=a&version=999", "?file=a&version=2", "?file=template", "?file=missing", "?file=a&extra=1", "?file=a%00"} {
		res, err := client.Get(base + q)
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal(err)
		}
		var v struct {
			Code int                `json:"code"`
			Data *dao.HistoryReview `json:"data"`
		}
		if err = json.Unmarshal(b, &v); err != nil {
			t.Fatal(err)
		}
		valid := q == "?file=a" || q == "?file=a&version=1" || q == "?file=b"
		if valid {
			if v.Code != 0 || v.Data == nil || !v.Data.Complete || v.Data.Total != 1 {
				t.Fatal(q, string(b))
			}
			if q == "?file=a" && v.Data.Selected != nil {
				t.Fatal("implicit selected body")
			}
			if q == "?file=a&version=1" && v.Data.Selected.Content != "private-history" {
				t.Fatal("wrong body")
			}
		} else if v.Code == 0 || v.Data != nil || strings.Contains(string(b), "private-") {
			t.Fatal("invalid scope disclosed data", q, string(b))
		}
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		req, _ := http.NewRequest(method, base+"?file=a&version=1", nil)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == 200 {
			t.Fatal("write route accepted", method)
		}
	}
	var body string
	var n int
	db.QueryRow(`SELECT content FROM files WHERE id='a'`).Scan(&body)
	db.QueryRow(`SELECT count(*) FROM file_versions`).Scan(&n)
	if body != "private-current" || n != 2 {
		t.Fatal("read mutated data")
	}
}
