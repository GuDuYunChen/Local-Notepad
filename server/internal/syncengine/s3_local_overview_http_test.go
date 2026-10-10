package syncengine

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

const localOverviewBody = `{"readOnly":true}`

func localOverviewRequest(raw string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, S3LocalOverviewPath, strings.NewReader(raw))
	r.Host, r.RemoteAddr = "127.0.0.1:27121", "127.0.0.1:45000"
	r.Header.Set("Content-Type", "application/json; charset=utf-8")
	r.Header.Set(syncs3.ReadProbeIntentHeader, S3LocalOverviewIntent)
	return r
}

func localOverviewFixture(t *testing.T) (*S3LocalOverviewHandler, *s3DBFixture) {
	t.Helper()
	f := s3DBFixtureNew()
	root := s3AttachmentFixture(t, map[string][]byte{"PRIVATE_NAME.bin": []byte("PRIVATE_BODY")})
	h, err := NewS3LocalOverviewHandler(s3DBOpen(t, f), root, s3CandidateLimits())
	if err != nil || f.begins.Load() != 0 || root.opens != 0 || root.stats != 0 {
		t.Fatal("constructor read resources or rejected valid capabilities", err)
	}
	return h, f
}

func localOverviewCheck(t *testing.T, rr *httptest.ResponseRecorder, status int, message string) s3LocalOverviewEnvelope {
	t.Helper()
	var out s3LocalOverviewEnvelope
	if rr.Code != status || json.Unmarshal(rr.Body.Bytes(), &out) != nil || out.Message != message {
		t.Fatalf("wrong bounded reply: status=%d, want=%d, body=%s", rr.Code, status, rr.Body.String())
	}
	code := status
	if status == 200 {
		code = 0
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(rr.Body.Bytes(), &envelope) != nil || len(envelope) != 3 || out.Code != code || (status != 200 && out.Data != nil) || (status == 200 && out.Data == nil) {
		t.Fatal("partial, missing, or extended envelope")
	}
	for _, marker := range []string{"PRIVATE", "captured-store", "PRIVATE_BODY", "雪<&>", "gone", "endpoint", "credentials"} {
		if strings.Contains(rr.Body.String(), marker) {
			t.Fatal("private detail escaped HTTP", marker)
		}
	}
	if rr.Header().Get("Cache-Control") != "no-store" || rr.Header().Get("X-Content-Type-Options") != "nosniff" || rr.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatal("missing response privacy headers")
	}
	for key := range rr.Header() {
		if strings.HasPrefix(strings.ToLower(key), "access-control-allow-") {
			t.Fatal("browser CORS admitted")
		}
	}
	return out
}

type localOverviewObservedBody struct {
	io.Reader
	onRead, onClose func()
	closeErr        error
	reads, closes   int
}

func (b *localOverviewObservedBody) Read(p []byte) (int, error) {
	b.reads++
	if b.onRead != nil {
		b.onRead()
	}
	return b.Reader.Read(p)
}
func (b *localOverviewObservedBody) Close() error {
	b.closes++
	if b.onClose != nil {
		b.onClose()
	}
	return b.closeErr
}

func TestS3LocalOverviewHTTPActualReaderAndFixedCounts(t *testing.T) {
	h, f := localOverviewFixture(t)
	body := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody)}
	f.before = func(string) {
		if body.closes != 1 {
			t.Error("database read before admitted body cleanup")
		}
	}
	r := localOverviewRequest(localOverviewBody)
	r.Body = body
	rr := httptest.NewRecorder()
	rr.Header()["aCcEsS-cOnTrOl-AlLoW-oRiGiN"] = []string{"*"}
	h.ServeHTTP(rr, r)
	out := localOverviewCheck(t, rr, 200, "OK").Data
	if out.Records != 5 || out.AttachmentBytes != 12 || out.Kinds[0].Records != 2 || out.Kinds[3].Records != 1 || !out.ReadOnly || !out.ObservedStable || out.CompleteForPreview || out.BaseItems != 1 {
		t.Fatal("incorrect scope or counts", out)
	}
	if f.begins.Load() != 2 || f.rollbacks.Load() != 2 || f.commits.Load() != 0 || body.closes != 1 {
		t.Fatal("reader retried, wrote, or did not clean up")
	}
	if _, err := h.root.Lstat("PRIVATE_NAME.bin"); err != nil {
		t.Fatal("borrowed capability closed")
	}
	var envelope map[string]json.RawMessage
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(rr.Body.Bytes(), &envelope)
	_ = json.Unmarshal(envelope["data"], &fields)
	if len(fields) != 10 {
		t.Fatal("output schema expanded")
	}
}

