package syncengine

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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

func previewPayload(t *testing.T, endpoint string, f recordSetFixture) map[string]any {
	t.Helper()
	b := recordPlanBasis(t)
	for id, r := range f.records {
		b.LocalRecords[id] = " \n" + string(recordBytes(t, r)) + "\n"
	}
	return map[string]any{"readOnly": true,
		"connection": map[string]any{"endpoint": endpoint, "bucket": "synthetic-bucket", "region": "us-east-1", "prefix": "空间", "accessKeyId": "AKIASYNTHETIC", "secretAccessKey": "SYNTHETIC_SECRET", "sessionToken": "SYNTHETIC_TOKEN"},
		"pin":        map[string]any{"storeId": f.ref.StoreID, "generation": f.ref.Generation, "sha256": f.ref.SHA256},
		"basis":      map[string]any{"storeId": b.StoreID, "localRecords": b.LocalRecords, "baseItems": b.BaseItems},
		"limits":     map[string]any{"localRecordBytes": 32768, "totalLocalRecordBytes": 65536, "maxLocalRecords": 32, "manifestBytes": 32768, "recordBytes": 32768, "totalRecordBytes": 65536, "maxRecords": 32, "maxItems": 96}}
}
func previewJSON(t *testing.T, input any) []byte {
	t.Helper()
	b, e := json.Marshal(input)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func previewRequest(raw []byte) *http.Request {
	r := httptest.NewRequest(http.MethodPost, S3PreviewPath, bytes.NewReader(raw))
	r.RemoteAddr = "127.0.0.1:43000"
	r.Host = "127.0.0.1:27121"
	r.Header.Set("Content-Type", "application/json; charset=utf-8")
	r.Header.Set(syncs3.ReadProbeIntentHeader, S3PreviewIntent)
	return r
}
func previewCheck(t *testing.T, rr *httptest.ResponseRecorder, status int) s3PreviewEnvelope {
	t.Helper()
	if rr.Code != status {
		t.Fatalf("unexpected HTTP status: %d instead of %d", rr.Code, status)
	}
	var result s3PreviewEnvelope
	if json.Unmarshal(rr.Body.Bytes(), &result) != nil {
		t.Fatal("not a JSON envelope")
	}
	wantCode := status
	if status == 200 {
		wantCode = 0
	}
	if result.Code != wantCode || (status != 200 && result.Data != nil) {
		t.Fatal("partial or incorrectly classified result")
	}
	if rr.Header().Get("Cache-Control") != "no-store" || rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing privacy headers")
	}
	for k := range rr.Header() {
		if strings.HasPrefix(strings.ToLower(k), "access-control-allow-") {
			t.Fatal("browser CORS admitted")
		}
	}
	for _, private := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", pinnedManifest().StoreID, "objects/", "manifests/", "endpoint", "secretAccessKey"} {
		if strings.Contains(rr.Body.String(), private) {
			t.Fatal("private detail in HTTP result")
		}
	}
	return result
}
func previewEmpty() S3PlanOverview {
	return S3PlanOverview{Format: S3PlanOverviewFormat, Version: 1, ReadOnly: true, Kinds: [4]S3PlanKindOverview{{Kind: "file"}, {Kind: "tag"}, {Kind: "file-tag"}, {Kind: "attachment"}}}
}

type previewObservedBody struct {
	io.Reader
	reads, closes int
}

func (b *previewObservedBody) Read(p []byte) (int, error) { b.reads++; return b.Reader.Read(p) }
func (b *previewObservedBody) Close() error               { b.closes++; return nil }

