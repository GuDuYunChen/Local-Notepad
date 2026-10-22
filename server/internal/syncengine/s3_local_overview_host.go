package syncengine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"notepad-server/internal/syncs3"
)

const S3LocalOverviewAuthHeader = "X-Notepad-Local-Overview"

var ErrS3LocalOverviewHost = errors.New("本地只读盘点未获授权或未能完成")

// S3LocalOverviewHost binds the application's trusted data directory and a
// process-session capability. Construction never opens or creates user files.
// Each accepted request owns a mode=ro SQLite connection and a lazily opened
// os.Root. All are closed BEFORE buffered statistics can be returned. The
// shared slot includes cleanup and never queues or retries. No credentials,
// paths or budgets are accepted from HTTP/IPC. This is not a sandbox against
// hostile processes running as the same OS user or directory replacement.
type S3LocalOverviewHost struct {
	directory string
	tokenHash [32]byte
	slot      chan struct{}
}

func NewS3LocalOverviewHost(directory, token string) (*S3LocalOverviewHost, error) {
	if !filepath.IsAbs(directory) || !validS3LocalToken(token) {
		return nil, ErrS3LocalOverviewHost
	}
	return &S3LocalOverviewHost{directory: filepath.Clean(directory), tokenHash: sha256.Sum256([]byte(token)), slot: make(chan struct{}, 1)}, nil
}
func (S3LocalOverviewHost) Format(s fmt.State, _ rune) {
	_, _ = io.WriteString(s, "S3LocalOverviewHost{read-only}")
}
func validS3LocalToken(token string) bool {
	if len(token) != 64 {
		return false
	}
	_, err := hex.DecodeString(token)
	return err == nil && token == strings.ToLower(token)
}
func s3HostReadOnlyURI(slashPath string) string {
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	u := url.URL{Scheme: "file", Path: slashPath, RawQuery: "mode=ro"}
	return u.String()
}
func s3HostLimits() S3LocalCandidateLimits {
	return S3LocalCandidateLimits{
		Database:    S3LocalDatabaseLimits{Records: 128, BaseItems: 128, RecordBytes: 256 * 1024, TotalRecordBytes: 1024 * 1024},
		Attachments: S3LocalAttachmentLimits{Attachments: 128, FileBytes: 32 * 1024 * 1024, TotalFileBytes: 64 * 1024 * 1024, RecordBytes: 256 * 1024, TotalRecordBytes: 1024 * 1024},
		Records:     256, TotalRecordBytes: 2 * 1024 * 1024,
	}
}

// Delays directory access until the original handler has validated the body
// and the database observation has completed. There is no os.DirFS fallback.
type s3HostRoot struct {
	directory string
	root      *os.Root
}

func (r *s3HostRoot) open() error {
	if r.root != nil {
		return nil
	}
	root, err := os.OpenRoot(r.directory)
	if err != nil {
		return err
	}
	r.root = root
	return nil
}
func (r *s3HostRoot) OpenFile(name string, flag int, perm os.FileMode) (*os.File, error) {
	if err := r.open(); err != nil {
		return nil, err
	}
	return r.root.OpenFile(name, flag, perm)
}
func (r *s3HostRoot) Lstat(name string) (os.FileInfo, error) {
	if err := r.open(); err != nil {
		return nil, err
	}
	return r.root.Lstat(name)
}
func (r *s3HostRoot) close() error {
	if r.root == nil {
		return nil
	}
	root := r.root
	r.root = nil
	return root.Close()
}

type s3HostResponse struct {
	header   http.Header
	body     bytes.Buffer
	status   int
	overflow bool
}

func (b *s3HostResponse) Header() http.Header { return b.header }
func (b *s3HostResponse) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}
func (b *s3HostResponse) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = 200
	}
	if b.body.Len()+len(p) > 4096 {
		b.overflow = true
		return 0, ErrS3LocalOverviewHost
	}
	return b.body.Write(p)
}
func (h *S3LocalOverviewHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.slot == nil {
		s3LocalOverviewReply(w, 503, "local-overview-unavailable", nil)
		return
	}
	if r == nil || r.URL == nil || !syncs3.NativeReadOnlyRequest(r, S3LocalOverviewIntent) {
		s3LocalOverviewReply(w, 403, "native-loopback-required", nil)
		return
	}
	tokens := s3PreviewHeader(r, S3LocalOverviewAuthHeader)
	if len(tokens) != 1 || !validS3LocalToken(tokens[0]) {
		s3LocalOverviewReply(w, 403, "native-loopback-required", nil)
		return
	}
	received := sha256.Sum256([]byte(tokens[0]))
	if subtle.ConstantTimeCompare(received[:], h.tokenHash[:]) != 1 {
		s3LocalOverviewReply(w, 403, "native-loopback-required", nil)
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
	// sql.Open is lazy; mode=ro forbids creating a missing DB or mutating rows.
	db, err := sql.Open("sqlite", s3HostReadOnlyURI(filepath.ToSlash(filepath.Join(h.directory, "data.db"))))
	if err != nil {
		s3LocalOverviewHTTPFailure(w, err)
		return
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	root := &s3HostRoot{directory: filepath.Join(h.directory, "uploads")}
	defer db.Close()
	defer root.close() // Also close if a driver panics.
	handler, err := NewS3LocalOverviewHandler(db, root, s3HostLimits())
	if err != nil {
		s3LocalOverviewHTTPFailure(w, err)
		return
	}
	buffered := &s3HostResponse{header: make(http.Header)}
	handler.ServeHTTP(buffered, r.WithContext(ctx))
	rootErr, dbErr := root.close(), db.Close()
	if ctx.Err() != nil {
		s3LocalOverviewHTTPFailure(w, ctx.Err())
		return
	}
	if rootErr != nil || dbErr != nil || buffered.overflow || buffered.status == 0 {
		s3LocalOverviewHTTPFailure(w, ErrS3LocalOverviewHost)
		return
	}
	for key := range w.Header() {
		if strings.HasPrefix(strings.ToLower(key), "access-control-allow-") {
			delete(w.Header(), key)
		}
	}
	for key, values := range buffered.header {
		w.Header()[key] = append([]string(nil), values...)
	}
	w.WriteHeader(buffered.status)
	_, _ = w.Write(buffered.body.Bytes())
}
