package appshutdown

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestParentExactCommand(t *testing.T) {
	if got := WaitParent(strings.NewReader("noise\n" + ParentCommand + "\n")); got != "parent-request" {
		t.Fatal(got)
	}
}
func TestParentEOFRequestsStop(t *testing.T) {
	if got := WaitParent(strings.NewReader("")); got != "parent-disconnected" {
		t.Fatal(got)
	}
}
func TestParentOversizedInputIsBounded(t *testing.T) {
	if got := WaitParent(strings.NewReader(strings.Repeat("x", 1024))); got != "parent-disconnected" {
		t.Fatal(got)
	}
}
func TestParentUnknownCommandDoesNotExecute(t *testing.T) {
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	done := make(chan string, 1)
	go func() { done <- WaitParent(r) }()
	if _, err := io.WriteString(w, "shutdown\n"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
		t.Fatal("accepted unrecognized command")
	default:
	}
	io.WriteString(w, ParentCommand+"\n")
	if got := <-done; got != "parent-request" {
		t.Fatal(got)
	}
}
func TestWaitTimeoutDoesNotPretendDrained(t *testing.T) {
	done := make(chan struct{})
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := Wait(ctx, done); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	select {
	case <-done:
		t.Fatal("timeout mutated barrier")
	default:
	}
	close(done)
	if err := Wait(context.Background(), done, nil); err != nil {
		t.Fatal(err)
	}
}
func TestWaitAllBarriers(t *testing.T) {
	a, b := make(chan struct{}), make(chan struct{})
	close(a)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Wait(ctx, a, b); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	close(b)
	if err := Wait(context.Background(), a, b); err != nil {
		t.Fatal(err)
	}
}
