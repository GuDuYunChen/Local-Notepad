package syncengine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"notepad-server/internal/syncjob"
)

func TestRecoveryShutdownRejectsAllNewManagedWork(t *testing.T) {
	r := NewRecoveryRunner(&Engine{DataDir: t.TempDir()}) // nil DB proves rejection precedes storage access
	ctx, op, err := r.beginOperation(context.Background(), "sync")
	if err != nil {
		t.Fatal(err)
	}
	done := r.Stop()
	if ctx.Err() != context.Canceled {
		t.Fatal("active operation not cancelled")
	}
	select {
	case <-done:
		t.Fatal("premature drain")
	default:
	}
	checks := []func() error{
		func() error { _, e := r.Run(context.Background(), false); return e },
		func() error { _, e := r.AutoTick(context.Background()); return e },
		func() error { _, e := r.CheckRemote(context.Background()); return e },
		func() error { _, e := r.Plan(context.Background()); return e },
		func() error { _, e := r.ConfigureAuto(context.Background(), false, 5); return e },
		func() error { _, e := r.ConfigureAuto(context.Background(), true, 5); return e },
		func() error { _, e := r.Rebind(context.Background()); return e },
		func() error { _, e := r.Status(context.Background()); return e },
		func() error { return r.Resolve(context.Background(), "id", "local") },
		func() error {
			return r.WithSettings(context.Background(), func(context.Context) error { t.Fatal("settings ran"); return nil })
		},
	}
	for i, check := range checks {
		if err := check(); !errors.Is(err, syncjob.ErrStopping) {
			t.Fatalf("entry %d: %v", i, err)
		}
	}
	op.Finish()
	<-done
	if r.Activity().Active {
		t.Fatal("activity not cleared after completion")
	}
}

func TestRecoveryShutdownWaitsForSettingsCallback(t *testing.T) {
	r := NewRecoveryRunner(&Engine{DataDir: t.TempDir()})
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(finished)
		_ = r.WithSettings(context.Background(), func(ctx context.Context) error { close(entered); <-ctx.Done(); <-release; return ctx.Err() })
	}()
	<-entered
	done := r.Stop()
	select {
	case <-done:
		t.Fatal("settings callback not drained")
	default:
	}
	close(release)
	<-finished
	<-done
}

func TestRecoveryShutdownCancelsHTTPAndPreservesCheckpoint(t *testing.T) {
	for _, writing := range []bool{false, true} {
		name := "preflight"
		if writing {
			name = "applying"
		}
		t.Run(name, func(t *testing.T) {
			entered := make(chan struct{})
			release := make(chan struct{})
			serverCancelled := make(chan struct{}, 1)
			var once sync.Once
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if writing && req.Method == "PROPFIND" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				// Consume the PROPFIND body before waiting for disconnect. Otherwise
				// net/http cannot start its background read and the test server can
				// wait forever even after the client correctly cancels the request.
				_, _ = io.Copy(io.Discard, req.Body)
				once.Do(func() { close(entered) })
				select {
				case <-req.Context().Done():
					select {
					case serverCancelled <- struct{}{}:
					default:
					}
				case <-release:
				}

			}))
			defer func() { close(release); srv.Close() }()
			db, root := testDB(t)
			if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?`, srv.URL+"/dav"); err != nil {
				t.Fatal(err)
			}
			r := NewRecoveryRunner(testEngine(db, root, "shutdown-device"))
			defer r.Stop()
			finished := make(chan error, 1)
			go func() { _, e := r.Run(context.Background(), false); finished <- e }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("network not entered")
			}
			done := r.Stop()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("shutdown failed to drain")
			}
			if err := <-finished; err == nil {
				t.Fatal("cancelled task reported success")
			}
			select {
			case <-serverCancelled:
			case <-time.After(3 * time.Second):
				t.Fatal("server did not observe request cancellation")
			}
			snapshot, err := (syncjob.FileStore{DataDir: root}).Load()
			if err != nil {
				t.Fatal(err)
			}
			if writing && snapshot.Mode != syncjob.Review {
				t.Fatalf("lost uncertain write: %+v", snapshot)
			}
			if !writing && snapshot.Mode != syncjob.Idle {
				t.Fatalf("read cancellation marked write: %+v", snapshot)
			}
			if snapshot.LastSuccessAt != 0 {
				t.Fatal("false success after cancellation")
			}
		})
	}
}
