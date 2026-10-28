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

func TestTagWorkspaceRealRoutesAndVersionRefusal(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{`CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,color TEXT)`, `CREATE TABLE file_tags(file_id TEXT,tag_id TEXT,PRIMARY KEY(file_id,tag_id))`, `CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT,created_at INTEGER,updated_at INTEGER,is_folder INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0)`, `INSERT INTO files(id,title,content,created_at,updated_at) VALUES('note-a','原笔记','正文必须保留',1,1)`} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	c := &TagController{TagLogic: &logic.TagLogic{TagDAO: &dao.TagDAO{DB: db}}}
	s := ghttp.GetServer("tag-workspace-" + uuid.NewString())
	s.SetAddr("127.0.0.1:0")
	s.SetDumpRouterMap(false)
	s.SetAccessLogEnabled(false)
	s.SetErrorLogEnabled(false)
	s.SetLogStdout(false)
	c.Register(s.Group("/api"))
	if e = s.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if e := s.Shutdown(); e != nil {
			t.Error(e)
		}
	})
	base := fmt.Sprintf("http://127.0.0.1:%d/api", s.GetListenedPort())
	client := &http.Client{Timeout: 5 * time.Second}
	call := func(method, path string, in any) (int, json.RawMessage) {
		t.Helper()
		var bytes []byte
		if in != nil {
			bytes, _ = json.Marshal(in)
		}
		request, e := http.NewRequest(method, base+path, strings.NewReader(string(bytes)))
		if e != nil {
			t.Fatal(e)
		}
		request.Header.Set("Content-Type", "application/json")
		response, e := client.Do(request)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		raw, e := io.ReadAll(response.Body)
		if e != nil || response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatal(response.StatusCode, string(raw), e)
		}
		var out struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if e = json.Unmarshal(raw, &out); e != nil {
			t.Fatal(e)
		}
		return out.Code, out.Data
	}
	code, data := call("GET", "/tag-workspace", nil)
	var initial dao.TagWorkspaceSnapshot
	json.Unmarshal(data, &initial)
	if code != 0 || !initial.Complete || len(initial.Tags) != 0 {
		t.Fatal(code, string(data))
	}
	in := dao.TagWorkspaceChange{Kind: "create", RequestID: uuid.NewString(), ExpectedRevision: initial.Revision, ID: uuid.NewString(), Name: "标签", Color: "#123456"}
	code, data = call("POST", "/tag-workspace/changes", in)
	var ack dao.TagWorkspaceResult
	json.Unmarshal(data, &ack)
	if code != 0 || ack.RequestID != in.RequestID || len(ack.Snapshot.Tags) != 1 {
		t.Fatal(code, string(data))
	}
	stale := in
	stale.Kind = "delete"
	stale.Name = ""
	stale.Color = ""
	stale.RequestID = uuid.NewString()
	if code, _ = call("POST", "/tag-workspace/changes", stale); code == 0 {
		t.Fatal("stale accepted")
	}
	db.Exec(`INSERT INTO file_tags VALUES('note-a',?)`, in.ID)
	code, data = call("GET", "/tag-workspace", nil)
	var current dao.TagWorkspaceSnapshot
	json.Unmarshal(data, &current)
	code, data = call("GET", "/tag-workspace/"+in.ID+"/notes?offset=0&revision="+current.Revision, nil)
	if code != 0 || strings.Contains(string(data), "正文必须保留") || !strings.Contains(string(data), "note-a") {
		t.Fatal(code, string(data))
	}
	for _, offset := range []string{"-1", "x", "1", "51"} {
		if code, _ = call("GET", "/tag-workspace/"+in.ID+"/notes?offset="+offset+"&revision="+current.Revision, nil); code == 0 {
			t.Fatal("invalid page", offset)
		}
	}
	stale.ExpectedRevision = current.Revision
	code, data = call("POST", "/tag-workspace/changes", stale)
	if code != 0 {
		t.Fatal(code, string(data))
	}
	var body string
	var updated int64
	db.QueryRow(`SELECT content,updated_at FROM files WHERE id='note-a'`).Scan(&body, &updated)
	if body != "正文必须保留" || updated != 1 {
		t.Fatal("modified note")
	}
}
