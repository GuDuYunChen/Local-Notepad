package syncengine

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWebDAVRetryIsWiredIntoGetBytes(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("read retried as %s", r.Method)
		}
		username, password, _ := r.BasicAuth()
		if username != "alice" || password != "secret" {
			t.Error("credentials lost")
		}
		if calls.Add(1) == 1 {
			http.Error(w, "private-server-detail", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("ETag", `"same-resource"`)
		_, _ = w.Write([]byte("verified-payload"))
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/notepad", "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	data, etag, err := remote.getBytes("objects/test", 1024)
	if err != nil || string(data) != "verified-payload" || etag != `"same-resource"` || calls.Load() != 2 {
		t.Fatalf("transport integration: %q %q %v calls=%d", data, etag, err, calls.Load())
	}
}

func TestWebDAVRetryIsWiredIntoReadOnlyManifestListing(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PROPFIND" {
			t.Errorf("manifest check performed %s", r.Method)
		}
		if calls.Add(1) == 1 {
			http.Error(w, "temporary", http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusMultiStatus)
		_, _ = w.Write([]byte(`<d:multistatus xmlns:d="DAV:"></d:multistatus>`))
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/notepad", "", "")
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := remote.LoadManifest()
	if err != nil || manifest.StoreID != "" || len(manifest.Items) != 0 || calls.Load() != 2 {
		t.Fatalf("manifest check: %+v %v", manifest, err)
	}
}

func TestWebDAVAuthenticationErrorDoesNotEchoServerBody(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "echoed-password=never-log-me", http.StatusUnauthorized)
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/private-token-path", "alice", "never-log-me")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = remote.getBytes("objects/test", 1024)
	var statusErr *WebDAVHTTPError
	if !errors.As(err, &statusErr) || statusErr.StatusCode != 401 || calls.Load() != 1 {
		t.Fatalf("wrong auth result: %v", err)
	}
	if strings.Contains(err.Error(), "never-log-me") || strings.Contains(err.Error(), "private-token-path") {
		t.Fatalf("private data echoed: %s", err)
	}
}

func TestWebDAVMutation503IsSingleShotAtRequestEntry(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPut {
			t.Errorf("unexpected method %s", r.Method)
		}
		w.Header().Set("Retry-After", "3600")
		http.Error(w, "private-reason", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/notepad", "", "")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := remote.request(http.MethodPut, "objects/test", strings.NewReader("data"), 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeResponse(resp)
	var statusErr *WebDAVHTTPError
	if !errors.As(webDAVStatusError(resp, "写入远端对象"), &statusErr) || statusErr.RetryAfterSeconds != 3600 || calls.Load() != 1 {
		t.Fatal("ambiguous write replayed or delay lost")
	}
}

func TestWebDAVTruncatedDownloadLeavesNoPublishedOrPartialFile(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Length", "100")
		_, _ = w.Write([]byte("ab"))
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/notepad", "", "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	err = remote.MaterializeBlobExclusive(strings.Repeat("a", 64), 100, filepath.Join(dir, "attachment.bin"))
	if err == nil || calls.Load() != 1 {
		t.Fatalf("truncated body was replayed or accepted: %v", err)
	}
	entries, readErr := os.ReadDir(dir)
	if readErr != nil || len(entries) != 0 {
		t.Fatalf("left partial/published bytes: %v %v", entries, readErr)
	}
}

func TestWebDAVChecksumFailureIsNeverReadRetried(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte("tampered"))
	}))
	defer server.Close()
	remote, err := NewWebDAVRemote(server.URL+"/notepad", "", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = remote.LoadRecord(strings.Repeat("a", 64))
	if err == nil || calls.Load() != 1 {
		t.Fatalf("integrity failure masked by retry: %v", err)
	}
}

func TestWebDAVReadRetryDoesNotFollowCredentialRedirects(t *testing.T) {
	var forwarded atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.WriteHeader(200) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/collect", http.StatusFound)
	}))
	defer origin.Close()
	remote, err := NewWebDAVRemote(origin.URL+"/notepad", "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = remote.getBytes("objects/test", 1024)
	var statusErr *WebDAVHTTPError
	if !errors.As(err, &statusErr) || statusErr.StatusCode != http.StatusFound || forwarded.Load() != 0 {
		t.Fatalf("redirect forwarded: %v", err)
	}
}
