package syncs3

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func probeConfig(endpoint string) Config { c := testConfig(); c.Endpoint = endpoint; return c }
func requireProbeFailure(t *testing.T, got ProbeResult, err error, outcome ProbeOutcome, status int) {
	t.Helper()
	if err == nil || got.Outcome != outcome || got.HTTPStatus != status || got.AcceptedBytes != 0 {
		t.Fatalf("wrong failed probe: outcome=%s status=%d accepted=%d error-present=%t", got.Outcome, got.HTTPStatus, got.AcceptedBytes, err != nil)
	}
}

func TestProbeSignedExactReadAndSafeSummary(t *testing.T) {
	const body = "synthetic-object-body-not-for-summary"
	const key = "folder/书 +%?#.json"
	const tag = "synthetic-etag-not-for-summary"
	credentials := testCredentials()
	credentials.SessionToken = "SyntheticProbeSession"
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "GET" || r.URL.EscapedPath() != "/examplebucket/prefix/folder/%E4%B9%A6%20%2B%25%3F%23.json" || r.URL.RawQuery != "" || r.Header.Get("Range") != "" {
			t.Error("probe changed the explicit read target or method")
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") || r.Header.Get("X-Amz-Security-Token") != credentials.SessionToken || r.Header.Get("Accept-Encoding") == "gzip" {
			t.Error("probe did not use the signed uncompressed read path")
		}
		w.Header().Set("ETag", tag)
		_, _ = io.WriteString(w, body)
	}))
	defer server.Close()
	cfg := probeConfig(server.URL)
	cfg.Prefix = "prefix"
	originalCfg, originalCredentials := cfg, credentials
	result, err := ProbeRead(context.Background(), cfg, credentials, key, 1024)
	if err != nil || result != (ProbeResult{ProbeReadable, 200, int64(len(body))}) || requests.Load() != 1 {
		t.Fatal("explicit read did not complete once")
	}
	if cfg != originalCfg || credentials != originalCredentials {
		t.Fatal("probe mutated caller configuration")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err = json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 3 {
		t.Fatal("unexpected summary fields")
	}
	for _, text := range []string{string(encoded), fmt.Sprintf("%v", result), fmt.Sprintf("%+v", result), fmt.Sprintf("%#v", result)} {
		for _, secret := range []string{body, key, tag, server.URL, credentials.AccessKeyID, credentials.SecretAccessKey, credentials.SessionToken} {
			if strings.Contains(text, secret) {
				t.Fatal("summary leaked a synthetic request or object marker")
			}
		}
	}
	if reflect.TypeOf(result).NumField() != 3 {
		t.Fatal("probe unexpectedly stores additional state")
	}
}

func TestProbeEmptyAndLimitSizeAreCompleteReads(t *testing.T) {
	for _, body := range []string{"", "12345678"} {
		t.Run(fmt.Sprintf("size-%d", len(body)), func(t *testing.T) {
			var n atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1); _, _ = io.WriteString(w, body) }))
			defer s.Close()
			result, err := ProbeRead(context.Background(), probeConfig(s.URL), testCredentials(), "object", 8)
			if err != nil || result.Outcome != ProbeReadable || result.HTTPStatus != 200 || result.AcceptedBytes != int64(len(body)) || n.Load() != 1 {
				t.Fatal("complete read rejected or repeated")
			}
		})
	}
}

func TestProbeHTTPFailuresAreNotAuthenticationSuccess(t *testing.T) {
	for _, status := range []int{201, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 409, 412, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var n atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n.Add(1)
				w.Header().Set("ETag", "synthetic-private-tag")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, "synthetic-private-error-body")
			}))
			defer s.Close()
			outcome := ProbeHTTPFailure
			switch status {
			case 401, 403:
				outcome = ProbeAccessDenied
			case 404:
				outcome = ProbeNotFound
			case 301, 302, 303, 307, 308:
				outcome = ProbeRedirectRefused
			}
			result, err := ProbeRead(context.Background(), probeConfig(s.URL), testCredentials(), "object", 1024)
			requireProbeFailure(t, result, err, outcome, status)
			var e *HTTPError
			if !errors.As(err, &e) || e.StatusCode != status || e.NotFound() != (status == 404) {
				t.Fatal("lost sanitized HTTP error semantics")
			}
			if n.Load() != 1 || strings.Contains(err.Error(), "synthetic-private") {
				t.Fatal("probe retried or leaked HTTP error content")
			}
		})
	}
}

