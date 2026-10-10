package syncengine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const hostTestToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func hostRequest(body string) *http.Request {
	r := httptest.NewRequest("POST", S3LocalOverviewPath, strings.NewReader(body))
	r.Host = "127.0.0.1:27121"
	r.RemoteAddr = "127.0.0.1:30001"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Notepad-Read-Only", S3LocalOverviewIntent)
	r.Header.Set(S3LocalOverviewAuthHeader, hostTestToken)
	return r
}
func hostReply(t *testing.T, h *S3LocalOverviewHost, r *http.Request, status int) *S3LocalOverview {
	t.Helper()
	w := httptest.NewRecorder()
	w.Header().Set("Access-Control-Allow-Origin", "*")
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("status=%d want=%d: %s", w.Code, status, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("missing privacy headers")
	}
	var e s3LocalOverviewEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatal(err)
	}
	if status != 200 && e.Data != nil {
		t.Fatal("partial overview leaked")
	}
	if strings.Contains(w.Body.String(), hostTestToken) || strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatal("private content leaked")
	}
	return e.Data
}
func TestS3LocalHostConfigurationAndReadOnlyURIs(t *testing.T) {
	for _, token := range []string{"", "a", strings.Repeat("g", 64), strings.Repeat("A", 64)} {
		if _, err := NewS3LocalOverviewHost(t.TempDir(), token); err == nil {
			t.Fatal("invalid token accepted")
		}
	}
	if _, err := NewS3LocalOverviewHost("relative", hostTestToken); err == nil {
		t.Fatal("relative directory accepted")
	}
	for _, p := range []string{"D:/space/雪%?#/data.db", "/tmp/space/雪%?#/data.db"} {
		uri := s3HostReadOnlyURI(p)
		u, err := url.Parse(uri)
		if err != nil || u.Host != "" || u.Opaque != "" || u.Fragment != "" || u.RawQuery != "mode=ro" || strings.TrimPrefix(u.Path, "/") != strings.TrimPrefix(p, "/") {
			t.Fatal("unsafe SQLite URI")
		}
	}
	hostReply(t, nil, hostRequest(`{"readOnly":true}`), 503)
}

type hostUnreadBody struct{ reads int }

