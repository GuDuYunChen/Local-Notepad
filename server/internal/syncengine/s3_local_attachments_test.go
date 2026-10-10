package syncengine

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// A trusted fixture root over an OWNED temporary directory. It is deliberately
// NOT a production confinement implementation. Go1.24 integration tests below
// separately supply the real os.Root used by the intended production caller.
type s3AttachmentFixtureRoot struct {
	directory  string
	opens      int
	stats      int
	handles    []*os.File
	beforeOpen func(string, int) error
	beforeStat func(string, int) error
}

func (r *s3AttachmentFixtureRoot) OpenFile(name string, flags int, mode os.FileMode) (*os.File, error) {
	r.opens++
	if flags != os.O_RDONLY|s3AttachmentOpenFlags || mode != 0 {
		return nil, errors.New("PRIVATE_INVALID_WRITE_FLAGS")
	}
	if r.beforeOpen != nil {
		if err := r.beforeOpen(name, r.opens); err != nil {
			return nil, err
		}
	}
	f, err := os.OpenFile(filepath.Join(r.directory, name), flags, mode)
	if f != nil {
		r.handles = append(r.handles, f)
	}
	return f, err
}
func (r *s3AttachmentFixtureRoot) Lstat(name string) (os.FileInfo, error) {
	r.stats++
	if r.beforeStat != nil {
		if err := r.beforeStat(name, r.stats); err != nil {
			return nil, err
		}
	}
	return os.Lstat(filepath.Join(r.directory, name))
}
func s3AttachmentLimits() S3LocalAttachmentLimits {
	return S3LocalAttachmentLimits{8, 4096, 8192, 4096, 8192}
}
func s3AttachmentFixture(t *testing.T, entries map[string][]byte) *s3AttachmentFixtureRoot {
	t.Helper()
	r := &s3AttachmentFixtureRoot{directory: t.TempDir()}
	for name, b := range entries {
		if err := os.WriteFile(filepath.Join(r.directory, name), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, f := range r.handles {
			if _, err := f.Stat(); err == nil {
				t.Error("owned handle leaked")
				_ = f.Close()
			}
		}
	})
	return r
}
func s3AttachmentZero(t *testing.T, value S3LocalAttachmentSnapshot, err, expected error) {
	t.Helper()
	if !errors.Is(err, expected) || !reflect.DeepEqual(value, S3LocalAttachmentSnapshot{}) {
		t.Fatalf("expected zero snapshot and %v; got %#v / %v", expected, value, err)
	}
	if err != nil && strings.Contains(err.Error(), "PRIVATE_") {
		t.Fatal("private error escaped")
	}
}

