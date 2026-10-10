package syncengine

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func s3OverviewCandidate(t *testing.T) (S3LocalCandidate, S3LocalCandidateLimits) {
	t.Helper()
	l := s3CandidateLimits()
	c, err := ReadS3LocalCandidate(context.Background(), s3DBOpen(t, s3DBFixtureNew()),
		s3AttachmentFixture(t, map[string][]byte{"PRIVATE_NAME.bin": []byte("PRIVATE_BODY"), "empty.bin": {}}), l)
	if err != nil {
		t.Fatal(err)
	}
	return c, l
}
func s3OverviewZero(t *testing.T, out S3LocalOverview, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || out != (S3LocalOverview{}) {
		t.Fatalf("not a zero refused overview: %#v / %v", out, err)
	}
}
func TestS3LocalOverviewActualReaderCountsAndPrivacy(t *testing.T) {
	f := s3DBFixtureNew()
	root := s3AttachmentFixture(t, map[string][]byte{"PRIVATE_NAME.bin": []byte("PRIVATE_BODY"), "empty.bin": {}})
	got, err := ReadS3LocalOverview(context.Background(), s3DBOpen(t, f), root, s3CandidateLimits())
	if err != nil || got.Format != S3LocalOverviewFormat || got.Version != 1 || !got.ReadOnly || !got.ObservedStable || got.CompleteForPreview || got.Records != 6 || got.BaseItems != 1 || got.AttachmentBytes != 12 {
		t.Fatal("incorrect local scope or counters", got, err)
	}
	wantKinds := []string{"file", "tag", "file-tag", "attachment"}
	wantCounts := []int{2, 1, 1, 2}
	var sum int64
	for i, row := range got.Kinds {
		if row.Kind != wantKinds[i] || row.Records != wantCounts[i] || row.RecordBytes <= 0 {
			t.Fatal("incorrect row", row)
		}
		sum += row.RecordBytes
	}
	if sum != got.RecordBytes || f.begins.Load() != 2 || f.rollbacks.Load() != 2 || f.commits.Load() != 0 || root.opens != 8 {
		t.Fatal("totals, cleanup or hidden retry", sum, got.RecordBytes)
	}
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil || len(fields) != 10 {
		t.Fatal("unexpected public fields", string(b))
	}
	for _, key := range []string{"format", "version", "read_only", "observed_stable", "complete_for_preview", "records", "record_bytes", "attachment_bytes", "base_items", "kinds"} {
		if _, ok := fields[key]; !ok {
			t.Fatal("missing exact summary field", key)
		}
	}
	for _, text := range []string{string(b), fmt.Sprintf("%v|%+v|%#v", got, got, got)} {
		for _, secret := range []string{"PRIVATE_", "雪e", "store", strings.Repeat("a", 64), strings.Repeat("b", 64), "empty.bin", "gone", "雪<&>正文"} {
			if strings.Contains(text, secret) {
				t.Fatal("private source escaped", secret)
			}
		}
	}
	// Value-only arrays cannot retain or share the original candidate's maps.
	copy := got
	copy.Kinds[0].Records = 900
	if got.Kinds[0].Records != 2 {
		t.Fatal("shared mutable output")
	}
}

func TestS3LocalOverviewCanonicalByteAccounting(t *testing.T) {
	c, l := s3OverviewCandidate(t)
	got, err := s3LocalOverview(context.Background(), c, l)
	if err != nil {
		t.Fatal(err)
	}
	var sum int64
	for _, raw := range c.LocalRecords {
		sum += int64(len([]byte(raw)))
	}
	if got.RecordBytes != sum || got.Records != len(c.LocalRecords) {
		t.Fatal("canonical UTF8 budget not counted exactly")
	}
	before := got
	c.LocalRecords["corrupt"] = "PRIVATE_LATE"
	c.BaseItems["corrupt"] = "PRIVATE_LATE"
	if got != before {
		t.Fatal("summary retained inputs")
	}
}

