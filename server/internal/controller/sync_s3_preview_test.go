package controller

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// Real pinned GoFrame registration and buffer. Empty supplied local data is
// explicit; no database is created, queried or implicitly initialized.
func TestS3PreviewRouteNativeBoundaryAndCountOnlyBuffer(t *testing.T) {
	manifest := syncengine.Manifest{Format: syncengine.ManifestFormat, Version: 1, StoreID: "PRIVATE_STORE", Generation: 1,
		UpdatedAt: "2026-01-01T00:00:00Z", DeviceID: "PRIVATE_DEVICE", Items: map[string]string{}}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(rawManifest)
	hash := hex.EncodeToString(sum[:])
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.Path != "/synthetic-bucket/manifests/00000000000000000001-"+hash+".json" || r.Header.Get("Authorization") == "" {
			t.Error("unexpected signed read")
		}
		_, _ = w.Write(rawManifest)
	}))
	defer upstream.Close()
	input := map[string]any{"readOnly": true,
		"connection": map[string]any{"endpoint": upstream.URL, "bucket": "synthetic-bucket", "region": "us-east-1", "accessKeyId": "AKIASYNTHETIC", "secretAccessKey": "PRIVATE_SECRET"},
		"pin":        map[string]any{"storeId": "PRIVATE_STORE", "generation": 1, "sha256": hash},
		"basis":      map[string]any{"storeId": "PRIVATE_STORE", "localRecords": map[string]string{}, "baseItems": map[string]string{}},
		"limits":     map[string]any{"localRecordBytes": 4096, "totalLocalRecordBytes": 8192, "maxLocalRecords": 4, "manifestBytes": 4096, "recordBytes": 4096, "totalRecordBytes": 8192, "maxRecords": 4, "maxItems": 12}}
	rawInput, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	server := ghttp.GetServer(fmt.Sprintf("s3-preview-route-%d", time.Now().UnixNano()))
	server.SetAddr("127.0.0.1:0")
	server.SetDumpRouterMap(false)
	server.SetAccessLogEnabled(false)
	server.SetErrorLogEnabled(false)
	server.SetLogStdout(false)
	server.SetReadTimeout(10 * time.Second)
	server.SetWriteTimeout(10 * time.Second)
	server.Use(func(r *ghttp.Request) {
		if r.Header.Get("X-Preview-Test-Cancel") == "yes" {
			ctx, cancel := context.WithCancel(r.GetCtx())
			cancel()
			r.SetCtx(ctx)
		}
		r.Middleware.Next()
	})
	(&SyncController{Recovery: &syncengine.RecoveryRunner{}}).Register(server.Group("/api"))
	if err = server.Start(); err != nil {
		t.Fatal("isolated router did not start")
	}
	defer func() {
		if e := server.Shutdown(); e != nil {
			t.Error("isolated router did not stop")
		}
	}()
	address := fmt.Sprintf("http://127.0.0.1:%d%s", server.GetListenedPort(), syncengine.S3PreviewPath)
	client := &http.Client{Timeout: 4 * time.Second}
	defer client.CloseIdleConnections()
	for _, tc := range []struct {
		name, origin, intent, query string
		change                      func([]byte) []byte
		cancel                      bool
		status                      int
		calls                       int32
	}{
		{name: "native-success", intent: syncengine.S3PreviewIntent, status: 200, calls: 1},
		{name: "browser-null", origin: "null", intent: syncengine.S3PreviewIntent, status: 403},
		{name: "browser-development", origin: "http://localhost:5173", intent: syncengine.S3PreviewIntent, status: 403},
		{name: "no-intent", status: 403},
		{name: "different-probe-intent", intent: syncs3.ReadProbeIntent, status: 403},
		{name: "query-refused", intent: syncengine.S3PreviewIntent, query: "?PRIVATE_QUERY=1", status: 400},
		{name: "readonly-false", intent: syncengine.S3PreviewIntent, change: func(b []byte) []byte {
			return bytes.Replace(b, []byte(`"readOnly":true`), []byte(`"readOnly":false`), 1)
		}, status: 400},
		{name: "duplicate-root", intent: syncengine.S3PreviewIntent, change: func(b []byte) []byte {
			return bytes.Replace(b, []byte(`"readOnly":true`), []byte(`"readOnly":true,"readOnly":true`), 1)
		}, status: 400},
		{name: "framework-cancellation", intent: syncengine.S3PreviewIntent, cancel: true, status: 408},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := calls.Load()
			body := rawInput
			if tc.change != nil {
				body = tc.change(rawInput)
			}
			req, e := http.NewRequest("POST", address+tc.query, bytes.NewReader(body))
			if e != nil {
				t.Fatal(e)
			}
			req.Header.Set("Content-Type", "application/json")
			if tc.intent != "" {
				req.Header.Set(syncs3.ReadProbeIntentHeader, tc.intent)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.cancel {
				req.Header.Set("X-Preview-Test-Cancel", "yes")
			}
			res, e := client.Do(req)
			if e != nil {
				t.Fatal("isolated framework request failed")
			}
			defer res.Body.Close()
			raw, e := io.ReadAll(res.Body)
			if e != nil {
				t.Fatal(e)
			}
			var out struct {
				Code    int                        `json:"code"`
				Message string                     `json:"message"`
				Data    *syncengine.S3PlanOverview `json:"data"`
			}
			if json.Unmarshal(raw, &out) != nil || res.StatusCode != tc.status || calls.Load()-before != tc.calls {
				t.Fatal("incorrect framework status or real GET count")
			}
			if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("X-Content-Type-Options") != "nosniff" || res.Header.Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("framework lost privacy headers")
			}
			if tc.status == 200 {
				if out.Code != 0 || out.Data == nil || out.Data.Format != syncengine.S3PlanOverviewFormat || !out.Data.ReadOnly || out.Data.Counts.Total != 0 {
					t.Fatal("count-only summary changed")
				}
			} else if out.Code != tc.status || out.Data != nil {
				t.Fatal("failed operation produced data")
			}
			for _, private := range []string{"PRIVATE", "AKIASYNTHETIC", upstream.URL, hash, "synthetic-bucket"} {
				if strings.Contains(string(raw), private) {
					t.Fatal("private input in framework reply")
				}
			}
		})
	}
}
