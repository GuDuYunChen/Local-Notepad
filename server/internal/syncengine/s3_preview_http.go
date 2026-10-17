package syncengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"notepad-server/internal/syncs3"
)

const (
	S3PreviewPath                  = "/api/sync/s3/preview"
	S3PreviewIntent                = "s3-preview"
	MaxS3PreviewRequestBytes int64 = 2 * 1024 * 1024
	MaxS3PreviewRecords            = 128
	s3PreviewTimeout               = 6 * time.Second
)

type s3PreviewOperation func(context.Context, *syncs3.ReadClient, S3ManifestReference, S3PlanRecordBasis, S3PlanRecordLimits) (S3PlanOverview, error)

// S3PreviewHandler is a stateless native-loopback-only HTTP adapter, not a
// provider or a database scanner. Explicit caller-supplied records/base/pin
// still require trusted provenance and completeness. One admitted call per
// handler, no queue/cache/automatic work. Separate probe/preview routes have
// separate slots; the same preview instance must be reused by its router.
// The intent is public, not local-process authentication. No browser CORS.
// The hosting server MUST bound inbound reads (the application uses 10s).
// The 6s context starts before body reading; it prevents late I/O/delivery but
// is not itself a socket read deadline. No detached body-reader goroutine.
type S3PreviewHandler struct {
	slot    chan struct{}
	preview s3PreviewOperation
}

func NewS3PreviewHandler() *S3PreviewHandler {
	return &S3PreviewHandler{slot: make(chan struct{}, 1), preview: ReadS3PlanOverviewFromRecords}
}

type s3PreviewEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    *S3PlanOverview `json:"data"`
}

func s3PreviewReply(w http.ResponseWriter, status int, message string, data *S3PlanOverview) {
	for key := range w.Header() {
		if strings.HasPrefix(strings.ToLower(key), "access-control-allow-") {
			delete(w.Header(), key)
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	code := status
	if status == http.StatusOK {
		code = 0
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(s3PreviewEnvelope{Code: code, Message: message, Data: data})
}

func s3PreviewHeader(r *http.Request, name string) []string {
	var values []string
	for key, value := range r.Header {
		if strings.EqualFold(key, name) {
			values = append(values, value...)
		}
	}
	return values
}

func (h *S3PreviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.URL == nil {
		s3PreviewReply(w, 400, "invalid-request", nil)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		s3PreviewReply(w, 405, "method-not-allowed", nil)
		return
	}
	if !syncs3.NativeReadOnlyRequest(r, S3PreviewIntent) {
		s3PreviewReply(w, 403, "native-loopback-required", nil)
		return
	}
	u := r.URL
	if u.Path != S3PreviewPath || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Host != "" || u.Scheme != "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		s3PreviewReply(w, 400, "invalid-request-target", nil)
		return
	}
	ct := s3PreviewHeader(r, "Content-Type")
	if len(ct) != 1 {
		s3PreviewReply(w, 415, "json-required", nil)
		return
	}
	media, params, err := mime.ParseMediaType(ct[0])
	if err != nil || media != "application/json" || len(params) > 1 || (len(params) == 1 && !strings.EqualFold(params["charset"], "utf-8")) {
		s3PreviewReply(w, 415, "json-required", nil)
		return
	}
	for key := range r.Header {
		if strings.EqualFold(key, "Content-Encoding") || strings.EqualFold(key, "Trailer") {
			s3PreviewReply(w, 415, "encoded-or-trailer-request-refused", nil)
			return
		}
	}
	if len(r.Trailer) != 0 {
		s3PreviewReply(w, 400, "invalid-request", nil)
		return
	}
	if h == nil || h.slot == nil || h.preview == nil {
		s3PreviewReply(w, 503, "preview-unavailable", nil)
		return
	}
	select {
	case h.slot <- struct{}{}:
		defer func() { <-h.slot }()
	default:
		s3PreviewReply(w, 429, "preview-busy", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s3PreviewTimeout)
	defer cancel()
	if ctx.Err() != nil {
		s3PreviewFailure(w, ctx.Err())
		return
	}
	if r.Body == nil {
		s3PreviewReply(w, 400, "invalid-request", nil)
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxS3PreviewRequestBytes)
	defer body.Close() // This runs before slot release, even on malformed input.
	if r.ContentLength > MaxS3PreviewRequestBytes {
		s3PreviewReply(w, 413, "request-too-large", nil)
		return
	}
	raw, err := io.ReadAll(body)
	if ctx.Err() != nil {
		s3PreviewFailure(w, ctx.Err())
		return
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			s3PreviewReply(w, 413, "request-too-large", nil)
		} else {
			s3PreviewReply(w, 400, "invalid-request", nil)
		}
		return
	}
	if len(r.Trailer) != 0 {
		s3PreviewReply(w, 400, "invalid-request", nil)
		return
	}
	input, err := decodeS3PreviewInput(ctx, raw)
	if ctx.Err() != nil {
		s3PreviewFailure(w, ctx.Err())
		return
	}
	if err != nil {
		s3PreviewReply(w, 400, "invalid-request", nil)
		return
	}
	client, err := syncs3.NewReadClient(input.config, input.credentials())
	if err != nil {
		s3PreviewReply(w, 400, "invalid-connection", nil)
		return
	}
	defer client.CloseIdleConnections()
	result, err := h.preview(ctx, client, input.pin, input.basis, input.limits)
	if ctx.Err() != nil {
		s3PreviewFailure(w, ctx.Err())
		return
	}
	if err != nil {
		s3PreviewFailure(w, err)
		return
	}
	if !s3PreviewValidOverview(result, input.limits.Plan.MaxItems) {
		s3PreviewReply(w, 422, "preview-not-available", nil)
		return
	}
	if ctx.Err() != nil {
		s3PreviewFailure(w, ctx.Err())
		return
	}
	s3PreviewReply(w, 200, "OK", &result)
}

func s3PreviewFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		s3PreviewReply(w, 408, "preview-cancelled", nil)
	case errors.Is(err, context.DeadlineExceeded):
		s3PreviewReply(w, 504, "preview-timeout", nil)
	default:
		s3PreviewReply(w, 422, "preview-not-available", nil)
	}
}

