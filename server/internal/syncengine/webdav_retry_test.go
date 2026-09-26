package syncengine

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type retryTestTransport func(*http.Request) (*http.Response, error)

func (fn retryTestTransport) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func retryTestResponse(status int, retryAfter string) *http.Response {
	header := make(http.Header)
	if retryAfter != "" {
		header.Set("Retry-After", retryAfter)
	}
	return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader("body-must-not-leak"))}
}

func retryTestPolicy(delays *[]time.Duration) webDAVReadPolicy {
	return webDAVReadPolicy{
		now: func() time.Time { return time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC) },
		wait: func(ctx context.Context, delay time.Duration) error {
			*delays = append(*delays, delay)
			return ctx.Err()
		},
	}
}

func retryTestRequest(t *testing.T, method string, body io.Reader) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, "https://dav.example.invalid/private-token-path", body)
	if err != nil {
		t.Fatal(err)
	}
	return req
}

func TestWebDAVReadRetriesAreBoundedAndPreservePROPFIND(t *testing.T) {
	var calls int
	var deadlines []time.Time
	var delays []time.Duration
	const payload = "<propfind xmlns=\"DAV:\"><prop/></propfind>"
	req := retryTestRequest(t, "PROPFIND", bytes.NewBufferString(payload))
	req.SetBasicAuth("alice", "private-password")
	req.Header.Set("Depth", "1")
	client := &http.Client{Timeout: time.Minute, Transport: retryTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		got, err := io.ReadAll(r.Body)
		_ = r.Body.Close()
		if err != nil || string(got) != payload || r.Header.Get("Depth") != "1" {
			t.Fatalf("replay changed request: %q %v", got, err)
		}
		user, password, ok := r.BasicAuth()
		if !ok || user != "alice" || password != "private-password" {
			t.Fatal("replay lost auth")
		}
		deadline, ok := r.Context().Deadline()
		if !ok {
			t.Fatal("no shared deadline")
		}
		deadlines = append(deadlines, deadline)
		if calls < 3 {
			return retryTestResponse(503, ""), nil
		}
		return retryTestResponse(207, ""), nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, req, retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if calls != 3 || resp.StatusCode != 207 {
		t.Fatalf("calls/status: %d %d", calls, resp.StatusCode)
	}
	if len(delays) != 2 || delays[0] != time.Second || delays[1] != 2*time.Second {
		t.Fatalf("waits: %v", delays)
	}
	if !deadlines[0].Equal(deadlines[1]) || !deadlines[1].Equal(deadlines[2]) {
		t.Fatal("deadline reset between attempts")
	}
}

func TestWebDAVPersistentReadFailureStopsAfterThreeAttempts(t *testing.T) {
	calls := 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return retryTestResponse(502, ""), nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if calls != 3 || len(delays) != 2 || resp.StatusCode != 502 {
		t.Fatalf("unbounded or lost status: %d %v", calls, delays)
	}
}

func TestWebDAVMutationsAreNeverRetried(t *testing.T) {
	for _, method := range []string{"PUT", "DELETE", "MKCOL", "MOVE", "COPY", "LOCK", "UNLOCK", "POST", "PATCH"} {
		t.Run(method, func(t *testing.T) {
			calls := 0
			var delays []time.Duration
			client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
				calls++
				return retryTestResponse(503, "1"), nil
			})}
			resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, method, nil), retryTestPolicy(&delays))
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if calls != 1 || len(delays) != 0 {
				t.Fatalf("mutation replayed: %d %v", calls, delays)
			}
		})
	}
}

func TestWebDAVReadPermanentHTTPFailuresAreNotRetried(t *testing.T) {
	for _, status := range []int{301, 400, 401, 403, 404, 405, 409, 412, 423, 501, 507} {
		calls := 0
		var delays []time.Duration
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
			calls++
			return retryTestResponse(status, ""), nil
		})}
		resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if calls != 1 || len(delays) != 0 {
			t.Fatalf("status %d retried", status)
		}
	}
}

