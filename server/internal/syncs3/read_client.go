// Package syncs3 supplies the read-only foundation for an S3-compatible provider.
// It is not registered with the sync engine yet and never writes remote objects.
package syncs3

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxObjectBytes int64 = 32 * 1024 * 1024
const requestTimeout = 15 * time.Second

var (
	ErrConfig         = errors.New("S3 只读连接配置无效")
	ErrCredentials    = errors.New("S3 访问凭据无效")
	ErrKey            = errors.New("S3 对象键无效或超出支持范围")
	ErrTransport      = errors.New("S3 只读请求失败，未执行写入")
	ErrTooLarge       = errors.New("S3 对象超过读取大小限制")
	ErrBody           = errors.New("S3 响应读取失败，未接受部分数据")
	ErrExpectedDigest = errors.New("S3 预期 SHA-256 格式无效，未执行读取")
	ErrDigestMismatch = errors.New("S3 对象内容与预期 SHA-256 不一致，未接受对象")
	bucketPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	regionPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	keyIDPattern      = regexp.MustCompile(`^[A-Za-z0-9]{1,128}$`)
)

// Config supports explicit-region, path-style endpoints. Endpoint must have a
// root path and no userinfo, query, fragment or escaped hostname. No discovery,
// region redirect, proxy credential forwarding or automatic retry is performed.
type Config struct{ Endpoint, Bucket, Region, Prefix string }

// Credentials are held in memory only. Formatting and JSON do not expose them.
// This is not secure persistence: the caller owns the original strings too.
type Credentials struct {
	AccessKeyID     string `json:"-"`
	SecretAccessKey string `json:"-"`
	SessionToken    string `json:"-"`
}

func (Credentials) Format(s fmt.State, _ rune) { _, _ = io.WriteString(s, "[S3 credentials redacted]") }

type ReadClient struct {
	endpoint               url.URL
	bucket, region, prefix string
	// Keep the immutable constructor snapshot behind a private closure: fmt
	// bypasses methods on unexported containing fields, and some verbs expand
	// pointers in error diagnostics. It cannot walk a function's captured data.
	// This is formatting containment, not encryption or secure memory erasure.
	credentials func() Credentials
	client      *http.Client
	now         func() time.Time
}

// A value receiver covers both ReadClient values and *ReadClient pointers.
// A pointer-only method leaves copied values outside fmt.Formatter's method set.
func (ReadClient) Format(s fmt.State, _ rune) { _, _ = io.WriteString(s, "[S3 read client redacted]") }

type Object struct {
	Bytes []byte
	ETag  string
}

// HTTPError intentionally does not include the server body, URL or headers.
// A 403 is not interpreted as proof that an object is missing or a password wrong.
type HTTPError struct{ StatusCode int }

func (e *HTTPError) Error() string  { return fmt.Sprintf("S3 只读请求返回 HTTP %d", e.StatusCode) }
func (e *HTTPError) NotFound() bool { return e.StatusCode == http.StatusNotFound }