func TestS3PreviewHTTPRealSignedReadAndCountOnlyResponse(t *testing.T) {
	records := []Record{setFile("root", "PRIVATE_DIR", "", true), setFile("e\u0301 %2F", "PRIVATE_TITLE", "root", false),
		presentTagRecord(TagPayload{ID: "标签", Name: "PRIVATE_TAG", Color: "#abcdef"}),
		presentFileTagRecord(FileTagPayload{FileID: "e\u0301 %2F", TagID: "标签"}),
		presentAttachmentRecord(AttachmentPayload{Name: "PRIVATE.bin", Size: 0, BlobHash: pinnedItemHash}), purgedRecordForKey("deleted")}
	f := newRecordSetFixture(t, records...)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.RawQuery != "" || !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") || r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" {
			t.Error("incorrect signed read")
		}
		b, ok := f.body(r.URL.Path)
		if !ok {
			t.Error("unlisted read")
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(b)
	}))
	defer upstream.Close()
	server := httptest.NewServer(NewS3PreviewHandler())
	defer server.Close()
	raw := previewJSON(t, previewPayload(t, upstream.URL, f))
	req, e := http.NewRequest("POST", server.URL+S3PreviewPath, bytes.NewReader(raw))
	if e != nil {
		t.Fatal(e)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(syncs3.ReadProbeIntentHeader, S3PreviewIntent)
	client := &http.Client{Timeout: 3 * time.Second}
	defer client.CloseIdleConnections()
	res, e := client.Do(req)
	if e != nil {
		t.Fatal("isolated preview HTTP failed")
	}
	defer res.Body.Close()
	body, e := io.ReadAll(res.Body)
	if e != nil {
		t.Fatal(e)
	}
	rr := httptest.NewRecorder()
	rr.HeaderMap = res.Header
	rr.Code = res.StatusCode
	rr.Body.Write(body)
	out := previewCheck(t, rr, 200)
	if out.Data == nil || out.Data.Counts.Total != 6 || out.Data.Counts.Noops != 6 || calls.Load() != 7 {
		t.Fatal("incorrect real read/count")
	}
	for i, want := range []int{3, 1, 1, 1} {
		if out.Data.Kinds[i].Counts.Noops != want {
			t.Fatal("kind counts changed")
		}
	}
	var envelope map[string]json.RawMessage
	_ = json.Unmarshal(body, &envelope)
	var summary map[string]json.RawMessage
	_ = json.Unmarshal(envelope["data"], &summary)
	if len(envelope) != 3 || len(summary) != 5 {
		t.Fatal("unexpected response fields")
	}
}

