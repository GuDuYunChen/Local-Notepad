package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/syncengine"
	"notepad-server/internal/syncs3"
)

// Run against the real pinned GoFrame router and buffer, not a fake adapter.
// The unused existing recovery runner avoids database setup; no recovery route
// is invoked. The S3 route is reached through the production Register method.
func TestS3ProbeRouteUsesNativeGuardAndBufferedJSON(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "GET" || r.URL.Path != "/test-bucket/probe.txt" || r.Header.Get("Authorization") == "" {
			t.Error("incorrect upstream request")
		}
		w.Header().Set("ETag", "private-etag")
		_, _ = io.WriteString(w, "private-body")
	}))
	defer upstream.Close()
	server := ghttp.GetServer(fmt.Sprintf("s3-local-probe-%d", time.Now().UnixNano()))
	server.SetAddr("127.0.0.1:0")
	server.SetDumpRouterMap(false)
	server.SetLogPath(t.TempDir())
	server.Use(func(r *ghttp.Request) {
		if r.Header.Get("X-Probe-Test-Cancel") == "yes" {
			ctx, cancel := context.WithCancel(r.GetCtx())
			cancel()
			r.SetCtx(ctx)
		}
		r.Middleware.Next()
	})
	controller := &SyncController{Recovery: &syncengine.RecoveryRunner{}}
	controller.Register(server.Group("/api"))
	if err := server.Start(); err != nil {
		t.Fatal("isolated GoFrame server did not start")
	}
	t.Cleanup(func() {
		if err := server.Shutdown(); err != nil {
			t.Error("isolated GoFrame server did not shut down")
		}
	})
	address := fmt.Sprintf("http://127.0.0.1:%d%s", server.GetListenedPort(), syncs3.ReadProbePath)
	input, err := json.Marshal(map[string]any{"endpoint": upstream.URL, "bucket": "test-bucket", "region": "us-east-1", "accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "synthetic-http-secret", "key": "probe.txt", "maxBytes": 1024, "readOnly": true})
	if err != nil {
		t.Fatal("synthetic input did not marshal")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, tc := range []struct {
		name   string
		origin string
		intent bool
		query  string
		cancel bool
		status int
		calls  int32
	}{
		{name: "native-success", intent: true, status: 200, calls: 1},
		{name: "browser-null", origin: "null", intent: true, status: 403},
		{name: "browser-dev", origin: "http://localhost:5173", intent: true, status: 403},
		{name: "missing-intent", status: 403},
		{name: "query-refused", intent: true, query: "?secretAccessKey=not-sent", status: 400},
		{name: "lifecycle-context", intent: true, cancel: true, status: 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := requests.Load()
			req, err := http.NewRequest("POST", address+tc.query, strings.NewReader(string(input)))
			if err != nil {
				t.Fatal("synthetic request did not construct")
			}
			req.Header.Set("Content-Type", "application/json")
			if tc.intent {
				req.Header.Set(syncs3.ReadProbeIntentHeader, syncs3.ReadProbeIntent)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.cancel {
				req.Header.Set("X-Probe-Test-Cancel", "yes")
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal("local GoFrame route request failed")
			}
			defer res.Body.Close()
			raw, err := io.ReadAll(res.Body)
			if err != nil || res.StatusCode != tc.status || requests.Load()-before != tc.calls {
				t.Fatal("incorrect route status, body or upstream call count")
			}
			var output struct {
				Code int                 `json:"code"`
				Data *syncs3.ProbeResult `json:"data"`
			}
			if json.Unmarshal(raw, &output) != nil || res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("buffered JSON/privacy headers were not preserved")
			}
			if tc.status == 200 && (output.Code != 0 || output.Data == nil || output.Data.AcceptedBytes != 12 || output.Data.Outcome != syncs3.ProbeReadable) {
				t.Fatal("read summary changed across framework adapter")
			}
			if tc.cancel && (output.Data == nil || output.Data.Outcome != syncs3.ProbeCancelled) {
				t.Fatal("framework request lifecycle context was not propagated")
			}
			for _, private := range []string{upstream.URL, "synthetic-http-secret", "AKIDEXAMPLE", "private-body", "private-etag", "probe.txt", "not-sent"} {
				if strings.Contains(string(raw), private) {
					t.Fatal("credential/object/query content escaped to reply")
				}
			}
		})
	}
}