func NewReadClient(cfg Config, credentials Credentials) (*ReadClient, error) {
	u, err := url.Parse(cfg.Endpoint)
	if err != nil || u.Opaque != "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery ||
		u.Fragment != "" || strings.Contains(cfg.Endpoint, "#") || (u.Path != "" && u.Path != "/") ||
		strings.Contains(u.Host, "%") || strings.TrimSpace(cfg.Endpoint) != cfg.Endpoint ||
		(u.Scheme != "https" && u.Scheme != "http") {
		return nil, ErrConfig
	}
	if port := u.Port(); port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return nil, ErrConfig
		}
	}
	if u.Scheme == "http" {
		ip := net.ParseIP(u.Hostname())
		if !strings.EqualFold(u.Hostname(), "localhost") && (ip == nil || !ip.IsLoopback()) {
			return nil, ErrConfig
		}
	}
	if !bucketPattern.MatchString(cfg.Bucket) || strings.Contains(cfg.Bucket, "..") || strings.Contains(cfg.Bucket, ".-") ||
		strings.Contains(cfg.Bucket, "-.") || net.ParseIP(cfg.Bucket) != nil || !regionPattern.MatchString(cfg.Region) {
		return nil, ErrConfig
	}
	if cfg.Prefix != "" && (!supportedKey(cfg.Prefix) || strings.HasSuffix(cfg.Prefix, "/")) {
		return nil, ErrConfig
	}
	if !keyIDPattern.MatchString(credentials.AccessKeyID) || credentials.SecretAccessKey == "" || len(credentials.SecretAccessKey) > 4096 ||
		!headerText(credentials.SecretAccessKey) || len(credentials.SessionToken) > 16384 || !headerText(credentials.SessionToken) {
		return nil, ErrCredentials
	}
	// The internal client uses a fresh transport. It does not share mutable global
	// defaults and never sends signed requests through an environment-configured proxy.
	// Fresh connections avoid transparent stale-connection retries of signed GETs.
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 30 * time.Second, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 64 * 1024}
	return &ReadClient{endpoint: *u, bucket: cfg.Bucket, region: cfg.Region, prefix: cfg.Prefix, credentials: func() Credentials { return credentials }, now: time.Now,
		client: &http.Client{Transport: transport, Timeout: requestTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func headerText(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	return true
}
func supportedKey(key string) bool {
	if key == "" || len(key) > 1024 || !utf8.ValidString(key) || strings.HasPrefix(key, "/") {
		return false
	}
	for _, part := range strings.Split(key, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	for _, c := range key {
		if c < 0x20 || c == 0x7f || c == '\\' {
			return false
		}
	}
	return true
}
func uriPath(s string) string {
	const digits = "0123456789ABCDEF"
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b == '/' || b == '-' || b == '_' || b == '.' || b == '~' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' {
			out.WriteByte(b)
		} else {
			out.WriteByte('%')
			out.WriteByte(digits[b>>4])
			out.WriteByte(digits[b&15])
		}
	}
	return out.String()
}
func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func mac(key []byte, text string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(text))
	return h.Sum(nil)
}

// signRead signs only the internally created GET request. It deliberately does
// not support query-string authentication or writes. S3 paths are never cleaned.
// Protocol/vector: AWS S3 sig-v4-header-based-auth.html, Example: GET Object.
func signRead(req *http.Request, credentials Credentials, region string, at time.Time) {
	utc := at.UTC()
	date := utc.Format("20060102")
	stamp := utc.Format("20060102T150405Z")
	req.Header.Set("X-Amz-Date", stamp)
	req.Header.Set("X-Amz-Content-Sha256", digest(nil))
	if credentials.SessionToken != "" {
		req.Header.Set("X-Amz-Security-Token", credentials.SessionToken)
	}
	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	headers := map[string]string{"host": host, "x-amz-date": stamp, "x-amz-content-sha256": digest(nil)}
	if token := req.Header.Get("X-Amz-Security-Token"); token != "" {
		headers["x-amz-security-token"] = token
	}
	if r := req.Header.Get("Range"); r != "" {
		headers["range"] = r
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, k := range names {
		canonicalHeaders.WriteString(k + ":" + strings.Join(strings.Fields(headers[k]), " ") + "\n")
	}
	signed := strings.Join(names, ";")
	canonical := "GET\n" + req.URL.EscapedPath() + "\n\n" + canonicalHeaders.String() + "\n" + signed + "\n" + digest(nil)
	scope := date + "/" + region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + digest([]byte(canonical))
	key := mac(mac(mac(mac([]byte("AWS4"+credentials.SecretAccessKey), date), region), "s3"), "aws4_request")
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+credentials.AccessKeyID+"/"+scope+",SignedHeaders="+signed+",Signature="+hex.EncodeToString(mac(key, toSign)))
}

