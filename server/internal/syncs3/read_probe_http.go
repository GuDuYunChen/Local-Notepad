package syncs3

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	ReadProbePath                 = "/api/sync/s3/probe"
	ReadProbeIntentHeader         = "X-Notepad-Read-Only"
	ReadProbeIntent               = "s3-probe"
	MaxProbeRequestBytes    int64 = 64 * 1024
	MaxProbeHTTPObjectBytes int64 = 1024 * 1024
	probeHTTPTimeout              = 6 * time.Second
)

type probeOperation func(context.Context, Config, Credentials, string, int64) (ProbeResult, error)

// ReadProbeHandler admits one native loopback request at a time, without a
// queue. It owns no database, stored credentials or synchronization runner.
// Browser requests (including the opaque "null" origin) are deliberately not
// supported here. A future renderer integration must use a reviewed native
// bridge; do not weaken this guard by allowing arbitrary browser origins.
// The intent header is explicit intent, NOT an authentication secret. Native
// local processes are trusted callers; this is not a multi-user auth boundary.
type ReadProbeHandler struct {
	slot  chan struct{}
	probe probeOperation
}

func NewReadProbeHandler() *ReadProbeHandler {
	return &ReadProbeHandler{slot: make(chan struct{}, 1), probe: ProbeRead}
}

type probeEnvelope struct {
	Code    int          `json:"code"`
	Message string       `json:"message"`
	Data    *ProbeResult `json:"data"`
}

func probeReply(w http.ResponseWriter, status int, message string, data *ProbeResult) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Del("Access-Control-Allow-Origin")
	w.Header().Del("Access-Control-Allow-Credentials")
	code := status
	if status == http.StatusOK {
		code = 0
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(probeEnvelope{Code: code, Message: message, Data: data})
}

func probeHeader(h http.Header, name string) []string {
	var values []string
	for key, v := range h {
		if strings.EqualFold(key, name) {
			values = append(values, v...)
		}
	}
	return values
}
func nativeProbeRequest(r *http.Request) bool {
	host, port, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || port == "" {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	host = r.Host
	if strings.Contains(host, ":") {
		host, port, err = net.SplitHostPort(host)
		n, e := strconv.Atoi(port)
		if err != nil || e != nil || n < 1 || n > 65535 {
			return false
		}
	}
	ip = net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
		return false
	}
	for key := range r.Header {
		if strings.EqualFold(key, "Origin") || strings.EqualFold(key, "Referer") || strings.HasPrefix(strings.ToLower(key), "sec-fetch-") {
			return false
		}
	}
	intent := probeHeader(r.Header, ReadProbeIntentHeader)
	return len(intent) == 1 && intent[0] == ReadProbeIntent
}

func (h *ReadProbeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.URL == nil {
		probeReply(w, 400, "invalid-request", nil)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		probeReply(w, 405, "method-not-allowed", nil)
		return
	}
	if !nativeProbeRequest(r) {
		probeReply(w, 403, "native-loopback-required", nil)
		return
	}
	if r.URL.Path != ReadProbePath || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.Host != "" || r.URL.Scheme != "" {
		probeReply(w, 400, "invalid-request-target", nil)
		return
	}
	contentTypes := probeHeader(r.Header, "Content-Type")
	if len(contentTypes) != 1 {
		probeReply(w, 415, "json-required", nil)
		return
	}
	media, params, err := mime.ParseMediaType(contentTypes[0])
	if err != nil || media != "application/json" || len(params) > 1 || (len(params) == 1 && !strings.EqualFold(params["charset"], "utf-8")) {
		probeReply(w, 415, "json-required", nil)
		return
	}
	for key := range r.Header {
		if strings.EqualFold(key, "Content-Encoding") {
			probeReply(w, 415, "encoded-request-refused", nil)
			return
		}
	}
	if h == nil || h.slot == nil || h.probe == nil {
		probeReply(w, 503, "probe-unavailable", nil)
		return
	}
	select {
	case h.slot <- struct{}{}:
		defer func() { <-h.slot }()
	default:
		probeReply(w, 429, "probe-busy", nil)
		return
	}
	if r.Body == nil {
		probeReply(w, 400, "invalid-request", nil)
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxProbeRequestBytes)
	defer body.Close()
	if r.ContentLength > MaxProbeRequestBytes {
		probeReply(w, 413, "request-too-large", nil)
		return
	}
	raw, err := io.ReadAll(body)
	if err != nil {
		if _, ok := err.(*http.MaxBytesError); ok {
			probeReply(w, 413, "request-too-large", nil)
		} else {
			probeReply(w, 400, "invalid-request", nil)
		}
		return
	}
	input, err := decodeProbeInput(raw)
	if err != nil {
		probeReply(w, 400, "invalid-request", nil)
		return
	}
	// The existing HTTP server bounds inbound reads. This separate shorter
	// deadline bounds the outbound probe, including shutdown/drain or caller cancellation.
	ctx, cancel := context.WithTimeout(r.Context(), probeHTTPTimeout)
	defer cancel()
	result, err := h.probe(ctx, input.config, input.credentials(), input.key, input.limit)
	if err != nil {
		result, _ = probeFailure(err) // Never echo a wrapper or partial success.
		probeReply(w, 422, "probe-not-readable", &result)
		return
	}
	if result.Outcome != ProbeReadable || result.HTTPStatus != 200 || result.AcceptedBytes < 0 || result.AcceptedBytes > input.limit {
		result, _ = probeFailure(ErrTransport)
		probeReply(w, 422, "probe-not-readable", &result)
		return
	}
	probeReply(w, 200, "OK", &result)
}

