package syncs3

import (
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

func testConfig() Config {
	return Config{Endpoint: "https://s3.example.test", Bucket: "examplebucket", Region: "us-east-1"}
}
func testCredentials() Credentials {
	return Credentials{AccessKeyID: "AKIAIOSFODNN7EXAMPLE", SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}
}
func newTestClient(t *testing.T) *ReadClient {
	t.Helper()
	c, e := NewReadClient(testConfig(), testCredentials())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(c.CloseIdleConnections)
	return c
}

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), ContentLength: -1, Body: io.NopCloser(strings.NewReader(body))}
}

// Public, non-secret AWS documentation vector; independently computed signature.
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
func TestAWSOfficialGETVector(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	at, _ := time.Parse(time.RFC3339, "2013-05-24T00:00:00Z")
	signRead(req, testCredentials(), "us-east-1", at)
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("signature vector mismatch: %s", got)
	}
}
func TestInvalidConfiguration(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Config)
	}{
		{"no scheme", func(c *Config) { c.Endpoint = "s3.example.test" }},
		{"zero port", func(c *Config) { c.Endpoint = "https://s3.example.test:0" }},
		{"port overflow", func(c *Config) { c.Endpoint = "https://s3.example.test:65536" }},
		{"public http", func(c *Config) { c.Endpoint = "http://s3.example.test" }},
		{"credentials in url", func(c *Config) { c.Endpoint = "https://key:secret@s3.example.test" }},
		{"query", func(c *Config) { c.Endpoint += "?secret=bad" }},
		{"empty query", func(c *Config) { c.Endpoint += "?" }},
		{"fragment", func(c *Config) { c.Endpoint += "#bad" }},
		{"empty fragment", func(c *Config) { c.Endpoint += "#" }},
		{"base path", func(c *Config) { c.Endpoint += "/prefix" }},
		{"whitespace", func(c *Config) { c.Endpoint = " " + c.Endpoint }},
		{"opaque", func(c *Config) { c.Endpoint = "https:s3.example.test" }},
		{"short bucket", func(c *Config) { c.Bucket = "ab" }},
		{"uppercase bucket", func(c *Config) { c.Bucket = "MyBucket" }},
		{"ip bucket", func(c *Config) { c.Bucket = "127.0.0.1" }},
		{"bucket path", func(c *Config) { c.Bucket = "abc/def" }},
		{"adjacent dots", func(c *Config) { c.Bucket = "a..b" }},
		{"bucket traversal", func(c *Config) { c.Bucket = "../bucket" }},
		{"empty region", func(c *Config) { c.Region = "" }},
		{"region scope injection", func(c *Config) { c.Region = "x/s3/aws4_request" }},
		{"prefix absolute", func(c *Config) { c.Prefix = "/root" }},
		{"prefix parent", func(c *Config) { c.Prefix = "a/../b" }},
		{"prefix slash", func(c *Config) { c.Prefix = "root/" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testConfig()
			tc.edit(&c)
			if _, e := NewReadClient(c, testCredentials()); !errors.Is(e, ErrConfig) {
				t.Fatalf("expected config rejection, got %v", e)
			}
		})
	}
}
func TestInvalidCredentials(t *testing.T) {
	for _, c := range []Credentials{{}, {AccessKeyID: "ID", SecretAccessKey: ""}, {AccessKeyID: "bad/id", SecretAccessKey: "valid"}, {AccessKeyID: "ID", SecretAccessKey: "s\r\nx"}, {AccessKeyID: "ID", SecretAccessKey: "valid", SessionToken: "token\nx"}, {AccessKeyID: "ID", SecretAccessKey: strings.Repeat("x", 4097)}} {
		if _, e := NewReadClient(testConfig(), c); !errors.Is(e, ErrCredentials) {
			t.Fatalf("expected credentials rejection: %v", e)
		}
	}
}
func TestCredentialsNotInJSONOrFormatting(t *testing.T) {
	c := testCredentials()
	c.SessionToken = "PRIVATESESSION"
	for _, value := range []any{c, &c, newTestClient(t)} {
		raw, _ := json.Marshal(value)
		for _, out := range []string{string(raw), fmt.Sprintf("%v", value), fmt.Sprintf("%+v", value), fmt.Sprintf("%#v", value)} {
			for _, secret := range []string{c.AccessKeyID, c.SecretAccessKey, c.SessionToken} {
				if strings.Contains(out, secret) {
					t.Fatal("credential leaked in formatting")
				}
			}
		}
	}
}
func TestKeyEncodingAndPrefixAreNotNormalized(t *testing.T) {
	cfg := testConfig()
	cfg.Endpoint = "https://s3.example.test:9443"
	cfg.Prefix = "work space"
	c, e := NewReadClient(cfg, testCredentials())
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseIdleConnections()
	cases := map[string]string{"a b/+%?#中": "/examplebucket/work%20space/a%20b/%2B%25%3F%23%E4%B8%AD", "a//b": "/examplebucket/work%20space/a//b", "A/é": "/examplebucket/work%20space/A/%C3%A9", "a/e\u0301": "/examplebucket/work%20space/a/e%CC%81", "a/%2F/b": "/examplebucket/work%20space/a/%252F/b"}
	for key, want := range cases {
		t.Run(key, func(t *testing.T) {
			c.client.Transport = roundTripper(func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" || r.URL.RawQuery != "" || r.Body != nil || r.URL.EscapedPath() != want || r.URL.Host != "s3.example.test:9443" {
					t.Fatalf("wrong read request: %s %s", r.Method, r.URL)
				}
				if strings.Contains(r.URL.String(), c.credentials().AccessKeyID) || !strings.Contains(r.Header.Get("Authorization"), "/us-east-1/s3/aws4_request") {
					t.Fatal("invalid auth placement")
				}
				return response(200, "ok"), nil
			})
			o, e := c.GetObject(context.Background(), key, 2)
			if e != nil || string(o.Bytes) != "ok" {
				t.Fatalf("get failed %v", e)
			}
		})
	}
}
func TestKeysLimitsAndContextRejectedBeforeIO(t *testing.T) {
	c := newTestClient(t)
	calls := 0
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { calls++; return response(200, ""), nil })
	for _, key := range []string{"", "/absolute", "../escape", "a/./b", "a/../b", "a\\b", "a\x00b", string([]byte{0xff}), strings.Repeat("中", 342)} {
		if _, e := c.GetObject(context.Background(), key, 10); !errors.Is(e, ErrKey) {
			t.Fatalf("key not rejected: %v", e)
		}
	}
	for _, limit := range []int64{-1, 0, MaxObjectBytes + 1} {
		if _, e := c.GetObject(context.Background(), "a", limit); !errors.Is(e, ErrConfig) {
			t.Fatal(e)
		}
	}
	if _, e := c.GetObject(nil, "a", 10); !errors.Is(e, ErrConfig) {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := c.GetObject(ctx, "a", 10); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	var nilClient *ReadClient
	if _, e := nilClient.GetObject(context.Background(), "a", 10); !errors.Is(e, ErrConfig) {
		t.Fatal(e)
	}
	c.prefix = strings.Repeat("p", 1020)
	if _, e := c.GetObject(context.Background(), "large", 10); !errors.Is(e, ErrKey) {
		t.Fatal(e)
	}
	if calls != 0 {
		t.Fatal("invalid input caused IO")
	}
}
func TestSessionTokenSignedAndUTC(t *testing.T) {
	at, _ := time.Parse(time.RFC3339, "2013-05-24T08:00:00+08:00")
	req, _ := http.NewRequest("GET", "https://example.test/test", nil)
	creds := testCredentials()
	creds.SessionToken = "TOKEN+/="
	signRead(req, creds, "us-east-1", at)
	if req.Header.Get("X-Amz-Date") != "20130524T000000Z" || req.Header.Get("X-Amz-Security-Token") != creds.SessionToken || !strings.Contains(req.Header.Get("Authorization"), ";x-amz-security-token,") {
		t.Fatal("temporary token not signed")
	}
	first := req.Header.Get("Authorization")
	creds.SessionToken = "OTHER"
	signRead(req, creds, "us-east-1", at)
	if first == req.Header.Get("Authorization") {
		t.Fatal("token change left signature unchanged")
	}
}
func TestHTTPFailuresNeverRetryAndNeverLeakBody(t *testing.T) {
	for _, status := range []int{301, 302, 307, 308, 400, 401, 403, 404, 408, 429, 500, 502, 503, 504, 206, 204} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				calls++
				return response(status, "SECRET_REMOTE_XML"), nil
			})
			object, err := c.GetObject(context.Background(), "manifest.json", 64)
			var he *HTTPError
			if !errors.As(err, &he) || he.StatusCode != status || he.NotFound() != (status == 404) || object.Bytes != nil || calls != 1 || strings.Contains(err.Error(), "SECRET") {
				t.Fatalf("bad status handling: %v calls=%d", err, calls)
			}
		})
	}
}
func TestRedirectDoesNotContactOtherServer(t *testing.T) {
	var forwarded, origin atomic.Int32
	dest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.WriteHeader(200) }))
	defer dest.Close()
	from := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin.Add(1)
		w.Header().Set("Location", dest.URL)
		w.WriteHeader(307)
	}))
	defer from.Close()
	cfg := testConfig()
	cfg.Endpoint = from.URL
	c, e := NewReadClient(cfg, testCredentials())
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseIdleConnections()
	_, e = c.GetObject(context.Background(), "a", 4)
	var he *HTTPError
	if !errors.As(e, &he) || he.StatusCode != 307 || forwarded.Load() != 0 || origin.Load() != 1 {
		t.Fatalf("redirect was followed: %v", e)
	}
}
func TestRealReadAndCancellation(t *testing.T) {
	received := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("write method %s", r.Method)
		}
		if strings.Contains(r.URL.Path, "slow") {
			received <- struct{}{}
			<-r.Context().Done()
			return
		}
		if r.Header.Get("Authorization") == "" {
			t.Error("unsigned request")
		}
		w.Header().Set("ETag", `"opaque-tag"`)
		_, _ = w.Write([]byte("abcd"))
	}))
	defer srv.Close()
	cfg := testConfig()
	cfg.Endpoint = srv.URL
	c, e := NewReadClient(cfg, testCredentials())
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseIdleConnections()
	o, e := c.GetObject(context.Background(), "a", 4)
	if e != nil || string(o.Bytes) != "abcd" || o.ETag != `"opaque-tag"` {
		t.Fatalf("read failed %v", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, e := c.GetObject(ctx, "slow", 4); done <- e }()
	select {
	case <-received:
		cancel()
	case <-time.After(time.Second):
		t.Fatal("request not received")
	}
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation not bounded")
	}
}
func TestLimitsNoPartialResultsAndClose(t *testing.T) {
	for _, tc := range []struct {
		name, body, encoding string
		length               int64
		want                 error
	}{
		{"exact", "abcd", "", 4, nil}, {"stream overflow", "abcde", "", -1, ErrTooLarge}, {"declared overflow", "abcde", "", 5, ErrTooLarge},
		{"declared mismatch", "abc", "", 4, ErrBody}, {"compressed", "abcd", "gzip", 4, ErrBody}, {"empty object", "", "", 0, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t)
			body := &observedBody{Reader: strings.NewReader(tc.body)}
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				r := response(200, "")
				r.Body = body
				r.ContentLength = tc.length
				r.Header.Set("Content-Encoding", tc.encoding)
				return r, nil
			})
			object, e := c.GetObject(context.Background(), "a", 4)
			if !errors.Is(e, tc.want) || !body.closed {
				t.Fatalf("wrong result: %v closed=%v", e, body.closed)
			}
			if e != nil && object.Bytes != nil {
				t.Fatal("returned partial data")
			}
		})
	}
}

