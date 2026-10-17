package syncengine

import (
	"context"
	"time"
)

const (
	syncReadLimit = 30 * time.Second
	syncRunLimit  = 10 * time.Minute
)

// Budgets derive from the caller; no attempt, object or inner read may reset
// the enclosing deadline. The override can only shorten a production limit.
// These are cooperative context deadlines, not hard filesystem/CPU time limits.
func withSyncBudget(parent context.Context, override, maximum time.Duration) (context.Context, context.CancelFunc) {
	if override <= 0 || override > maximum {
		override = maximum
	}
	return context.WithTimeout(parent, override)
}
