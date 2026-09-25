package syncengine

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	xwebdav "golang.org/x/net/webdav"
)

func newWebDAVTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	handler := &xwebdav.Handler{
		Prefix:     "/",
		FileSystem: xwebdav.Dir(root),
		LockSystem: xwebdav.NewMemLS(),
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, password, ok := r.BasicAuth()
		if !ok || username != "alice" || password != "secret" {
			w.Header().Set("WWW-Authenticate", `Basic realm="sync"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	return server, server.URL + "/local-notepad"
}

func TestWebDAVRemoteStoresImmutableObjectsBlobsManifestAndLock(t *testing.T) {
	_, endpoint := newWebDAVTestServer(t)
	remote, err := NewWebDAVRemote(endpoint, "alice", "secret")
	if err != nil { t.Fatal(err) }

	record := presentRecord(FilePayload{ID: "n1", Title: "One", Content: "alpha", CreatedAt: 1, UpdatedAt: 2, SortOrder: 1000})
	data, objectHash, err := encodeRecord(record)
	if err != nil { t.Fatal(err) }
	if err := remote.SaveObject(objectHash, data); err != nil { t.Fatal(err) }
	loaded, err := remote.LoadRecord(objectHash)
	if err != nil || loaded.File == nil || loaded.File.Content != "alpha" {
		t.Fatalf("unexpected loaded record: %#v, %v", loaded, err)
	}

	source := filepath.Join(t.TempDir(), "asset.bin")
	if err := os.WriteFile(source, []byte("attachment-body"), 0600); err != nil { t.Fatal(err) }
	size, blobHash, err := stableFileDigest(source)
	if err != nil { t.Fatal(err) }
	if err := remote.SaveBlobFile(blobHash, source, size); err != nil { t.Fatal(err) }
	target := filepath.Join(t.TempDir(), "downloaded.bin")
	if err := remote.MaterializeBlobExclusive(blobHash, size, target); err != nil { t.Fatal(err) }
	if got, err := os.ReadFile(target); err != nil || string(got) != "attachment-body" {
		t.Fatalf("unexpected downloaded blob: %q, %v", got, err)
	}

	saved, err := remote.SaveManifest(Manifest{
		Format: ManifestFormat, Version: ManifestVersion, StoreID: "store-a",
		Generation: 1, UpdatedAt: "2026-09-25T12:00:00Z", DeviceID: "device-a",
		Items: map[string]string{"n1": objectHash},
	})
	if err != nil { t.Fatal(err) }
	manifest, err := remote.LoadManifest()
	if err != nil || manifest.Revision != saved.Revision || manifest.Items["n1"] != objectHash {
		t.Fatalf("unexpected manifest: %#v, %v", manifest, err)
	}

	lock, err := remote.AcquireLock()
	if err != nil { t.Fatal(err) }
	if _, err := remote.AcquireLock(); err == nil { t.Fatal("expected second WebDAV lock acquisition to fail") }
	lock.Release()
	lock2, err := remote.AcquireLock()
	if err != nil { t.Fatalf("lock was not released: %v", err) }
	lock2.Release()
}

func TestWebDAVEngineTwoDeviceRoundTrip(t *testing.T) {
	_, endpoint := newWebDAVTestServer(t)
	ctx := context.Background()
	dbA, rootA := testDB(t)
	dbB, rootB := testDB(t)
	addFile(t, dbA, "n1", "One", "through-webdav", 10)
	for _, db := range []*sql.DB{dbA, dbB} {
		if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_username='alice',sync_password='secret'`, endpoint); err != nil {
			t.Fatal(err)
		}
	}
	engineA := testEngine(dbA, rootA, "device-a")
	engineB := testEngine(dbB, rootB, "device-b")
	if _, err := engineA.Run(ctx); err != nil { t.Fatal(err) }
	result, err := engineB.Run(ctx)
	if err != nil { t.Fatal(err) }
	if result.AppliedDown != 1 || fileContent(t, dbB, "n1") != "through-webdav" {
		t.Fatalf("unexpected WebDAV sync result: %+v", result)
	}
}

func TestWebDAVRejectsInsecureExternalEndpointAndBadCredentials(t *testing.T) {
	if _, err := NewWebDAVRemote("http://example.com/dav", "alice", "secret"); err == nil {
		t.Fatal("expected insecure non-loopback endpoint to fail")
	}
	_, endpoint := newWebDAVTestServer(t)
	remote, err := NewWebDAVRemote(endpoint, "alice", "wrong")
	if err != nil { t.Fatal(err) }
	if _, err := remote.LoadManifest(); err == nil { t.Fatal("expected bad WebDAV credentials to fail") }
}


func TestWebDAVPlanIsStrictlyReadOnly(t *testing.T) {
	root:=t.TempDir()
	handler:=&xwebdav.Handler{Prefix:"/",FileSystem:xwebdav.Dir(root),LockSystem:xwebdav.NewMemLS()}
	var writes atomic.Int64
	server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
		username,password,ok:=r.BasicAuth()
		if !ok||username!="alice"||password!="secret"{http.Error(w,"unauthorized",http.StatusUnauthorized);return}
		switch r.Method{case "MKCOL",http.MethodPut,http.MethodDelete,"MOVE","COPY":writes.Add(1)}
		handler.ServeHTTP(w,r)
	}))
	defer server.Close()

	db,dataRoot:=testDB(t)
	addFile(t,db,"n1","One","preview-only",10)
	if _,err:=db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_username='alice',sync_password='secret'`,server.URL+"/local-notepad");err!=nil{t.Fatal(err)}
	engine:=testEngine(db,dataRoot,"device-a")
	plan,err:=engine.Plan(context.Background())
	if err!=nil{t.Fatal(err)}
	if plan.Uploads!=1||!plan.NeedsInit{t.Fatalf("unexpected preview plan: %+v",plan)}
	if got:=writes.Load();got!=0{t.Fatalf("WebDAV preview performed %d remote writes",got)}
}


func TestWebDAVAutomaticSyncRunsWhenDueThenWaitsForInterval(t *testing.T) {
	_,endpoint:=newWebDAVTestServer(t)
	db,root:=testDB(t)
	addFile(t,db,"n-auto","Auto","background",10)
	if _,err:=db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_username='alice',sync_password='secret',sync_auto_enabled=1,sync_interval_minutes=1`,endpoint);err!=nil{t.Fatal(err)}
	engine:=testEngine(db,root,"device-auto")
	first,err:=engine.AutoTick(context.Background())
	if err!=nil{t.Fatal(err)}
	if !first.Ran||first.Reason!="ok"||first.Result.AppliedUp!=1{t.Fatalf("unexpected first auto tick: %+v",first)}
	second,err:=engine.AutoTick(context.Background())
	if err!=nil{t.Fatal(err)}
	if second.Ran||second.Reason!="not-due"{t.Fatalf("unexpected second auto tick: %+v",second)}
}


func TestRuntimeWebDAVSecretOverridesLegacyDatabasePassword(t *testing.T) {
	_,endpoint:=newWebDAVTestServer(t)
	db,root:=testDB(t)
	addFile(t,db,"n-secure","Secure","runtime-secret",10)
	if _,err:=db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_username='alice',sync_password='wrong'`,endpoint);err!=nil{t.Fatal(err)}
	engine:=testEngine(db,root,"device-secure")
	engine.WebDAVPassword="secret"
	result,err:=engine.Run(context.Background())
	if err!=nil{t.Fatal(err)}
	if result.AppliedUp!=1{t.Fatalf("runtime secret was not used: %+v",result)}
}