func TestS3LocalOverviewEmptyRemainsIncomplete(t *testing.T) {
	f := s3DBFixtureNew()
	for _, key := range []string{"files", "tags", "links", "base"} {
		f.data[key] = nil
	}
	f.data["state"] = [][]driver.Value{{"", ""}}
	got, err := ReadS3LocalOverview(context.Background(), s3DBOpen(t, f), s3AttachmentFixture(t, nil), s3CandidateLimits())
	if err != nil || !got.ObservedStable || got.CompleteForPreview || got.Records != 0 || got.RecordBytes != 0 || got.BaseItems != 0 || got.AttachmentBytes != 0 {
		t.Fatal("empty promoted to preview authorization", err)
	}
	for _, row := range got.Kinds {
		if row.Kind == "" || row.Records != 0 || row.RecordBytes != 0 {
			t.Fatal("empty lost complete four-kind schema")
		}
	}
}

func TestS3LocalOverviewRefusesBrokenInternalInvariants(t *testing.T) {
	mutations := map[string]func(*S3LocalCandidate){
		"not-stable":        func(c *S3LocalCandidate) { c.ObservedStable = false },
		"promoted":          func(c *S3LocalCandidate) { c.CompleteForPreview = true },
		"nil-local":         func(c *S3LocalCandidate) { c.LocalRecords = nil },
		"nil-base":          func(c *S3LocalCandidate) { c.BaseItems = nil },
		"negative-bytes":    func(c *S3LocalCandidate) { c.AttachmentBytes = -1 },
		"incorrect-bytes":   func(c *S3LocalCandidate) { c.AttachmentBytes++ },
		"base-private-hash": func(c *S3LocalCandidate) { c.BaseItems["gone"] = "PRIVATE_BAD" },
		"base-private-id":   func(c *S3LocalCandidate) { c.BaseItems["\x00PRIVATE"] = strings.Repeat("a", 64) },
		"bad-store":         func(c *S3LocalCandidate) { c.StoredRemoteStoreID = "\x00PRIVATE" },
		"bad-revision":      func(c *S3LocalCandidate) { c.StoredRemoteRevision = "PRIVATE_BAD" },
		"orphan-revision":   func(c *S3LocalCandidate) { c.StoredRemoteStoreID = "" },
		"orphan-base":       func(c *S3LocalCandidate) { c.StoredRemoteRevision = "" },
		"unknown-record":    func(c *S3LocalCandidate) { c.LocalRecords["wrong"] = "{}" },
		"invalid-id":        func(c *S3LocalCandidate) { c.LocalRecords["\x00PRIVATE"] = "{}" },
		"renamed-id": func(c *S3LocalCandidate) {
			c.LocalRecords["wrong"] = c.LocalRecords["root"]
			delete(c.LocalRecords, "root")
		},
		"missing-parent": func(c *S3LocalCandidate) { delete(c.LocalRecords, "root") },
		"missing-tag":    func(c *S3LocalCandidate) { delete(c.LocalRecords, tagItemKey("t")) },
		"noncanonical":   func(c *S3LocalCandidate) { c.LocalRecords["root"] += "\n" },
		"duplicate-json": func(c *S3LocalCandidate) {
			c.LocalRecords["root"] = strings.Replace(c.LocalRecords["root"], `"version":1`, `"version":1,"version":1`, 1)
		},
		"private-json": func(c *S3LocalCandidate) {
			c.LocalRecords["root"] = strings.Replace(c.LocalRecords["root"], `"version":1`, `"private":"PRIVATE_X","version":1`, 1)
		},
		"purged-local": func(c *S3LocalCandidate) {
			b, _, _ := encodeRecord(Record{Format: RecordFormat, Version: 1, Kind: "file", ID: "root", State: "purged"})
			c.LocalRecords["root"] = string(b)
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			c, l := s3OverviewCandidate(t)
			mutate(&c)
			got, err := s3LocalOverview(context.Background(), c, l)
			s3OverviewZero(t, got, err, ErrS3LocalOverview)
		})
	}
}

