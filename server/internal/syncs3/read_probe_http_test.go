package syncs3

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func httpProbeFields(endpoint string) map[string]any {
	return map[string]any{"endpoint": endpoint, "bucket": "test-bucket", "region": "us-east-1", "prefix": "notes", "accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "synthetic-secret-HTTP", "sessionToken": "synthetic-token-HTTP", "key": "目录/📝.json", "maxBytes": 1024, "readOnly": true}
}
func httpProbeJSON(fields map[string]any) string { b, _ := json.Marshal(fields); return string(b) }
func httpProbeRequest(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, ReadProbePath, strings.NewReader(body))
	r.Host = "127.0.0.1:27121"
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set(ReadProbeIntentHeader, ReadProbeIntent)
	return r
}
func httpProbeEnvelope(t *testing.T, w *httptest.ResponseRecorder) probeEnvelope {
	t.Helper()
	var e probeEnvelope
	if json.Unmarshal(w.Body.Bytes(), &e) != nil {
		t.Fatal("response is not JSON")
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing response privacy headers")
	}
	return e
}
func assertHTTPProbeRedacted(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	for _, s := range []string{"AKIDEXAMPLE", "synthetic-secret-HTTP", "synthetic-token-HTTP", "private-object-body", "private-etag", "Authorization", "目录"} {
		if strings.Contains(w.Body.String(), s) {
			t.Fatal("response exposed request/remote detail")
		}
	}
}

func TestProbeHTTPReadsOneRealSignedObject(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "GET" || r.URL.Path != "/test-bucket/notes/目录/📝.json" || r.Header.Get("Authorization") == "" || r.Header.Get("X-Amz-Security-Token") != "synthetic-token-HTTP" {
			t.Error("wrong signed request contract")
		}
		w.Header().Set("ETag", "private-etag")
		_, _ = io.WriteString(w, "private-object-body")
	}))
	defer upstream.Close()
	server := httptest.NewServer(NewReadProbeHandler())
	defer server.Close()
	body := httpProbeJSON(httpProbeFields(upstream.URL))
	req, _ := http.NewRequest("POST", server.URL+ReadProbePath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(ReadProbeIntentHeader, ReadProbeIntent)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal("local HTTP handler unavailable")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var e probeEnvelope
	if json.Unmarshal(raw, &e) != nil || res.StatusCode != 200 || e.Code != 0 || e.Data == nil || e.Data.Outcome != ProbeReadable || e.Data.AcceptedBytes != 19 || e.Data.HTTPStatus != 200 {
		t.Fatal("incorrect preflight summary")
	}
	if requests.Load() != 1 || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("repeated request or cacheable reply")
	}
	if strings.Contains(string(raw), "private-") || strings.Contains(string(raw), upstream.URL) || strings.Contains(string(raw), "synthetic-") {
		t.Fatal("remote/request details escaped")
	}
}

func TestProbeHTTPRejectsNonNativeCallersBeforeBodyRead(t *testing.T) {
	cases := []struct {
		name   string
		change func(*http.Request)
	}{
		{"external-peer", func(r *http.Request) { r.RemoteAddr = "192.0.2.1:123" }},
		{"missing-peer", func(r *http.Request) { r.RemoteAddr = "" }},
		{"rebound-host", func(r *http.Request) { r.Host = "attacker.example:27121" }},
		{"host-userinfo", func(r *http.Request) { r.Host = "user@127.0.0.1:27121" }},
		{"invalid-port", func(r *http.Request) { r.Host = "127.0.0.1:99999" }},
		{"origin-null", func(r *http.Request) { r.Header.Set("Origin", "null") }},
		{"origin-empty", func(r *http.Request) { r.Header["origin"] = []string{""} }},
		{"origin-local", func(r *http.Request) { r.Header.Set("Origin", "http://localhost:5173") }},
		{"origin-external", func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") }},
		{"referer", func(r *http.Request) { r.Header.Set("Referer", "http://localhost") }},
		{"fetch-site", func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "same-origin") }},
		{"intent-missing", func(r *http.Request) { r.Header.Del(ReadProbeIntentHeader) }},
		{"intent-duplicate", func(r *http.Request) { r.Header.Add(ReadProbeIntentHeader, ReadProbeIntent) }},
		{"intent-wrong", func(r *http.Request) { r.Header.Set(ReadProbeIntentHeader, "write") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var calls int
			h := NewReadProbeHandler()
			h.probe = func(context.Context, Config, Credentials, string, int64) (ProbeResult, error) {
				calls++
				return ProbeResult{}, nil
			}
			r := httpProbeRequest("{}")
			body := &httpProbeCountingBody{}
			r.Body = body
			c.change(r)
			w := httptest.NewRecorder()
			w.Header().Set("Access-Control-Allow-Origin", "null")
			h.ServeHTTP(w, r)
			e := httpProbeEnvelope(t, w)
			if w.Code != 403 || e.Data != nil || calls != 0 || body.reads != 0 || w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("non-native caller was not rejected before input/probe")
			}
		})
	}
}

