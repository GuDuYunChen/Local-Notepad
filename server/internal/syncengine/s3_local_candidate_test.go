package syncengine

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func s3CandidateLimits() S3LocalCandidateLimits {
	return S3LocalCandidateLimits{Database: s3DBLimits(), Attachments: s3AttachmentLimits(), Records: 16, TotalRecordBytes: 32768}
}
func s3CandidateZero(t *testing.T, out S3LocalCandidate, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(out, S3LocalCandidate{}) {
		t.Fatalf("expected zero candidate / %v, got %#v / %v", want, out, err)
	}
	if err != nil && strings.Contains(err.Error(), "PRIVATE_") {
		t.Fatal("private diagnostics escaped")
	}
}

func TestS3LocalCandidateCanonicalUnionAndDetached(t *testing.T) {
	f := s3DBFixtureNew()
	db := s3DBOpen(t, f)
	root := s3AttachmentFixture(t, map[string][]byte{"雪 &.bin": []byte("PRIVATE_BODY"), "zero": {}})
	var order []string
	f.before = func(key string) {
		if key == "schema" {
			order = append(order, "database")
		}
	}
	root.beforeOpen = func(name string, n int) error {
		if name == "." && (n == 1 || n == 5) {
			order = append(order, "attachments")
		}
		if f.rollbacks.Load() != f.begins.Load() {
			t.Fatal("database transaction leaked into file I/O")
		}
		return nil
	}
	out, err := ReadS3LocalCandidate(context.Background(), db, root, s3CandidateLimits())
	if err != nil || !out.ObservedStable || out.CompleteForPreview || len(out.LocalRecords) != 6 || out.AttachmentBytes != 12 {
		t.Fatal("bad candidate", out, err)
	}
	if !reflect.DeepEqual(order, []string{"database", "attachments", "database", "attachments"}) || f.begins.Load() != 2 || f.rollbacks.Load() != 2 || f.commits.Load() != 0 || root.opens != 8 {
		t.Fatal("wrong order, cleanup, or hidden retry", order, root.opens)
	}
	if out.StoredRemoteStoreID != "store" || out.StoredRemoteRevision != strings.Repeat("a", 64) || out.BaseItems["gone"] != strings.Repeat("b", 64) {
		t.Fatal("stored identity or missing-with-base policy rebound")
	}
	want, _, _ := encodeRecord(presentAttachmentRecord(AttachmentPayload{Name: "雪 &.bin", Size: 12, BlobHash: hashBytes([]byte("PRIVATE_BODY"))}))
	if out.LocalRecords[attachmentItemKey("雪 &.bin")] != string(want) || !strings.Contains(out.LocalRecords["雪e\u0301"], "PRIVATE_NOTE") {
		t.Fatal("canonical content missing")
	}
	out.LocalRecords["corrupt"] = "no"
	out.BaseItems["gone"] = "bad"
	root.beforeOpen = nil
	f.before = nil
	again, err := ReadS3LocalCandidate(context.Background(), db, root, s3CandidateLimits())
	if err != nil || len(again.LocalRecords) != 6 || again.BaseItems["gone"] != strings.Repeat("b", 64) {
		t.Fatal("result alias/cache", err)
	}
}

func TestS3LocalCandidateAllLimitsBeforeAnyIO(t *testing.T) {
	mutations := map[string]func(*S3LocalCandidateLimits){
		"count0": func(l *S3LocalCandidateLimits) { l.Records = 0 }, "countMax": func(l *S3LocalCandidateLimits) { l.Records = 257 },
		"total0": func(l *S3LocalCandidateLimits) { l.TotalRecordBytes = 0 }, "totalMax": func(l *S3LocalCandidateLimits) { l.TotalRecordBytes = 2*1024*1024 + 1 },
		"dbCount0": func(l *S3LocalCandidateLimits) { l.Database.Records = 0 }, "dbCountMax": func(l *S3LocalCandidateLimits) { l.Database.Records = 129 },
		"dbBase0": func(l *S3LocalCandidateLimits) { l.Database.BaseItems = 0 }, "dbBaseMax": func(l *S3LocalCandidateLimits) { l.Database.BaseItems = 129 },
		"dbRecord0": func(l *S3LocalCandidateLimits) { l.Database.RecordBytes = 0 }, "dbRecordMax": func(l *S3LocalCandidateLimits) { l.Database.RecordBytes = 256*1024 + 1 },
		"dbTotal0": func(l *S3LocalCandidateLimits) { l.Database.TotalRecordBytes = 0 }, "dbTotalMax": func(l *S3LocalCandidateLimits) { l.Database.TotalRecordBytes = 1024*1024 + 1 },
		"attachmentCount0": func(l *S3LocalCandidateLimits) { l.Attachments.Attachments = 0 }, "attachmentCountMax": func(l *S3LocalCandidateLimits) { l.Attachments.Attachments = 129 },
		"file0": func(l *S3LocalCandidateLimits) { l.Attachments.FileBytes = 0 }, "fileMax": func(l *S3LocalCandidateLimits) { l.Attachments.FileBytes = 32*1024*1024 + 1 },
		"files0": func(l *S3LocalCandidateLimits) { l.Attachments.TotalFileBytes = 0 }, "filesMax": func(l *S3LocalCandidateLimits) { l.Attachments.TotalFileBytes = 64*1024*1024 + 1 },
		"attachmentRecord0": func(l *S3LocalCandidateLimits) { l.Attachments.RecordBytes = 0 }, "attachmentRecordMax": func(l *S3LocalCandidateLimits) { l.Attachments.RecordBytes = 256*1024 + 1 },
		"attachmentTotal0": func(l *S3LocalCandidateLimits) { l.Attachments.TotalRecordBytes = 0 }, "attachmentTotalMax": func(l *S3LocalCandidateLimits) { l.Attachments.TotalRecordBytes = 1024*1024 + 1 },
	}
	for name, change := range mutations {
		t.Run(name, func(t *testing.T) {
			f := s3DBFixtureNew()
			db := s3DBOpen(t, f)
			root := s3AttachmentFixture(t, nil)
			l := s3CandidateLimits()
			change(&l)
			out, err := ReadS3LocalCandidate(context.Background(), db, root, l)
			s3CandidateZero(t, out, err, ErrS3LocalCandidateInput)
			if f.begins.Load() != 0 || root.opens+root.stats != 0 {
				t.Fatal("invalid input performed I/O")
			}
		})
	}
}