// Only the fixed identity-free representation crosses the HTTP boundary.
func s3PreviewValidOverview(out S3PlanOverview, max int) bool {
	if out.Format != S3PlanOverviewFormat || out.Version != 1 || !out.ReadOnly {
		return false
	}
	valid := func(c S3PlanOverviewCounts) bool {
		for _, n := range []int{c.Total, c.UploadCandidates, c.DownloadCandidates, c.Conflicts, c.Noops} {
			if n < 0 || n > max {
				return false
			}
		}
		return c.Total == c.UploadCandidates+c.DownloadCandidates+c.Conflicts+c.Noops
	}
	if !valid(out.Counts) {
		return false
	}
	sum := S3PlanOverviewCounts{}
	for i, kind := range []string{"file", "tag", "file-tag", "attachment"} {
		c := out.Kinds[i].Counts
		if out.Kinds[i].Kind != kind || !valid(c) {
			return false
		}
		sum.Total += c.Total
		sum.UploadCandidates += c.UploadCandidates
		sum.DownloadCandidates += c.DownloadCandidates
		sum.Conflicts += c.Conflicts
		sum.Noops += c.Noops
	}
	return sum == out.Counts
}

type s3PreviewInput struct {
	config      syncs3.Config
	credentials func() syncs3.Credentials
	pin         S3ManifestReference
	basis       S3PlanRecordBasis
	limits      S3PlanRecordLimits
}

func (s3PreviewInput) Format(s fmt.State, _ rune) {
	_, _ = io.WriteString(s, "[S3 preview input redacted]")
}