func (b *hostUnreadBody) Read([]byte) (int, error) { b.reads++; return 0, io.EOF }
func (b *hostUnreadBody) Close() error             { return nil }
func TestS3LocalHostRejectsUnauthenticatedWithoutBodyOrFiles(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	h, err := NewS3LocalOverviewHost(dir, hostTestToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"missing-token", "wrong-token", "duplicate-token", "alias-token", "browser", "bad-intent", "non-loopback"} {
		t.Run(mode, func(t *testing.T) {
			r := hostRequest(`{"readOnly":true}`)
			b := &hostUnreadBody{}
			r.Body = b
			switch mode {
			case "missing-token":
				r.Header.Del(S3LocalOverviewAuthHeader)
			case "wrong-token":
				r.Header.Set(S3LocalOverviewAuthHeader, strings.Repeat("b", 64))
			case "duplicate-token":
				r.Header.Add(S3LocalOverviewAuthHeader, hostTestToken)
			case "alias-token":
				r.Header[strings.ToLower(S3LocalOverviewAuthHeader)] = []string{hostTestToken}
			case "browser":
				r.Header.Set("Origin", "null")
			case "bad-intent":
				r.Header.Set("X-Notepad-Read-Only", "other")
			case "non-loopback":
				r.RemoteAddr = "192.0.2.1:9"
			}
			hostReply(t, h, r, 403)
			if b.reads != 0 {
				t.Fatal("unauthorized body read")
			}
		})
	}
	if _, err = os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("constructor/refusal created directory")
	}
	if text := fmt.Sprintf("%+v %#v", h, *h); strings.Contains(text, dir) || strings.Contains(text, hostTestToken) {
		t.Fatal("host formatting leaks identity")
	}
}
func TestS3LocalHostActualSQLiteRootAndFreshExplicitRead(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	writeAttachment(t, dir, "PRIVATE.bin", "bytes")
	h, err := NewS3LocalOverviewHost(dir, hostTestToken)
	if err != nil {
		t.Fatal(err)
	}
	first := hostReply(t, h, hostRequest(`{"readOnly":true}`), 200)
	if first == nil || first.Records != 4 || first.AttachmentBytes != 5 || first.CompleteForPreview {
		t.Fatal("incorrect actual inventory")
	}
	if fileContent(t, writer, "雪") != "first<&>" {
		t.Fatal("source was altered")
	}
	writeAttachment(t, dir, "PRIVATE.bin", "longer bytes")
	second := hostReply(t, h, hostRequest(`{"readOnly":true}`), 200)
	if second.AttachmentBytes != 12 {
		t.Fatal("cached prior result")
	}
	if err = os.Rename(filepath.Join(dir, "uploads"), filepath.Join(dir, "moved-uploads")); err != nil {
		t.Fatal("root handle leaked", err)
	}
	hostReply(t, h, hostRequest(`{"readOnly":true}`), 422)
	if _, err = os.Stat(filepath.Join(dir, "uploads")); !os.IsNotExist(err) {
		t.Fatal("missing root was recreated")
	}
	if _, err = writer.Exec(`UPDATE files SET title='after-read'`); err != nil {
		t.Fatal("read transaction leaked", err)
	}
}
func TestS3LocalHostOriginalRequestGuardsRemainAuthoritative(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "unopened")
	h, _ := NewS3LocalOverviewHost(dir, hostTestToken)
	for _, tc := range []struct {
		body   string
		status int
	}{{`{}`, 400}, {`{"readOnly":false}`, 400}, {`{"readOnly":true,"path":"PRIVATE"}`, 400}, {`{"readOnly":true,"readOnly":true}`, 400}, {strings.Repeat(" ", 65), 413}} {
		hostReply(t, h, hostRequest(tc.body), tc.status)
	}
	r := hostRequest(`{"readOnly":true}`)
	r.Method = "GET"
	hostReply(t, h, r, 405)
	r = hostRequest(`{"readOnly":true}`)
	r.URL.RawQuery = "path=PRIVATE"
	hostReply(t, h, r, 400)
	r = hostRequest(`{"readOnly":true}`)
	r.Header.Set("Content-Encoding", "gzip")
	hostReply(t, h, r, 415)
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("invalid intent created files")
	}
}
func TestS3LocalHostCancellationAndBusyDoNotOpenResources(t *testing.T) {
	h, _ := NewS3LocalOverviewHost(filepath.Join(t.TempDir(), "missing"), hostTestToken)
	r := hostRequest(`{"readOnly":true}`)
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	hostReply(t, h, r.WithContext(ctx), 408)
	h.slot <- struct{}{}
	r = hostRequest(`{"readOnly":true}`)
	b := &hostUnreadBody{}
	r.Body = b
	hostReply(t, h, r, 429)
	<-h.slot
	if b.reads != 0 {
		t.Fatal("busy request read input")
	}
	hostReply(t, h, hostRequest(`{"readOnly":true}`), 422)
}
func TestS3LocalHostOverBudgetReturnsNoPartialCounts(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	writeAttachment(t, dir, "a.bin", "a")
	for i := 0; i < 128; i++ {
		addTag(t, writer, fmt.Sprintf("t%d", i), fmt.Sprintf("tag%d", i), "#abc")
	}
	h, _ := NewS3LocalOverviewHost(dir, hostTestToken)
	hostReply(t, h, hostRequest(`{"readOnly":true}`), 422)
	var n int
	if writer.QueryRow("SELECT count(*) FROM tags").Scan(&n) != nil || n != 129 {
		t.Fatal("over-budget input mutated")
	}
}

func TestS3LocalHostProductionMigrationLedgerWithoutWritingPragma(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	writeAttachment(t, dir, "a.bin", "a")
	if _, err := writer.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(14,1); PRAGMA user_version=0;`); err != nil {
		t.Fatal(err)
	}
	host, _ := NewS3LocalOverviewHost(dir, hostTestToken)
	hostReply(t, host, hostRequest(`{"readOnly":true}`), 200)
	var version int
	if writer.QueryRow("PRAGMA user_version").Scan(&version) != nil || version != 0 {
		t.Fatal("read request mutated schema marker")
	}
	if _, err := writer.Exec(`INSERT INTO schema_migrations VALUES(15,2)`); err != nil {
		t.Fatal(err)
	}
	hostReply(t, host, hostRequest(`{"readOnly":true}`), 422)
}