func TestS3LocalOverviewHTTPConstructorRefusesInvalidCapabilitiesWithoutIO(t *testing.T) {
	f := s3DBFixtureNew()
	db := s3DBOpen(t, f)
	root := s3AttachmentFixture(t, nil)
	for _, point := range []string{"database", "root", "typed-nil-root", "database-count", "attachment-count", "file-bytes", "total-file-bytes", "record-bytes", "union-count", "union-bytes"} {
		t.Run(point, func(t *testing.T) {
			d, r, l := db, S3LocalAttachmentRoot(root), s3CandidateLimits()
			switch point {
			case "database":
				d = nil
			case "root":
				r = nil
			case "typed-nil-root":
				r = typedNilLocalOverviewRoot()
			case "database-count":
				l.Database.Records = 129
			case "attachment-count":
				l.Attachments.Attachments = 129
			case "file-bytes":
				l.Attachments.FileBytes = 0
			case "total-file-bytes":
				l.Attachments.TotalFileBytes = -1
			case "record-bytes":
				l.Database.RecordBytes = 0
			case "union-count":
				l.Records = 257
			case "union-bytes":
				l.TotalRecordBytes = 0
			}
			h, err := NewS3LocalOverviewHandler(d, r, l)
			if h != nil || !errors.Is(err, ErrS3LocalOverviewHandlerInput) || f.begins.Load() != 0 || root.opens != 0 || root.stats != 0 {
				t.Fatal("invalid constructor performed I/O or exposed a handler", err)
			}
		})
	}
	l := s3CandidateLimits()
	h, err := NewS3LocalOverviewHandler(db, root, l)
	if err != nil {
		t.Fatal(err)
	}
	l.Records = 0
	if h.limits.Records == 0 {
		t.Fatal("retained caller-owned budget pointer")
	}
}

// Reuse the actual fixture root's type without invoking any method on nil.
func typedNilLocalOverviewRoot() S3LocalAttachmentRoot {
	var r *s3AttachmentFixtureRoot
	return r
}

