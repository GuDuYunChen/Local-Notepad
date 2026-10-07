//go:build go1.24

package syncengine

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// This test is executed on the project's pinned Go1.24.11 Linux AND Windows CI.
// It is not part of local Go1.23 model runs. It supplies the real confinement
// capability, with neither path concatenation nor a mock filesystem adapter.
func TestS3LocalAttachmentsActualRoot(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{"雪 &.bin": "actual bytes", "zero.bin": ""} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	if err != nil || len(got.AttachmentRecords) != 2 || got.CompleteForPreview || got.ContentBytes != 12 {
		t.Fatal("actual root contract", err)
	}
	if _, err = root.Lstat("雪 &.bin"); err != nil {
		t.Fatal("borrowed root closed")
	}
	if err := os.Mkdir(filepath.Join(dir, "unexpected-directory"), 0700); err != nil {
		t.Fatal(err)
	}
	got, err = ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentEntry)
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	got, err = ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentRead)
}
