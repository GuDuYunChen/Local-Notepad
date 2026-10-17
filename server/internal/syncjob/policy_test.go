package syncjob

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var scope = strings.Repeat("a", 64)

func classifyTest(error) Failure { return Failure{Kind: "temporary_remote", Retryable: true} }
func noop(context.Context) error { return nil }

type memoryStore struct {
	mu       sync.Mutex
	s        Snapshot
	failSave bool
	saves    int
	failAt   int
}

func (m *memoryStore) Load() (Snapshot, error) { m.mu.Lock(); defer m.mu.Unlock(); return m.s, nil }
func (m *memoryStore) Save(s Snapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.saves++
	if m.failSave || m.saves == m.failAt {
		return errors.New("private I/O error")
	}
	m.s = s
	return nil
}
func fixture() (*Coordinator, *memoryStore, *time.Time) {
	now := time.Unix(10000, 0)
	store := &memoryStore{s: Empty()}
	return New(store, func() time.Time { return now }), store, &now
}

func TestBackoffAndCap(t *testing.T) {
	for i, delay := range []int64{60, 120, 240, 480, 960, 1800, 1800} {
		if got := nextRetry(1000, i+1, time.Minute, 0); got != 1000+delay {
			t.Fatalf("%d => %d", i, got)
		}
	}
	if got := nextRetry(1000, 1, 15*time.Minute, 0); got != 1900 {
		t.Fatal(got)
	}
}
func TestLongRetryAfterAndOverflow(t *testing.T) {
	if got := nextRetry(1000, 32, time.Minute, 7200); got != 8200 {
		t.Fatal(got)
	}
	if got := nextRetry(1000, 1, time.Minute, math.MaxInt64); got != math.MaxInt64 {
		t.Fatal(got)
	}
}
func TestPreflightFailureNeverCallsApply(t *testing.T) {
	c, store, _ := fixture()
	applied := false
	err := c.Execute(context.Background(), scope, false, false, time.Minute, func(context.Context) error { return errors.New("503") }, func(context.Context) error { applied = true; return nil }, classifyTest)
	if err == nil || applied {
		t.Fatalf("%v %v", err, applied)
	}
	if store.s.Mode != Backoff || store.s.NextAttemptAt != 10060 || store.s.Failures != 1 {
		t.Fatal(store.s)
	}
}
func TestRetryDeadlineSurvivesNewCoordinator(t *testing.T) {
	dir := t.TempDir()
	store := FileStore{DataDir: dir}
	now := time.Unix(1000, 0)
	c := New(store, func() time.Time { return now })
	failure := func(error) Failure { return Failure{Kind: "rate_limit", Retryable: true, RetryAfterSeconds: 7200} }
	_ = c.Execute(context.Background(), scope, false, false, time.Minute, func(context.Context) error { return errors.New("429") }, noop, failure)
	restored := New(store, func() time.Time { return now.Add(time.Hour) })
	called := false
	err := restored.Execute(context.Background(), scope, true, false, time.Minute, func(context.Context) error { called = true; return nil }, noop, failure)
	var wait *RetryWait
	if !errors.As(err, &wait) || wait.Until != 8200 || called {
		t.Fatalf("%v %v", err, called)
	}
}
func TestDueProbeRecoversAndClearsFailureCount(t *testing.T) {
	c, store, now := fixture()
	_ = c.Execute(context.Background(), scope, false, false, time.Minute, func(context.Context) error { return errors.New("503") }, noop, classifyTest)
	*now = now.Add(time.Minute)
	if err := c.Execute(context.Background(), scope, false, false, time.Minute, noop, noop, classifyTest); err != nil {
		t.Fatal(err)
	}
	if store.s.Mode != Idle || store.s.Failures != 0 || store.s.LastSuccessAt != now.Unix() {
		t.Fatal(store.s)
	}
}
func TestAuthenticationBlocksAutomaticButAllowsManualProbe(t *testing.T) {
	c, store, _ := fixture()
	calls := 0
	classify := func(error) Failure { return Failure{Kind: "authentication"} }
	_ = c.Execute(context.Background(), scope, false, false, time.Minute, func(context.Context) error { return errors.New("401") }, noop, classify)
	if store.s.Mode != Blocked {
		t.Fatal(store.s)
	}
	if err := c.Execute(context.Background(), scope, false, false, time.Minute, func(context.Context) error { calls++; return nil }, noop, classify); !errors.Is(err, ErrBlocked) || calls != 0 {
		t.Fatal(err)
	}
	if err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, noop, classify); err != nil {
		t.Fatal(err)
	}
}
func TestMarkerExistsBeforeApply(t *testing.T) {
	c, store, _ := fixture()
	if err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, func(context.Context) error {
		s, _ := store.Load()
		if s.Mode != Applying {
			t.Fatal("write ran without durable guard")
		}
		return nil
	}, classifyTest); err != nil {
		t.Fatal(err)
	}
}
func TestWriteFailureNeverAutomaticallyReplays(t *testing.T) {
	c, store, _ := fixture()
	calls := 0
	err := c.Execute(context.Background(), scope, false, false, time.Minute, noop, func(context.Context) error { calls++; return errors.New("possibly committed") }, classifyTest)
	if !errors.Is(err, ErrReview) || store.s.Mode != Review {
		t.Fatal(err, store.s)
	}
	for i := 0; i < 10; i++ {
		err = c.Execute(context.Background(), scope, false, false, time.Minute, noop, func(context.Context) error { calls++; return nil }, classifyTest)
		if !errors.Is(err, ErrReview) {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
}
func TestProcessRestartLeavesApplyingBlocked(t *testing.T) {
	store := FileStore{DataDir: t.TempDir()}
	s := Empty()
	s.Scope = scope
	s.Mode = Applying
	if err := store.Save(s); err != nil {
		t.Fatal(err)
	}
	c := New(store, nil)
	if err := c.Execute(context.Background(), scope, false, false, time.Minute, noop, noop, classifyTest); !errors.Is(err, ErrReview) {
		t.Fatal(err)
	}
	if err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, noop, classifyTest); !errors.Is(err, ErrReview) {
		t.Fatal(err)
	}
	if err := c.Execute(context.Background(), scope, true, true, time.Minute, noop, noop, classifyTest); err != nil {
		t.Fatal(err)
	}
}
func TestFailedProbeCannotClearUncertainOutcome(t *testing.T) {
	c, store, _ := fixture()
	store.s.Scope = scope
	store.s.Mode = Review
	err := c.Execute(context.Background(), scope, true, true, time.Minute, func(context.Context) error { return errors.New("503") }, noop, classifyTest)
	if !errors.Is(err, ErrReview) || store.s.Mode != Review {
		t.Fatal(err, store.s)
	}
}
func TestConfigChangeDoesNotClearUncertainOutcome(t *testing.T) {
	c, store, _ := fixture()
	store.s.Scope = scope
	store.s.Mode = Applying
	err := c.Execute(context.Background(), strings.Repeat("b", 64), false, false, time.Minute, noop, noop, classifyTest)
	if !errors.Is(err, ErrReview) {
		t.Fatal(err)
	}
}
func TestJournalFailurePreventsWrites(t *testing.T) {
	c, store, _ := fixture()
	store.failSave = true
	applied := false
	err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, func(context.Context) error { applied = true; return nil }, classifyTest)
	if !errors.Is(err, ErrJournal) || applied {
		t.Fatal(err, applied)
	}
}
func TestCompletionSaveFailureKeepsApplying(t *testing.T) {
	c, store, _ := fixture()
	store.failAt = 2
	err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, noop, classifyTest)
	if !errors.Is(err, ErrJournal) || store.s.Mode != Applying {
		t.Fatal(err, store.s)
	}
}
func TestCancelledBeforeApplyDoesNotWrite(t *testing.T) {
	c, _, _ := fixture()
	ctx, cancel := context.WithCancel(context.Background())
	applied := false
	err := c.Execute(ctx, scope, true, false, time.Minute, func(context.Context) error { cancel(); return nil }, func(context.Context) error { applied = true; return nil }, classifyTest)
	if !errors.Is(err, context.Canceled) || applied {
		t.Fatal(err, applied)
	}
}
func TestSingleFlightAndMetadataSerialization(t *testing.T) {
	c, _, _ := fixture()
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- c.Execute(context.Background(), scope, true, false, time.Minute, func(context.Context) error { close(entered); <-release; return nil }, noop, classifyTest)
	}()
	<-entered
	if err := c.Execute(context.Background(), scope, true, false, time.Minute, noop, noop, classifyTest); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if err := c.Read(context.Background(), scope, noop); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if err := c.Exclusive(context.Background(), true, noop); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestReadDoesNotUnlockReview(t *testing.T) {
	c, store, _ := fixture()
	store.s.Scope = scope
	store.s.Mode = Review
	if err := c.Read(context.Background(), scope, noop); err != nil {
		t.Fatal(err)
	}
	if store.s.Mode != Review {
		t.Fatal(store.s)
	}
}
func TestExplicitRebindClearsOnlyAfterSuccess(t *testing.T) {
	c, store, _ := fixture()
	store.s.Scope = scope
	store.s.Mode = Review
	_ = c.Exclusive(context.Background(), true, func(context.Context) error { return errors.New("failed") })
	if store.s.Mode != Review {
		t.Fatal(store.s)
	}
	if err := c.Exclusive(context.Background(), true, noop); err != nil {
		t.Fatal(err)
	}
	if store.s.Mode != Idle {
		t.Fatal(store.s)
	}
}
func TestFileJournalRejectsMalformedOversizedAndUnknownVersion(t *testing.T) {
	dir := t.TempDir()
	f := FileStore{DataDir: dir}
	if err := f.Save(Empty()); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "sync-runtime", "job.json")
	for _, raw := range []string{"", `{"version":99,"mode":"idle"}`, `{"version":1,"mode":"idle","extra":true}`, strings.Repeat("x", 9000), `{"version":1,"mode":"idle"}{}`} {
		if err := os.WriteFile(target, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := f.Load(); !errors.Is(err, ErrJournal) {
			t.Fatalf("accepted invalid data: %v", err)
		}
	}
}
func TestFileJournalRoundTripAndNoSensitiveFields(t *testing.T) {
	dir := t.TempDir()
	f := FileStore{DataDir: dir}
	s := Empty()
	s.Scope = scope
	s.Mode = Backoff
	s.Failures = 2
	s.NextAttemptAt = 1234
	s.FailureKind = "temporary_remote"
	if err := f.Save(s); err != nil {
		t.Fatal(err)
	}
	got, err := f.Load()
	if err != nil || got != s {
		t.Fatal(err, got)
	}
	if err = f.Save(Empty()); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "sync-runtime", "job.json"))
	for _, sensitive := range []string{"password", "endpoint", "username", "content", "title"} {
		if strings.Contains(string(data), sensitive) {
			t.Fatal(sensitive)
		}
	}
}
func TestFileJournalRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	runtimeDir := filepath.Join(dir, "sync-runtime")
	if err := os.Mkdir(runtimeDir, 0700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(runtimeDir, "job.json")
	if err := os.Symlink(outside, target); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	f := FileStore{DataDir: dir}
	if _, err := f.Load(); err == nil {
		t.Fatal("followed symlink")
	}
	if err := f.Save(Empty()); err == nil {
		t.Fatal("overwrote symlink")
	}
	data, _ := os.ReadFile(outside)
	if string(data) != "unchanged" {
		t.Fatal("outside file changed")
	}
}