func TestProbeNeverFollowsRedirectOrFallsBack(t *testing.T) {
	var original, target atomic.Int32
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { target.Add(1) }))
	defer dst.Close()
	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		original.Add(1)
		w.Header().Set("Location", dst.URL+"/private-key")
		w.WriteHeader(307)
	}))
	defer src.Close()
	result, err := ProbeRead(context.Background(), probeConfig(src.URL), testCredentials(), "explicit-key", 1024)
	requireProbeFailure(t, result, err, ProbeRedirectRefused, 307)
	if original.Load() != 1 || target.Load() != 0 {
		t.Fatal("redirect followed or probe repeated")
	}
}

func TestProbeInputRejectionHasNoNetwork(t *testing.T) {
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1) }))
	defer s.Close()
	for _, kind := range []string{"nil-context", "zero-limit", "negative-limit", "over-limit", "bad-config", "bad-credentials", "bad-key", "overlong-combined-key"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			cfg := probeConfig(s.URL)
			credentials := testCredentials()
			key := "object"
			limit := int64(1024)
			want := ProbeInvalidConfig
			switch kind {
			case "nil-context":
				ctx = nil
			case "zero-limit":
				limit = 0
			case "negative-limit":
				limit = -1
			case "over-limit":
				limit = MaxObjectBytes + 1
			case "bad-config":
				cfg.Endpoint += "?synthetic-secret=hidden"
			case "bad-credentials":
				credentials = Credentials{}
				want = ProbeInvalidCredentials
			case "bad-key":
				key = "../object"
				want = ProbeInvalidKey
			case "overlong-combined-key":
				cfg.Prefix = strings.Repeat("a", 1020)
				key = "object"
				want = ProbeInvalidKey
			}
			result, err := ProbeRead(ctx, cfg, credentials, key, limit)
			requireProbeFailure(t, result, err, want, 0)
		})
	}
	if n.Load() != 0 {
		t.Fatal("invalid input caused an HTTP request")
	}
}

func TestProbeCancelledOrExpiredBeforeRead(t *testing.T) {
	for _, expired := range []bool{false, true} {
		t.Run(fmt.Sprint(expired), func(t *testing.T) {
			var ctx context.Context
			var cancel context.CancelFunc
			want := ProbeCancelled
			sentinel := context.Canceled
			if expired {
				ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				want = ProbeDeadlineExceeded
				sentinel = context.DeadlineExceeded
			} else {
				ctx, cancel = context.WithCancel(context.Background())
				cancel()
			}
			defer cancel()
			result, err := ProbeRead(ctx, testConfig(), testCredentials(), "object", 1024)
			requireProbeFailure(t, result, err, want, 0)
			if !errors.Is(err, sentinel) {
				t.Fatal("context identity lost")
			}
		})
	}
}

func TestProbeCancellationDuringRealBody(t *testing.T) {
	started := make(chan struct{})
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.Header().Set("Content-Length", "100")
		_, _ = io.WriteString(w, "partial")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	var result ProbeResult
	var err error
	go func() {
		result, err = ProbeRead(ctx, probeConfig(s.URL), testCredentials(), "object", 100)
		close(done)
	}()
	select {
	case <-started:
		cancel()
	case <-time.After(3 * time.Second):
		t.Fatal("probe did not start")
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("probe cancellation did not settle")
	}
	requireProbeFailure(t, result, err, ProbeCancelled, 0)
	if !errors.Is(err, context.Canceled) || n.Load() != 1 {
		t.Fatal("lost cancellation or retried")
	}
}

func TestProbeDeadlineDuringRealBody(t *testing.T) {
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.Header().Set("Content-Length", "100")
		_, _ = io.WriteString(w, "partial")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := ProbeRead(ctx, probeConfig(s.URL), testCredentials(), "object", 100)
	requireProbeFailure(t, result, err, ProbeDeadlineExceeded, 0)
	if !errors.Is(err, context.DeadlineExceeded) || n.Load() != 1 {
		t.Fatal("lost deadline or retried")
	}
}

