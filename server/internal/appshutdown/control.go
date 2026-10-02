// Package appshutdown contains the private parent-pipe protocol and bounded
// drain barrier. It exposes no network endpoint and executes no input as code.
package appshutdown

import (
	"bufio"
	"context"
	"io"
)

const ParentCommand = "LOCAL_NOTEPAD_SHUTDOWN_V1"

// WaitParent is used ONLY when NOTEPAD_PARENT_STDIN=1. EOF means the managed
// parent has closed its private pipe. Ordinary CLI stdin is never monitored.
func WaitParent(input io.Reader) string {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 256), 256)
	for scanner.Scan() {
		if scanner.Text() == ParentCommand {
			return "parent-request"
		}
	}
	return "parent-disconnected"
}

// Wait does not close resources or erase recovery markers on timeout. The
// owner must distinguish deadline failure from successful completion.
func Wait(ctx context.Context, done ...<-chan struct{}) error {
	for _, ch := range done {
		if ch == nil {
			continue
		}
		select {
		case <-ch:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}