// GetObject reads at most limit bytes. Failure returns no partial object. It
// performs one request only; redirects, missing objects and 429/5xx do not cause
// retries or writes. ETag is opaque metadata, not proof of a content hash.
func (r *ReadClient) GetObject(ctx context.Context, key string, limit int64) (Object, error) {
	if r == nil || r.client == nil || r.credentials == nil || r.now == nil || ctx == nil || limit < 1 || limit > MaxObjectBytes {
		return Object{}, ErrConfig
	}
	if err := ctx.Err(); err != nil {
		return Object{}, err
	}
	if !supportedKey(key) {
		return Object{}, ErrKey
	}
	full := key
	if r.prefix != "" {
		full = r.prefix + "/" + key
	}
	if len(full) > 1024 {
		return Object{}, ErrKey
	}
	u := r.endpoint
	u.Path = "/" + r.bucket + "/" + full
	u.RawPath = uriPath(u.Path)
	call, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(call, http.MethodGet, u.String(), nil)
	if err != nil {
		return Object{}, ErrConfig
	}
	signRead(req, r.credentials(), r.region, r.now())
	resp, err := r.client.Do(req)
	if err != nil {
		if call.Err() != nil {
			return Object{}, call.Err()
		}
		return Object{}, ErrTransport
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Object{}, &HTTPError{StatusCode: resp.StatusCode}
	}
	// Header.Get returns only the first field value. Check every field line so
	// an earlier identity/empty value cannot hide a later encoding. Preserve the
	// existing narrow compatibility policy; do not decode or accept coding lists.
	for _, encoding := range resp.Header.Values("Content-Encoding") {
		if encoding != "" && encoding != "identity" {
			return Object{}, ErrBody
		}
	}
	if resp.ContentLength > limit {
		return Object{}, ErrTooLarge
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		if call.Err() != nil {
			return Object{}, call.Err()
		}
		return Object{}, ErrBody
	}
	if int64(len(b)) > limit {
		return Object{}, ErrTooLarge
	}
	if resp.ContentLength >= 0 && int64(len(b)) != resp.ContentLength {
		return Object{}, ErrBody
	}
	return Object{Bytes: b, ETag: resp.Header.Get("ETag")}, nil
}
func (r *ReadClient) CloseIdleConnections() {
	if r != nil && r.client != nil {
		r.client.CloseIdleConnections()
	}
}

// GetVerifiedObject accepts a complete object only if SHA-256 of its exact bytes
// matches the caller's expected 64-character lowercase hexadecimal digest.
// The expected value must come from an independently trusted source: a match
// does not authenticate a manifest, credentials, bucket ownership or freshness.
// ETag and remote checksum headers are NOT used as the expected digest.
//
// This method reuses GetObject's single signed GET, limits and refusal policy.
// It never retries or falls back to unverified data, HEAD, List or another key.
// The original byte-only ProbeRead/HTTP/IPC contract remains unchanged. Returned
// Object bytes are internal caller data, not a renderer-safe summary. Every
// failure returns the zero Object (no bytes or ETag); GC is not secure erasure.
func (r *ReadClient) GetVerifiedObject(ctx context.Context, key string, limit int64, expectedSHA256 string) (Object, error) {
	if ctx == nil || limit < 1 || limit > MaxObjectBytes {
		return Object{}, ErrConfig
	}
	if len(expectedSHA256) != sha256.Size*2 {
		return Object{}, ErrExpectedDigest
	}
	for _, c := range expectedSHA256 {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return Object{}, ErrExpectedDigest
		}
	}
	expected, err := hex.DecodeString(expectedSHA256)
	if err != nil {
		return Object{}, ErrExpectedDigest
	}
	// One budget covers the read and verification. GetObject's nested timeout
	// cannot extend this deadline. Hashing is bounded by MaxObjectBytes; a
	// cancellation noticed after the read/hash must not deliver old success.
	call, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	object, err := r.GetObject(call, key, limit)
	if err != nil {
		return Object{}, err
	}
	if err := call.Err(); err != nil {
		return Object{}, err
	}
	actual := sha256.Sum256(object.Bytes)
	if err := call.Err(); err != nil {
		return Object{}, err
	}
	if !hmac.Equal(actual[:], expected) {
		return Object{}, ErrDigestMismatch
	}
	return object, nil
}
