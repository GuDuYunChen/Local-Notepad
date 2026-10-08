//go:build go1.24

package syncengine

import (
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Actual pinned SQLite mode=ro + os.Root through the HTTP handler. This uses
// Request/ResponseRecorder (no listener), not a production route or GUI test.
func TestS3LocalOverviewHTTPActualReadOnlySQLiteAndRoot(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	attachments := t.TempDir()
	name := filepath.Join(attachments, "PRIVATE_NAME.bin")
	if err := os.WriteFile(name, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(attachments)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	reader, err := sql.Open("sqlite", s3SQLiteReadOnlyURL(filepath.ToSlash(filepath.Join(dir, "data.db"))))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	h, err := NewS3LocalOverviewHandler(reader, root, s3CandidateLimits())
	if err != nil {
		t.Fatal(err)
	}
	read := func(wantBytes int64) {
		t.Helper()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
		o := localOverviewCheck(t, rr, 200, "OK").Data
		if o.Records != 4 || o.AttachmentBytes != wantBytes || o.CompleteForPreview || !o.ObservedStable {
			t.Fatal("actual SQLite/root did not pass original readers and HTTP projection", o)
		}
	}
	read(5)
	// Explicitly alter only our fixture between requests. A new request reads
	// again, rather than retaining the old summary or a private candidate map.
	if err := os.WriteFile(name, []byte("second"), 0600); err != nil {
		t.Fatal(err)
	}
	read(6)
	if _, err := reader.Exec(`UPDATE files SET content='forbidden'`); err == nil {
		t.Fatal("test reader unexpectedly writable")
	}
	if fileContent(t, writer, "雪") != "first<&>" {
		t.Fatal("original database content changed")
	}
	if b, err := os.ReadFile(name); err != nil || string(b) != "second" {
		t.Fatal("HTTP read mutated fixture attachment")
	}
	if _, err := root.Lstat("PRIVATE_NAME.bin"); err != nil {
		t.Fatal("borrowed root closed")
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, localOverviewRequest(localOverviewBody))
	localOverviewCheck(t, rr, 422, "local-overview-not-available")
}
