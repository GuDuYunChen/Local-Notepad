package syncengine

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncjob"
)

// These tests use the repository's existing SQLite fixtures. They belong to
// go test ./..., not the dependency-free transport validation command.
func TestRecoveryReadDeadlinePersistsOnlyPreflightBackoff(t *testing.T) {
	var writes atomic.Int32
	release := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != "PROPFIND" {
			writes.Add(1)
		}
		select {
		case <-req.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1`, s.URL); err != nil {
		t.Fatal(err)
	}
	r := NewRecoveryRunner(testEngine(db, root, "read-deadline"))
	r.readTimeout = 80 * time.Millisecond
	_, err := r.Run(context.Background(), false)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected failure: %v", err)
	}
	j, err := r.jobs.Snapshot()
	if err != nil || j.Mode != syncjob.Backoff || j.Failures != 1 || j.LastSuccessAt != 0 || writes.Load() != 0 {
		t.Fatalf("unsafe preflight result: %+v err=%v writes=%d", j, err, writes.Load())
	}
}

func TestRecoveryParentCancellationReleasesReadGuard(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var fast atomic.Bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if fast.Load() {
			w.WriteHeader(404)
			return
		}
		close(entered)
		select {
		case <-req.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?`, s.URL); err != nil {
		t.Fatal(err)
	}
	r := NewRecoveryRunner(testEngine(db, root, "cancel-read"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := r.Run(ctx, false); done <- err }()
	awaitContextSignal(t, entered)
	cancel()
	if err := awaitContextError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	j, err := r.jobs.Snapshot()
	if err != nil || j.Mode != syncjob.Idle || j.LastSuccessAt != 0 {
		t.Fatalf("cancel changed checkpoint: %+v %v", j, err)
	}
	fast.Store(true)
	if _, err := r.CheckRemote(context.Background()); err != nil {
		t.Fatalf("read guard was not released: %v", err)
	}
}

func TestRecoveryCancelledApplyingCannotAutoReplay(t *testing.T) {
	for _, byDeadline := range []bool{false, true} {
		name := "parent-cancel"
		if byDeadline {
			name = "operation-deadline"
		}
		t.Run(name, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			var mu sync.Mutex
			owner := webDAVLockPayload{}
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				switch req.Method {
				case "PROPFIND":
					w.WriteHeader(404)
				case "MKCOL":
					w.WriteHeader(201)
				case http.MethodPut:
					var value webDAVLockPayload
					if err := json.NewDecoder(req.Body).Decode(&value); err != nil {
						t.Error(err)
						return
					}
					mu.Lock()
					owner = value
					mu.Unlock()
					close(entered)
					select {
					case <-req.Context().Done():
					case <-release:
					}
				case http.MethodGet:
					mu.Lock()
					value := owner
					mu.Unlock()
					_ = json.NewEncoder(w).Encode(value)
				case http.MethodDelete:
					w.WriteHeader(204)
				default:
					t.Errorf("unexpected method %s", req.Method)
				}
			}))
			defer s.Close()
			defer close(release)
			db, root := testDB(t)
			addFile(t, db, "kept", "Kept", "unchanged", 10)
			if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1`, s.URL); err != nil {
				t.Fatal(err)
			}
			r := NewRecoveryRunner(testEngine(db, root, "cancel-applying"))
			if byDeadline {
				r.runTimeout = 250 * time.Millisecond
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := r.Run(ctx, false); done <- err }()
			awaitContextSignal(t, entered)
			if !byDeadline {
				cancel()
			}
			if err := awaitContextError(t, done); !errors.Is(err, syncjob.ErrReview) {
				t.Fatalf("not protected: %v", err)
			}
			j, err := r.jobs.Snapshot()
			if err != nil || j.Mode != syncjob.Review || j.LastSuccessAt != 0 {
				t.Fatalf("invalid checkpoint: %+v %v", j, err)
			}
			before := calls.Load()
			if _, err := r.AutoTick(context.Background()); !errors.Is(err, syncjob.ErrReview) {
				t.Fatalf("replayed uncertain write: %v", err)
			}
			if calls.Load() != before {
				t.Fatal("automatic attempt made network calls after cancellation")
			}
			if fileContent(t, db, "kept") != "unchanged" {
				t.Fatal("unexpected local content change")
			}
		})
	}
}

func TestRecoverySchedulerCancellationReachesInFlightProbe(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		close(entered)
		select {
		case <-req.Context().Done():
		case <-release:
		}
	}))
	defer s.Close()
	defer close(release)
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1`, s.URL); err != nil {
		t.Fatal(err)
	}
	r := NewRecoveryRunner(testEngine(db, root, "cancel-scheduler"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { RunRecoveryScheduler(ctx, r, 0, time.Hour); done <- nil }()
	awaitContextSignal(t, entered)
	cancel()
	awaitContextError(t, done)
	j, err := r.jobs.Snapshot()
	if err != nil || j.Mode != syncjob.Idle {
		t.Fatalf("scheduler entered write stage: %+v %v", j, err)
	}
}
