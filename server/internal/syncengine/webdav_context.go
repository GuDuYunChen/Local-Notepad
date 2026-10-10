package syncengine

import (
	"context"
	"time"
)

const webDAVLockCleanupLimit = 3 * time.Second

// A transport is created for one Engine operation, not shared between tasks.
// Keep the legacy constructor for callers that deliberately use Background.
func newWebDAVRemoteContext(ctx context.Context, endpoint, username, password string) (*WebDAVRemote, error) {
	if err := ctx.Err(); err != nil {
		return nil, &WebDAVTransportError{cause: err}
	}
	r, err := NewWebDAVRemote(endpoint, username, password)
	if err != nil {
		return nil, err
	}
	r.operationContext = ctx
	return r, nil
}

func (r *WebDAVRemote) requestContext() context.Context {
	if r.operationContext != nil {
		return r.operationContext
	}
	return context.Background()
}

// Cancellation must stop data requests, but it must not automatically prevent
// releasing OUR lock. The detached context is used only for ownership checking
// and a single DELETE; it cannot restart the operation or publish a manifest.
// Failure is best-effort: never guess ownership or erase another owner's lock.
// Existing remote lock lease/TOCTOU limitations are unchanged by this helper.
func (r *WebDAVRemote) releaseLockWithin(token string, limit time.Duration) {
	if token == "" {
		return
	}
	if limit <= 0 || limit > webDAVLockCleanupLimit {
		limit = webDAVLockCleanupLimit
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.requestContext()), limit)
	defer cancel()
	cleanup := *r
	cleanup.operationContext = ctx
	owner, err := cleanup.readLock()
	if err != nil || owner.Token != token {
		return
	}
	_ = cleanup.deleteLock()
}