func TestS3LocalCandidateNilAndCancelledBeforeIO(t *testing.T) {
	f := s3DBFixtureNew()
	db := s3DBOpen(t, f)
	root := s3AttachmentFixture(t, nil)
	var typedNil *s3AttachmentFixtureRoot
	for _, r := range []S3LocalAttachmentRoot{nil, typedNil} {
		out, err := ReadS3LocalCandidate(context.Background(), db, r, s3CandidateLimits())
		s3CandidateZero(t, out, err, ErrS3LocalCandidateInput)
	}
	out, err := ReadS3LocalCandidate(nil, db, root, s3CandidateLimits())
	s3CandidateZero(t, out, err, ErrS3LocalCandidateInput)
	out, err = ReadS3LocalCandidate(context.Background(), nil, root, s3CandidateLimits())
	s3CandidateZero(t, out, err, ErrS3LocalCandidateInput)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out, err = ReadS3LocalCandidate(ctx, db, root, s3CandidateLimits())
	s3CandidateZero(t, out, err, context.Canceled)
	ctx, cancel = context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancel()
	out, err = ReadS3LocalCandidate(ctx, db, root, s3CandidateLimits())
	s3CandidateZero(t, out, err, context.DeadlineExceeded)
	if f.begins.Load() != 0 || root.opens != 0 {
		t.Fatal("nil or expired input reached I/O")
	}
}

func TestS3LocalCandidateRejectsDatabaseDrift(t *testing.T) {
	for _, field := range []string{"content", "tag", "base", "store", "revision", "membership"} {
		t.Run(field, func(t *testing.T) {
			f := s3DBFixtureNew()
			db := s3DBOpen(t, f)
			root := s3AttachmentFixture(t, nil)
			root.beforeOpen = func(_ string, n int) error {
				if n == 1 {
					switch field {
					case "content":
						f.data["files"][1][2] = "changed"
					case "tag":
						f.data["tags"][0][1] = "changed"
					case "base":
						f.data["base"][0][1] = strings.Repeat("c", 64)
					case "store":
						f.data["state"][0][0] = "other-store"
					case "revision":
						f.data["state"][0][1] = strings.Repeat("d", 64)
					case "membership":
						f.data["base"] = append(f.data["base"], []driver.Value{"gone2", strings.Repeat("e", 64)})
					}
				}
				return nil
			}
			out, err := ReadS3LocalCandidate(context.Background(), db, root, s3CandidateLimits())
			s3CandidateZero(t, out, err, ErrS3LocalCandidateChanged)
			if f.begins.Load() != 2 || f.rollbacks.Load() != 2 || root.opens != 2 {
				t.Fatal("drift retried or continued")
			}
		})
	}
}

func TestS3LocalCandidateRejectsAttachmentDrift(t *testing.T) {
	for _, change := range []string{"same-size-body", "added", "removed"} {
		t.Run(change, func(t *testing.T) {
			f := s3DBFixtureNew()
			db := s3DBOpen(t, f)
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("before")})
			f.before = func(key string) {
				if key == "schema" && f.begins.Load() == 2 {
					var err error
					switch change {
					case "same-size-body":
						err = os.WriteFile(filepath.Join(root.directory, "a"), []byte("AFTER!"), 0600)
					case "added":
						err = os.WriteFile(filepath.Join(root.directory, "b"), []byte("other"), 0600)
					case "removed":
						err = os.Remove(filepath.Join(root.directory, "a"))
					}
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			out, err := ReadS3LocalCandidate(context.Background(), db, root, s3CandidateLimits())
			s3CandidateZero(t, out, err, ErrS3LocalCandidateChanged)
		})
	}
}