func TestWebDAVRetryAfterSecondsDatesInvalidAndOverflow(t *testing.T) {
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		raw   string
		delay time.Duration
		valid bool
	}{
		{"5", 5 * time.Second, true}, {"0", 0, true}, {" 60 ", time.Minute, true},
		{now.Add(5 * time.Second).Format(http.TimeFormat), 5 * time.Second, true},
		{now.Add(-time.Minute).Format(http.TimeFormat), 0, true},
		{"", 0, false}, {"invalid", 0, false}, {"-1", 0, false}, {"1.5", 0, false},
		{"9999999999999999999999999", time.Duration(math.MaxInt64), true},
	} {
		delay, valid := webDAVRetryAfter(test.raw, now)
		if delay != test.delay || valid != test.valid {
			t.Errorf("%q: %v/%v", test.raw, delay, valid)
		}
	}
}

func TestWebDAVShortRetryAfterIsRespectedAndLongHintIsNotShortened(t *testing.T) {
	for _, hint := range []string{"5", "3600", "9999999999999999999999999"} {
		calls := 0
		var delays []time.Duration
		client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return retryTestResponse(429, hint), nil
			}
			return retryTestResponse(200, ""), nil
		})}
		resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if hint == "5" {
			if calls != 2 || len(delays) != 1 || delays[0] != 5*time.Second {
				t.Fatalf("short hint ignored: %v", delays)
			}
		} else if calls != 1 || len(delays) != 0 || resp.StatusCode != 429 {
			t.Fatal("long hint shortened into an immediate retry")
		}
	}
}

func TestWebDAVHTTPFailureDoesNotExposeBodyOrURL(t *testing.T) {
	resp := retryTestResponse(401, "60")
	resp.Request = retryTestRequest(t, http.MethodGet, nil)
	err := webDAVHTTPFailure(resp, "读取远端对象", time.Now())
	defer resp.Body.Close()
	var httpErr *WebDAVHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 401 || httpErr.RetryAfterSeconds != 60 || httpErr.Kind() != "authentication" {
		t.Fatal(err)
	}
	if strings.Contains(err.Error(), "body-must-not-leak") || strings.Contains(err.Error(), "private-token-path") {
		t.Fatalf("secret leak: %s", err)
	}
}

func TestWebDAVTransportErrorsPreserveCauseWithoutLeakingURL(t *testing.T) {
	calls := 0
	var delays []time.Duration
	cause := &url.Error{Op: "Get", URL: "https://private:user-secret@example.invalid/token", Err: &net.DNSError{Err: "no such host", Name: "secret-host", IsNotFound: true}}
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) { calls++; return nil, cause })}
	_, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if calls != 1 || err == nil || !errors.Is(err, cause) {
		t.Fatalf("cause/retry mismatch: %v %d", err, calls)
	}
	for _, secret := range []string{"user-secret", "secret-host", "private-token-path"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("leaked %s", secret)
		}
	}
}

func TestWebDAVCertificateErrorsAreNotTransient(t *testing.T) {
	for _, cause := range []error{
		x509.UnknownAuthorityError{}, x509.HostnameError{}, x509.CertificateInvalidError{},
		&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, tls.RecordHeaderError{},
	} {
		if kind := classifyWebDAVTransport(&url.Error{Op: "Get", URL: "https://secret.invalid", Err: cause}); kind != "tls" {
			t.Fatalf("classified %T as %s", cause, kind)
		}
	}
}

func TestWebDAVTemporaryNetworkFailureCanRecover(t *testing.T) {
	calls := 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return nil, io.EOF
		}
		return retryTestResponse(200, ""), nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if calls != 2 || len(delays) != 1 {
		t.Fatalf("did not recover: %d %v", calls, delays)
	}
}

func TestWebDAVMutationNetworkFailureIsNotReplayed(t *testing.T) {
	calls := 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) { calls++; return nil, io.EOF })}
	_, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodPut, nil), retryTestPolicy(&delays))
	if calls != 1 || err == nil || len(delays) != 0 {
		t.Fatalf("ambiguous PUT replayed: %d %v", calls, err)
	}
}

