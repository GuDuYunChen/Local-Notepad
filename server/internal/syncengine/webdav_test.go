package syncengine

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