type httpProbeCountingBody struct {
	reads, closes int
	raw           *strings.Reader
	err           error
}

func (b *httpProbeCountingBody) Read(p []byte) (int, error) {
	b.reads++
	if b.err != nil {
		return 0, b.err
	}
	if b.raw == nil {
		return 0, io.EOF
	}
	return b.raw.Read(p)
}
func (b *httpProbeCountingBody) Close() error { b.closes++; return nil }

func TestProbeHTTPValidNativeHostVariants(t *testing.T) {
	for _, c := range []struct{ host, peer string }{{"localhost:27121", "127.0.0.1:20"}, {"127.0.0.1", "127.0.0.1:20"}, {"[::1]:27121", "[::1]:20"}} {
		r := httpProbeRequest("{}")
		r.Host = c.host
		r.RemoteAddr = c.peer
		if !nativeProbeRequest(r) {
			t.Fatal("supported native loopback rejected")
		}
	}
}
func TestProbeHTTPRejectsInvalidTransportEnvelope(t *testing.T) {
	cases := []struct {
		name   string
		status int
		change func(*http.Request)
	}{
		{"GET", 405, func(r *http.Request) { r.Method = "GET" }}, {"OPTIONS", 405, func(r *http.Request) { r.Method = "OPTIONS" }},
		{"query", 400, func(r *http.Request) { r.URL.RawQuery = "secret=synthetic-secret-HTTP" }},
		{"empty-query", 400, func(r *http.Request) { r.URL.ForceQuery = true }},
		{"other-path", 400, func(r *http.Request) { r.URL.Path = "/api/sync/run" }},
		{"raw-path", 400, func(r *http.Request) { r.URL.RawPath = "/api/sync/s3/%70robe" }},
		{"absolute-target", 400, func(r *http.Request) { r.URL.Scheme = "http"; r.URL.Host = "127.0.0.1" }},
		{"form", 415, func(r *http.Request) { r.Header.Set("Content-Type", "application/x-www-form-urlencoded") }},
		{"missing-type", 415, func(r *http.Request) { r.Header.Del("Content-Type") }},
		{"duplicate-type", 415, func(r *http.Request) { r.Header.Add("Content-Type", "application/json") }},
		{"charset", 415, func(r *http.Request) { r.Header.Set("Content-Type", "application/json; charset=latin-1") }},
		{"extra-param", 415, func(r *http.Request) { r.Header.Set("Content-Type", "application/json; x=1") }},
		{"compression", 415, func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }},
		{"empty-compression", 415, func(r *http.Request) { r.Header["content-encoding"] = []string{""} }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httpProbeRequest("{}")
			b := &httpProbeCountingBody{}
			r.Body = b
			c.change(r)
			w := httptest.NewRecorder()
			NewReadProbeHandler().ServeHTTP(w, r)
			if w.Code != c.status || b.reads != 0 {
				t.Fatal("invalid envelope accepted/read")
			}
			httpProbeEnvelope(t, w)
			assertHTTPProbeRedacted(t, w)
		})
	}
}

