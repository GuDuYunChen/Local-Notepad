package syncjob

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestActivityLifecycle(t *testing.T) {
	var tracker ActivityTracker
	if tracker.Snapshot().Active {
		t.Fatal("zero tracker is active")
	}
	ctx, op, err := tracker.Begin(context.Background(), "sync", time.Unix(42, 0))
	if err != nil {
		t.Fatal(err)
	}
	defer op.Finish()
	a := tracker.Snapshot()
	if !a.Active || len(a.ID) != 32 || a.Kind != "sync" || a.Phase != "preflight" || a.StartedAt != 42 {
		t.Fatalf("%+v", a)
	}
	op.Applying()
	if tracker.Snapshot().Phase != "applying" {
		t.Fatal("phase not advanced")
	}
	receipt, err := tracker.Cancel(a.ID)
	if err != nil || !receipt.Accepted || receipt.Reason != "requested" {
		t.Fatalf("%+v %v", receipt, err)
	}
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("not propagated")
	}
	if !tracker.Snapshot().Active || !tracker.Snapshot().CancelRequested {
		t.Fatal("cancel released task before cleanup")
	}
	op.Finish()
	if tracker.Snapshot().Active {
		t.Fatal("finished still active")
	}
}
func TestActivityRejectsConcurrentStart(t *testing.T) {
	var tr ActivityTracker
	_, op, _ := tr.Begin(context.Background(), "sync", time.Now())
	defer op.Finish()
	if _, _, err := tr.Begin(context.Background(), "check", time.Now()); !errors.Is(err, ErrActivityBusy) {
		t.Fatal(err)
	}
}
func TestActivityRepeatedCancelIsIdempotent(t *testing.T) {
	var tr ActivityTracker
	_, op, _ := tr.Begin(context.Background(), "plan", time.Now())
	defer op.Finish()
	id := tr.Snapshot().ID
	_, _ = tr.Cancel(id)
	got, err := tr.Cancel(id)
	if err != nil || !got.Accepted || got.Reason != "already-requested" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestActivityStaleCancelDoesNotTouchNextOperation(t *testing.T) {
	var tr ActivityTracker
	_, old, _ := tr.Begin(context.Background(), "sync", time.Now())
	id := tr.Snapshot().ID
	old.Finish()
	ctx, next, _ := tr.Begin(context.Background(), "check", time.Now())
	defer next.Finish()
	got, err := tr.Cancel(id)
	if err != nil || got.Accepted || ctx.Err() != nil || tr.Snapshot().CancelRequested {
		t.Fatal("stale cancellation touched new work")
	}
	old.Finish()
	old.Applying()
	if tr.Snapshot().Phase != "preflight" || !tr.Snapshot().Active {
		t.Fatal("old handle touched new work")
	}
}
func TestActivityUnknownAndMalformedIDsAreHarmless(t *testing.T) {
	var tr ActivityTracker
	ctx, op, _ := tr.Begin(context.Background(), "sync", time.Now())
	defer op.Finish()
	for _, id := range []string{"", "*", strings.Repeat("z", 32), " ../"} {
		if _, err := tr.Cancel(id); !errors.Is(err, ErrActivityID) {
			t.Fatal(id, err)
		}
	}
	got, err := tr.Cancel(strings.Repeat("0", 32))
	if err != nil || got.Accepted || ctx.Err() != nil {
		t.Fatal("unknown ID not harmless")
	}
}
func TestActivityParentCancellationKeepsRegistrationUntilFinish(t *testing.T) {
	var tr ActivityTracker
	parent, cancel := context.WithCancel(context.Background())
	ctx, op, _ := tr.Begin(parent, "check", time.Now())
	defer op.Finish()
	cancel()
	if ctx.Err() == nil || !tr.Snapshot().Active {
		t.Fatal("parent cancellation semantics")
	}
}
func TestActivityHonorsShorterDeadline(t *testing.T) {
	var tr ActivityTracker
	parent, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ctx, op, _ := tr.Begin(parent, "check", time.Now())
	defer op.Finish()
	want, _ := parent.Deadline()
	got, _ := ctx.Deadline()
	if !got.Equal(want) {
		t.Fatal("deadline extended")
	}
}
func TestActivityDoesNotStartCancelledParent(t *testing.T) {
	var tr ActivityTracker
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := tr.Begin(ctx, "check", time.Now()); !errors.Is(err, context.Canceled) || tr.Snapshot().Active {
		t.Fatal(err)
	}
}
func TestActivityAllowsOnlyKnownKinds(t *testing.T) {
	var tr ActivityTracker
	if _, _, err := tr.Begin(context.Background(), "https://private/password", time.Now()); err == nil {
		t.Fatal("accepted private kind")
	}
	if tr.Snapshot().Active {
		t.Fatal("invalid begin persisted")
	}
}
func TestActivityConcurrentCancelAndSnapshot(t *testing.T) {
	var tr ActivityTracker
	_, op, _ := tr.Begin(context.Background(), "auto-sync", time.Now())
	defer op.Finish()
	id := tr.Snapshot().ID
	var wg sync.WaitGroup
	for i := 0; i < 80; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = tr.Cancel(id); _ = tr.Snapshot(); op.Applying() }()
	}
	wg.Wait()
	if !tr.Snapshot().CancelRequested {
		t.Fatal("lost cancellation")
	}
}
func TestActivityFinishAndCancelRaceDoesNotAffectNewWork(t *testing.T) {
	var tr ActivityTracker
	for i := 0; i < 30; i++ {
		_, op, _ := tr.Begin(context.Background(), "resolve", time.Now())
		id := tr.Snapshot().ID
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = tr.Cancel(id) }()
		go func() { defer wg.Done(); op.Finish() }()
		wg.Wait()
		ctx, next, err := tr.Begin(context.Background(), "sync", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		_, _ = tr.Cancel(id)
		if ctx.Err() != nil {
			t.Fatal("cancelled successor")
		}
		next.Finish()
	}
}
func TestActivityJSONHasOnlyPublicMetadata(t *testing.T) {
	var tr ActivityTracker
	_, op, _ := tr.Begin(context.Background(), "resolve", time.Now())
	defer op.Finish()
	raw, _ := json.Marshal(tr.Snapshot())
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 6 {
		t.Fatalf("unexpected snapshot: %s", raw)
	}
	for _, name := range []string{"active", "id", "kind", "phase", "started_at", "cancel_requested"} {
		if _, ok := fields[name]; !ok {
			t.Fatal(name)
		}
	}
}