type observedBody struct {
	io.Reader
	closed bool
}

func (b *observedBody) Close() error { b.closed = true; return nil }
func TestTransportErrorRedaction(t *testing.T) {
	c := newTestClient(t)
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { return nil, errors.New("SECRET endpoint credentials") })
	_, e := c.GetObject(context.Background(), "a", 4)
	if !errors.Is(e, ErrTransport) || strings.Contains(e.Error(), "SECRET") {
		t.Fatal("leaked transport error")
	}
}
func TestClientHasNoProxyAndHasFiniteBudgets(t *testing.T) {
	c := newTestClient(t)
	tr := c.client.Transport.(*http.Transport)
	if tr.Proxy != nil || tr.MaxResponseHeaderBytes != 64*1024 || !tr.DisableCompression || !tr.DisableKeepAlives || c.client.Timeout != requestTimeout || tr.ResponseHeaderTimeout <= 0 || tr.TLSHandshakeTimeout <= 0 {
		t.Fatal("unsafe default transport")
	}
}

func TestPartialReadErrorIsClosedAndRedacted(t *testing.T) {
	c := newTestClient(t)
	body := &failingBody{}
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { r := response(200, ""); r.Body = body; return r, nil })
	o, e := c.GetObject(context.Background(), "a", 64)
	if !errors.Is(e, ErrBody) || o.Bytes != nil || !body.closed || strings.Contains(e.Error(), "SECRET") {
		t.Fatalf("partial body accepted: %v", e)
	}
}

type failingBody struct{ closed bool }

func (b *failingBody) Read(p []byte) (int, error) {
	copy(p, "part")
	return 4, errors.New("SECRET BODY ERROR")
}
func (b *failingBody) Close() error { b.closed = true; return nil }
func TestHTTPSRejectsUntrustedCertificate(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("bad")) }))
	defer srv.Close()
	cfg := testConfig()
	cfg.Endpoint = srv.URL
	c, e := NewReadClient(cfg, testCredentials())
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseIdleConnections()
	_, e = c.GetObject(context.Background(), "a", 4)
	if !errors.Is(e, ErrTransport) {
		t.Fatalf("untrusted TLS accepted: %v", e)
	}
}

func TestZeroValueClientRejectsWithoutPanic(t *testing.T) {
	for _, c := range []*ReadClient{nil, {}, {now: time.Now}} {
		if _, err := c.GetObject(context.Background(), "key", 1); !errors.Is(err, ErrConfig) {
			t.Fatalf("uninitialized client must reject: %v", err)
		}
		c.CloseIdleConnections()
	}
}
