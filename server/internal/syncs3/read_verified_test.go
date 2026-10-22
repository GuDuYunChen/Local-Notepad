package syncs3

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Fixed SHA-256 vectors, not expectations obtained from the method under test.
const abcSHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
const helloSHA256 = "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"

func requireEmptyVerifiedObject(t *testing.T, object Object, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("wrong verified-read failure: %v", err)
	}
	if object.Bytes != nil || object.ETag != "" {
		t.Fatal("failed verified read delivered an object")
	}
}

func TestVerifiedReadFixedVectors(t *testing.T) {
	for _, tc := range []struct{ name, body, hash string }{
		{"empty", "", emptySHA256}, {"abc", "abc", abcSHA256}, {"newline", "hello world\n", helloSHA256},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			c.client.Transport = roundTripper(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Method != "GET" || req.Header.Get("Range") != "" {
					t.Error("not a complete GET")
				}
				res := response(200, tc.body)
				res.Header.Set("ETag", "opaque-not-a-hash")
				return res, nil
			})
			limit := int64(len(tc.body))
			if limit == 0 {
				limit = 1
			}
			object, err := c.GetVerifiedObject(context.Background(), "item", limit, tc.hash)
			if err != nil || string(object.Bytes) != tc.body || object.ETag != "opaque-not-a-hash" || calls != 1 {
				t.Fatalf("fixed vector was not accepted with one GET: %v, calls=%d", err, calls)
			}
		})
	}
}

func TestVerifiedReadRejectsExpectedDigestBeforeIO(t *testing.T) {
	c := newTestClient(t)
	calls := 0
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { calls++; return response(200, "abc"), nil })
	cases := []string{"", "abc", strings.Repeat("a", 63), strings.Repeat("a", 65), strings.ToUpper(abcSHA256),
		" " + abcSHA256[1:], abcSHA256[:63] + "\n", "sha256:" + abcSHA256, strings.Repeat("g", 64), strings.Repeat("雪", 64),
		strings.Repeat("0", 63) + "/", strings.Repeat("0", 63) + "\x00"}
	for i, hash := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			object, err := c.GetVerifiedObject(context.Background(), "item", 3, hash)
			requireEmptyVerifiedObject(t, object, err, ErrExpectedDigest)
		})
	}
	if calls != 0 {
		t.Fatal("invalid expectation dispatched a request")
	}
}

func TestVerifiedReadRejectsAnyDigestMismatchWithoutMetadata(t *testing.T) {
	for _, pos := range []int{0, 31, 63} {
		t.Run(fmt.Sprint(pos), func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			hash := []byte(abcSHA256)
			hash[pos] = '0'
			if abcSHA256[pos] == '0' {
				hash[pos] = '1'
			}
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				calls++
				res := response(200, "abc")
				// Neither a claimed ETag nor a claimed checksum header can validate bad bytes.
				res.Header.Set("ETag", string(hash))
				res.Header.Set("x-amz-checksum-sha256", string(hash))
				return res, nil
			})
			object, err := c.GetVerifiedObject(context.Background(), "PRIVATE_KEY", 3, string(hash))
			requireEmptyVerifiedObject(t, object, err, ErrDigestMismatch)
			if calls != 1 {
				t.Fatal("mismatch triggered a retry")
			}
			for _, output := range []string{fmt.Sprint(err), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
				for _, private := range []string{string(hash), abcSHA256, "PRIVATE_KEY", "abc"} {
					if strings.Contains(output, private) {
						t.Fatal("private verification detail in error")
					}
				}
			}
		})
	}
}

func TestVerifiedReadUsesByteIdentityNotNormalization(t *testing.T) {
	for _, body := range []string{"ABC", "abc\n", " abc", "\xef\xbb\xbfabc", "ab\x00", "abd"} {
		t.Run(fmt.Sprintf("%x", body), func(t *testing.T) {
			c := newTestClient(t)
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { return response(200, body), nil })
			object, err := c.GetVerifiedObject(context.Background(), "item", 128, abcSHA256)
			requireEmptyVerifiedObject(t, object, err, ErrDigestMismatch)
		})
	}
}