func TestS3LocalOverviewHTTPRefusesTargetsHeadersAndBrowsersBeforeRead(t *testing.T) {
	tests := []struct {
		name   string
		edit   func(*http.Request)
		status int
		msg    string
	}{
		{"get", func(r *http.Request) { r.Method = "GET" }, 405, "method-not-allowed"},
		{"options", func(r *http.Request) { r.Method = "OPTIONS" }, 405, "method-not-allowed"},
		{"remote", func(r *http.Request) { r.RemoteAddr = "192.0.2.1:45000" }, 403, "native-loopback-required"},
		{"host", func(r *http.Request) { r.Host = "PRIVATE.example" }, 403, "native-loopback-required"},
		{"origin", func(r *http.Request) { r.Header.Set("Origin", "null") }, 403, "native-loopback-required"},
		{"referer", func(r *http.Request) { r.Header["rEfErEr"] = []string{""} }, 403, "native-loopback-required"},
		{"fetch-metadata", func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "none") }, 403, "native-loopback-required"},
		{"missing-intent", func(r *http.Request) { r.Header.Del(syncs3.ReadProbeIntentHeader) }, 403, "native-loopback-required"},
		{"wrong-intent", func(r *http.Request) { r.Header.Set(syncs3.ReadProbeIntentHeader, S3PreviewIntent) }, 403, "native-loopback-required"},
		{"duplicate-intent", func(r *http.Request) {
			r.Header[strings.ToLower(syncs3.ReadProbeIntentHeader)] = []string{S3LocalOverviewIntent}
		}, 403, "native-loopback-required"},
		{"path", func(r *http.Request) { r.URL.Path += "/" }, 400, "invalid-request-target"},
		{"raw-path", func(r *http.Request) { r.URL.RawPath = S3LocalOverviewPath }, 400, "invalid-request-target"},
		{"query", func(r *http.Request) { r.URL.RawQuery = "path=PRIVATE" }, 400, "invalid-request-target"},
		{"empty-query", func(r *http.Request) { r.URL.ForceQuery = true }, 400, "invalid-request-target"},
		{"absolute", func(r *http.Request) { r.URL.Scheme, r.URL.Host = "http", "127.0.0.1:27121" }, 400, "invalid-request-target"},
		{"user-info", func(r *http.Request) { r.URL.User = url.User("PRIVATE") }, 400, "invalid-request-target"},
		{"fragment", func(r *http.Request) { r.URL.Fragment = "PRIVATE" }, 400, "invalid-request-target"},
		{"opaque", func(r *http.Request) { r.URL.Opaque = "PRIVATE" }, 400, "invalid-request-target"},
		{"missing-json", func(r *http.Request) { r.Header.Del("Content-Type") }, 415, "json-required"},
		{"duplicate-json", func(r *http.Request) { r.Header["content-type"] = []string{"application/json"} }, 415, "json-required"},
		{"charset", func(r *http.Request) { r.Header.Set("Content-Type", "application/json; charset=utf-16") }, 415, "json-required"},
		{"parameter", func(r *http.Request) { r.Header.Set("Content-Type", "application/json; boundary=PRIVATE") }, 415, "json-required"},
		{"encoding", func(r *http.Request) { r.Header["cOnTeNt-EnCoDiNg"] = []string{"identity", "gzip"} }, 415, "encoded-or-trailer-request-refused"},
		{"trailer-header", func(r *http.Request) { r.Header.Set("Trailer", "PRIVATE") }, 415, "encoded-or-trailer-request-refused"},
		{"trailer", func(r *http.Request) { r.Trailer = http.Header{"PRIVATE": []string{"value"}} }, 400, "invalid-request"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h, f := localOverviewFixture(t)
			r := localOverviewRequest(localOverviewBody)
			body := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody)}
			r.Body = body
			tc.edit(r)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			localOverviewCheck(t, rr, tc.status, tc.msg)
			if f.begins.Load() != 0 || body.reads != 0 {
				t.Fatal("rejected request touched body or database")
			}
		})
	}
}

func TestS3LocalOverviewHTTPStrictIntentOnlyBody(t *testing.T) {
	for _, raw := range []string{"", `{}`, `null`, `[]`, `true`, `{"readOnly":false}`, `{"readOnly":"true"}`, `{"ReadOnly":true}`, `{"readOnly":1}`, `{"readOnly":null}`, `{"readOnly":true,"readOnly":true}`, `{"readOnly":true,"read\u004fnly":true}`, `{"readOnly":true,"path":"PRIVATE"}`, `{"readOnly":true,"limits":{}}`, `{"readOnly":true,"records":{}}`, `{"readOnly":true,"connection":{}}`, `{"readOnly":true}{}`, `{"readOnly":true}x`, `{"readOnly":true,}`, "\xef\xbb\xbf" + localOverviewBody} {
		t.Run(fmt.Sprintf("body-%x", []byte(raw)), func(t *testing.T) {
			h, f := localOverviewFixture(t)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, localOverviewRequest(raw))
			localOverviewCheck(t, rr, 400, "invalid-request")
			if f.begins.Load() != 0 {
				t.Fatal("invalid body reached local data")
			}
		})
	}
	for _, raw := range []string{localOverviewBody, "\n{ \"readOnly\" : true }\r\n", `{"read\u004fnly":true}`, localOverviewBody + strings.Repeat(" ", int(MaxS3LocalOverviewRequestBytes)-len(localOverviewBody))} {
		t.Run(fmt.Sprintf("valid-%d", len(raw)), func(t *testing.T) {
			h, _ := localOverviewFixture(t)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, localOverviewRequest(raw))
			localOverviewCheck(t, rr, 200, "OK")
		})
	}
}