func TestS3LocalAttachmentsCanonicalAndDetached(t *testing.T) {
	entries := map[string][]byte{"雪 &.bin": {0, 1, 2, 255}, "empty.bin": {}, "note.txt": []byte("PRIVATE_CONTENT")}
	root := s3AttachmentFixture(t, entries)
	got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	if err != nil || got.CompleteForPreview || len(got.AttachmentRecords) != 3 {
		t.Fatal("scope or read failed", err)
	}
	var total int64
	for name, b := range entries {
		want, _, err := encodeRecord(presentAttachmentRecord(AttachmentPayload{Name: name, Size: int64(len(b)), BlobHash: hashBytes(b)}))
		if err != nil || got.AttachmentRecords[attachmentItemKey(name)] != string(want) {
			t.Fatal("canonical record changed")
		}
		content, err := os.ReadFile(filepath.Join(root.directory, name))
		if err != nil || !bytes.Equal(content, b) {
			t.Fatal("file modified")
		}
		total += int64(len(b))
	}
	if got.ContentBytes != total || strings.Contains(strings.Join(mapValues(got.AttachmentRecords), ""), "PRIVATE_CONTENT") {
		t.Fatal("incorrect charge or content exposed")
	}
	got.AttachmentRecords["injected"] = "bad"
	again, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	if err != nil || len(again.AttachmentRecords) != 3 {
		t.Fatal("returned map reused")
	}
	if root.opens != 10 {
		t.Fatal("unexpected retry or hidden I/O", root.opens)
	}
}
func mapValues(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func TestS3LocalAttachmentsEmptyIsOnlyDirectoryEvidence(t *testing.T) {
	root := s3AttachmentFixture(t, nil)
	got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	if err != nil || got.AttachmentRecords == nil || len(got.AttachmentRecords) != 0 || got.CompleteForPreview || got.ContentBytes != 0 {
		t.Fatal("empty scope conflated", err)
	}
	if root.opens != 2 || root.stats != 0 {
		t.Fatal("implicit probe")
	}
}

func TestS3LocalAttachmentsInputBudgetBeforeIO(t *testing.T) {
	for _, change := range []func(*S3LocalAttachmentLimits){
		func(l *S3LocalAttachmentLimits) { l.Attachments = 0 }, func(l *S3LocalAttachmentLimits) { l.Attachments = 129 },
		func(l *S3LocalAttachmentLimits) { l.FileBytes = 0 }, func(l *S3LocalAttachmentLimits) { l.FileBytes = 32*1024*1024 + 1 },
		func(l *S3LocalAttachmentLimits) { l.TotalFileBytes = 0 }, func(l *S3LocalAttachmentLimits) { l.TotalFileBytes = 64*1024*1024 + 1 },
		func(l *S3LocalAttachmentLimits) { l.RecordBytes = 0 }, func(l *S3LocalAttachmentLimits) { l.RecordBytes = 256*1024 + 1 },
		func(l *S3LocalAttachmentLimits) { l.TotalRecordBytes = 0 }, func(l *S3LocalAttachmentLimits) { l.TotalRecordBytes = 1024*1024 + 1 },
	} {
		root := s3AttachmentFixture(t, nil)
		l := s3AttachmentLimits()
		change(&l)
		got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, l)
		s3AttachmentZero(t, got, err, ErrS3LocalAttachmentInput)
		if root.opens+root.stats != 0 {
			t.Fatal("invalid budget reached directory")
		}
	}
	var typedNil *s3AttachmentFixtureRoot
	for _, root := range []S3LocalAttachmentRoot{nil, typedNil} {
		got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
		s3AttachmentZero(t, got, err, ErrS3LocalAttachmentInput)
	}
	root := s3AttachmentFixture(t, nil)
	got, err := ReadS3LocalAttachmentSnapshot(nil, root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentInput)
	if root.opens+root.stats != 0 {
		t.Fatal("nil context reached directory")
	}
}

func TestS3LocalAttachmentsPortableNames(t *testing.T) {
	for _, name := range []string{"", ".", "..", "../x", "a/b", `a\b`, "C:x", "x:y", "A?", "*", "<x>", `a"b`, "a|b", "x.", "x ", "\x00", "\n", "x\x7f", "\xff", "CON", "con.txt", "CON .txt", "PRN", "AUX.bin", "NUL", "CONIN$", "CONOUT$", "COM1", "lpt9.a", "COM¹", "LPT²", strings.Repeat("x", 600)} {
		if s3LocalAttachmentName(name) {
			t.Errorf("unsafe name accepted: %q", name)
		}
	}
	for _, name := range []string{"a", "空 文件.bin", "literal%2f.txt", "my..file", "COM10.txt", "name&x.bin", "é.txt"} {
		if !s3LocalAttachmentName(name) {
			t.Errorf("safe exact name changed %q", name)
		}
	}
}

func TestS3LocalAttachmentsLimitsDoNotTruncate(t *testing.T) {
	for _, kind := range []string{"count", "file", "total", "record", "total-record"} {
		t.Run(kind, func(t *testing.T) {
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("123"), "b": []byte("456")})
			l := s3AttachmentLimits()
			switch kind {
			case "count":
				l.Attachments = 1
			case "file":
				l.FileBytes = 2
			case "total":
				l.TotalFileBytes = 5
			case "record":
				l.RecordBytes = 2
			case "total-record":
				l.TotalRecordBytes = 2
			}
			got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, l)
			s3AttachmentZero(t, got, err, ErrS3LocalAttachmentLimit)
			if kind == "count" && root.stats != 0 {
				t.Fatal("overfull directory read bodies")
			}
			if kind == "file" && root.opens != 1 {
				t.Fatal("oversize file opened")
			}
		})
	}
}

