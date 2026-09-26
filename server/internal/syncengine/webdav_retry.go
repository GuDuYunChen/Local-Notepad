package syncengine

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// WebDAVHTTPError exposes protocol facts, never response bodies or URLs. A
// RetryAfterSeconds value is advisory; it does not schedule a whole sync run.
type WebDAVHTTPError struct {
	StatusCode        int
	RetryAfterSeconds int64
	Operation         string
}

func (e *WebDAVHTTPError) Error() string {
	return fmt.Sprintf("%s失败: HTTP %d（%s）", e.Operation, e.StatusCode, webDAVFailureLabel(e.Kind()))
}

func (e *WebDAVHTTPError) Kind() string {
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return "authentication"
	case http.StatusForbidden:
		return "permission"
	case http.StatusTooManyRequests:
		return "rate_limit"
	case http.StatusRequestTimeout, http.StatusInternalServerError,
		http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return "temporary_remote"
	case http.StatusInsufficientStorage:
		return "storage"
	default:
		return "remote_rejected"
	}
}

// Keep the underlying cause available to errors.Is/As without exposing the
// *url.Error string (which may contain a private endpoint or embedded token).
type WebDAVTransportError struct{ cause error }

func (e *WebDAVTransportError) Error() string {
	return "WebDAV 请求失败（" + webDAVFailureLabel(e.Kind()) + "）"
}
func (e *WebDAVTransportError) Unwrap() error { return e.cause }
func (e *WebDAVTransportError) Kind() string  { return classifyWebDAVTransport(e.cause) }

func webDAVFailureLabel(kind string) string {
	switch kind {
	case "authentication":
		return "认证失败，请检查账号和密码"
	case "permission":
		return "权限不足，请检查远端授权"
	case "rate_limit":
		return "远端限流，请稍后重试"
	case "temporary_remote":
		return "远端暂时不可用"
	case "temporary_network":
		return "网络暂时不可用"
	case "tls":
		return "TLS 或证书验证失败"
	case "cancelled":
		return "请求已取消"
	case "storage":
		return "远端存储空间不足"
	default:
		return "请检查连接配置或远端服务"
	}
}

func classifyWebDAVTransport(err error) string {
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	// Certificate errors can also satisfy net.Error. Never classify them as a
	// retryable network failure or weaken TLS verification to make a retry work.
	var verification *tls.CertificateVerificationError
	var authority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError
	var record tls.RecordHeaderError
	if errors.As(err, &verification) || errors.As(err, &authority) ||
		errors.As(err, &hostname) || errors.As(err, &invalid) || errors.As(err, &record) {
		return "tls"
	}
	var dns *net.DNSError
	if errors.As(err, &dns) && dns.IsNotFound {
		return "configuration"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return "temporary_network"
	}
	var network *net.OpError
	if errors.As(err, &network) {
		return "temporary_network"
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return "temporary_network"
	}
	return "configuration"
}

func retryableWebDAVStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// RFC 9110 section 10.2.3 allows both delay-seconds and HTTP-date. Saturating
// overflow prevents an enormous positive hint from turning into an immediate
// retry. Long valid hints are returned to the caller, not clamped downward.
func webDAVRetryAfter(raw string, now time.Time) (time.Duration, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	digits := true
	for _, c := range raw {
		if c < '0' || c > '9' {
			digits = false
			break
		}
	}
	if digits {
		seconds, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || seconds > uint64(math.MaxInt64/int64(time.Second)) {
			return time.Duration(math.MaxInt64), true
		}
		return time.Duration(seconds) * time.Second, true
	}
	at, err := http.ParseTime(raw)
	if err != nil {
		return 0, false
	}
	delay := at.Sub(now)
	if delay < 0 {
		delay = 0
	}
	return delay, true
}