func TestProbeWireBodyFailuresNeverReportAcceptedBytes(t *testing.T) {
	for _, kind := range []string{"declared-too-large", "chunked-too-large", "truncated", "later-gzip"} {
		t.Run(kind, func(t *testing.T) {
			var n atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n.Add(1)
				w.Header().Set("ETag", "synthetic-private-tag")
				switch kind {
				case "declared-too-large":
					w.Header().Set("Content-Length", "12")
					_, _ = io.WriteString(w, "123456789012")
				case "chunked-too-large":
					w.(http.Flusher).Flush()
					_, _ = io.WriteString(w, "123456789012")
				case "truncated":
					w.Header().Set("Content-Length", "8")
					_, _ = io.WriteString(w, "short")
				case "later-gzip":
					w.Header().Add("Content-Encoding", "identity")
					w.Header().Add("Content-Encoding", "gzip")
					_, _ = io.WriteString(w, "encoded")
				}
			}))
			defer s.Close()
			want := ProbeBodyRejected
			if strings.Contains(kind, "too-large") {
				want = ProbeTooLarge
			}
			result, err := ProbeRead(context.Background(), probeConfig(s.URL), testCredentials(), "object", 8)
			requireProbeFailure(t, result, err, want, 0)
			if n.Load() != 1 {
				t.Fatal("body failure retried")
			}
		})
	}
}

func TestProbeTransportFailureAndUntrustedTLSAreSanitized(t *testing.T) {
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted TLS must not reach handler") }))
	s.Config.ErrorLog = log.New(io.Discard, "", 0)
	s.StartTLS()
	defer s.Close()
	result, err := ProbeRead(context.Background(), probeConfig(s.URL), testCredentials(), "private-object-key", 1024)
	requireProbeFailure(t, result, err, ProbeTransportFailure, 0)
	if err != ErrTransport || strings.Contains(err.Error(), s.URL) {
		t.Fatal("transport error was not sanitized")
	}
}

type probeCountBody struct{ reads, closes int }

func (b *probeCountBody) Read([]byte) (int, error) {
	b.reads++
	return 0, errors.New("synthetic-private-read-error")
}
func (b *probeCountBody) Close() error { b.closes++; return nil }
func TestProbeRejectedResponseClosesWithoutApplicationRead(t *testing.T) {
	for _, status := range []int{200, 403, 404, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			client := newTestClient(t)
			body := &probeCountBody{}
			calls := 0
			client.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Encoding": {"identity", "gzip"}}, Body: body, ContentLength: -1}, nil
			})
			want, reported := ProbeBodyRejected, 0
			switch status {
			case 403:
				want, reported = ProbeAccessDenied, 403
			case 404:
				want, reported = ProbeNotFound, 404
			case 503:
				want, reported = ProbeHTTPFailure, 503
			}
			result, err := probeRead(context.Background(), client, "object", 16)
			requireProbeFailure(t, result, err, want, reported)
			if calls != 1 || body.reads != 0 || body.closes != 1 {
				t.Fatal("refused response was read, left open or retried")
			}
		})
	}
}

func TestProbeUnknownOrWrappedErrorsNeverEchoInput(t *testing.T) {
	for _, original := range []error{ErrConfig, ErrCredentials, ErrKey, ErrBody, ErrTransport, ErrTooLarge, context.Canceled, context.DeadlineExceeded, &HTTPError{403}, errors.New("synthetic-private-unknown"), (*HTTPError)(nil)} {
		wrapped := fmt.Errorf("synthetic-private-wrapper: %w", original)
		result, err := probeFailure(wrapped)
		if err == nil || result.Outcome == ProbeReadable || result.AcceptedBytes != 0 || strings.Contains(err.Error(), "synthetic-private") {
			t.Fatal("probe returned arbitrary error wrapper or success")
		}
	}
}

func TestProbeConcurrentCallsKeepResultsIndependent(t *testing.T) {
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1); _, _ = io.WriteString(w, "safe") }))
	defer s.Close()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := ProbeRead(context.Background(), probeConfig(s.URL), testCredentials(), "object", 16)
			if err != nil || result != (ProbeResult{ProbeReadable, 200, 4}) {
				t.Error("parallel probe result incorrect")
			}
		}()
	}
	wg.Wait()
	if n.Load() != 12 {
		t.Fatal("probe repeated or skipped a call")
	}
}

func TestProbeNilOrZeroReaderCannotReportSuccess(t *testing.T) {
	for _, client := range []*ReadClient{nil, {}} {
		result, err := probeRead(context.Background(), client, "object", 16)
		requireProbeFailure(t, result, err, ProbeInvalidConfig, 0)
	}
}