type probeInput struct {
	config      Config
	credentials func() Credentials
	key         string
	limit       int64
}

func (probeInput) Format(s fmt.State, _ rune) { _, _ = io.WriteString(s, "[S3 probe input redacted]") }

// Decode a flat, exact-case, duplicate-free JSON object. The usual struct
// decoder accepts case-insensitive and repeated keys; neither is suitable for
// an explicit credential-bearing request contract. No raw decoder error escapes.
func decodeProbeInput(raw []byte) (probeInput, error) {
	bad := func() (probeInput, error) { return probeInput{}, ErrConfig }
	if int64(len(raw)) > MaxProbeRequestBytes || !utf8.Valid(raw) {
		return bad()
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	t, err := d.Token()
	if err != nil || t != json.Delim('{') {
		return bad()
	}
	fields := make(map[string]json.RawMessage)
	allowed := map[string]bool{"endpoint": true, "bucket": true, "region": true, "prefix": true, "accessKeyId": true, "secretAccessKey": true, "sessionToken": true, "key": true, "maxBytes": true, "readOnly": true}
	for d.More() {
		t, err = d.Token()
		if err != nil {
			return bad()
		}
		k, ok := t.(string)
		if !ok || !allowed[k] || fields[k] != nil {
			return bad()
		}
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return bad()
		}
		fields[k] = v
	}
	t, err = d.Token()
	if err != nil || t != json.Delim('}') {
		return bad()
	}
	if _, err = d.Token(); err != io.EOF {
		return bad()
	}
	if string(fields["readOnly"]) != "true" {
		return bad()
	}
	limit, err := strconv.ParseInt(string(fields["maxBytes"]), 10, 64)
	if err != nil || limit < 1 || limit > MaxProbeHTTPObjectBytes {
		return bad()
	}
	values := make(map[string]string)
	for _, k := range []string{"endpoint", "bucket", "region", "prefix", "accessKeyId", "secretAccessKey", "sessionToken", "key"} {
		v, ok := fields[k]
		if !ok {
			if k == "prefix" || k == "sessionToken" {
				continue
			}
			return bad()
		}
		s, ok := probeJSONString(v)
		if !ok {
			return bad()
		}
		values[k] = s
	}
	c := Credentials{AccessKeyID: values["accessKeyId"], SecretAccessKey: values["secretAccessKey"], SessionToken: values["sessionToken"]}
	return probeInput{config: Config{Endpoint: values["endpoint"], Bucket: values["bucket"], Region: values["region"], Prefix: values["prefix"]}, credentials: func() Credentials { return c }, key: values["key"], limit: limit}, nil
}

// Reject the JSON decoder's replacement of invalid UTF-16 escapes rather than
// signing a silently changed object key. Valid paired escapes and literal UTF-8
// are preserved, including supplementary characters.
func probeJSONString(raw []byte) (string, bool) {
	if len(raw) < 2 || raw[0] != '"' || !utf8.Valid(raw) {
		return "", false
	}
	var result string
	if json.Unmarshal(raw, &result) != nil {
		return "", false
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if raw[i] != 'u' {
			continue
		}
		v, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return "", false
		}
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return "", false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return "", false
			}
			low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return "", false
			}
			i += 6
		}
	}
	return result, true
}
