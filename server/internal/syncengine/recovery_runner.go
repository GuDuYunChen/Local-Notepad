package syncengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"notepad-server/internal/syncjob"
)

// RecoveryRunner is the application's sync entrypoint. The existing Engine
// remains responsible for objects/transactions/conflicts; this runner controls
// whether a WHOLE attempt is safe to start. It never automatically replays a
// failed Engine.Run or Engine.Resolve.
type RecoveryRunner struct {
	engine *Engine
	jobs   *syncjob.Coordinator
}
type RecoveryState struct {
	State
	Recovery syncjob.Snapshot `json:"recovery"`
}

func NewRecoveryRunner(e *Engine) *RecoveryRunner {
	return &RecoveryRunner{engine: e, jobs: syncjob.New(syncjob.FileStore{DataDir: e.DataDir}, e.now)}
}
func (r *RecoveryRunner) scope(ctx context.Context) (string, error) {
	_, provider, endpoint, username, _, err := r.engine.config(ctx)
	if err != nil {
		return "", err
	}
	state, err := r.engine.state(ctx)
	if err != nil {
		return "", err
	}
	// Hash the scope without credentials or note data. Keep remote_store_id out:
	// initializing a new store must not reset the first successful checkpoint.
	raw, _ := json.Marshal([]string{state.DeviceID, provider, endpoint, username, r.engine.RemoteRoot})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func classifySyncJobFailure(err error) syncjob.Failure {
	var h *WebDAVHTTPError
	if errors.As(err, &h) {
		kind := h.Kind()
		if kind == "remote_rejected" {
			kind = "configuration"
		}
		return syncjob.Failure{Kind: kind, Retryable: retryableWebDAVStatus(h.StatusCode), RetryAfterSeconds: h.RetryAfterSeconds}
	}
	kind := classifyWebDAVTransport(err)
	return syncjob.Failure{Kind: kind, Retryable: kind == "temporary_network"}
}
func (r *RecoveryRunner) Status(ctx context.Context) (RecoveryState, error) {
	s, err := r.engine.Status(ctx)
	if err != nil {
		return RecoveryState{}, err
	}
	j, err := r.jobs.Snapshot()
	if err != nil {
		s.LastStatus = "recovery_blocked"
		s.LastError = syncjob.ErrJournal.Error()
		return RecoveryState{State: s, Recovery: syncjob.Snapshot{Version: 1, Mode: syncjob.Blocked, FailureKind: "configuration"}}, nil
	}
	scope, err := r.scope(ctx)
	if err != nil {
		return RecoveryState{}, err
	}
	if j.Scope != scope && j.Mode != syncjob.Applying && j.Mode != syncjob.Review {
		j = syncjob.Empty()
	}
	switch j.Mode {
	case syncjob.Applying, syncjob.Review:
		s.LastStatus = "review_required"
		s.LastError = syncjob.ErrReview.Error()
	case syncjob.Backoff:
		s.LastStatus = "retry_wait"
		s.LastError = (&syncjob.RetryWait{Until: j.NextAttemptAt}).Error()
	case syncjob.Blocked:
		s.LastStatus = "recovery_blocked"
		s.LastError = webDAVFailureLabel(j.FailureKind) + "；自动同步已暂停，请修复后手动重试。"
	}
	return RecoveryState{State: s, Recovery: j}, nil
}
func (r *RecoveryRunner) run(ctx context.Context, manual, acknowledged bool) (RunResult, error) {
	_, interval, err := r.engine.autoConfig(ctx)
	if err != nil {
		return RunResult{}, err
	}
	scope, err := r.scope(ctx)
	if err != nil {
		return RunResult{}, err
	}
	var result RunResult
	err = r.jobs.Execute(ctx, scope, manual, acknowledged, interval,
		func(ctx context.Context) error {
			actual, e := r.scope(ctx)
			if e != nil {
				return e
			}
			if actual != scope {
				return fmt.Errorf("同步配置已变化，请重新发起同步")
			}
			state, e := r.engine.state(ctx)
			if e != nil {
				return e
			}
			if !state.Enabled {
				return fmt.Errorf("同步尚未启用")
			}
			// Recheck after obtaining the job guard, not from a stale scheduler read.
			if !manual {
				enabled, _, e := r.engine.autoConfig(ctx)
				if e != nil {
					return e
				}
				if !enabled {
					return context.Canceled
				}
				if state.OpenConflicts > 0 {
					return fmt.Errorf("存在待处理冲突，请手动处理")
				}
			}
			_, e = r.engine.CheckRemote(ctx)
			return e
		},
		func(ctx context.Context) error { var e error; result, e = r.engine.Run(ctx); return e }, classifySyncJobFailure)
	return result, err
}
func (r *RecoveryRunner) Run(ctx context.Context, acknowledged bool) (RunResult, error) {
	return r.run(ctx, true, acknowledged)
}
func (r *RecoveryRunner) AutoTick(ctx context.Context) (AutoTickResult, error) {
	enabled, interval, err := r.engine.autoConfig(ctx)
	if err != nil {
		return AutoTickResult{}, err
	}
	if !enabled {
		return AutoTickResult{Reason: "disabled"}, nil
	}
	state, err := r.engine.state(ctx)
	if err != nil {
		return AutoTickResult{}, err
	}
	if state.OpenConflicts > 0 {
		return AutoTickResult{Reason: "conflicts"}, nil
	}
	j, err := r.jobs.Snapshot()
	if err != nil {
		return AutoTickResult{Reason: "journal-blocked"}, err
	}
	if j.Mode == syncjob.Idle {
		last := state.LastSyncAt
		scope, e := r.scope(ctx)
		if e != nil {
			return AutoTickResult{}, e
		}
		if j.Scope == scope && j.LastSuccessAt > 0 {
			last = j.LastSuccessAt
		}
		if last > 0 && r.engine.now().Sub(time.Unix(last, 0)) < interval {
			return AutoTickResult{Reason: "not-due"}, nil
		}
	}
	result, err := r.run(ctx, false, false)
	if err != nil {
		reason := "error"
		var wait *syncjob.RetryWait
		switch {
		case errors.Is(err, syncjob.ErrBusy):
			reason = "busy"
		case errors.Is(err, syncjob.ErrReview):
			reason = "review-required"
		case errors.Is(err, syncjob.ErrBlocked):
			reason = "blocked"
		case errors.As(err, &wait):
			reason = "backoff"
		}
		return AutoTickResult{Reason: reason}, err
	}
	return AutoTickResult{Ran: true, Reason: "ok", Result: result}, nil
}
func (r *RecoveryRunner) CheckRemote(ctx context.Context) (RemoteCheck, error) {
	scope, err := r.scope(ctx)
	if err != nil {
		return RemoteCheck{}, err
	}
	var result RemoteCheck
	err = r.jobs.Read(ctx, scope, func(ctx context.Context) error { var e error; result, e = r.engine.CheckRemote(ctx); return e })
	return result, err
}
func (r *RecoveryRunner) Plan(ctx context.Context) (Plan, error) {
	scope, err := r.scope(ctx)
	if err != nil {
		return Plan{}, err
	}
	var result Plan
	err = r.jobs.Read(ctx, scope, func(ctx context.Context) error { var e error; result, e = r.engine.Plan(ctx); return e })
	return result, err
}
func (r *RecoveryRunner) ConfigureAuto(ctx context.Context, enabled bool, interval int) (State, error) {
	var result State
	fn := func(ctx context.Context) error {
		var e error
		result, e = r.engine.ConfigureAuto(ctx, enabled, interval)
		return e
	}
	if !enabled {
		err := r.jobs.Exclusive(ctx, false, fn)
		return result, err
	}
	scope, err := r.scope(ctx)
	if err != nil {
		return result, err
	}
	// Read-only verification alone does not clear an ambiguous-write checkpoint.
	err = r.jobs.Read(ctx, scope, fn)
	return result, err
}
func (r *RecoveryRunner) Rebind(ctx context.Context) (State, error) {
	var result State
	err := r.jobs.Exclusive(ctx, true, func(ctx context.Context) error { var e error; result, e = r.engine.Rebind(ctx); return e })
	return result, err
}
func (r *RecoveryRunner) Resolve(ctx context.Context, id, choice string) error {
	scope, err := r.scope(ctx)
	if err != nil {
		return err
	}
	return r.jobs.Execute(ctx, scope, true, false, time.Minute,
		func(ctx context.Context) error { _, e := r.engine.CheckRemote(ctx); return e },
		func(ctx context.Context) error { return r.engine.Resolve(ctx, id, choice) }, classifySyncJobFailure)
}
func RunRecoveryScheduler(ctx context.Context, r *RecoveryRunner, startupDelay, pollInterval time.Duration) {
	if r == nil {
		return
	}
	if startupDelay < 0 {
		startupDelay = 0
	}
	if pollInterval <= 0 {
		pollInterval = 30 * time.Second
	}
	timer := time.NewTimer(startupDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		_, _ = r.AutoTick(ctx)
		timer.Reset(pollInterval)
	}
}

// WithSettings prevents full-row settings updates from changing a task target
// between preflight and execution. Note editing does not take this guard.
func (r *RecoveryRunner) WithSettings(ctx context.Context, fn func(context.Context) error) error {
	return r.jobs.Exclusive(ctx, false, fn)
}