func TestS3PreviewHTTPAdmissionRefusesBeforeReadingBody(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*http.Request)
		status int
	}{
		{"get", func(r *http.Request) { r.Method = "GET" }, 405}, {"options", func(r *http.Request) { r.Method = "OPTIONS" }, 405},
		{"remote peer", func(r *http.Request) { r.RemoteAddr = "192.0.2.1:43000"; r.Header.Set("X-Forwarded-For", "127.0.0.1") }, 403},
		{"remote host", func(r *http.Request) { r.Host = "private.invalid:27121" }, 403}, {"bad host port", func(r *http.Request) { r.Host = "localhost:0" }, 403},
		{"no intent", func(r *http.Request) { r.Header.Del(syncs3.ReadProbeIntentHeader) }, 403},
		{"probe intent", func(r *http.Request) { r.Header.Set(syncs3.ReadProbeIntentHeader, syncs3.ReadProbeIntent) }, 403},
		{"double intent", func(r *http.Request) { r.Header.Add(syncs3.ReadProbeIntentHeader, S3PreviewIntent) }, 403},
		{"case duplicate intent", func(r *http.Request) { r.Header["x-notepad-read-only"] = []string{S3PreviewIntent} }, 403},
		{"origin null", func(r *http.Request) { r.Header.Set("Origin", "null") }, 403}, {"empty origin", func(r *http.Request) { r.Header["origin"] = nil }, 403},
		{"referer", func(r *http.Request) { r.Header.Set("Referer", "http://localhost/") }, 403}, {"fetch metadata", func(r *http.Request) { r.Header["sEc-FeTcH-Site"] = nil }, 403},
		{"wrong target", func(r *http.Request) { r.URL.Path = syncs3.ReadProbePath }, 400}, {"encoded target", func(r *http.Request) { r.URL.RawPath = "/api/sync/s3/%70review" }, 400},
		{"query", func(r *http.Request) { r.URL.RawQuery = "PRIVATE_QUERY" }, 400}, {"empty query", func(r *http.Request) { r.URL.ForceQuery = true }, 400},
		{"absolute target", func(r *http.Request) { r.URL.Scheme = "http"; r.URL.Host = r.Host }, 400}, {"fragment", func(r *http.Request) { r.URL.Fragment = "PRIVATE" }, 400},
		{"text input", func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 415},
		{"double content type", func(r *http.Request) { r.Header["content-type"] = []string{"application/json"} }, 415},
		{"other parameter", func(r *http.Request) { r.Header.Set("Content-Type", "application/json; boundary=abc") }, 415},
		{"empty encoding", func(r *http.Request) { r.Header["content-encoding"] = nil }, 415},
		{"trailer header", func(r *http.Request) { r.Header.Set("Trailer", "Origin") }, 415}, {"trailer map", func(r *http.Request) { r.Trailer = http.Header{"Origin": nil} }, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := previewRequest([]byte("{}"))
			b := &previewObservedBody{Reader: strings.NewReader("PRIVATE_BODY")}
			r.Body = b
			tc.change(r)
			h := NewS3PreviewHandler()
			h.preview = func(context.Context, *syncs3.ReadClient, S3ManifestReference, S3PlanRecordBasis, S3PlanRecordLimits) (S3PlanOverview, error) {
				t.Error("guard dispatched operation")
				return previewEmpty(), nil
			}
			rr := httptest.NewRecorder()
			rr.Header()["access-control-allow-origin"] = []string{"*"}
			h.ServeHTTP(rr, r)
			previewCheck(t, rr, tc.status)
			if b.reads != 0 {
				t.Fatal("refused request body was read")
			}
		})
	}
	if syncs3.NativeReadOnlyRequest(nil, S3PreviewIntent) || syncs3.NativeReadOnlyRequest(previewRequest(nil), "") {
		t.Fatal("empty policy accepted")
	}
}