func webDAVHTTPFailure(resp *http.Response, operation string, now time.Time) error {
	delay, _ := webDAVRetryAfter(resp.Header.Get("Retry-After"), now)
	seconds := int64(delay / time.Second)
	if delay%time.Second != 0 {
		seconds++
	}
	return &WebDAVHTTPError{StatusCode: resp.StatusCode, RetryAfterSeconds: seconds, Operation: operation}
}

const (
	webDAVReadAttempts = 3 // Original request plus at most two retries.
	webDAVMaxRetryWait = 5 * time.Second
	webDAVRequestLimit = 10 * time.Minute
)

type webDAVReadPolicy struct {
	now  func() time.Time
	wait func(context.Context, time.Duration) error
}

func waitWebDAVRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func doWebDAVRequest(client *http.Client, req *http.Request) (*http.Response, error) {
	return doWebDAVRequestWithPolicy(client, req, webDAVReadPolicy{now: time.Now, wait: waitWebDAVRetry})
}

// This is a transport READ retry, not an upload replay or a sync scheduler.
// It retries only before a response body is handed to the caller. Partial body
// failures, failed checksums and invalid manifests are deliberately not retried.
func doWebDAVRequestWithPolicy(client *http.Client, req *http.Request, policy webDAVReadPolicy) (*http.Response, error) {
	limit := client.Timeout
	if limit <= 0 || limit > webDAVRequestLimit {
		limit = webDAVRequestLimit
	}
	ctx, cancel := context.WithTimeout(req.Context(), limit)
	keepContext := false
	defer func() {
		if !keepContext {
			cancel()
		}
	}()
	// A shared context bounds every attempt, its waits AND the final body. Do
	// not give each retry a fresh Client.Timeout budget.
	boundedClient := *client
	boundedClient.Timeout = 0
	canRetry := (req.Method == http.MethodGet || req.Method == "PROPFIND") &&
		(req.Body == nil || req.Body == http.NoBody || req.GetBody != nil)
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			if attempt == 0 && req.Body != nil {
				_ = req.Body.Close()
			}
			return nil, &WebDAVTransportError{cause: err}
		}
		current := req.Clone(ctx)
		if attempt > 0 && req.Body != nil && req.Body != http.NoBody {
			body, err := req.GetBody()
			if err != nil {
				return nil, &WebDAVTransportError{cause: err}
			}
			current.Body = body
		}
		resp, err := boundedClient.Do(current)
		retry := canRetry && attempt+1 < webDAVReadAttempts && ctx.Err() == nil
		delay := time.Second << attempt
		if err != nil {
			retry = retry && classifyWebDAVTransport(err) == "temporary_network"
		} else {
			retry = retry && retryableWebDAVStatus(resp.StatusCode)
			if hint, valid := webDAVRetryAfter(resp.Header.Get("Retry-After"), policy.now()); valid && hint > delay {
				delay = hint
			}
			// Never shorten a server's hint. A long wait is surfaced as a
			// structured error for a future scheduler, not slept through here.
			retry = retry && delay <= webDAVMaxRetryWait
		}
		if !retry {
			if err != nil {
				if resp != nil && resp.Body != nil {
					_ = resp.Body.Close()
				}
				return nil, &WebDAVTransportError{cause: err}
			}
			resp.Body = &webDAVResponseBody{ReadCloser: resp.Body, cancel: cancel}
			keepContext = true
			return resp, nil
		}
		// Do not read an untrusted error body merely to reuse its connection:
		// a streaming/never-ending body must not defeat a bounded retry policy.
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err := policy.wait(ctx, delay); err != nil {
			return nil, &WebDAVTransportError{cause: err}
		}
	}
}

type webDAVResponseBody struct {
	io.ReadCloser
	cancel context.CancelFunc
	once   sync.Once
}

func (body *webDAVResponseBody) Read(p []byte) (int, error) {
	n, err := body.ReadCloser.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		return n, &WebDAVTransportError{cause: err}
	}
	return n, err
}

func (body *webDAVResponseBody) Close() error {
	body.once.Do(body.cancel)
	return body.ReadCloser.Close()
}
