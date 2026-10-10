package syncjob

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var (
	ErrActivityBusy = errors.New("同步操作正在执行，请稍后重试")
	ErrActivityID   = errors.New("取消请求必须指定有效的同步任务编号")
)

// Activity is ephemeral, not a recovery checkpoint or an assertion about commits.
// Never include endpoints, credentials or note content in this public snapshot.
type Activity struct {
	Active          bool   `json:"active"`
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Phase           string `json:"phase"`
	StartedAt       int64  `json:"started_at"`
	CancelRequested bool   `json:"cancel_requested"`
}
type CancelReceipt struct {
	ID       string `json:"id"`
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason"`
}

// ActivityTracker has its own short-lived mutex: neither a database transaction
// nor the coordinator's task gate is needed to read it or request cancellation.
// The zero value is ready to use; one tracker belongs to one managed backend.
type ActivityTracker struct {
	mu      sync.Mutex
	current Activity
	cancel  context.CancelFunc
}
type Operation struct {
	tracker *ActivityTracker
	id      string
	once    sync.Once
}

func (t *ActivityTracker) Begin(parent context.Context, kind string, now time.Time) (context.Context, *Operation, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	if t.current.Active {
		return nil, nil, ErrActivityBusy
	}
	switch kind {
	case "sync", "auto-sync", "check", "plan", "enable-auto", "resolve":
	default:
		return nil, nil, errors.New("同步任务类型无效")
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return nil, nil, errors.New("无法创建同步任务编号")
	}
	id := hex.EncodeToString(raw[:])
	ctx, cancel := context.WithCancel(parent)
	t.current = Activity{Active: true, ID: id, Kind: kind, Phase: "preflight", StartedAt: now.Unix()}
	t.cancel = cancel
	return ctx, &Operation{tracker: t, id: id}, nil
}
func (t *ActivityTracker) Snapshot() Activity {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.current
}
func (t *ActivityTracker) Cancel(id string) (CancelReceipt, error) {
	if len(id) != 32 {
		return CancelReceipt{}, ErrActivityID
	}
	if _, err := hex.DecodeString(id); err != nil {
		return CancelReceipt{}, ErrActivityID
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	receipt := CancelReceipt{ID: id, Reason: "not-active"}
	if !t.current.Active || t.current.ID != id {
		return receipt, nil
	}
	receipt.Accepted = true
	receipt.Reason = "requested"
	if t.current.CancelRequested {
		receipt.Reason = "already-requested"
	}
	t.current.CancelRequested = true
	// A CancelFunc signals cancellation; it does not wait for task cleanup.
	t.cancel()
	return receipt, nil
}
func (o *Operation) Applying() {
	t := o.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.current.ID == o.id {
		t.current.Phase = "applying"
	}
}
func (o *Operation) Finish() {
	o.once.Do(func() {
		t := o.tracker
		t.mu.Lock()
		defer t.mu.Unlock()
		if t.current.ID == o.id {
			t.cancel()
			t.current = Activity{}
			t.cancel = nil
		}
	})
}
