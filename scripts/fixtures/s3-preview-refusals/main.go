// Test-only, finite and offline. Exercise the ORIGINAL standard-library HTTP
// handler with httptest requests. No listener, S3 client request, database or
// file operation is started. This is not a GoFrame/Electron end-to-end server.
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"

	"notepad-server/internal/syncengine"
)

type observation struct {
	Name   string          `json:"name"`
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

func main() {
	h := syncengine.NewS3PreviewHandler()
	cases := []struct {
		name   string
		change func(*http.Request)
	}{
		{"encoding-empty", func(r *http.Request) { r.Header["Content-Encoding"] = []string{""} }},
		{"encoding-identity", func(r *http.Request) { r.Header.Set("Content-Encoding", "identity") }},
		{"encoding-gzip", func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }},
		{"encoding-mixed-case", func(r *http.Request) { r.Header["cOnTeNt-EnCoDiNg"] = []string{"gzip"} }},
		{"trailer-declaration", func(r *http.Request) { r.Header.Set("Trailer", "X-Synthetic") }},
		{"trailer-value", func(r *http.Request) { r.Trailer = http.Header{"X-Synthetic": {"synthetic"}} }},
		{"query-target", func(r *http.Request) { r.URL.RawQuery = "synthetic=1" }},
		{"method-get", func(r *http.Request) { r.Method = http.MethodGet }},
		{"browser-origin", func(r *http.Request) { r.Header.Set("Origin", "null") }},
		{"browser-referer", func(r *http.Request) { r.Header.Set("Referer", "https://example.invalid") }},
		{"missing-intent", func(r *http.Request) { r.Header.Del("X-Notepad-Read-Only") }},
		{"non-json", func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }},
		{"nil-body", func(r *http.Request) { r.Body = nil }},
		{"declared-oversize", func(r *http.Request) { r.ContentLength = syncengine.MaxS3PreviewRequestBytes + 1 }},
		{"invalid-json-shape", func(r *http.Request) {}},
		{"cancelled", func(r *http.Request) {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			*r = *r.WithContext(ctx)
		}},
		{"deadline", func(r *http.Request) {
			ctx, cancel := context.WithDeadline(r.Context(), time.Unix(0, 0))
			defer cancel()
			*r = *r.WithContext(ctx)
		}},
		{"nil-handler", func(r *http.Request) {}},
	}
	out := make([]observation, 0, len(cases))
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodPost, syncengine.S3PreviewPath, strings.NewReader("{}"))
		r.RemoteAddr, r.Host = "127.0.0.1:12345", "127.0.0.1:27121"
		r.Header.Set("X-Notepad-Read-Only", syncengine.S3PreviewIntent)
		r.Header.Set("Content-Type", "application/json")
		c.change(r)
		w := httptest.NewRecorder()
		if c.name == "nil-handler" {
			var unavailable *syncengine.S3PreviewHandler
			unavailable.ServeHTTP(w, r)
		} else {
			h.ServeHTTP(w, r)
		}
		out = append(out, observation{c.name, w.Code, json.RawMessage(w.Body.Bytes())})
	}
	if json.NewEncoder(os.Stdout).Encode(out) != nil {
		os.Exit(1)
	}
}