func TestProbeHTTPStrictJSONContract(t *testing.T) {
	good := httpProbeJSON(httpProbeFields("http://127.0.0.1:1"))
	invalid := []string{"", "null", "[]", "{}", good + "{}", good + " false", "{", strings.Replace(good, `"readOnly":true`, `"readOnly":false`, 1), strings.Replace(good, `"readOnly":true`, `"readOnly":null`, 1), strings.Replace(good, `"readOnly":true`, `"readOnly":"true"`, 1), strings.Replace(good, `"readOnly":true`, `"ReadOnly":true`, 1), strings.Replace(good, `"key":`, `"KEY":`, 1), strings.Replace(good, `"key":`, `"key":"x","key":`, 1), strings.Replace(good, `"key":`, `"\u006bey":"x","key":`, 1), strings.Replace(good, `"key":`, `"extra":1,"key":`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":1e3`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":1.5`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":0`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":1048577`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":"1024"`, 1), strings.Replace(good, `"maxBytes":1024`, `"maxBytes":9223372036854775808`, 1), strings.Replace(good, "目录/📝.json", `\ud800`, 1), strings.Replace(good, "目录/📝.json", `\udc00`, 1), strings.Replace(good, "目录/📝.json", string([]byte{0xff}), 1)}
	for i, s := range invalid {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			h := NewReadProbeHandler()
			calls := 0
			h.probe = func(context.Context, Config, Credentials, string, int64) (ProbeResult, error) {
				calls++
				return ProbeResult{}, nil
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httpProbeRequest(s))
			if w.Code != 400 || calls != 0 {
				t.Fatal("ambiguous/invalid JSON reached probe")
			}
			assertHTTPProbeRedacted(t, w)
		})
	}
	for _, key := range []string{"endpoint", "bucket", "region", "accessKeyId", "secretAccessKey", "key", "maxBytes", "readOnly"} {
		t.Run("missing-"+key, func(t *testing.T) {
			f := httpProbeFields("http://127.0.0.1:1")
			delete(f, key)
			if _, err := decodeProbeInput([]byte(httpProbeJSON(f))); err == nil {
				t.Fatal("required member missing")
			}
		})
	}
	for _, key := range []string{"endpoint", "bucket", "region", "prefix", "accessKeyId", "secretAccessKey", "sessionToken", "key"} {
		t.Run("null-"+key, func(t *testing.T) {
			f := httpProbeFields("http://127.0.0.1:1")
			f[key] = nil
			if _, err := decodeProbeInput([]byte(httpProbeJSON(f))); err == nil {
				t.Fatal("null string member accepted")
			}
		})
	}
}

func TestProbeHTTPJSONStringPreservesIdentity(t *testing.T) {
	for raw, want := range map[string]string{`"目录/📝.json"`: "目录/📝.json", `"\ud83d\udcdd"`: "📝", `"a\\ud800"`: `a\ud800`, `" A/Ａ/%2F.json "`: " A/Ａ/%2F.json ", `"\u0000"`: "\x00"} {
		got, ok := probeJSONString([]byte(raw))
		if !ok || got != want {
			t.Fatal("valid JSON string silently changed")
		}
	}
	for _, raw := range []string{`null`, `12`, `"\ud800"`, `"\udc00"`, `"\ud800x"`, `"\ud800\u0020"`, `"\ud800\ud800"`, `"\u12"`, `"\q"`} {
		if _, ok := probeJSONString([]byte(raw)); ok {
			t.Fatal("invalid scalar string accepted")
		}
	}
	f := httpProbeFields("http://127.0.0.1:1")
	delete(f, "prefix")
	delete(f, "sessionToken")
	s := strings.Replace(httpProbeJSON(f), "目录/📝.json", `\ud83d\udcdd`, 1)
	p, err := decodeProbeInput([]byte("\n" + s + " \t"))
	if err != nil || p.key != "📝" || p.config.Prefix != "" || p.credentials().SessionToken != "" {
		t.Fatal("valid optional/UTF16 input rejected")
	}
	for _, v := range []any{p, &p, struct{ x probeInput }{p}} {
		out := fmt.Sprintf("%+v", v)
		if strings.Contains(out, "synthetic-secret") || strings.Contains(out, "synthetic-token") {
			t.Fatal("private input diagnostic exposed credential")
		}
	}
}

func TestProbeHTTPBoundsBodyAndClosesAfterDecode(t *testing.T) {
	for _, declared := range []int64{-1, MaxProbeRequestBytes + 1} {
		b := &httpProbeCountingBody{raw: strings.NewReader(strings.Repeat(" ", int(MaxProbeRequestBytes)+1))}
		r := httpProbeRequest("")
		r.Body = b
		r.ContentLength = declared
		w := httptest.NewRecorder()
		NewReadProbeHandler().ServeHTTP(w, r)
		if w.Code != 413 || b.closes != 1 {
			t.Fatal("oversized input not rejected/closed")
		}
		if declared > 0 && b.reads != 0 {
			t.Fatal("declared overflow body read")
		}
	}
	b := &httpProbeCountingBody{err: errors.New("synthetic-secret-HTTP")}
	r := httpProbeRequest("")
	r.Body = b
	w := httptest.NewRecorder()
	NewReadProbeHandler().ServeHTTP(w, r)
	if w.Code != 400 || b.closes != 1 {
		t.Fatal("read failure not handled")
	}
	assertHTTPProbeRedacted(t, w)
}

func TestProbeHTTPFailureIsNotSuccessfulConnection(t *testing.T) {
	for _, status := range []int{204, 206, 301, 302, 304, 307, 308, 401, 403, 404, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var requests atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("ETag", "private-etag")
				w.Header().Set("Location", "http://127.0.0.1:1/forbidden")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, "private-object-body")
			}))
			defer up.Close()
			w := httptest.NewRecorder()
			NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields(up.URL))))
			e := httpProbeEnvelope(t, w)
			if w.Code != 422 || e.Code == 0 || e.Data == nil || e.Data.HTTPStatus != status || e.Data.AcceptedBytes != 0 || e.Data.Outcome == ProbeReadable || requests.Load() != 1 {
				t.Fatal("HTTP failure mislabeled or retried")
			}
			assertHTTPProbeRedacted(t, w)
		})
	}
}

func TestProbeHTTPDoesNotFollowRedirectTarget(t *testing.T) {
	var targets atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targets.Add(1) }))
	defer target.Close()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(302)
	}))
	defer up.Close()
	w := httptest.NewRecorder()
	NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields(up.URL))))
	e := httpProbeEnvelope(t, w)
	if targets.Load() != 0 || e.Data == nil || e.Data.Outcome != ProbeRedirectRefused {
		t.Fatal("redirect followed")
	}
}

func TestProbeHTTPConcurrencyBusyAndSlotRelease(t *testing.T) {
	h := NewReadProbeHandler()
	entered := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	h.probe = func(context.Context, Config, Credentials, string, int64) (ProbeResult, error) {
		calls.Add(1)
		close(entered)
		<-release
		return ProbeResult{Outcome: ProbeReadable, HTTPStatus: 200}, nil
	}
	done := make(chan struct{})
	r := httpProbeRequest(httpProbeJSON(httpProbeFields("http://127.0.0.1:1")))
	go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), r) }()
	<-entered
	b := &httpProbeCountingBody{}
	busy := httpProbeRequest("{}")
	busy.Body = b
	w := httptest.NewRecorder()
	h.ServeHTTP(w, busy)
	if w.Code != 429 || b.reads != 0 || calls.Load() != 1 {
		t.Fatal("busy request queued or read")
	}
	close(release)
	<-done
	h.probe = func(context.Context, Config, Credentials, string, int64) (ProbeResult, error) {
		return ProbeResult{Outcome: ProbeReadable, HTTPStatus: 200}, nil
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields("http://127.0.0.1:1"))))
	if w.Code != 200 {
		t.Fatal("slot not released")
	}
}

func TestProbeHTTPCancellationAndDeadline(t *testing.T) {
	h := NewReadProbeHandler()
	observed := false
	h.probe = func(ctx context.Context, _ Config, _ Credentials, _ string, _ int64) (ProbeResult, error) {
		d, ok := ctx.Deadline()
		if !ok || time.Until(d) > probeHTTPTimeout || time.Until(d) <= 0 {
			t.Error("missing finite deadline")
		}
		observed = true
		return ProbeResult{}, context.DeadlineExceeded
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields("http://127.0.0.1:1"))))
	e := httpProbeEnvelope(t, w)
	if !observed || e.Data.Outcome != ProbeDeadlineExceeded {
		t.Fatal("deadline result wrong")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w = httptest.NewRecorder()
	NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields("http://127.0.0.1:1"))).WithContext(ctx))
	e = httpProbeEnvelope(t, w)
	if w.Code != 422 || e.Data.Outcome != ProbeCancelled {
		t.Fatal("cancellation lost")
	}
}

func TestProbeHTTPInvalidConfigurationNeverContactsUpstream(t *testing.T) {
	var n atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1) }))
	defer up.Close()
	for _, mutate := range []func(map[string]any){func(m map[string]any) { m["bucket"] = ".." }, func(m map[string]any) { m["region"] = "" }, func(m map[string]any) { m["secretAccessKey"] = "" }, func(m map[string]any) { m["key"] = "../other" }, func(m map[string]any) { m["endpoint"] = up.URL + "?secret=hidden" }} {
		f := httpProbeFields(up.URL)
		mutate(f)
		w := httptest.NewRecorder()
		NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(f)))
		e := httpProbeEnvelope(t, w)
		if w.Code != 422 || e.Data == nil || e.Data.AcceptedBytes != 0 {
			t.Fatal("bad config reported success")
		}
		assertHTTPProbeRedacted(t, w)
	}
	if n.Load() != 0 {
		t.Fatal("invalid configuration performed network request")
	}
}

func TestProbeHTTPNoPartialSummaryAndUnknownErrorRedacted(t *testing.T) {
	cases := []struct {
		r   ProbeResult
		err error
	}{{ProbeResult{Outcome: ProbeReadable, AcceptedBytes: 999}, errors.New("synthetic-secret-HTTP")}, {ProbeResult{Outcome: ProbeReadable, HTTPStatus: 200, AcceptedBytes: 1025}, nil}, {ProbeResult{Outcome: ProbeReadable, HTTPStatus: 200, AcceptedBytes: -1}, nil}, {ProbeResult{Outcome: "synthetic-secret-HTTP", HTTPStatus: 200}, nil}}
	for _, c := range cases {
		h := NewReadProbeHandler()
		h.probe = func(context.Context, Config, Credentials, string, int64) (ProbeResult, error) { return c.r, c.err }
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields("http://127.0.0.1:1"))))
		e := httpProbeEnvelope(t, w)
		if w.Code != 422 || e.Data.AcceptedBytes != 0 || e.Data.Outcome != ProbeTransportFailure {
			t.Fatal("unsafe summary escaped")
		}
		assertHTTPProbeRedacted(t, w)
	}
}

func TestProbeHTTPNilZeroAndEmptyObject(t *testing.T) {
	for _, h := range []*ReadProbeHandler{nil, {}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httpProbeRequest("{}"))
		if w.Code != 503 {
			t.Fatal("invalid handler did not fail closed")
		}
	}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer up.Close()
	w := httptest.NewRecorder()
	NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(httpProbeFields(up.URL))))
	e := httpProbeEnvelope(t, w)
	if w.Code != 200 || e.Data.AcceptedBytes != 0 {
		t.Fatal("empty object is a valid complete read")
	}
}

func TestProbeHTTPBoundaryAndEncodingOnActualTransport(t *testing.T) {
	cases := []struct {
		name     string
		body     []byte
		encoding bool
		length   int
		outcome  ProbeOutcome
	}{
		{"exact", bytes.Repeat([]byte{'x'}, 1024), false, 1024, ProbeReadable},
		{"overflow", bytes.Repeat([]byte{'x'}, 1025), false, 1024, ProbeTooLarge},
		{"repeated-encoding", []byte("encoded"), true, 1024, ProbeBodyRejected},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if c.encoding {
					w.Header().Add("Content-Encoding", "identity")
					w.Header().Add("Content-Encoding", "gzip")
				}
				_, _ = w.Write(c.body)
			}))
			defer up.Close()
			f := httpProbeFields(up.URL)
			f["maxBytes"] = c.length
			w := httptest.NewRecorder()
			NewReadProbeHandler().ServeHTTP(w, httpProbeRequest(httpProbeJSON(f)))
			e := httpProbeEnvelope(t, w)
			if e.Data == nil || e.Data.Outcome != c.outcome {
				t.Fatal("reader boundary not preserved")
			}
			if c.outcome != ProbeReadable && e.Data.AcceptedBytes != 0 {
				t.Fatal("partial response returned")
			}
		})
	}
}