func TestWebDAVUnreplayablePROPFINDIsNotRetried(t *testing.T) {
	calls := 0
	var delays []time.Duration
	req := retryTestRequest(t, "PROPFIND", io.NopCloser(strings.NewReader("stream")))
	client := &http.Client{Transport: retryTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		_ = r.Body.Close()
		return retryTestResponse(503, ""), nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, req, retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if calls != 1 || len(delays) != 0 {
		t.Fatal("non-replayable body retried")
	}
}

func TestWebDAVCancellationStopsBackoffBeforeAnotherRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	var delays []time.Duration
	policy := retryTestPolicy(&delays)
	policy.wait = func(ctx context.Context, _ time.Duration) error { cancel(); return ctx.Err() }
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) { calls++; return retryTestResponse(503, ""), nil })}
	_, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil).WithContext(ctx), policy)
	if calls != 1 || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel ignored: %d %v", calls, err)
	}
}

func TestWebDAVAlreadyCancelledRequestDoesNotReachTransport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) { calls++; return retryTestResponse(200, ""), nil })}
	_, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil).WithContext(ctx), retryTestPolicy(&delays))
	if calls != 0 || !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled request reached transport")
	}
}

func TestWebDAVFinalResponseContextLivesUntilBodyClose(t *testing.T) {
	var requestContext context.Context
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(r *http.Request) (*http.Response, error) {
		requestContext = r.Context()
		return retryTestResponse(200, ""), nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	if requestContext.Err() != nil {
		t.Fatal("response body cancelled before consumption")
	}
	if _, err := io.ReadAll(resp.Body); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if requestContext.Err() != context.Canceled {
		t.Fatal("request timer leaked after Close")
	}
}

type retryTestFailingBody struct{}

func (retryTestFailingBody) Read([]byte) (int, error) {
	return 0, &url.Error{Op: "Get", URL: "https://secret.invalid/token", Err: io.ErrUnexpectedEOF}
}
func (retryTestFailingBody) Close() error { return nil }

func TestWebDAVPartialBodyFailureIsNotReplayedOrExposed(t *testing.T) {
	calls := 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
		calls++
		r := retryTestResponse(200, "")
		r.Body = retryTestFailingBody{}
		return r, nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	_, err = io.ReadAll(resp.Body)
	if calls != 1 || !errors.Is(err, io.ErrUnexpectedEOF) || strings.Contains(err.Error(), "secret.invalid") {
		t.Fatalf("partial body mishandled: %d %v", calls, err)
	}
}

type retryTestNoReadBody struct{ closed *int }

func (retryTestNoReadBody) Read([]byte) (int, error) { panic("must not drain untrusted error body") }
func (b retryTestNoReadBody) Close() error           { *b.closed++; return nil }

func TestWebDAVRetryClosesErrorBodiesWithoutDraining(t *testing.T) {
	calls, closed := 0, 0
	var delays []time.Duration
	client := &http.Client{Transport: retryTestTransport(func(*http.Request) (*http.Response, error) {
		calls++
		r := retryTestResponse(503, "")
		r.Body = retryTestNoReadBody{closed: &closed}
		return r, nil
	})}
	resp, err := doWebDAVRequestWithPolicy(client, retryTestRequest(t, http.MethodGet, nil), retryTestPolicy(&delays))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if closed != 3 {
		t.Fatalf("leaked retry response: %d", closed)
	}
}

func TestWebDAVSharedDeadlineIsNotRetriedAfterExhaustion(t *testing.T) {
	calls := 0
	client := &http.Client{Timeout: 10 * time.Millisecond, Transport: retryTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}
	_, err := doWebDAVRequest(client, retryTestRequest(t, http.MethodGet, nil))
	if calls != 1 || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline reset: %d %v", calls, err)
	}
}
