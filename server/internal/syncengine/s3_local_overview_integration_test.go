//go:build go1.24

package syncengine

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Real pinned SQLite in mode=ro and os.Root, using only owned temporary data.
func TestS3LocalOverviewActualSQLiteAndRoot(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	attachments := t.TempDir()
	if err := os.WriteFile(filepath.Join(attachments, "PRIVATE_NAME.bin"), []byte("bytes"), 0600); err != nil {
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
	got, err := ReadS3LocalOverview(context.Background(), reader, root, s3CandidateLimits())
	if err != nil || got.Records != 4 || got.AttachmentBytes != 5 || got.Kinds[0].Records != 1 || got.Kinds[1].Records != 1 || got.Kinds[2].Records != 1 || got.Kinds[3].Records != 1 || !got.ObservedStable || got.CompleteForPreview {
		t.Fatal("actual overview", got, err)
	}
	b, err := json.Marshal(got)
	if err != nil || strings.Contains(string(b), "PRIVATE_") || strings.Contains(string(b), "captured-store") || strings.Contains(string(b), "first") {
		t.Fatal("private SQLite/root input exposed")
	}
	if _, err = reader.Exec(`UPDATE files SET content='forbidden'`); err == nil {
		t.Fatal("reader is writable")
	}
	if fileContent(t, writer, "雪") != "first<&>" {
		t.Fatal("DB was modified")
	}
	if b, err := os.ReadFile(filepath.Join(attachments, "PRIVATE_NAME.bin")); err != nil || string(b) != "bytes" {
		t.Fatal("attachment modified")
	}
	if _, err = root.Lstat("PRIVATE_NAME.bin"); err != nil {
		t.Fatal("borrowed root closed")
	}
}