func TestS3PreviewHTTPStrictNestedJSONAndLimitsStayOffline(t *testing.T) {
	f := newRecordSetFixture(t)
	base := string(previewJSON(t, previewPayload(t, "https://synthetic.invalid", f)))
	invalid := []string{"null", "[]", base + "{}", strings.Replace(base, `"readOnly":true`, `"readOnly":false`, 1), strings.Replace(base, `"readOnly":true`, `"readonly":true`, 1), strings.Replace(base, `"readOnly":true`, `"readOnly":true,"read\u004fnly":true`, 1)}
	// Duplicate and unknown members at EVERY object level, including empty maps.
	for _, key := range []string{"connection", "pin", "basis", "limits", "localRecords", "baseItems"} {
		target := `"` + key + `":{`
		comma := ","
		if strings.Contains(base, target+"}") {
			comma = ""
		}
		invalid = append(invalid, strings.Replace(base, target, target+`"unknown":0`+comma, 1), strings.Replace(base, target, target+`"dup":"x","d\u0075p":"y"`+comma, 1))
	}
	for _, key := range []string{"endpoint", "bucket", "region", "prefix", "accessKeyId", "secretAccessKey", "sessionToken", "storeId", "sha256"} {
		var obj map[string]any
		_ = json.Unmarshal([]byte(base), &obj)
		section := obj["connection"].(map[string]any)
		if key == "storeId" || key == "sha256" {
			section = obj["pin"].(map[string]any)
		}
		section[key] = nil
		invalid = append(invalid, string(previewJSON(t, obj)))
	}
	for _, key := range []string{"localRecordBytes", "totalLocalRecordBytes", "maxLocalRecords", "manifestBytes", "recordBytes", "totalRecordBytes", "maxRecords", "maxItems"} {
		for _, value := range []any{0, -1, 1.5, 1000000000, "1", nil} {
			obj := previewPayload(t, "https://synthetic.invalid", f)
			obj["limits"].(map[string]any)[key] = value
			invalid = append(invalid, string(previewJSON(t, obj)))
		}
	}
	for _, field := range []string{"connection", "pin", "basis", "limits"} {
		obj := previewPayload(t, "https://synthetic.invalid", f)
		delete(obj, field)
		invalid = append(invalid, string(previewJSON(t, obj)))
	}
	invalid = append(invalid, strings.Replace(base, `"sessionToken":"SYNTHETIC_TOKEN"`, `"sessionToken":"\ud800"`, 1), strings.Replace(base, `"generation":7`, `"generation":7e0`, 1), base+string([]byte{0xff}))
	for i, raw := range invalid {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			h := NewS3PreviewHandler()
			h.preview = func(context.Context, *syncs3.ReadClient, S3ManifestReference, S3PlanRecordBasis, S3PlanRecordLimits) (S3PlanOverview, error) {
				t.Error("bad JSON reached operation")
				return previewEmpty(), nil
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, previewRequest([]byte(raw)))
			previewCheck(t, rr, 400)
		})
	}
	// Nil maps and >128 map members are rejected, not truncated.
	for _, value := range []any{nil, []string{}, func() map[string]string {
		m := map[string]string{}
		for i := 0; i < 129; i++ {
			m[fmt.Sprint(i)] = "{}"
		}
		return m
	}()} {
		obj := previewPayload(t, "https://synthetic.invalid", f)
		obj["basis"].(map[string]any)["localRecords"] = value
		rr := httptest.NewRecorder()
		NewS3PreviewHandler().ServeHTTP(rr, previewRequest(previewJSON(t, obj)))
		previewCheck(t, rr, 400)
	}
}

func TestS3PreviewHTTPInvalidLocalRecordsNeverReachS3(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer upstream.Close()
	for _, r := range []Record{setFile("note", "PRIVATE", "missing-parent", false), setFile("note", "PRIVATE", "note", true)} {
		input := previewPayload(t, upstream.URL, f)
		input["basis"].(map[string]any)["localRecords"] = map[string]string{r.ID: string(recordBytes(t, r))}
		rr := httptest.NewRecorder()
		NewS3PreviewHandler().ServeHTTP(rr, previewRequest(previewJSON(t, input)))
		previewCheck(t, rr, 422)
	}
	for _, raw := range []string{`{"id":"note","id":"elsewhere"}`, `{"format":"\ud800"}`, "{}"} {
		input := previewPayload(t, upstream.URL, f)
		input["basis"].(map[string]any)["localRecords"] = map[string]string{"note": raw}
		rr := httptest.NewRecorder()
		NewS3PreviewHandler().ServeHTTP(rr, previewRequest(previewJSON(t, input)))
		previewCheck(t, rr, 422)
	}
	if calls.Load() != 0 {
		t.Fatal("invalid local basis accessed upstream")
	}
}

type previewBrokenBody struct{}

func (previewBrokenBody) Read([]byte) (int, error) { return 0, errors.New("PRIVATE_READ_ERROR") }
func (previewBrokenBody) Close() error             { return nil }
func TestS3PreviewHTTPBodyBudgetErrorsAndClosure(t *testing.T) {
	for _, announced := range []bool{false, true} {
		r := previewRequest(nil)
		b := &previewObservedBody{Reader: strings.NewReader(strings.Repeat(" ", int(MaxS3PreviewRequestBytes+1)))}
		r.Body = b
		r.ContentLength = -1
		if announced {
			r.ContentLength = MaxS3PreviewRequestBytes + 1
		}
		rr := httptest.NewRecorder()
		NewS3PreviewHandler().ServeHTTP(rr, r)
		previewCheck(t, rr, 413)
		if b.closes != 1 || (announced && b.reads != 0) {
			t.Fatal("request budget/close changed")
		}
	}
	r := previewRequest(nil)
	r.Body = previewBrokenBody{}
	rr := httptest.NewRecorder()
	NewS3PreviewHandler().ServeHTTP(rr, r)
	previewCheck(t, rr, 400)
	for _, h := range []*S3PreviewHandler{nil, {}, NewS3PreviewHandler()} {
		r := previewRequest(nil)
		r.Body = nil
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		status := 503
		if h != nil && h.preview != nil {
			status = 400
		}
		previewCheck(t, rr, status)
	}
}