func TestS3LocalOverviewHTTPBodyBoundsErrorsAndCleanup(t *testing.T) {
	for _, point := range []string{"declared-too-large", "stream-too-large", "close-error", "read-error", "late-trailer", "length-mismatch", "nil-body"} {
		t.Run(point, func(t *testing.T) {
			h, f := localOverviewFixture(t)
			r := localOverviewRequest(localOverviewBody)
			body := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody)}
			r.Body = body
			status, msg := 400, "invalid-request"
			switch point {
			case "declared-too-large":
				r.ContentLength = MaxS3LocalOverviewRequestBytes + 1
				status, msg = 413, "request-too-large"
			case "stream-too-large":
				r.ContentLength = -1
				body.Reader = strings.NewReader(strings.Repeat(" ", 1000))
				status, msg = 413, "request-too-large"
			case "close-error":
				body.closeErr = errors.New("PRIVATE_CLOSE")
			case "read-error":
				body.Reader = localOverviewErrorReader{}
			case "late-trailer":
				body.onClose = func() { r.Trailer = http.Header{"PRIVATE": []string{"value"}} }
			case "length-mismatch":
				r.ContentLength++
			case "nil-body":
				r.Body = nil
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			localOverviewCheck(t, rr, status, msg)
			if f.begins.Load() != 0 || (point != "nil-body" && body.closes != 1) || (point == "declared-too-large" && body.reads != 0) {
				t.Fatal("body rejection leaked resources or started a scan")
			}
			// A refused request releases admission for a fresh explicit request.
			rr = httptest.NewRecorder()
			h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
			localOverviewCheck(t, rr, 200, "OK")
		})
	}
}

type localOverviewErrorReader struct{}

func (localOverviewErrorReader) Read([]byte) (int, error) { return 0, errors.New("PRIVATE_READ") }

func TestS3LocalOverviewHTTPInvalidRequestAndUninitializedHandler(t *testing.T) {
	h, f := localOverviewFixture(t)
	for _, r := range []*http.Request{nil, {Method: "POST"}} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		localOverviewCheck(t, rr, 400, "invalid-request")
	}
	for _, invalid := range []*S3LocalOverviewHandler{nil, {}} {
		rr := httptest.NewRecorder()
		invalid.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
		localOverviewCheck(t, rr, 503, "local-overview-unavailable")
	}
	if f.begins.Load() != 0 {
		t.Fatal("invalid handler/request read database")
	}
}

func TestS3LocalOverviewHTTPCancellationBeforeDuringAndAfterBody(t *testing.T) {
	for _, point := range []string{"before", "body-read", "body-close", "deadline", "database"} {
		t.Run(point, func(t *testing.T) {
			h, f := localOverviewFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			status, msg := 408, "local-overview-cancelled"
			body := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody)}
			switch point {
			case "before":
				cancel()
			case "body-read":
				body.onRead = cancel
			case "body-close":
				body.onClose = cancel
			case "deadline":
				var end context.CancelFunc
				ctx, end = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				defer end()
				status, msg = 504, "local-overview-timeout"
			case "database":
				f.before = func(table string) {
					if table == "tags" {
						cancel()
					}
				}
			}
			r := localOverviewRequest(localOverviewBody).WithContext(ctx)
			r.Body = body
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			localOverviewCheck(t, rr, status, msg)
			if point != "database" && f.begins.Load() != 0 {
				t.Fatal("cancelled body started database scan")
			}
			if point == "database" && f.begins.Load() != 1 {
				t.Fatal("cancelled scan continued to second database observation")
			}
		})
	}
}

func localOverviewAwait(t *testing.T, c <-chan struct{}) {
	t.Helper()
	select {
	case <-c:
	case <-time.After(3 * time.Second):
		t.Fatal("controlled operation did not reach expected lifecycle point")
	}
}

