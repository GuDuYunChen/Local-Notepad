package syncjob

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestLifecycleStopFreezesBeforeDrain(t *testing.T) {
	var l Lifecycle
	ctx, finish, err := l.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	done := l.Stop()
	if ctx.Err() != context.Canceled {
		t.Fatal("work not cancelled")
	}
	if _, _, err = l.Begin(context.Background()); !errors.Is(err, ErrStopping) {
		t.Fatal(err)
	}
	select {
	case <-done:
		t.Fatal("cancel was mistaken for completion")
	default:
	}
	finish()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("drain not completed")
	}
	finish()
	if l.Stop() != done {
		t.Fatal("non-idempotent stop")
	}
}

func TestLifecycleAlreadyCancelledIsNotAdmitted(t *testing.T) {
	var l Lifecycle
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := l.Begin(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	select {
	case <-l.Stop():
	default:
		t.Fatal("rejected call leaked")
	}
}

func TestLifecycleStopEmptyIsPermanent(t *testing.T) {
	var l Lifecycle
	select {
	case <-l.Stop():
	default:
		t.Fatal("empty lifecycle blocked")
	}
	if _, _, err := l.Begin(context.Background()); !errors.Is(err, ErrStopping) {
		t.Fatal(err)
	}
}

func TestLifecycleWaitsForAllAndIgnoresLateFinish(t *testing.T) {
	var l Lifecycle
	_, a, _ := l.Begin(context.Background())
	_, b, _ := l.Begin(context.Background())
	a()
	a()
	ctx, c, _ := l.Begin(context.Background())
	done := l.Stop()
	a()
	b()
	if ctx.Err() != context.Canceled {
		t.Fatal("newer work not cancelled")
	}
	select {
	case <-done:
		t.Fatal("late finish released another caller")
	default:
	}
	c()
	<-done
}

func TestLifecycleCallerCancellationStillRequiresFinish(t *testing.T) {
	var l Lifecycle
	parent, cancel := context.WithCancel(context.Background())
	_, finish, _ := l.Begin(parent)
	cancel()
	done := l.Stop()
	select {
	case <-done:
		t.Fatal("cancel prematurely drained")
	default:
	}
	finish()
	<-done
}

func TestLifecycleAdmissionStopRace(t *testing.T) {
	var l Lifecycle
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			ctx, finish, err := l.Begin(context.Background())
			if errors.Is(err, ErrStopping) {
				return
			}
			if err != nil {
				t.Error(err)
				return
			}
			<-ctx.Done()
			finish()
			finish()
		}()
	}
	close(start)
	done := l.Stop()
	wg.Wait()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("admission race leaked")
	}
}

func TestLifecycleConcurrentStopReturnsSameBarrier(t *testing.T) {
	var l Lifecycle
	_, finish, _ := l.Begin(context.Background())
	const n = 20
	channels := make(chan (<-chan struct{}), n)
	for i := 0; i < n; i++ {
		go func() { channels <- l.Stop() }()
	}
	first := <-channels
	for i := 1; i < n; i++ {
		if <-channels != first {
			t.Fatal("different barriers")
		}
	}
	finish()
	<-first
}

func TestLifecycleSealDrainsWithoutCancellingLocalSave(t *testing.T) {
	var l Lifecycle
	ctx, finish, _ := l.Begin(context.Background())
	done := l.Seal()
	if ctx.Err() != nil {
		t.Fatal("seal cancelled accepted local work")
	}
	if _, _, err := l.Begin(context.Background()); !errors.Is(err, ErrStopping) {
		t.Fatal(err)
	}
	select {
	case <-done:
		t.Fatal("save not yet complete")
	default:
	}
	finish()
	<-done
}
func TestLifecycleStopAfterSealCancelsInFlight(t *testing.T) {
	var l Lifecycle
	ctx, finish, _ := l.Begin(context.Background())
	sealed := l.Seal()
	if l.Stop() != sealed || ctx.Err() != context.Canceled {
		t.Fatal("stop after seal")
	}
	finish()
	<-sealed
}
