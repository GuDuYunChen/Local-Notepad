// Package syncjob protects task boundaries; it never replays a possibly-mutating
// task automatically. It is independent of the database and WebDAV transport.
package syncjob

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"
)

const Version = 1
const (
	Idle     = "idle"
	Backoff  = "backoff"
	Blocked  = "blocked"
	Applying = "applying"
	Review   = "review_required"
)

var (
	ErrBusy    = errors.New("同步操作正在执行，请稍后重试")
	ErrReview  = errors.New("上次同步的写入结果待确认；请核查两端数据后明确确认手动重试")
	ErrBlocked = errors.New("自动同步已暂停，请修复连接配置后手动验证或同步")
	ErrJournal = errors.New("同步恢复记录无法安全读取或保存，已停止本次同步")
)

type Snapshot struct {
	Version       int    `json:"version"`
	Scope         string `json:"scope"`
	Mode          string `json:"mode"`
	Failures      int    `json:"consecutive_failures"`
	NextAttemptAt int64  `json:"next_attempt_at"`
	LastAttemptAt int64  `json:"last_attempt_at"`
	LastSuccessAt int64  `json:"last_success_at"`
	FailureKind   string `json:"failure_kind"`
}

// Failure contains only a fixed classification and protocol delay, not raw error
// messages, credentials, URLs, titles or document content.
type Failure struct {
	Kind              string
	Retryable         bool
	RetryAfterSeconds int64
}

type Store interface {
	Load() (Snapshot, error)
	Save(Snapshot) error
}

type RetryWait struct{ Until int64 }

func (e *RetryWait) Error() string {
	return fmt.Sprintf("同步暂缓，最早重试时间：%s", time.Unix(e.Until, 0).UTC().Format(time.RFC3339))
}

type Coordinator struct {
	store Store
	now   func() time.Time
	mu    sync.Mutex
}

func New(store Store, now func() time.Time) *Coordinator {
	if now == nil {
		now = time.Now
	}
	return &Coordinator{store: store, now: now}
}
func Empty() Snapshot { return Snapshot{Version: Version, Mode: Idle} }
func (c *Coordinator) Snapshot() (Snapshot, error) {
	s, err := c.store.Load()
	if err != nil {
		return Snapshot{}, ErrJournal
	}
	if err = s.Validate(); err != nil {
		return Snapshot{}, ErrJournal
	}
	return s, nil
}
func (s Snapshot) Validate() error {
	if s.Version != Version || s.Failures < 0 || s.Failures > 32 || s.NextAttemptAt < 0 || s.LastAttemptAt < 0 || s.LastSuccessAt < 0 {
		return ErrJournal
	}
	switch s.Mode {
	case Idle, Backoff, Blocked, Applying, Review:
	default:
		return ErrJournal
	}
	if s.Mode != Idle && len(s.Scope) != 64 {
		return ErrJournal
	}
	for _, r := range s.Scope {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return ErrJournal
		}
	}
	if s.Scope != "" && len(s.Scope) != 64 {
		return ErrJournal
	}
	switch s.FailureKind {
	case "", "authentication", "permission", "rate_limit", "temporary_remote", "temporary_network", "tls", "storage", "configuration", "cancelled", "unknown", "outcome_unknown":
	default:
		return ErrJournal
	}
	if s.Mode == Backoff && s.NextAttemptAt == 0 {
		return ErrJournal
	}
	return nil
}
func (c *Coordinator) save(s Snapshot) error {
	if err := s.Validate(); err != nil {
		return ErrJournal
	}
	if err := c.store.Save(s); err != nil {
		return ErrJournal
	}
	return nil
}

