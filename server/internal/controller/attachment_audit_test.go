package controller

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/google/uuid"
	"net/http"
	"notepad-server/internal/dao"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAttachmentAuditActualReadOnlyRoute(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if _, e = db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,is_deleted INTEGER DEFAULT 0,is_folder INTEGER DEFAULT 0); INSERT INTO files(id,title,content) VALUES('note','private title','![local](/uploads/a.txt)')`); e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("private bytes"), 0600)
	c := &UploadController{UploadDir: dir, FileDAO: &dao.FileDAO{DB: db}}
	s := ghttp.GetServer("attachment-audit-" + uuid.NewString())
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
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/api/attachment-audit", s.GetListenedPort())
	client := &http.Client{Timeout: 10 * time.Second}
	read := func() struct {
		Code int
		Data *dao.AttachmentAuditSnapshot
	} { r, e := client.Get(endpoint); if e != nil {
		t.Fatal(e)
	}; defer r.Body.Close(); if r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("cache")
	}; var result struct {
		Code int
		Data *dao.AttachmentAuditSnapshot
	}; if e = json.NewDecoder(r.Body).Decode(&result); e != nil {
		t.Fatal(e)
	}; return result }
	a := read()
	if a.Code != 0 || a.Data == nil || a.Data.Totals.Referenced != 1 {
		t.Fatal(a)
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		req, _ := http.NewRequest(method, endpoint, nil)
		r, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		if r.StatusCode == 200 {
			t.Fatal("write route", method)
		}
	}
	var body string
	db.QueryRow(`SELECT content FROM files WHERE id='note'`).Scan(&body)
	if body != "![local](/uploads/a.txt)" {
		t.Fatal("body changed")
	}
	db.Exec(`DROP TABLE files`)
	b := read()
	if b.Code == 0 || b.Data != nil {
		t.Fatal("partial failure", b)
	}
}
