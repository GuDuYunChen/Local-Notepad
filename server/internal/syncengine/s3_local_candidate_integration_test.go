//go:build go1.24

package syncengine

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Both the pinned SQLite driver (mode=ro) and os.Root are REAL here. Only the
// fixture owns the writer and directory. No application profile, real bucket,
// HTTP/IPC transport or mocked filesystem/database rows are involved.
func TestS3LocalCandidateActualSQLiteAndRoot(t *testing.T) {
	writer, dir := s3SQLiteSeed(t)
	attachments := t.TempDir()
	if err := os.WriteFile(filepath.Join(attachments, "雪.bin"), []byte("bytes"), 0600); err != nil {
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
	out, err := ReadS3LocalCandidate(context.Background(), reader, root, s3CandidateLimits())
	if err != nil || len(out.LocalRecords) != 4 || out.AttachmentBytes != 5 || !out.ObservedStable || out.CompleteForPreview || out.StoredRemoteStoreID != "captured-store" {
		t.Fatal("actual input composition", err)
	}
	if _, err = reader.Exec(`UPDATE files SET content='forbidden'`); err == nil {
		t.Fatal("test reader was writable")
	}
	if fileContent(t, writer, "雪") != "first<&>" {
		t.Fatal("reader changed database")
	}
	if b, err := os.ReadFile(filepath.Join(attachments, "雪.bin")); err != nil || string(b) != "bytes" {
		t.Fatal("reader changed attachment", err)
	}
	if _, err = root.Lstat("雪.bin"); err != nil {
		t.Fatal("borrowed root closed", err)
	}
}

func TestS3LocalCandidateActualConcurrentChanges(t *testing.T) {
	for _, kind := range []string{"database", "attachment"} {
		t.Run(kind, func(t *testing.T) {
			writer, dir := s3SQLiteSeed(t)
			attachments := t.TempDir()
			path := filepath.Join(attachments, "a")
			if err := os.WriteFile(path, []byte("before"), 0600); err != nil {
				t.Fatal(err)
			}
			root, err := os.OpenRoot(attachments)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			observations := 0
			reader := sql.OpenDB(s3ObservedSQLiteConnector{dsn: s3SQLiteReadOnlyURL(filepath.ToSlash(filepath.Join(dir, "data.db"))), before: func(q string) {
				if q != "PRAGMA user_version" {
					return
				}
				observations++
				if observations != 2 {
					return
				}
				if kind == "database" {
					if _, err := writer.Exec(`UPDATE files SET content='changed' WHERE id='雪'`); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := os.WriteFile(path, []byte("AFTER!"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}})
			defer reader.Close()
			out, err := ReadS3LocalCandidate(context.Background(), reader, root, s3CandidateLimits())
			s3CandidateZero(t, out, err, ErrS3LocalCandidateChanged)
			if observations != 2 {
				t.Fatal("unexpected requery/retry", observations)
			}
			var revision string
			if reader.QueryRow(`SELECT remote_revision FROM sync_state WHERE id=1`).Scan(&revision) != nil || revision != strings.Repeat("a", 64) {
				t.Fatal("common base rebound or reader closed")
			}
		})
	}
}