// nextRetry preserves a server's longer Retry-After rather than capping it to
// the local backoff. Saturation can only postpone work, never wrap to immediate.
func nextRetry(now int64, failures int, interval time.Duration, hint int64) int64 {
	seconds := int64(60)
	for i := 1; i < failures && seconds < 1800; i++ {
		seconds *= 2
	}
	if seconds > 1800 {
		seconds = 1800
	}
	if n := int64((interval + time.Second - 1) / time.Second); n > seconds {
		seconds = n
	}
	if hint > seconds {
		seconds = hint
	}
	if now < 0 {
		now = 0
	}
	if seconds > math.MaxInt64-now {
		return math.MaxInt64
	}
	return now + seconds
}

// Execute retries only the read-only preflight automatically. Once apply is
// entered, every failure (including cancellation) requires an explicit manual
// acknowledgement. An Applying journal left by process termination is handled
// identically. Manual operations still obey an outstanding Retry-After deadline.
func (c *Coordinator) Execute(ctx context.Context, scope string, manual, acknowledged bool, interval time.Duration,
	probe func(context.Context) error, apply func(context.Context) error, classify func(error) Failure) error {
	if !c.mu.TryLock() {
		return ErrBusy
	}
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	s, err := c.Snapshot()
	if err != nil {
		return err
	}
	uncertain := s.Mode == Applying || s.Mode == Review
	if uncertain && (!manual || !acknowledged) {
		return ErrReview
	}
	if s.Scope != scope && !uncertain {
		s = Empty()
	}
	if s.Scope == scope && s.NextAttemptAt > c.now().Unix() {
		return &RetryWait{Until: s.NextAttemptAt}
	}
	if s.Mode == Blocked && !manual {
		return ErrBlocked
	}
	if err = probe(ctx); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// A failed read cannot turn an ambiguous previous write into a safe retry.
		if uncertain {
			return ErrReview
		}
		f := classify(err)
		s.Scope = scope
		s.LastAttemptAt = c.now().Unix()
		s.Failures++
		if s.Failures > 32 {
			s.Failures = 32
		}
		s.Mode = Blocked
		s.FailureKind = f.Kind
		s.NextAttemptAt = 0
		if f.Retryable {
			s.Mode = Backoff
			s.NextAttemptAt = nextRetry(s.LastAttemptAt, s.Failures, interval, f.RetryAfterSeconds)
		}
		if saveErr := c.save(s); saveErr != nil {
			return saveErr
		}
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	s.Scope = scope
	s.Mode = Applying
	s.LastAttemptAt = c.now().Unix()
	s.NextAttemptAt = 0
	s.FailureKind = ""
	if err = c.save(s); err != nil {
		return err
	} // fail closed BEFORE any possibly-mutating call
	if err = ctx.Err(); err != nil {
		return err
	} // conservative Applying marker remains
	if err = apply(ctx); err != nil {
		s.Mode = Review
		s.FailureKind = "outcome_unknown"
		_ = c.save(s) // failure leaves the earlier Applying marker in place
		return ErrReview
	}
	s.Mode = Idle
	s.Failures = 0
	s.FailureKind = ""
	s.LastSuccessAt = c.now().Unix()
	s.NextAttemptAt = 0
	// A failed completion checkpoint must not be reported as a successful task.
	if err = c.save(s); err != nil {
		return err
	}
	return nil
}

// Read runs a user-requested read/validation under the same operation guard. It
// observes Retry-After but never clears an uncertain write marker.
func (c *Coordinator) Read(ctx context.Context, scope string, fn func(context.Context) error) error {
	if !c.mu.TryLock() {
		return ErrBusy
	}
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	s, err := c.Snapshot()
	if err != nil {
		return err
	}
	if s.Scope == scope && s.NextAttemptAt > c.now().Unix() {
		return &RetryWait{Until: s.NextAttemptAt}
	}
	return fn(ctx)
}

// Exclusive serializes local metadata operations with sync. Reset is allowed
// only after an explicitly requested rebind succeeds; no content is removed.
func (c *Coordinator) Exclusive(ctx context.Context, reset bool, fn func(context.Context) error) error {
	if !c.mu.TryLock() {
		return ErrBusy
	}
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := fn(ctx); err != nil {
		return err
	}
	if reset {
		return c.save(Empty())
	}
	return nil
}