func TestVerifiedReadRetainsTransportRefusals(t *testing.T) {
	for _, status := range []int{204, 206, 301, 302, 303, 304, 307, 308, 401, 403, 404, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				calls++
				res := response(status, "PRIVATE_BODY")
				res.Header.Set("Location", "https://private.invalid/")
				return res, nil
			})
			object, err := c.GetVerifiedObject(context.Background(), "item", 100, abcSHA256)
			var httpErr *HTTPError
			if !errors.As(err, &httpErr) || httpErr.StatusCode != status {
				t.Fatalf("classification changed: %v", err)
			}
			if object.Bytes != nil || object.ETag != "" || calls != 1 {
				t.Fatal("failure data or replay")
			}
		})
	}
	c := newTestClient(t)
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { return nil, errors.New("PRIVATE_NATIVE_ERROR") })
	object, err := c.GetVerifiedObject(context.Background(), "item", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, ErrTransport)
	if strings.Contains(fmt.Sprint(err), "PRIVATE") {
		t.Fatal("native error leaked")
	}
}

type verifiedBody struct {
	io.Reader
	close func()
}

func (b verifiedBody) Close() error {
	if b.close != nil {
		b.close()
	}
	return nil
}
func TestVerifiedReadNeverAcceptsIncompleteOrEncodedBody(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(*http.Response)
		want  error
	}{
		{"announced oversize", func(r *http.Response) { r.ContentLength = 4 }, ErrTooLarge},
		{"stream oversize", func(r *http.Response) { r.Body = io.NopCloser(strings.NewReader("abcd")) }, ErrTooLarge},
		{"short read", func(r *http.Response) { r.ContentLength = 3; r.Body = io.NopCloser(strings.NewReader("ab")) }, ErrBody},
		{"late encoding", func(r *http.Response) {
			r.Header.Add("Content-Encoding", "identity")
			r.Header.Add("Content-Encoding", "gzip")
		}, ErrBody},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t)
			calls := 0
			c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
				calls++
				r := response(200, "abc")
				tc.setup(r)
				r.Header.Set("ETag", "PRIVATE_ETAG")
				return r, nil
			})
			object, err := c.GetVerifiedObject(context.Background(), "item", 3, abcSHA256)
			requireEmptyVerifiedObject(t, object, err, tc.want)
			if calls != 1 {
				t.Fatal("body rejection replayed")
			}
		})
	}
}

func TestVerifiedReadInputAndCancelledContextStayOffline(t *testing.T) {
	c := newTestClient(t)
	calls := 0
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { calls++; return response(200, "abc"), nil })
	for _, limit := range []int64{0, -1, MaxObjectBytes + 1} {
		object, err := c.GetVerifiedObject(context.Background(), "item", limit, abcSHA256)
		requireEmptyVerifiedObject(t, object, err, ErrConfig)
	}
	object, err := c.GetVerifiedObject(nil, "item", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, ErrConfig)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	object, err = c.GetVerifiedObject(ctx, "item", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, context.Canceled)
	ctx, done := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer done()
	object, err = c.GetVerifiedObject(ctx, "item", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, context.DeadlineExceeded)
	object, err = c.GetVerifiedObject(context.Background(), "../outside", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, ErrKey)
	for _, client := range []*ReadClient{nil, {}} {
		object, err = client.GetVerifiedObject(context.Background(), "item", 3, abcSHA256)
		requireEmptyVerifiedObject(t, object, err, ErrConfig)
	}
	if calls != 0 {
		t.Fatal("invalid input or cancelled context accessed network")
	}
}

func TestVerifiedReadCancellationAfterBodyCloseCannotReturnSuccess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := newTestClient(t)
	closed := 0
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) {
		r := response(200, "")
		r.Body = verifiedBody{strings.NewReader("abc"), func() { closed++; cancel() }}
		r.Header.Set("ETag", "PRIVATE_ETAG")
		return r, nil
	})
	object, err := c.GetVerifiedObject(ctx, "item", 3, abcSHA256)
	requireEmptyVerifiedObject(t, object, err, context.Canceled)
	if closed != 1 {
		t.Fatal("response body lifecycle changed")
	}
}

func TestVerifiedReadSharesCallersDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	deadline, _ := ctx.Deadline()
	c := newTestClient(t)
	c.client.Transport = roundTripper(func(req *http.Request) (*http.Response, error) {
		inherited, ok := req.Context().Deadline()
		if !ok || inherited.After(deadline) {
			t.Error("request extended caller deadline")
		}
		return response(200, "abc"), nil
	})
	if _, err := c.GetVerifiedObject(ctx, "item", 3, abcSHA256); err != nil {
		t.Fatal(err)
	}
}

func TestVerifiedReadRealSignedGETAndCancellation(t *testing.T) {
	type requestView struct{ method, path, auth, token string }
	seen := make(chan requestView, 2)
	cancelSeen := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		seen <- requestView{r.Method, r.URL.EscapedPath(), r.Header.Get("Authorization"), r.Header.Get("X-Amz-Security-Token")}
		if strings.HasSuffix(r.URL.Path, "/wait") {
			<-r.Context().Done()
			close(cancelSeen)
			return
		}
		w.Header().Set("ETag", "untrusted-opaque")
		_, _ = io.WriteString(w, "abc")
	}))
	defer server.Close()
	cfg := testConfig()
	cfg.Endpoint = server.URL
	cfg.Prefix = "空间"
	creds := testCredentials()
	creds.SessionToken = "SYNTHETIC_TOKEN"
	c, err := NewReadClient(cfg, creds)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseIdleConnections()
	object, err := c.GetVerifiedObject(context.Background(), "e\u0301 %2F", 3, abcSHA256)
	if err != nil || string(object.Bytes) != "abc" {
		t.Fatalf("signed GET failed: %v", err)
	}
	first := <-seen
	if first.method != "GET" || first.path != "/examplebucket/%E7%A9%BA%E9%97%B4/e%CC%81%20%252F" || !strings.HasPrefix(first.auth, "AWS4-HMAC-SHA256 Credential=") || first.token != creds.SessionToken {
		t.Fatal("signed request identity changed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		o, e := c.GetVerifiedObject(ctx, "wait", 3, abcSHA256)
		if o.Bytes != nil || o.ETag != "" {
			done <- errors.New("unexpected object")
			return
		}
		done <- e
	}()
	select {
	case <-seen:
	case <-time.After(2 * time.Second):
		t.Fatal("owned request did not start")
	}
	cancel()
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatalf("wrong cancellation: %v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("owned request did not cancel")
	}
	select {
	case <-cancelSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation did not reach synthetic S3")
	}
	if calls.Load() != 2 {
		t.Fatal("extra requests were sent")
	}
}

func TestVerifiedReadConcurrentExpectationsDoNotCross(t *testing.T) {
	c := newTestClient(t)
	var calls atomic.Int32
	var wg sync.WaitGroup
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { calls.Add(1); return response(200, "abc"), nil })
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			hash := abcSHA256
			if i%2 != 0 {
				hash = emptySHA256
			}
			o, e := c.GetVerifiedObject(context.Background(), "item", 3, hash)
			if i%2 == 0 {
				if e != nil || string(o.Bytes) != "abc" {
					t.Error("valid concurrent expectation rejected")
				}
			} else {
				if !errors.Is(e, ErrDigestMismatch) || o.Bytes != nil || o.ETag != "" {
					t.Error("mismatched concurrent expectation delivered data")
				}
			}
		}(i)
	}
	wg.Wait()
	if calls.Load() != 8 {
		t.Fatal("cross-call caching or replay")
	}
}

func TestVerifiedReadDoesNotChangeByteOnlyProbeMeaning(t *testing.T) {
	c := newTestClient(t)
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { return response(200, "not-a-manifest"), nil })
	result, err := probeRead(context.Background(), c, "item", 100)
	if err != nil || result.Outcome != ProbeReadable || result.AcceptedBytes != 14 {
		t.Fatal("byte-only preflight contract changed")
	}
}
