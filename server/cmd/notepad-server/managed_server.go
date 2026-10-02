package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"notepad-server/internal/appshutdown"
	"notepad-server/internal/syncengine"
	"notepad-server/internal/syncjob"

	"github.com/gogf/gf/v2/net/ghttp"
)

// Start (not Run/Wait) deliberately avoids GoFrame's independent process-signal
// handler. This single owner must drain tasks before main closes the database.
func serveManaged(ctx context.Context, cancel context.CancelFunc, s *ghttp.Server, recovery *syncengine.RecoveryRunner, maintenanceDone <-chan struct{}) error {
	var requests syncjob.Lifecycle
	s.Use(func(r *ghttp.Request) {
		next, finish, err := requests.Begin(r.Context())
		if err != nil {
			r.Response.WriteStatus(http.StatusServiceUnavailable, "本地数据服务正在退出")
			return
		}
		defer finish()
		r.SetCtx(next)
		r.Middleware.Next()
	})
	s.SetGracefulShutdownTimeout(3)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(quit)
	parent := make(chan string, 1)
	if os.Getenv("NOTEPAD_PARENT_STDIN") == "1" {
		go func() { parent <- appshutdown.WaitParent(os.Stdin) }()
	}
	if err := s.Start(); err != nil {
		cancel()
		return fmt.Errorf("启动本地数据服务失败: %w", err)
	}
	schedulerDone := make(chan struct{})
	go func() {
		defer close(schedulerDone)
		syncengine.RunRecoveryScheduler(ctx, recovery, 15*time.Second, 30*time.Second)
	}()
	select {
	case <-quit:
	case <-parent:
	case <-ctx.Done():
	}
	// Freeze admission before cancelling; the barriers include function defers,
	// lock cleanup and journal completion, not just delivery of cancel signals.
	// Let accepted note saves finish; cancel only managed sync operations.
	requestsDone := requests.Seal()
	recoveryDone := recovery.Stop()
	cancel()
	httpDone := make(chan struct{})
	go func() { defer close(httpDone); _ = s.Shutdown() }()
	drain, finish := context.WithTimeout(context.Background(), 8*time.Second)
	defer finish()
	if err := appshutdown.Wait(drain, recoveryDone, requestsDone, schedulerDone, maintenanceDone, httpDone); err != nil {
		return fmt.Errorf("本地服务收尾未完成，恢复记录保留；异常退出: %w", err)
	}
	return nil
}