func TestS3LocalOverviewHTTPBusyHoldsSlotThroughBodyClose(t *testing.T) {
	h, f := localOverviewFixture(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	body := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody), onClose: func() { close(entered); <-release }}
	r := localOverviewRequest(localOverviewBody)
	r.Body = body
	first := httptest.NewRecorder()
	go func() { defer close(done); h.ServeHTTP(first, r) }()
	localOverviewAwait(t, entered)
	// A copied handler shares its admission slot, not an independent allowance.
	copy := *h
	secondBody := &localOverviewObservedBody{Reader: strings.NewReader(localOverviewBody)}
	secondReq := localOverviewRequest(localOverviewBody)
	secondReq.Body = secondBody
	rr := httptest.NewRecorder()
	copy.ServeHTTP(rr, secondReq)
	localOverviewCheck(t, rr, 429, "local-overview-busy")
	if secondBody.reads != 0 || f.begins.Load() != 0 {
		t.Fatal("overlapping or not-yet-cleaned-up body started reading")
	}
	once.Do(func() { close(release) })
	localOverviewAwait(t, done)
	localOverviewCheck(t, first, 200, "OK")
}

func TestS3LocalOverviewHTTPCancelledReaderKeepsSlotUntilReturn(t *testing.T) {
	h, _ := localOverviewFixture(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	var calls atomic.Int32
	// An intentionally uncooperative internal test operation. It must not be
	// detached or freed simply because the caller has stopped waiting.
	h.read = func(context.Context, *sql.DB, S3LocalAttachmentRoot, S3LocalCandidateLimits) (S3LocalOverview, error) {
		calls.Add(1)
		close(entered)
		<-release
		return S3LocalOverview{Format: "PRIVATE_LATE"}, errors.New("PRIVATE_LATE_ERROR")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := httptest.NewRecorder()
	go func() {
		defer close(done)
		h.ServeHTTP(first, localOverviewRequest(localOverviewBody).WithContext(ctx))
	}()
	localOverviewAwait(t, entered)
	cancel()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 429, "local-overview-busy")
	once.Do(func() { close(release) })
	localOverviewAwait(t, done)
	localOverviewCheck(t, first, 408, "local-overview-cancelled")
	if calls.Load() != 1 {
		t.Fatal("cancelled reader was retried or overlapped")
	}
	h.read = ReadS3LocalOverview
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 200, "OK")
}

func TestS3LocalOverviewHTTPDeadlineAndLateSuccessRefusal(t *testing.T) {
	for _, earlier := range []bool{false, true} {
		t.Run(fmt.Sprint(earlier), func(t *testing.T) {
			h, _ := localOverviewFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var expected time.Time
			if earlier {
				expected = time.Now().Add(time.Second)
				var end context.CancelFunc
				ctx, end = context.WithDeadline(ctx, expected)
				defer end()
			}
			started := time.Now()
			h.read = func(ctx context.Context, db *sql.DB, root S3LocalAttachmentRoot, l S3LocalCandidateLimits) (S3LocalOverview, error) {
				d, ok := ctx.Deadline()
				if !ok || d.After(started.Add(s3LocalOverviewHTTPTimeout+100*time.Millisecond)) || (earlier && !d.Equal(expected)) {
					t.Error("shared deadline missing, refreshed or lengthened")
				}
				out, err := ReadS3LocalOverview(ctx, db, root, l)
				cancel()
				return out, err
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, localOverviewRequest(localOverviewBody).WithContext(ctx))
			localOverviewCheck(t, rr, 408, "local-overview-cancelled")
		})
	}
}

