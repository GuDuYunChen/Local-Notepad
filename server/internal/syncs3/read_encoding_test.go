package syncs3

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Use the production HTTP transport, not a fake response or a request retry.
// A later header value must not be hidden by an earlier identity/empty value.
func TestReadRejectsLaterContentEncodingOnWire(t *testing.T) {
	for _, first := range []string{"identity", ""} {
		name := first
		if name == "" {
			name = "empty-first"
		}
		t.Run(name, func(t *testing.T) {
			var compressed bytes.Buffer
			zw := gzip.NewWriter(&compressed)
			if _, err := zw.Write([]byte(`{"fixture":"synthetic"}`)); err != nil {
				t.Fatal(err)
			}
			if err := zw.Close(); err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.Method != http.MethodGet {
					t.Errorf("unexpected method %s", r.Method)
				}
				w.Header().Add("Content-Encoding", first)
				w.Header().Add("Content-Encoding", "gzip")
				w.Header().Set("ETag", `"synthetic"`)
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(compressed.Bytes())
			}))
			defer srv.Close()
			cfg := testConfig()
			cfg.Endpoint = srv.URL
			c, err := NewReadClient(cfg, testCredentials())
			if err != nil {
				t.Fatal(err)
			}
			defer c.CloseIdleConnections()
			object, err := c.GetObject(context.Background(), "manifest.json", 4096)
			if !errors.Is(err, ErrBody) || object.Bytes != nil || object.ETag != "" || requests.Load() != 1 {
				t.Fatalf("encoded object accepted or retried: err=%v bytes=%d etag=%q requests=%d", err, len(object.Bytes), object.ETag, requests.Load())
			}
		})
	}
}

// Preserve the foundation's existing narrow compatibility policy: an absent
// field, empty field, or literal identity value needs no decoding. Any other
// value (including a comma-combined coding list) must be refused, on every line.
func TestReadContentEncodingBoundaries(t *testing.T) {
	cases := []struct {
		name   string
		values []string
		reject bool
	}{
		{"absent", nil, false},
		{"empty", []string{""}, false},
		{"identity", []string{"identity"}, false},
		{"repeated identity", []string{"identity", "identity"}, false},
		{"empty then identity", []string{"", "identity"}, false},
		{"identity then empty", []string{"identity", ""}, false},
		{"single gzip", []string{"gzip"}, true},
		{"gzip then identity", []string{"gzip", "identity"}, true},
		{"identity then gzip", []string{"identity", "gzip"}, true},
		{"empty then gzip", []string{"", "gzip"}, true},
		{"third-line br", []string{"identity", "", "br"}, true},
		{"combined codings", []string{"identity, gzip"}, true},
		{"later combined codings", []string{"identity", "identity, gzip"}, true},
		{"strict subset unchanged", []string{"identity, identity"}, true},
		{"uppercase compressed", []string{"identity", "GZIP"}, true},
		{"unknown coding redacted", []string{"identity", "SYNTHETIC-PRIVATE-CODING"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			body := &encodingObservedBody{Reader: bytes.NewReader([]byte("body"))}
			c.client.Transport = roundTripper(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Method != http.MethodGet {
					t.Errorf("unexpected method %s", req.Method)
				}
				r := response(http.StatusOK, "")
				r.Header["Content-Encoding"] = tc.values
				r.Header.Set("ETag", `"synthetic-etag"`)
				r.Body = body
				r.ContentLength = 4
				return r, nil
			})
			object, err := c.GetObject(context.Background(), "object", 4)
			if calls != 1 || body.closes != 1 {
				t.Fatalf("calls=%d closes=%d", calls, body.closes)
			}
			if tc.reject {
				if !errors.Is(err, ErrBody) || object.Bytes != nil || object.ETag != "" || body.reads != 0 {
					t.Fatalf("must reject before reading, without data/metadata: err=%v reads=%d bytes=%d", err, body.reads, len(object.Bytes))
				}
				if strings.Contains(err.Error(), "SYNTHETIC-PRIVATE-CODING") {
					t.Fatal("raw coding leaked")
				}
			} else if err != nil || string(object.Bytes) != "body" || object.ETag != `"synthetic-etag"` || body.reads == 0 {
				t.Fatalf("unencoded compatibility changed: err=%v bytes=%d", err, len(object.Bytes))
			}
		})
	}
}

type encodingObservedBody struct {
	*bytes.Reader
	reads, closes int
}

func (b *encodingObservedBody) Read(p []byte) (int, error) { b.reads++; return b.Reader.Read(p) }
func (b *encodingObservedBody) Close() error               { b.closes++; return nil }

func TestReadContentEncodingPlainOnWire(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values []string
	}{
		{"absent", nil}, {"empty", []string{""}}, {"identity", []string{"identity"}},
		{"repeated identity", []string{"identity", "identity"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodGet || r.Header.Get("Accept-Encoding") != "" {
					t.Errorf("unexpected request method/encoding: %s %q", r.Method, r.Header.Get("Accept-Encoding"))
				}
				for _, value := range tc.values {
					w.Header().Add("Content-Encoding", value)
				}
				_, _ = w.Write([]byte("plain"))
			}))
			defer srv.Close()
			cfg := testConfig()
			cfg.Endpoint = srv.URL
			c, err := NewReadClient(cfg, testCredentials())
			if err != nil {
				t.Fatal(err)
			}
			defer c.CloseIdleConnections()
			object, err := c.GetObject(context.Background(), "object", 5)
			if err != nil || string(object.Bytes) != "plain" || calls.Load() != 1 {
				t.Fatalf("read failed: %v calls=%d", err, calls.Load())
			}
		})
	}
}

func TestReadContentEncodingMixedHeaderCaseOnWire(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		// Direct map entries deliberately produce two differently cased wire
		// fields. The production parser canonicalizes names; neither value may
		// disappear from the validation decision.
		w.Header()["Content-Encoding"] = []string{"identity"}
		w.Header()["content-encoding"] = []string{"gzip"}
		_, _ = w.Write([]byte("synthetic-coded-body"))
	}))
	defer srv.Close()
	cfg := testConfig()
	cfg.Endpoint = srv.URL
	c, err := NewReadClient(cfg, testCredentials())
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseIdleConnections()
	object, err := c.GetObject(context.Background(), "object", 64)
	if !errors.Is(err, ErrBody) || object.Bytes != nil || object.ETag != "" || calls.Load() != 1 {
		t.Fatalf("mixed-case field escaped validation: err=%v calls=%d", err, calls.Load())
	}
}
