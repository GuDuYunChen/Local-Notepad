package syncengine

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"notepad-server/internal/syncs3"
)

const (
	S3LocalOverviewPath                  = "/api/sync/s3/local-overview"
	S3LocalOverviewIntent                = "s3-local-overview"
	MaxS3LocalOverviewRequestBytes int64 = 64
	s3LocalOverviewHTTPTimeout           = 5 * time.Second
)

var ErrS3LocalOverviewHandlerInput = errors.New("本地概览请求处理器的读取能力或预算无效")

type s3LocalOverviewRead func(context.Context, *sql.DB, S3LocalAttachmentRoot, S3LocalCandidateLimits) (S3LocalOverview, error)

// S3LocalOverviewHandler exposes ONLY the accepted identity-free local counts.
// A trusted host binds already-authorized borrowed db/root capabilities and
// explicit limits ONCE. The request cannot choose a path, database, credentials,
// remote, pin, records or budgets. Construction performs no I/O. Reuse one
// instance for the resource lifetime: its slot rejects overlap without queuing.
// Copies share the same slot; there is no cache, retry, background work or Close
// method that could close borrowed capabilities. The host owns their lifetime.
//
// This is an adapter, deliberately NOT registered with production HTTP or IPC.
// Future wiring must establish capability provenance, local-process access and
// lifetime separately. Public intent + loopback/browser guard is NOT auth.
// Counts still reveal coarse usage; never make this a public telemetry route.
//
// One 5s/caller-earlier context covers body handling, original D1/A1/D2/A2
// reading, cleanup and delivery checks. It does not interrupt an uncooperative
// Body.Read/Close, filesystem or driver syscall. The host MUST bound inbound
// reads with a server ReadTimeout and must not pre-parse the body. No detached
// goroutine pretends cancellation has completed while I/O is still running.
// CompleteForPreview remains false: this is not a remote plan or sync consent.
type S3LocalOverviewHandler struct {
	db     *sql.DB
	root   S3LocalAttachmentRoot
	limits S3LocalCandidateLimits
	slot   chan struct{}
	read   s3LocalOverviewRead
}

func NewS3LocalOverviewHandler(db *sql.DB, root S3LocalAttachmentRoot, limits S3LocalCandidateLimits) (*S3LocalOverviewHandler, error) {
	if db == nil || s3NilAttachmentRoot(root) || !s3AttachmentPlatform || !s3LocalCandidateLimitsValid(limits) {
		return nil, ErrS3LocalOverviewHandlerInput
	}
	return &S3LocalOverviewHandler{db: db, root: root, limits: limits, slot: make(chan struct{}, 1), read: ReadS3LocalOverview}, nil
}

// A value receiver also protects copied/nested values from fmt's private-field
// traversal. Formatting must not expose a capability's path or driver state.
func (S3LocalOverviewHandler) Format(s fmt.State, _ rune) {
	_, _ = io.WriteString(s, "S3LocalOverviewHandler{read-only}")
}

type s3LocalOverviewEnvelope struct {
	Code    int              `json:"code"`
	Message string           `json:"message"`
	Data    *S3LocalOverview `json:"data"`
}

func s3LocalOverviewReply(w http.ResponseWriter, status int, message string, data *S3LocalOverview) {
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
	_ = json.NewEncoder(w).Encode(s3LocalOverviewEnvelope{code, message, data})
}

func s3LocalOverviewHTTPFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		s3LocalOverviewReply(w, 408, "local-overview-cancelled", nil)
	case errors.Is(err, context.DeadlineExceeded):
		s3LocalOverviewReply(w, 504, "local-overview-timeout", nil)
	default:
		s3LocalOverviewReply(w, 422, "local-overview-not-available", nil)
	}
}