func TestS3LocalOverviewHTTPReadFailureEmptyAndNoCache(t *testing.T) {
	h, f := localOverviewFixture(t)
	f.failQuery = "tags"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 422, "local-overview-not-available")
	f.failQuery = ""
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 200, "OK")
	// Close the BORROWED database ourselves: an old success cannot be replayed.
	if err := h.db.Close(); err != nil {
		t.Fatal(err)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 422, "local-overview-not-available")
	// A truly empty fixture still has the fixed kind rows and no preview consent.
	h, f = localOverviewFixture(t)
	for _, key := range []string{"files", "tags", "links", "base"} {
		f.data[key] = nil
	}
	h.root = s3AttachmentFixture(t, nil)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	out := localOverviewCheck(t, rr, 200, "OK").Data
	if out.Records != 0 || out.RecordBytes != 0 || out.CompleteForPreview || !out.ObservedStable {
		t.Fatal("empty inventory changed scope")
	}
}

func TestS3LocalOverviewHTTPRejectsCorruptInternalCounters(t *testing.T) {
	mutations := map[string]func(*S3LocalOverview){
		"private-format":         func(o *S3LocalOverview) { o.Format = "PRIVATE_FORMAT" },
		"version":                func(o *S3LocalOverview) { o.Version++ },
		"write":                  func(o *S3LocalOverview) { o.ReadOnly = false },
		"unstable":               func(o *S3LocalOverview) { o.ObservedStable = false },
		"complete":               func(o *S3LocalOverview) { o.CompleteForPreview = true },
		"negative-records":       func(o *S3LocalOverview) { o.Records = -1 },
		"record-total":           func(o *S3LocalOverview) { o.Records++ },
		"negative-bytes":         func(o *S3LocalOverview) { o.RecordBytes = -1 },
		"byte-total":             func(o *S3LocalOverview) { o.RecordBytes++ },
		"negative-base":          func(o *S3LocalOverview) { o.BaseItems = -1 },
		"base-limit":             func(o *S3LocalOverview) { o.BaseItems = 129 },
		"negative-body":          func(o *S3LocalOverview) { o.AttachmentBytes = -1 },
		"body-limit":             func(o *S3LocalOverview) { o.AttachmentBytes = 1 << 62 },
		"private-kind":           func(o *S3LocalOverview) { o.Kinds[0].Kind = "PRIVATE_KIND" },
		"negative-kind":          func(o *S3LocalOverview) { o.Kinds[0].Records = -1 },
		"huge-kind":              func(o *S3LocalOverview) { o.Kinds[3].Records = 1 << 30 },
		"negative-kind-bytes":    func(o *S3LocalOverview) { o.Kinds[0].RecordBytes = -1 },
		"huge-kind-bytes":        func(o *S3LocalOverview) { o.Kinds[0].RecordBytes = 1 << 62 },
		"zero-bytes-with-record": func(o *S3LocalOverview) { o.RecordBytes -= o.Kinds[0].RecordBytes; o.Kinds[0].RecordBytes = 0 },
		"bytes-without-record":   func(o *S3LocalOverview) { o.Records -= o.Kinds[3].Records; o.Kinds[3].Records = 0 },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			h, _ := localOverviewFixture(t)
			h.read = func(ctx context.Context, db *sql.DB, root S3LocalAttachmentRoot, l S3LocalCandidateLimits) (S3LocalOverview, error) {
				o, err := ReadS3LocalOverview(ctx, db, root, l)
				if err != nil {
					t.Fatal(err)
				}
				mutate(&o)
				return o, nil
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
			localOverviewCheck(t, rr, 422, "local-overview-not-available")
		})
	}
}

func TestS3LocalOverviewHTTPFormattingDoesNotExposeCapabilities(t *testing.T) {
	h, _ := localOverviewFixture(t)
	for _, value := range []any{h, *h, struct{ H any }{h}, struct{ H any }{*h}, []any{h, *h}} {
		for _, format := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x"} {
			text := fmt.Sprintf(format, value)
			if strings.Contains(text, "PRIVATE") || strings.Contains(text, "directory:") || strings.Contains(text, "connector:") || strings.Contains(text, "limits:") || !strings.Contains(text, "read-only") {
				t.Fatal("capability/driver details exposed by formatting", text)
			}
		}
	}
	b, err := json.Marshal(h)
	if err != nil || !bytes.Equal(b, []byte("{}")) {
		t.Fatal("handler serialization exposed capabilities")
	}
}
