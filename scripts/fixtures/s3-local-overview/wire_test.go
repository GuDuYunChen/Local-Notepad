// This template runs only in an owned temporary module. Real production Go
// handlers/readers, a synthetic SQL driver and actual owned attachment files;
// no production server, network, credentials or user database is involved.
package syncengine

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLocalOverviewWireFixture(t *testing.T) {
	f := s3DBFixtureNew()
	h, err := NewS3LocalOverviewHandler(s3DBOpen(t, f), s3AttachmentFixture(t, map[string][]byte{"COMLPT1.bin": []byte("test")}), s3CandidateLimits())
	if err != nil {
		t.Fatal(err)
	}
	type observation struct {
		Name    string `json:"name"`
		Status  int    `json:"status"`
		Body    string `json:"body"`
		Cache   string `json:"cache"`
		Nosniff string `json:"nosniff"`
	}
	var out []observation
	for _, name := range []string{"success", "method", "origin", "intent", "target", "media", "encoding", "trailer", "oversize", "body", "nil-body", "cancelled", "timeout", "read-failure", "busy", "unavailable", "duplicate", "retry-success"} {
		r := httptest.NewRequest(http.MethodPost, S3LocalOverviewPath, strings.NewReader(`{"readOnly":true}`))
		r.RemoteAddr, r.Host = "127.0.0.1:12345", "127.0.0.1:27121"
		r.Header.Set("X-Notepad-Read-Only", S3LocalOverviewIntent)
		r.Header.Set("Content-Type", "application/json")
		f.beginErr = false
		target := h
		switch name {
		case "method":
			r.Method = http.MethodGet
		case "origin":
			r.Header.Set("Origin", "null")
		case "intent":
			r.Header.Del("X-Notepad-Read-Only")
		case "target":
			r.URL.RawQuery = "private=true"
		case "media":
			r.Header.Set("Content-Type", "text/plain")
		case "encoding":
			r.Header.Set("Content-Encoding", "gzip")
		case "trailer":
			r.Trailer = http.Header{"Private": {"secret"}}
		case "oversize":
			r.ContentLength = 65
		case "body":
			r.Body = http.NoBody
			r.ContentLength = 0
		case "nil-body":
			r.Body = nil
		case "cancelled":
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			r = r.WithContext(ctx)
		case "timeout":
			ctx, cancel := context.WithDeadline(r.Context(), time.Unix(0, 0))
			defer cancel()
			r = r.WithContext(ctx)
		case "read-failure":
			f.beginErr = true
		case "busy":
			h.slot <- struct{}{}
		case "unavailable":
			target = nil
		case "duplicate":
			r = httptest.NewRequest(http.MethodPost, S3LocalOverviewPath, strings.NewReader(`{"readOnly":true,"readOnly":true}`))
			r.RemoteAddr, r.Host = "127.0.0.1:12345", "127.0.0.1:27121"
			r.Header.Set("X-Notepad-Read-Only", S3LocalOverviewIntent)
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		target.ServeHTTP(w, r)
		if name == "busy" {
			<-h.slot
		}
		out = append(out, observation{name, w.Code, w.Body.String(), w.Header().Get("Cache-Control"), w.Header().Get("X-Content-Type-Options")})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("LOCAL_OVERVIEW_WIRE " + string(b))
}