func TestS3LocalAttachmentsDirectoryAndEntryRefusals(t *testing.T) {
	root := s3AttachmentFixture(t, nil)
	if err := os.Mkdir(filepath.Join(root.directory, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentEntry)
	if root.stats != 0 {
		t.Fatal("recursive traversal")
	}
	missing := &s3AttachmentFixtureRoot{directory: filepath.Join(t.TempDir(), "missing")}
	got, err = ReadS3LocalAttachmentSnapshot(context.Background(), missing, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentRead)
	if _, err = os.Stat(missing.directory); !os.IsNotExist(err) {
		t.Fatal("created missing directory")
	}
	file := s3AttachmentFixture(t, map[string][]byte{"a": {1}})
	file.directory = filepath.Join(file.directory, "a")
	got, err = ReadS3LocalAttachmentSnapshot(context.Background(), file, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentEntry)
}

func TestS3LocalAttachmentsFixedIOErrorsAndWholeResultDiscard(t *testing.T) {
	for _, where := range []string{"directory", "body", "second-list", "first-stat", "after-read", "final-stat", "close"} {
		t.Run(where, func(t *testing.T) {
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("PRIVATE_BODY")})
			root.beforeOpen = func(name string, n int) error {
				if (where == "directory" && n == 1) || (where == "body" && name == "a") || (where == "second-list" && n == 3) {
					return errors.New("PRIVATE_DRIVER_DETAIL")
				}
				return nil
			}
			root.beforeStat = func(name string, n int) error {
				if (where == "first-stat" && n == 1) || (where == "after-read" && n == 2) || (where == "final-stat" && n == 3) {
					return errors.New("PRIVATE_PATH")
				}
				if where == "close" && n == 2 {
					if err := root.handles[1].Close(); err != nil {
						t.Fatal(err)
					}
				}
				return nil
			}
			got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
			s3AttachmentZero(t, got, err, ErrS3LocalAttachmentRead)
		})
	}
}

func TestS3LocalAttachmentsChangedObjectsAndInventory(t *testing.T) {
	for _, where := range []string{"before-open", "after-read", "final-stat", "new-entry"} {
		t.Run(where, func(t *testing.T) {
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("first")})
			mutate := func() {
				if err := os.WriteFile(filepath.Join(root.directory, "a"), []byte("different length"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			root.beforeOpen = func(name string, n int) error {
				if where == "before-open" && name == "a" {
					mutate()
				}
				if where == "new-entry" && n == 3 {
					return os.WriteFile(filepath.Join(root.directory, "new"), []byte("z"), 0600)
				}
				return nil
			}
			root.beforeStat = func(name string, n int) error {
				if (where == "after-read" && n == 2) || (where == "final-stat" && n == 3) {
					mutate()
				}
				return nil
			}
			got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
			s3AttachmentZero(t, got, err, ErrS3LocalAttachmentChanged)
		})
	}
}

func TestS3LocalAttachmentsCancellationDoesNotReturnPartial(t *testing.T) {
	for _, when := range []string{"before", "open", "after-read", "final"} {
		t.Run(when, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("first")})
			if when == "before" {
				cancel()
			}
			root.beforeOpen = func(name string, n int) error {
				if when == "open" && name == "a" {
					cancel()
				}
				return nil
			}
			root.beforeStat = func(name string, n int) error {
				if (when == "after-read" && n == 2) || (when == "final" && n == 3) {
					cancel()
				}
				return nil
			}
			got, err := ReadS3LocalAttachmentSnapshot(ctx, root, s3AttachmentLimits())
			s3AttachmentZero(t, got, err, context.Canceled)
			if when == "before" && root.opens != 0 {
				t.Fatal("cancelled read reached directory")
			}
		})
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancel()
	root := s3AttachmentFixture(t, nil)
	got, err := ReadS3LocalAttachmentSnapshot(ctx, root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, context.DeadlineExceeded)
}

type s3CountReader struct{ calls int }

func (r *s3CountReader) Read([]byte) (int, error) { r.calls++; return 0, io.EOF }
func TestS3LocalAttachmentsCancelledStreamDoesNotRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source := &s3CountReader{}
	n, err := (s3AttachmentReader{ctx, source}).Read(make([]byte, 1))
	if n != 0 || !errors.Is(err, context.Canceled) || source.calls != 0 {
		t.Fatal("cancelled stream consumed bytes")
	}
}