func TestS3PreviewHTTPFailClosedOperationResults(t *testing.T) {
	raw := previewJSON(t, previewPayload(t, "https://synthetic.invalid", newRecordSetFixture(t)))
	for _, tc := range []struct {
		name   string
		out    S3PlanOverview
		err    error
		status int
	}{
		{"private error", previewEmpty(), errors.New("PRIVATE_NATIVE_ERROR"), 422},
		{"wrapped cancelled", previewEmpty(), fmt.Errorf("PRIVATE: %w", context.Canceled), 408},
		{"wrapped deadline", previewEmpty(), fmt.Errorf("PRIVATE: %w", context.DeadlineExceeded), 504},
		{"zero success", S3PlanOverview{}, nil, 422},
		{"private kind", func() S3PlanOverview { v := previewEmpty(); v.Kinds[0].Kind = "PRIVATE_ID"; return v }(), nil, 422},
		{"count mismatch", func() S3PlanOverview { v := previewEmpty(); v.Counts.Noops = 1; return v }(), nil, 422},
		{"kind mismatch", func() S3PlanOverview {
			v := previewEmpty()
			v.Kinds[0].Counts.Total = 1
			v.Kinds[0].Counts.Conflicts = 1
			return v
		}(), nil, 422},
		{"budget overflow", func() S3PlanOverview {
			v := previewEmpty()
			v.Counts.Total = 97
			v.Counts.Noops = 97
			v.Kinds[0].Counts = v.Counts
			return v
		}(), nil, 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewS3PreviewHandler()
			h.preview = func(context.Context, *syncs3.ReadClient, S3ManifestReference, S3PlanRecordBasis, S3PlanRecordLimits) (S3PlanOverview, error) {
				return tc.out, tc.err
			}
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, previewRequest(raw))
			previewCheck(t, rr, tc.status)
		})
	}
}

func TestS3PreviewHTTPBusySlotHeldUntilCancelledOperationReturns(t *testing.T) {
	h := NewS3PreviewHandler()
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	var calls atomic.Int32
	h.preview = func(ctx context.Context, _ *syncs3.ReadClient, _ S3ManifestReference, _ S3PlanRecordBasis, _ S3PlanRecordLimits) (S3PlanOverview, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return previewEmpty(), nil // deliberately late success
	}
	raw := previewJSON(t, previewPayload(t, "https://synthetic.invalid", newRecordSetFixture(t)))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := httptest.NewRecorder()
	go func() { h.ServeHTTP(first, previewRequest(raw).WithContext(ctx)); close(done) }()
	t.Cleanup(func() {
		cancel()
		unblock()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("owned handler did not finish cleanup")
		}
	})
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("operation did not start")
	}
	cancel()
	refused := previewRequest(raw)
	body := &previewObservedBody{Reader: bytes.NewReader(raw)}
	refused.Body = body
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, refused)
	previewCheck(t, rr, 429)
	if body.reads != 0 || calls.Load() != 1 {
		t.Fatal("busy request queued or dispatched")
	}
	unblock()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("owned operation failed to drain")
	}
	previewCheck(t, first, 408)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, previewRequest(raw))
	previewCheck(t, rr, 200)
	if calls.Load() != 2 {
		t.Fatal("drained slot unavailable")
	}
}

