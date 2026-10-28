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
	"testing"
	"time"
)

func TestLibraryStatisticsRealReadOnlyRoute(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,parent_id TEXT DEFAULT '',created_at INTEGER,updated_at INTEGER,is_folder INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0)`, `CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT,color TEXT)`, `CREATE TABLE file_tags(file_id TEXT,tag_id TEXT)`, `INSERT INTO files(id,title,content,created_at,updated_at) VALUES('a','原笔记','secret正文',1,1)`} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	c := &FileController{FileLogic: &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}}
	s := ghttp.GetServer("library-statistics-" + uuid.NewString())
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
	url := fmt.Sprintf("http://127.0.0.1:%d/api/library-statistics", s.GetListenedPort())
	client := &http.Client{Timeout: 10 * time.Second}
	res, e := client.Get(url)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(res.Body)
	if e != nil || res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal(e, res.StatusCode)
	}
	var result struct {
		Code int                           `json:"code"`
		Data dao.LibraryStatisticsSnapshot `json:"data"`
	}
	if e = json.Unmarshal(raw, &result); e != nil || result.Code != 0 || !result.Data.Complete || result.Data.Totals.Notes != 1 {
		t.Fatal(e, string(raw))
	}
	req, _ := http.NewRequest("POST", url, nil)
	r, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode == 200 {
		t.Fatal("unexpected write route")
	}
	var body string
	db.QueryRow(`SELECT content FROM files WHERE id='a'`).Scan(&body)
	if body != "secret正文" {
		t.Fatal("body changed")
	}
	db.Exec(`DROP TABLE tags`)
	res, e = client.Get(url)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	raw, _ = io.ReadAll(res.Body)
	var failure struct {
		Code int `json:"code"`
		Data any `json:"data"`
	}
	json.Unmarshal(raw, &failure)
	if failure.Code == 0 || failure.Data != nil {
		t.Fatal("partial error", string(raw))
	}
}
