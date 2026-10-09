package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/syncengine"
	"notepad-server/internal/syncs3"
	"os"
	"path/filepath"
)

// Use the pinned GoFrame version's standard http.ResponseWriter buffer, not
// RawWriter: framework lifecycle, response status and buffering remain intact.
// Do not Parse/GetJson here: credentials must reach the bounded strict decoder
// without a framework pre-read, coercion or re-serialization.
func registerS3ReadProbe(group *ghttp.RouterGroup, engine *syncengine.Engine) {
	var local *syncengine.S3LocalOverviewHost
	if engine != nil && engine.DataDir != "" {
		if directory, err := filepath.Abs(engine.DataDir); err == nil {
			local, _ = syncengine.NewS3LocalOverviewHost(directory, os.Getenv("NOTEPAD_LOCAL_OVERVIEW_TOKEN"))
		}
	}
	group.ALL("/sync/s3/local-overview", func(r *ghttp.Request) {
		local.ServeHTTP(r.Response.BufferWriter, r.Request.WithContext(r.GetCtx()))
	})
	handler := syncs3.NewReadProbeHandler()
	group.POST("/sync/s3/probe", func(r *ghttp.Request) {
		handler.ServeHTTP(r.Response.BufferWriter, r.Request.WithContext(r.GetCtx()))
	})
	// Reuse one preview handler/slot for the router lifetime; never parse the
	// credential-bearing body through GoFrame before its strict bounded decoder.
	preview := syncengine.NewS3PreviewHandler()
	group.POST("/sync/s3/preview", func(r *ghttp.Request) {
		preview.ServeHTTP(r.Response.BufferWriter, r.Request.WithContext(r.GetCtx()))
	})
}