func TestS3LocalOverviewRechecksEveryBudget(t *testing.T) {
	mutations := map[string]func(*S3LocalCandidateLimits){
		"invalid":                  func(l *S3LocalCandidateLimits) { l.Records = 0 },
		"union-count":              func(l *S3LocalCandidateLimits) { l.Records = 5 },
		"union-bytes":              func(l *S3LocalCandidateLimits) { l.TotalRecordBytes = 1 },
		"base-count":               func(l *S3LocalCandidateLimits) { l.Database.BaseItems = 1 },
		"db-count":                 func(l *S3LocalCandidateLimits) { l.Database.Records = 3 },
		"db-record":                func(l *S3LocalCandidateLimits) { l.Database.RecordBytes = 1 },
		"db-total":                 func(l *S3LocalCandidateLimits) { l.Database.TotalRecordBytes = 1 },
		"attachment-count":         func(l *S3LocalCandidateLimits) { l.Attachments.Attachments = 1 },
		"attachment-record":        func(l *S3LocalCandidateLimits) { l.Attachments.RecordBytes = 1 },
		"attachment-total-records": func(l *S3LocalCandidateLimits) { l.Attachments.TotalRecordBytes = 1 },
		"file-bytes":               func(l *S3LocalCandidateLimits) { l.Attachments.FileBytes = 11 },
		"all-file-bytes":           func(l *S3LocalCandidateLimits) { l.Attachments.TotalFileBytes = 11 },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			c, l := s3OverviewCandidate(t)
			if name == "base-count" {
				c.BaseItems["other"] = strings.Repeat("a", 64)
			}
			mutate(&l)
			got, err := s3LocalOverview(context.Background(), c, l)
			s3OverviewZero(t, got, err, ErrS3LocalOverview)
		})
	}
}

func TestS3LocalOverviewInputAndCancellationBeforeIO(t *testing.T) {
	f := s3DBFixtureNew()
	db := s3DBOpen(t, f)
	root := s3AttachmentFixture(t, nil)
	got, err := ReadS3LocalOverview(nil, db, root, s3CandidateLimits())
	s3OverviewZero(t, got, err, ErrS3LocalOverview)
	l := s3CandidateLimits()
	l.Attachments.FileBytes = 0
	got, err = ReadS3LocalOverview(context.Background(), db, root, l)
	s3OverviewZero(t, got, err, ErrS3LocalOverview)
	for _, expired := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		want := context.Canceled
		if expired {
			cancel()
			ctx, cancel = context.WithDeadline(context.Background(), time.Unix(0, 0))
			want = context.DeadlineExceeded
		}
		cancel()
		got, err = ReadS3LocalOverview(ctx, db, root, s3CandidateLimits())
		s3OverviewZero(t, got, err, want)
	}
	if f.begins.Load() != 0 || root.opens != 0 {
		t.Fatal("invalid inputs triggered I/O")
	}
	got, err = s3LocalOverview(nil, S3LocalCandidate{}, s3CandidateLimits())
	s3OverviewZero(t, got, err, ErrS3LocalOverview)
}

func TestS3LocalOverviewObservedDriftReturnsNoCounts(t *testing.T) {
	for _, mode := range []string{"database", "attachments", "private-error", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			f := s3DBFixtureNew()
			root := s3AttachmentFixture(t, map[string][]byte{"a": []byte("before")})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			root.beforeOpen = func(_ string, n int) error {
				if n == 1 {
					switch mode {
					case "database":
						f.data["files"][1][2] = "changed"
					case "private-error":
						return errors.New("PRIVATE_DRIVER_DETAILS")
					case "cancel":
						cancel()
					}
				}
				return nil
			}
			f.before = func(key string) {
				if key == "schema" && f.begins.Load() == 2 && mode == "attachments" {
					if err := os.WriteFile(filepath.Join(root.directory, "a"), []byte("AFTER!"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			got, err := ReadS3LocalOverview(ctx, s3DBOpen(t, f), root, s3CandidateLimits())
			want := ErrS3LocalOverview
			if mode == "cancel" {
				want = context.Canceled
			}
			s3OverviewZero(t, got, err, want)
		})
	}
}

func TestS3LocalOverviewNoDirectionalOrAuthorizationFields(t *testing.T) {
	typ := reflect.TypeOf(S3LocalOverview{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if f.Type.Kind() == reflect.Map || f.Type.Kind() == reflect.Slice || f.Type.Kind() == reflect.Pointer || f.Type.Kind() == reflect.Interface {
			t.Fatal("private reference-bearing overview", f.Name)
		}
		for _, banned := range []string{"Upload", "Download", "Purge", "Store", "Revision", "Pin", "Hash", "Title", "Content", "Path", "Secret"} {
			if strings.Contains(f.Name, banned) {
				t.Fatal("unexpected directional or private field", f.Name)
			}
		}
	}
}