// The original scanner rejects invalid UTF-8/UTF-16 before JSON decoding. Every
// nested object uses exact names and duplicate/escaped-alias refusal. No decoder
// diagnostic escapes. Record JSON stays a string until the original validator.
func s3PreviewFields(ctx context.Context, raw []byte, names string, optional string) (map[string]json.RawMessage, error) {
	allowed := strings.Fields(names)
	out := make(map[string]json.RawMessage, len(allowed))
	err := s3ManifestMembers(ctx, raw, len(allowed), func(k string, v json.RawMessage) error {
		found := false
		for _, name := range allowed {
			if k == name {
				found = true
				break
			}
		}
		if !found {
			return ErrS3PlanRecordBasis
		}
		out[k] = v
		return nil
	})
	if err != nil {
		return nil, ErrS3PlanRecordBasis
	}
	for _, k := range allowed {
		if out[k] == nil && !strings.Contains(" "+optional+" ", " "+k+" ") {
			return nil, ErrS3PlanRecordBasis
		}
	}
	return out, nil
}
func s3PreviewText(raw json.RawMessage) (string, error) {
	var s string
	if len(raw) < 2 || raw[0] != '"' || json.Unmarshal(raw, &s) != nil {
		return "", ErrS3PlanRecordBasis
	}
	return s, nil
}
func s3PreviewMap(ctx context.Context, raw []byte, max int) (map[string]string, error) {
	out := make(map[string]string)
	err := s3ManifestMembers(ctx, raw, max, func(k string, v json.RawMessage) error {
		s, e := s3PreviewText(v)
		if e != nil {
			return e
		}
		out[k] = s
		return nil
	})
	return out, err
}
func decodeS3PreviewInput(ctx context.Context, raw []byte) (s3PreviewInput, error) {
	bad := func() (s3PreviewInput, error) { return s3PreviewInput{}, ErrS3PlanRecordBasis }
	if int64(len(raw)) > MaxS3PreviewRequestBytes || s3ManifestJSON(ctx, raw) != nil {
		return bad()
	}
	fields, err := s3PreviewFields(ctx, raw, "readOnly connection pin basis limits", "")
	if err != nil || !bytes.Equal(fields["readOnly"], []byte("true")) {
		return bad()
	}
	c, err := s3PreviewFields(ctx, fields["connection"], "endpoint bucket region prefix accessKeyId secretAccessKey sessionToken", "prefix sessionToken")
	if err != nil {
		return bad()
	}
	values := make(map[string]string, len(c))
	for k, v := range c {
		s, e := s3PreviewText(v)
		if e != nil {
			return bad()
		}
		values[k] = s
	}
	p, err := s3PreviewFields(ctx, fields["pin"], "storeId generation sha256", "")
	if err != nil {
		return bad()
	}
	store, err := s3PreviewText(p["storeId"])
	if err != nil || !s3ManifestID(store) {
		return bad()
	}
	hash, err := s3PreviewText(p["sha256"])
	if err != nil || !objectHashPattern.MatchString(hash) {
		return bad()
	}
	generation, err := strconv.ParseInt(string(p["generation"]), 10, 64)
	if err != nil || generation < 1 {
		return bad()
	}
	b, err := s3PreviewFields(ctx, fields["basis"], "storeId localRecords baseItems", "")
	if err != nil {
		return bad()
	}
	localStore, err := s3PreviewText(b["storeId"])
	if err != nil || localStore != store {
		return bad()
	}
	local, err := s3PreviewMap(ctx, b["localRecords"], MaxS3PreviewRecords)
	if err != nil {
		return bad()
	}
	base, err := s3PreviewMap(ctx, b["baseItems"], MaxS3PreviewRecords)
	if err != nil {
		return bad()
	}
	l, err := s3PreviewFields(ctx, fields["limits"], "localRecordBytes totalLocalRecordBytes maxLocalRecords manifestBytes recordBytes totalRecordBytes maxRecords maxItems", "")
	if err != nil {
		return bad()
	}
	caps := map[string]int64{"localRecordBytes": 256 * 1024, "totalLocalRecordBytes": 1024 * 1024, "maxLocalRecords": MaxS3PreviewRecords, "manifestBytes": 1024 * 1024, "recordBytes": 256 * 1024, "totalRecordBytes": 4 * 1024 * 1024, "maxRecords": MaxS3PreviewRecords, "maxItems": 3 * MaxS3PreviewRecords}
	ns := make(map[string]int64, len(l))
	for k, v := range l {
		n, e := strconv.ParseInt(string(v), 10, 64)
		if e != nil || n < 1 || n > caps[k] {
			return bad()
		}
		ns[k] = n
	}
	creds := syncs3.Credentials{AccessKeyID: values["accessKeyId"], SecretAccessKey: values["secretAccessKey"], SessionToken: values["sessionToken"]}
	return s3PreviewInput{config: syncs3.Config{Endpoint: values["endpoint"], Bucket: values["bucket"], Region: values["region"], Prefix: values["prefix"]}, credentials: func() syncs3.Credentials { return creds },
		pin: S3ManifestReference{StoreID: store, Generation: generation, SHA256: hash}, basis: S3PlanRecordBasis{StoreID: localStore, LocalRecords: local, BaseItems: base},
		limits: S3PlanRecordLimits{LocalRecordBytes: ns["localRecordBytes"], TotalLocalRecordBytes: ns["totalLocalRecordBytes"], MaxLocalRecords: int(ns["maxLocalRecords"]), Plan: S3PlanReadLimits{MaxItems: int(ns["maxItems"]), Records: S3RecordSetReadLimits{ManifestBytes: ns["manifestBytes"], RecordBytes: ns["recordBytes"], TotalRecordBytes: ns["totalRecordBytes"], MaxRecords: int(ns["maxRecords"])}}}}, nil
}
