package syncengine

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func awaitContextSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("operation did not reach the expected stage")
	}
}
func awaitContextError(t *testing.T, ch <-chan error) error {
	t.Helper()
	select {
	case err := <-ch:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not release operation")
		return nil
	}
}
func contextRemote(t *testing.T, ctx context.Context, endpoint string) *WebDAVRemote {
	t.Helper()
	r, err := newWebDAVRemoteContext(ctx, endpoint, "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestOperationContextAlreadyCancelledMakesNoRequest(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := newWebDAVRemoteContext(ctx, s.URL, "alice", "secret")
	if !errors.Is(err, context.Canceled) || calls.Load() != 0 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}
func TestOperationContextCancelsBeforeHeaders(t *testing.T) {
	for _, method := range []string{http.MethodGet, "PROPFIND", http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				close(entered)
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}))
			defer s.Close()
			defer close(release)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := contextRemote(t, ctx, s.URL)
			done := make(chan error, 1)
			go func() {
				resp, err := r.request(method, "test", bytes.NewBufferString("payload"), 7, nil)
				closeResponse(resp)
				done <- err
			}()
			awaitContextSignal(t, entered)
			cancel()
			if err := awaitContextError(t, done); !errors.Is(err, context.Canceled) {
				t.Fatalf("unexpected error %v", err)
			}
			if calls.Load() != 1 {
				t.Fatalf("cancelled request replayed %d times", calls.Load())
			}
		})
	}
}
func TestOperationContextDeadlineStopsReadRetryWait(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	r := contextRemote(t, ctx, s.URL)
	_, _, err := r.getBytes("object", 1024)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected error %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("retry outlived enclosing budget: %d", calls.Load())
	}
}
func TestOperationContextCancelledDownloadDoesNotPublish(t *testing.T) {
	data := []byte("complete attachment content")
	entered, release := make(chan struct{}), make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(data[:3])
		w.(http.Flusher).Flush()
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := contextRemote(t, ctx, s.URL)
	target := filepath.Join(t.TempDir(), "attachment.bin")
	done := make(chan error, 1)
	go func() { done <- r.MaterializeBlobExclusive(hashBytes(data), int64(len(data)), target) }()
	awaitContextSignal(t, entered)
	cancel()
	if err := awaitContextError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error %v", err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("published cancelled attachment: %v", err)
	}
	files, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary files leaked: %v %v", files, err)
	}
}
func TestOperationContextCancelledPutDoesNotProbeOrReplay(t *testing.T) {
	var puts, gets atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			puts.Add(1)
			_, _ = io.Copy(io.Discard, r.Body)
			close(entered)
			select {
			case <-r.Context().Done():
			case <-release:
			}
			return
		}
		gets.Add(1)
	}))
	defer s.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := contextRemote(t, ctx, s.URL)
	data := []byte("immutable")
	done := make(chan error, 1)
	go func() { done <- r.putImmutable("objects/test", data, hashBytes(data)) }()
	awaitContextSignal(t, entered)
	cancel()
	if err := awaitContextError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error %v", err)
	}
	if puts.Load() != 1 || gets.Load() != 0 {
		t.Fatalf("after cancel puts=%d gets=%d", puts.Load(), gets.Load())
	}
}
func TestOperationContextCleanupCanReleaseOwnLockAfterCancel(t *testing.T) {
	var deletes atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(webDAVLockPayload{Token: "owned", At: "now"})
			return
		}
		if r.Method == http.MethodDelete {
			deletes.Add(1)
			w.WriteHeader(204)
			return
		}
		t.Errorf("unexpected cleanup method %s", r.Method)
	}))
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	r := contextRemote(t, ctx, s.URL)
	cancel()
	r.releaseLock("owned")
	if deletes.Load() != 1 {
		t.Fatal("cancelled context prevented owned lock cleanup")
	}
	if r.requestContext().Err() != context.Canceled {
		t.Fatal("cleanup revived the data-operation context")
	}
}
func TestOperationContextCleanupDoesNotGuessLockOwnership(t *testing.T) {
	for _, owner := range []string{"other", "", "malformed"} {
		t.Run(owner, func(t *testing.T) {
			var deletes atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodDelete {
					deletes.Add(1)
					return
				}
				if owner == "malformed" {
					_, _ = w.Write([]byte("not json"))
					return
				}
				_ = json.NewEncoder(w).Encode(webDAVLockPayload{Token: owner, At: "now"})
			}))
			defer s.Close()
			ctx, cancel := context.WithCancel(context.Background())
			r := contextRemote(t, ctx, s.URL)
			cancel()
			r.releaseLock("owned")
			if deletes.Load() != 0 {
				t.Fatal("deleted an unverifiable lock")
			}
		})
	}
}
func TestOperationContextCleanupHasItsOwnShortDeadline(t *testing.T) {
	release := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	r := contextRemote(t, ctx, s.URL)
	cancel()
	done := make(chan error, 1)
	go func() { r.releaseLockWithin("owned", 40*time.Millisecond); done <- nil }()
	awaitContextError(t, done)
}
func TestOperationContextLegacyConstructorStillWorks(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer s.Close()
	r, err := NewWebDAVRemote(s.URL, "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	body, _, err := r.getBytes("read", 10)
	if err != nil || string(body) != "ok" {
		t.Fatalf("legacy read: %s %v", body, err)
	}
}
func TestOperationBudgetDefaultsAndParentDeadline(t *testing.T) {
	for _, override := range []time.Duration{0, -time.Second, time.Hour} {
		ctx, cancel := withSyncBudget(context.Background(), override, syncReadLimit)
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > syncReadLimit || time.Until(deadline) < 29*time.Second {
			t.Fatal("bad default read budget")
		}
		cancel()
	}
	parent, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	ctx, cancel := withSyncBudget(parent, 0, syncRunLimit)
	defer cancel()
	p, _ := parent.Deadline()
	c, _ := ctx.Deadline()
	if !p.Equal(c) {
		t.Fatal("inner budget extended parent deadline")
	}
}
func TestOperationBudgetCancellationDoesNotCancelParent(t *testing.T) {
	parent, stop := context.WithCancel(context.Background())
	defer stop()
	ctx, cancel := withSyncBudget(parent, 0, syncReadLimit)
	cancel()
	if ctx.Err() != context.Canceled || parent.Err() != nil {
		t.Fatal("read budget leaked cancellation into its parent")
	}
}

// This minimal driver supplies ONLY a config row. It tests the actual Engine
// remote factory's context wiring, not SQLite transaction or database behavior.
type operationConfigConnector struct{ endpoint string }

func (c operationConfigConnector) Connect(context.Context) (driver.Conn, error) {
	return operationConfigConn{c.endpoint}, nil
}
func (c operationConfigConnector) Driver() driver.Driver { return operationConfigDriver{c.endpoint} }

type operationConfigDriver struct{ endpoint string }

func (d operationConfigDriver) Open(string) (driver.Conn, error) {
	return operationConfigConn{d.endpoint}, nil
}

type operationConfigConn struct{ endpoint string }

func (c operationConfigConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected Prepare")
}
func (c operationConfigConn) Close() error { return nil }
func (c operationConfigConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected transaction")
}
func (c operationConfigConn) QueryContext(ctx context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !strings.Contains(q, "sync_endpoint") {
		return nil, errors.New("unexpected query")
	}
	return &operationConfigRows{endpoint: c.endpoint}, nil
}

type operationConfigRows struct {
	endpoint string
	read     bool
}

func (r *operationConfigRows) Columns() []string {
	return []string{"enabled", "provider", "endpoint", "username", "password"}
}
func (r *operationConfigRows) Close() error { return nil }
func (r *operationConfigRows) Next(dst []driver.Value) error {
	if r.read {
		return io.EOF
	}
	r.read = true
	copy(dst, []driver.Value{int64(1), "webdav", r.endpoint, "alice", "secret"})
	return nil
}
func TestOperationContextEngineFactoryPropagatesCancellation(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	db := sql.OpenDB(operationConfigConnector{s.URL})
	defer db.Close()
	e := &Engine{DB: db, DataDir: t.TempDir()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r, err := e.remote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := r.LoadManifest(); done <- err }()
	awaitContextSignal(t, entered)
	cancel()
	if err := awaitContextError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("engine context lost: %v", err)
	}
}
