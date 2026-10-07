package syncengine

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestS3LocalAttachmentsLinuxRefusesLinksAndFIFOReplacement(t *testing.T) {
	for _, kind := range []string{"symlink-entry", "fifo-entry", "swap-symlink", "swap-fifo"} {
		t.Run(kind, func(t *testing.T) {
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("first")})
			other := filepath.Join(t.TempDir(), "private")
			if err := os.WriteFile(other, []byte("PRIVATE_OUTSIDE"), 0600); err != nil {
				t.Fatal(err)
			}
			replace := func() error {
				name := filepath.Join(root.directory, "a")
				if err := os.Remove(name); err != nil {
					return err
				}
				if kind == "fifo-entry" || kind == "swap-fifo" {
					return syscall.Mkfifo(name, 0600)
				}
				return os.Symlink(other, name)
			}
			if kind == "symlink-entry" || kind == "fifo-entry" {
				if err := replace(); err != nil {
					t.Fatal(err)
				}
			} else {
				root.beforeOpen = func(name string, n int) error {
					if name == "a" {
						return replace()
					}
					return nil
				}
			}
			start := time.Now()
			got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
			if err == nil || got.AttachmentRecords != nil || time.Since(start) > time.Second {
				t.Fatal("unsafe object followed, blocked, or accepted", err)
			}
		})
	}
}