func (h *S3LocalOverviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.URL == nil {
		s3LocalOverviewReply(w, 400, "invalid-request", nil)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		s3LocalOverviewReply(w, 405, "method-not-allowed", nil)
		return
	}
	if !syncs3.NativeReadOnlyRequest(r, S3LocalOverviewIntent) {
		s3LocalOverviewReply(w, 403, "native-loopback-required", nil)
		return
	}
	u := r.URL
	if u.Path != S3LocalOverviewPath || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Host != "" || u.Scheme != "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		s3LocalOverviewReply(w, 400, "invalid-request-target", nil)
		return
	}
	ct := s3PreviewHeader(r, "Content-Type")
	if len(ct) != 1 {
		s3LocalOverviewReply(w, 415, "json-required", nil)
		return
	}
	media, params, err := mime.ParseMediaType(ct[0])
	if err != nil || media != "application/json" || len(params) > 1 || (len(params) == 1 && !strings.EqualFold(params["charset"], "utf-8")) {
		s3LocalOverviewReply(w, 415, "json-required", nil)
		return
	}
	for key := range r.Header {
		if strings.EqualFold(key, "Content-Encoding") || strings.EqualFold(key, "Trailer") {
			s3LocalOverviewReply(w, 415, "encoded-or-trailer-request-refused", nil)
			return
		}
	}
	if len(r.Trailer) != 0 {
		s3LocalOverviewReply(w, 400, "invalid-request", nil)
		return
	}
	if h == nil || h.slot == nil || h.read == nil || h.db == nil || s3NilAttachmentRoot(h.root) || !s3LocalCandidateLimitsValid(h.limits) {
		s3LocalOverviewReply(w, 503, "local-overview-unavailable", nil)
		return
	}
	select {
	case h.slot <- struct{}{}:
		defer func() { <-h.slot }()
	default:
		s3LocalOverviewReply(w, 429, "local-overview-busy", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s3LocalOverviewHTTPTimeout)
	defer cancel()
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	if r.Body == nil {
		s3LocalOverviewReply(w, 400, "invalid-request", nil)
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxS3LocalOverviewRequestBytes)
	// Close before any local read, while still holding the slot. A body-close
	// failure must not occur after a successful overview has already been sent.
	if r.ContentLength > MaxS3LocalOverviewRequestBytes {
		_ = body.Close()
		s3LocalOverviewReply(w, 413, "request-too-large", nil)
		return
	}
	raw, err := io.ReadAll(body)
	closeErr := body.Close()
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			s3LocalOverviewReply(w, 413, "request-too-large", nil)
		} else {
			s3LocalOverviewReply(w, 400, "invalid-request", nil)
		}
		return
	}
	if closeErr != nil || len(r.Trailer) != 0 || (r.ContentLength >= 0 && r.ContentLength != int64(len(raw))) || !s3LocalOverviewIntentBody(raw) {
		s3LocalOverviewReply(w, 400, "invalid-request", nil)
		return
	}
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	out, err := h.read(ctx, h.db, h.root, h.limits)
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	if err != nil || !s3LocalOverviewHTTPValid(out, h.limits) {
		s3LocalOverviewHTTPFailure(w, err)
		return
	}
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	s3LocalOverviewReply(w, 200, "OK", &out)
}

// Token-by-token, case-sensitive, exactly one field: duplicates (including
// escaped-key aliases), coercion, additional objects and trailing data fail.
func s3LocalOverviewIntentBody(raw []byte) bool {
	if int64(len(raw)) > MaxS3LocalOverviewRequestBytes {
		return false
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	for _, want := range []any{json.Delim('{'), "readOnly", true, json.Delim('}')} {
		got, err := d.Token()
		if err != nil || got != want {
			return false
		}
	}
	_, err := d.Token()
	return errors.Is(err, io.EOF)
}

// Check fixed output vocabulary and budgets before anything reaches JSON.
// This is NOT provenance certification or an exported arbitrary-data projector.
func s3LocalOverviewHTTPValid(out S3LocalOverview, l S3LocalCandidateLimits) bool {
	if out.Format != S3LocalOverviewFormat || out.Version != 1 || !out.ReadOnly || !out.ObservedStable || out.CompleteForPreview ||
		out.Records < 0 || out.Records > l.Records || out.RecordBytes < 0 || out.RecordBytes > l.TotalRecordBytes ||
		out.AttachmentBytes < 0 || out.AttachmentBytes > l.Attachments.TotalFileBytes || out.BaseItems < 0 || out.BaseItems > l.Database.BaseItems {
		return false
	}
	count, databaseCount := 0, 0
	var total, databaseBytes int64
	for i, kind := range []string{"file", "tag", "file-tag", "attachment"} {
		r := out.Kinds[i]
		cap, perRecord, aggregate := l.Database.Records, l.Database.RecordBytes, l.Database.TotalRecordBytes
		if i == 3 {
			cap, perRecord, aggregate = l.Attachments.Attachments, l.Attachments.RecordBytes, l.Attachments.TotalRecordBytes
		}
		if r.Kind != kind || r.Records < 0 || r.Records > cap || r.RecordBytes < 0 || r.RecordBytes > aggregate ||
			r.RecordBytes > int64(r.Records)*perRecord || (r.Records > 0 && r.RecordBytes < int64(r.Records)) {
			return false
		}
		count += r.Records
		total += r.RecordBytes
		if i < 3 {
			databaseCount += r.Records
			databaseBytes += r.RecordBytes
		}
	}
	return count == out.Records && total == out.RecordBytes && databaseCount <= l.Database.Records && databaseBytes <= l.Database.TotalRecordBytes &&
		out.AttachmentBytes <= int64(out.Kinds[3].Records)*l.Attachments.FileBytes
}