func TestS3LocalCandidateCombinedBudgetNotComponentBudget(t *testing.T) {
	for _, kind := range []string{"records", "bytes", "exact"} {
		t.Run(kind, func(t *testing.T) {
			f := s3DBFixtureNew()
			db := s3DBOpen(t, f)
			root := s3AttachmentFixture(t, map[string][]byte{"a": {1}})
			d, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
			if err != nil {
				t.Fatal(err)
			}
			a, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
			if err != nil {
				t.Fatal(err)
			}
			var total int64
			for _, m := range []map[string]string{d.DatabaseRecords, a.AttachmentRecords} {
				for _, raw := range m {
					total += int64(len(raw))
				}
			}
			l := s3CandidateLimits()
			l.Records = 5
			l.TotalRecordBytes = total
			if kind == "records" {
				l.Records = 4
			}
			if kind == "bytes" {
				l.TotalRecordBytes--
			}
			out, err := ReadS3LocalCandidate(context.Background(), db, root, l)
			if kind == "exact" {
				if err != nil || len(out.LocalRecords) != 5 {
					t.Fatal("exact union boundary", err)
				}
			} else {
				s3CandidateZero(t, out, err, ErrS3LocalCandidateLimit)
			}
		})
	}
}

func TestS3LocalCandidateSecondPassFailureAndCancellation(t *testing.T) {
	for _, kind := range []string{"database", "attachments", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			f := s3DBFixtureNew()
			db := s3DBOpen(t, f)
			root := s3AttachmentFixture(t, nil)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			f.before = func(key string) {
				if key == "schema" && f.begins.Load() == 2 {
					if kind == "database" {
						f.failQuery = "files"
					}
					if kind == "cancel" {
						cancel()
					}
				}
			}
			root.beforeOpen = func(_ string, n int) error {
				if kind == "attachments" && n == 3 {
					return errors.New("PRIVATE_FS")
				}
				return nil
			}
			want := ErrS3LocalDatabaseRead
			if kind == "attachments" {
				want = ErrS3LocalAttachmentRead
			}
			if kind == "cancel" {
				want = context.Canceled
			}
			out, err := ReadS3LocalCandidate(ctx, db, root, s3CandidateLimits())
			s3CandidateZero(t, out, err, want)
			if f.begins.Load() > 2 || root.opens > 4 || f.commits.Load() != 0 {
				t.Fatal("hidden retry or commit")
			}
		})
	}
}

func TestS3LocalCandidateEmptyDoesNotAuthorizePreview(t *testing.T) {
	f := s3DBFixtureNew()
	for _, key := range []string{"files", "tags", "links", "base"} {
		f.data[key] = nil
	}
	f.data["state"] = [][]driver.Value{{"", ""}}
	out, err := ReadS3LocalCandidate(context.Background(), s3DBOpen(t, f), s3AttachmentFixture(t, nil), s3CandidateLimits())
	if err != nil || out.LocalRecords == nil || out.BaseItems == nil || len(out.LocalRecords) != 0 || len(out.BaseItems) != 0 || !out.ObservedStable || out.CompleteForPreview || out.StoredRemoteStoreID != "" {
		t.Fatal("empty candidate promoted or rebound", err)
	}
}

// Instrument only the context boundary; the original transaction fixture still
// supplies all rows and enforces read-only options/rollback semantics.
type s3CandidateDeadlineConnector struct {
	f         *s3DBFixture
	deadlines *[]time.Time
}

func (c s3CandidateDeadlineConnector) Driver() driver.Driver { return s3DBDriver{} }
func (c s3CandidateDeadlineConnector) Connect(context.Context) (driver.Conn, error) {
	return &s3CandidateDeadlineConn{s3DBConn: &s3DBConn{f: c.f}, deadlines: c.deadlines}, nil
}

type s3CandidateDeadlineConn struct {
	*s3DBConn
	deadlines *[]time.Time
}

func (c *s3CandidateDeadlineConn) BeginTx(ctx context.Context, o driver.TxOptions) (driver.Tx, error) {
	d, ok := ctx.Deadline()
	if !ok {
		return nil, errors.New("PRIVATE_DEADLINE")
	}
	*c.deadlines = append(*c.deadlines, d)
	return c.s3DBConn.BeginTx(ctx, o)
}
func TestS3LocalCandidateOneSharedDeadline(t *testing.T) {
	for _, earlier := range []bool{false, true} {
		var deadlines []time.Time
		ctx := context.Background()
		cancel := func() {}
		if earlier {
			ctx, cancel = context.WithTimeout(ctx, 2*time.Second)
		}
		db := sql.OpenDB(s3CandidateDeadlineConnector{s3DBFixtureNew(), &deadlines})
		out, err := ReadS3LocalCandidate(ctx, db, s3AttachmentFixture(t, nil), s3CandidateLimits())
		if err != nil || !out.ObservedStable || len(deadlines) != 2 || !deadlines[0].Equal(deadlines[1]) {
			t.Fatal("deadline refreshed", deadlines, err)
		}
		if earlier {
			want, _ := ctx.Deadline()
			if !deadlines[0].Equal(want) {
				t.Fatal("caller deadline changed")
			}
		}
		cancel()
		db.Close()
	}
}
