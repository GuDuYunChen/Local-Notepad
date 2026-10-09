package controller

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/middleware"
	"notepad-server/internal/syncengine"
)

// Actual pinned GoFrame routing and production CORS. No credentials or user
// files. A missing owned directory proves unauthorized/invalid calls don't
// initialize a database or attachment store.
func TestS3LocalOverviewProductionRouteAndCORS(t *testing.T) {
	token := strings.Repeat("a", 64)
	t.Setenv("NOTEPAD_LOCAL_OVERVIEW_TOKEN", token)
	s := ghttp.GetServer(fmt.Sprintf("local-overview-host-%d", time.Now().UnixNano()))
	s.SetAddr("127.0.0.1:0")
	s.SetDumpRouterMap(false)
	s.SetAccessLogEnabled(false)
	s.SetErrorLogEnabled(false)
	s.SetLogStdout(false)
	s.Use(middleware.CORS)
	c := &SyncController{Engine: &syncengine.Engine{DataDir: t.TempDir()}, Recovery: &syncengine.RecoveryRunner{}}
	c.Register(s.Group("/api"))
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Shutdown(); err != nil {
			t.Error(err)
		}
	})
	address := fmt.Sprintf("http://127.0.0.1:%d%s", s.GetListenedPort(), syncengine.S3LocalOverviewPath)
	client := &http.Client{Timeout: 3 * time.Second}
	for _, tc := range []struct {
		name, method, body, origin, credential string
		status                                 int
	}{
		{"no-auth", "POST", `{"readOnly":true}`, "", "", 403},
		{"browser", "POST", `{"readOnly":true}`, "null", token, 403},
		{"preflight", "OPTIONS", "", "http://localhost:5000", "", 403},
		{"invalid-body", "POST", `{"readOnly":false}`, "", token, 400},
		{"read-only-missing-database", "POST", `{"readOnly":true}`, "", token, 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := http.NewRequest(tc.method, address, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Notepad-Read-Only", syncengine.S3LocalOverviewIntent)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.credential != "" {
				r.Header.Set(syncengine.S3LocalOverviewAuthHeader, tc.credential)
			}
			response, err := client.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			raw, e := io.ReadAll(response.Body)
			response.Body.Close()
			if e != nil || response.StatusCode != tc.status || response.Header.Get("Access-Control-Allow-Origin") != "" || response.Header.Get("Cache-Control") != "no-store" || !strings.Contains(string(raw), `"data":null`) {
				t.Fatalf("invalid private route response: %d %s", response.StatusCode, raw)
			}
			if strings.Contains(string(raw), token) {
				t.Fatal("credential escaped")
			}
		})
	}
}
