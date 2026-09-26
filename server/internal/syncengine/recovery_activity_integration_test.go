package syncengine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncjob"
)

func awaitActivitySignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("request never reached server")
	}
}
func awaitActivityError(t *testing.T, ch <-chan error) error {
	t.Helper()
	select {
	case err := <-ch:
		return err
	case <-time.After(4 * time.Second):
		t.Fatal("cancelled operation did not return")
		return nil
	}
}
func TestRunnerActivityCancelPreflightWithoutEnteringApply(t *testing.T) {
	reached := make(chan struct{})
	var once sync.Once
	var writes atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if r.Method != "PROPFIND" {
			writes.Add(1)
			w.WriteHeader(500)
			return
		}
		once.Do(func() { close(reached) })
		<-r.Context().Done()
	}))
	defer srv.Close()
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?`, srv.URL+"/notes"); err != nil {
		t.Fatal(err)
	}
	runner := NewRecoveryRunner(testEngine(db, root, "a"))
	parent, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := runner.Run(parent, false); done <- err }()
	awaitActivitySignal(t, reached)
	a := runner.Activity()
	if !a.Active || a.Kind != "sync" || a.Phase != "preflight" {
		t.Fatalf("%+v", a)
	}
	receipt, err := runner.CancelCurrent(a.ID)
	if err != nil || !receipt.Accepted {
		t.Fatalf("%+v %v", receipt, err)
	}
	if err = awaitActivityError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if runner.Activity().Active || writes.Load() != 0 {
		t.Fatal("active or wrote after preflight cancellation")
	}
	checkpoint, err := runner.jobs.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.Mode != syncjob.Idle || checkpoint.LastSuccessAt != 0 || checkpoint.Failures != 0 {
		t.Fatalf("%+v", checkpoint)
	}
}
func TestRunnerActivityCancelApplyingKeepsReviewAndBypassesDatabase(t *testing.T) {
	reached := make(chan struct{})
	var once sync.Once
	var writes atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if r.Method == "PROPFIND" {
			w.WriteHeader(404)
			return
		}
		if r.Method == "MKCOL" {
			writes.Add(1)
			once.Do(func() { close(reached) })
			<-r.Context().Done()
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=1`, srv.URL+"/notes"); err != nil {
		t.Fatal(err)
	}
	runner := NewRecoveryRunner(testEngine(db, root, "a"))
	parent, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := runner.Run(parent, false); done <- err }()
	awaitActivitySignal(t, reached)
	// Holding the single DB connection must not block the in-memory cancel path.
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	a := runner.Activity()
	if a.Phase != "applying" {
		t.Fatalf("%+v", a)
	}
	acknowledged := make(chan bool, 1)
	go func() { receipt, e := runner.CancelCurrent(a.ID); acknowledged <- e == nil && receipt.Accepted }()
	select {
	case ok := <-acknowledged:
		if !ok {
			t.Fatal("cancel rejected")
		}
	case <-time.After(time.Second):
		t.Fatal("cancel blocked behind DB")
	}
	_ = tx.Rollback()
	if err = awaitActivityError(t, done); !errors.Is(err, syncjob.ErrReview) {
		t.Fatal(err)
	}
	j, err := runner.jobs.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if j.Mode != syncjob.Review || j.LastSuccessAt != 0 || runner.Activity().Active {
		t.Fatalf("%+v", j)
	}
	count := writes.Load()
	next, err := runner.AutoTick(context.Background())
	if !errors.Is(err, syncjob.ErrReview) || next.Ran || writes.Load() != count {
		t.Fatalf("replayed: %+v %v", next, err)
	}
}
func TestRunnerStaleCancelDoesNotCancelNextRead(t *testing.T) {
	reached := make(chan struct{}, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		reached <- struct{}{}
		<-r.Context().Done()
	}))
	defer srv.Close()
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?`, srv.URL+"/notes"); err != nil {
		t.Fatal(err)
	}
	runner := NewRecoveryRunner(testEngine(db, root, "a"))
	parent, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	done := make(chan error, 1)
	launch := func() {
		go func() { _, err := runner.CheckRemote(parent); done <- err }()
		awaitActivitySignal(t, reached)
	}
	launch()
	old := runner.Activity().ID
	_, _ = runner.CancelCurrent(old)
	_ = awaitActivityError(t, done)
	launch()
	next := runner.Activity()
	receipt, err := runner.CancelCurrent(old)
	if err != nil || receipt.Accepted || next.ID == old || runner.Activity().CancelRequested {
		t.Fatal("stale request affected next task")
	}
	if _, err = runner.Plan(parent); !errors.Is(err, syncjob.ErrBusy) {
		t.Fatalf("concurrent entry: %v", err)
	}
	_, _ = runner.CancelCurrent(next.ID)
	if err = awaitActivityError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestRunnerCancelAutoEnableLeavesPreferenceOff(t *testing.T) {
	reached := make(chan struct{})
	var once sync.Once
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		once.Do(func() { close(reached) })
		<-r.Context().Done()
	}))
	defer srv.Close()
	db, root := testDB(t)
	if _, err := db.Exec(`UPDATE settings SET sync_provider='webdav',sync_endpoint=?,sync_auto_enabled=0`, srv.URL+"/notes"); err != nil {
		t.Fatal(err)
	}
	runner := NewRecoveryRunner(testEngine(db, root, "a"))
	parent, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := runner.ConfigureAuto(parent, true, 5); done <- err }()
	awaitActivitySignal(t, reached)
	a := runner.Activity()
	if a.Kind != "enable-auto" {
		t.Fatalf("%+v", a)
	}
	_, _ = runner.CancelCurrent(a.ID)
	if err := awaitActivityError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	var enabled int
	if err := db.QueryRow(`SELECT sync_auto_enabled FROM settings WHERE id=1`).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled != 0 {
		t.Fatal("cancelled validation enabled auto sync")
	}
}
