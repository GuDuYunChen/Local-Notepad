package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/syncs3"
)

// Use the pinned GoFrame version's standard http.ResponseWriter buffer, not
// RawWriter: framework lifecycle, response status and buffering remain intact.
// Do not Parse/GetJson here: credentials must reach the bounded strict decoder
// without a framework pre-read, coercion or re-serialization.
func registerS3ReadProbe(group *ghttp.RouterGroup) {
	handler := syncs3.NewReadProbeHandler()
	group.POST("/sync/s3/probe", func(r *ghttp.Request) {
		handler.ServeHTTP(r.Response.BufferWriter, r.Request.WithContext(r.GetCtx()))
	})
}