func TestS3PreviewHTTPCallerDeadlineAndAlreadyCancelled(t *testing.T) {
	raw := previewJSON(t, previewPayload(t, "https://synthetic.invalid", newRecordSetFixture(t)))
	h := NewS3PreviewHandler()
	var calls atomic.Int32
	h.preview = func(ctx context.Context, _ *syncs3.ReadClient, _ S3ManifestReference, _ S3PlanRecordBasis, _ S3PlanRecordLimits) (S3PlanOverview, error) {
		calls.Add(1)
		d, ok := ctx.Deadline()
		if !ok || time.Until(d) > s3PreviewTimeout {
			t.Error("deadline extended")
		}
		<-ctx.Done()
		return previewEmpty(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, previewRequest(raw).WithContext(ctx))
	previewCheck(t, rr, 504)
	ctx2, stop := context.WithCancel(context.Background())
	stop()
	r := previewRequest(raw).WithContext(ctx2)
	b := &previewObservedBody{Reader: bytes.NewReader(raw)}
	r.Body = b
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	previewCheck(t, rr, 408)
	if calls.Load() != 1 || b.reads != 0 {
		t.Fatal("already-cancelled request did work")
	}
}

func TestS3PreviewHTTPCancellationReachesRealGET(t *testing.T) {
	f := newRecordSetFixture(t)
	started := make(chan struct{})
	upDone := make(chan struct{})
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		close(started)
		<-r.Context().Done()
		close(upDone)
	}))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	raw := previewJSON(t, previewPayload(t, upstream.URL, f))
	rr := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { NewS3PreviewHandler().ServeHTTP(rr, previewRequest(raw).WithContext(ctx)); close(done) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("real GET not started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not drain")
	}
	select {
	case <-upDone:
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation not propagated")
	}
	previewCheck(t, rr, 408)
	if calls.Load() != 1 {
		t.Fatal("unexpected retry")
	}
}

func TestS3PreviewHTTPRemoteRefusalsNeverReturnEmptySuccess(t *testing.T) {
	f := newRecordSetFixture(t)
	for _, status := range []int{302, 403, 404, 500, 200} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", "http://PRIVATE.invalid")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, "PRIVATE_UNTRUSTED_BODY")
			}))
			defer upstream.Close()
			rr := httptest.NewRecorder()
			NewS3PreviewHandler().ServeHTTP(rr, previewRequest(previewJSON(t, previewPayload(t, upstream.URL, f))))
			previewCheck(t, rr, 422)
			if calls.Load() != 1 {
				t.Fatal("refusal replayed")
			}
		})
	}
}

func TestS3PreviewHTTPInputFormattingAndExplicitEmptyComparison(t *testing.T) {
	f := newRecordSetFixture(t)
	raw := previewJSON(t, previewPayload(t, "https://synthetic.invalid", f))
	input, e := decodeS3PreviewInput(context.Background(), raw)
	if e != nil {
		t.Fatal(e)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		if strings.Contains(fmt.Sprintf(verb, input), "SYNTHETIC") {
			t.Fatal("input formatting leaked credentials")
		}
	}
	inputMap := previewPayload(t, "https://synthetic.invalid", f)
	delete(inputMap["connection"].(map[string]any), "prefix")
	delete(inputMap["connection"].(map[string]any), "sessionToken")
	if _, e = decodeS3PreviewInput(context.Background(), previewJSON(t, inputMap)); e != nil {
		t.Fatal("optional fields refused")
	}
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = w.Write(f.raw) }))
	defer upstream.Close()
	rr := httptest.NewRecorder()
	NewS3PreviewHandler().ServeHTTP(rr, previewRequest(previewJSON(t, previewPayload(t, upstream.URL, f))))
	out := previewCheck(t, rr, 200)
	if out.Data == nil || out.Data.Counts.Total != 0 || calls.Load() != 1 {
		t.Fatal("empty comparison bypassed manifest")
	}
}
