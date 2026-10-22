package syncengine

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	xwebdav "golang.org/x/net/webdav"
	"notepad-server/internal/syncjob"
)

func TestRecoveryPreflightRetryAfterSurvivesRestart(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Retry-After", "7200")
		w.WriteHeader(429)
	}))
	defer server.Close()
	db, root := testDB(t)
	_, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1,sync_interval_minutes=1`, server.URL+"/dav")
	if err != nil {
		t.Fatal(err)
	}
	e := testEngine(db, root, "retry-device")
	runner := NewRecoveryRunner(e)
	if _, err = runner.AutoTick(context.Background()); err == nil {
		t.Fatal("expected rate limit")
	}
	state, err := runner.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.Recovery.Mode != syncjob.Backoff || state.Recovery.NextAttemptAt != e.now().Unix()+7200 {
		t.Fatal(state)
	}
	before := requests.Load()
	again := NewRecoveryRunner(e)
	_, err = again.AutoTick(context.Background())
	var wait *syncjob.RetryWait
	if !errors.As(err, &wait) || requests.Load() != before {
		t.Fatal("restart ignored Retry-After", err)
	}
}
func TestRecoveryApplyFailureRequiresManualAcknowledgement(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	var writes atomic.Int32
	h := &xwebdav.Handler{Prefix: "/", FileSystem: xwebdav.Dir(t.TempDir()), LockSystem: xwebdav.NewMemLS()}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "MKCOL" {
			writes.Add(1)
			if fail.Load() {
				http.Error(w, "error", 503)
				return
			}
		}
		h.ServeHTTP(w, r)
	}))
	defer server.Close()
	db, root := testDB(t)
	addFile(t, db, "n-recovery", "Recovery", "keep", 10)
	_, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1,sync_interval_minutes=1`, server.URL+"/dav")
	if err != nil {
		t.Fatal(err)
	}
	e := testEngine(db, root, "write-device")
	runner := NewRecoveryRunner(e)
	if _, err = runner.Run(context.Background(), false); !errors.Is(err, syncjob.ErrReview) {
		t.Fatal(err)
	}
	before := writes.Load()
	runner = NewRecoveryRunner(e)
	fail.Store(false)
	if _, err = runner.AutoTick(context.Background()); !errors.Is(err, syncjob.ErrReview) {
		t.Fatal(err)
	}
	if _, err = runner.Run(context.Background(), false); !errors.Is(err, syncjob.ErrReview) {
		t.Fatal(err)
	}
	if writes.Load() != before {
		t.Fatal("ambiguous attempt auto-replayed")
	}
	result, err := runner.Run(context.Background(), true)
	if err != nil || result.AppliedUp != 1 {
		t.Fatal(result, err)
	}
	state, err := runner.Status(context.Background())
	if err != nil || state.Recovery.Mode != syncjob.Idle || state.Recovery.LastSuccessAt == 0 {
		t.Fatal(state, err)
	}
	if fileContent(t, db, "n-recovery") != "keep" {
		t.Fatal("local note changed")
	}
}
func TestRecoverySettingsAndRebindShareGuard(t *testing.T) {
	db, root := testDB(t)
	runner := NewRecoveryRunner(testEngine(db, root, "guard-device"))
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- runner.WithSettings(context.Background(), func(context.Context) error { close(entered); <-release; return nil })
	}()
	<-entered
	if _, err := runner.Rebind(context.Background()); !errors.Is(err, syncjob.ErrBusy) {
		t.Fatal(err)
	}
	if _, err := runner.Run(context.Background(), false); !errors.Is(err, syncjob.ErrBusy) {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestRecoveryReadDoesNotClearCrashMarker(t *testing.T) {
	db, root := testDB(t)
	runner := NewRecoveryRunner(testEngine(db, root, "crash-device"))
	scope, err := runner.scope(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	record := syncjob.Empty()
	record.Scope = scope
	record.Mode = syncjob.Applying
	if err = (syncjob.FileStore{DataDir: root}).Save(record); err != nil {
		t.Fatal(err)
	}
	if _, err = runner.CheckRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, err := runner.Status(context.Background())
	if err != nil || state.Recovery.Mode != syncjob.Applying {
		t.Fatal(state, err)
	}
}
func TestRecoveryClassifierIsConservative(t *testing.T) {
	for _, code := range []int{401, 403, 404, 507} {
		if classifySyncJobFailure(&WebDAVHTTPError{StatusCode: code}).Retryable {
			t.Fatal(code)
		}
	}
	if f := classifySyncJobFailure(&WebDAVHTTPError{StatusCode: 429, RetryAfterSeconds: 600}); !f.Retryable || f.RetryAfterSeconds != 600 {
		t.Fatal(f)
	}
	if classifySyncJobFailure(errors.New("bad manifest sha256")).Retryable {
		t.Fatal("unknown failure was retryable")
	}
}
func TestRecoverySuccessfulLocalRunKeepsExistingSemantics(t *testing.T) {
	db, root := testDB(t)
	addFile(t, db, "n-local", "Local", "content", 10)
	runner := NewRecoveryRunner(testEngine(db, root, "local-device"))
	result, err := runner.Run(context.Background(), false)
	if err != nil || result.AppliedUp != 1 {
		t.Fatal(result, err)
	}
	state, err := runner.Status(context.Background())
	if err != nil || state.BaseItems != 1 || state.Recovery.Mode != syncjob.Idle {
		t.Fatal(state, err)
	}
	if _, err = runner.Rebind(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, err = runner.Status(context.Background())
	if err != nil || state.BaseItems != 0 || state.Recovery.Mode != syncjob.Idle {
		t.Fatal(state, err)
	}
	if fileContent(t, db, "n-local") != "content" {
		t.Fatal("rebind removed content")
	}
}
func TestRecoveryCorruptJournalBlocksRunButStatusReportsProblem(t *testing.T) {
	db, root := testDB(t)
	runner := NewRecoveryRunner(testEngine(db, root, "corrupt-device"))
	if err := os.Mkdir(filepath.Join(root, "sync-runtime"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sync-runtime", "job.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Run(context.Background(), false); !errors.Is(err, syncjob.ErrJournal) {
		t.Fatal(err)
	}
	state, err := runner.Status(context.Background())
	if err != nil || state.LastStatus != "recovery_blocked" {
		t.Fatal(state, err)
	}
}
func TestRecoverySchedulerCancelledBeforeStartDoesNothing(t *testing.T) {
	db, root := testDB(t)
	runner := NewRecoveryRunner(testEngine(db, root, "cancel-device"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	RunRecoveryScheduler(ctx, runner, time.Hour, time.Second)
	if _, err := os.Stat(filepath.Join(root, "sync-runtime")); !os.IsNotExist(err) {
		t.Fatal("cancelled scheduler wrote journal")
	}
}
