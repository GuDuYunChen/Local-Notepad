package syncjob

import (
	"context"
	"errors"
	"sync"
)

var ErrStopping = errors.New("本地数据服务正在退出，已停止接收新的同步操作")

// Lifecycle closes admission before signalling cancellation. Completion means
// all admitted callers have returned, not that any cancelled write rolled back.
// The zero value is usable. A stopped lifecycle cannot be reopened.
type Lifecycle struct {
	mu       sync.Mutex
	stopping bool
	next     uint64
	active   map[uint64]context.CancelFunc
	drained  chan struct{}
}

func (l *Lifecycle) Begin(parent context.Context) (context.Context, func(), error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.stopping {
		return nil, nil, ErrStopping
	}
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	if l.active == nil {
		l.active = make(map[uint64]context.CancelFunc)
	}
	l.next++
	id := l.next
	ctx, cancel := context.WithCancel(parent)
	l.active[id] = cancel
	var once sync.Once
	finish := func() {
		once.Do(func() {
			cancel()
			l.mu.Lock()
			defer l.mu.Unlock()
			delete(l.active, id)
			if l.stopping && len(l.active) == 0 {
				close(l.drained)
			}
		})
	}
	return ctx, finish, nil
}

// Seal rejects new callers but lets already accepted local work finish. This
// is used for HTTP note saves: shutdown must not cancel them merely because
// the user asked the sync subsystem to stop.
func (l *Lifecycle) Seal() <-chan struct{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.stopping {
		l.stopping = true
		l.drained = make(chan struct{})
		if len(l.active) == 0 {
			close(l.drained)
		}
	}
	return l.drained
}

// Stop is idempotent. The barrier includes cleanup/checkpointing, not just
// cancellation delivery. Stop can also escalate a previous Seal to cancellation.
func (l *Lifecycle) Stop() <-chan struct{} {
	done := l.Seal()
	l.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(l.active))
	for _, cancel := range l.active {
		cancels = append(cancels, cancel)
	}
	l.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	return done
}
