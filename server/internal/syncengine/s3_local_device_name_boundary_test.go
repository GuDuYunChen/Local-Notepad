package syncengine

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// COM/LPT are alternative three-byte prefixes, not two removable prefixes.
// These names use the normal filename namespace, not device paths. Keep the
// Windows-legal fixtures portable so the original Linux/Windows suites run them.
func TestS3LocalDevicePrefixBoundary(t *testing.T) {
	for _, name := range []string{
		"COMLPT1", "COMLPT9.txt", "comlpt1.txt", "CoMlPt2.tar.gz",
		"COMLPT¹.txt", "comlpt².txt", "COMLPT³.txt",
		"LPTCOM1.txt", "COMCOM1.txt", "LPTLPT1.txt", "COMLPT1 .txt",
		"COM10.txt", "LPT10.txt", "COM1-extra.txt", "LPT9-extra.txt",
	} {
		t.Run(name, func(t *testing.T) {
			if !s3LocalAttachmentName(name) || !s3LocalAttachmentNameAvailable(name, nil) {
				t.Fatalf("ordinary filename incorrectly treated as a reserved device: %q", name)
			}
		})
	}
}

func TestS3LocalDeviceFamiliesRemainReserved(t *testing.T) {
	// Exercise every original digit, both prefixes, case-insensitivity and the
	// stem before the first extension. Never create actual device-name files.
	for _, prefix := range []string{"COM", "LPT", "com", "lpt"} {
		for _, digit := range "123456789¹²³" {
			for _, extension := range []string{"", ".txt", ".tar.gz", " .txt"} {
				name := prefix + string(digit) + extension
				if s3LocalAttachmentName(name) || s3LocalAttachmentNameAvailable(name, nil) {
					t.Errorf("reserved device name accepted: %q", name)
				}
			}
		}
	}
}

func TestS3LocalDevicePrefixReadersPreserveNamesAndBodies(t *testing.T) {
	entries := map[string][]byte{
		"COMLPT1.txt": []byte("PRIVATE_ONE"),
		"comlpt9.bin": {0, 1, 2, 255},
		"COMLPT¹.txt": {},
		"LPTCOM1.txt": []byte("PRIVATE_FOUR"),
	}
	var total int64
	canonical := make(map[string]string, len(entries))
	for name, body := range entries {
		raw, _, err := encodeRecord(presentAttachmentRecord(AttachmentPayload{
			Name: name, Size: int64(len(body)), BlobHash: hashBytes(body),
		}))
		if err != nil {
			t.Fatal(err)
		}
		canonical[attachmentItemKey(name)] = string(raw)
		total += int64(len(body))
	}
	for _, api := range []string{"snapshot", "candidate", "overview"} {
		t.Run(api, func(t *testing.T) {
			root := s3AttachmentFixture(t, entries)
			f := s3DBFixtureNew()
			observations := 1
			var records map[string]string
			switch api {
			case "snapshot":
				out, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
				if err != nil || out.CompleteForPreview || out.ContentBytes != total || len(out.AttachmentRecords) != len(entries) {
					t.Fatal("ordinary attachments refused or scope changed", err)
				}
				records = out.AttachmentRecords
			case "candidate":
				observations = 2
				out, err := ReadS3LocalCandidate(context.Background(), s3DBOpen(t, f), root, s3CandidateLimits())
				if err != nil || out.CompleteForPreview || !out.ObservedStable || out.AttachmentBytes != total {
					t.Fatal("ordinary attachments refused or candidate scope changed", err)
				}
				records = out.LocalRecords
			case "overview":
				observations = 2
				out, err := ReadS3LocalOverview(context.Background(), s3DBOpen(t, f), root, s3CandidateLimits())
				if err != nil || out.CompleteForPreview || !out.ObservedStable || !out.ReadOnly || out.AttachmentBytes != total || out.Kinds[3].Records != len(entries) {
					t.Fatal("ordinary attachments refused or overview scope changed", err)
				}
			}
			for id, want := range canonical {
				if records != nil && records[id] != want {
					t.Fatal("source name, size or content hash was changed")
				}
			}
			if root.opens != observations*(len(entries)+2) || root.stats != observations*len(entries)*3 {
				t.Fatal("reader performed extra I/O or retried", root.opens, root.stats)
			}
			if api != "snapshot" && (f.begins.Load() != 2 || f.rollbacks.Load() != 2 || f.commits.Load() != 0) {
				t.Fatal("read-only transaction lifecycle changed")
			}
			for name, want := range entries {
				body, err := os.ReadFile(filepath.Join(root.directory, name))
				if err != nil || !bytes.Equal(body, want) {
					t.Fatal("source attachment modified", err)
				}
			}
			// The shared fixture also checks that every owned handle was closed.
		})
	}
}

func TestS3LocalDevicePrefixOverviewBoundary(t *testing.T) {
	for _, names := range [][]string{
		{"COMLPT1.txt", "LPTCOM1.txt"},
		{"COMLPT¹.txt", "COMLPT².txt"},
	} {
		t.Run(strings.Join(names, "+"), func(t *testing.T) {
			c, limits := s3NameCandidate(t, names)
			out, err := s3LocalOverview(context.Background(), c, limits)
			if err != nil || out.CompleteForPreview || !out.ReadOnly || out.Kinds[3].Records != len(names) || out.AttachmentBytes != int64(len(names)) {
				t.Fatal("ordinary names refused by the internal projector", err)
			}
		})
	}
	for _, names := range [][]string{
		{"COMLPT1.txt", "comlpt1.TXT"}, // Still refuse Unicode case-fold aliases.
		{"COMLPT1.txt", "COM1.txt"},    // Still refuse a real device name.
		{"COMLPT1.txt", "LPT¹.bin"},
	} {
		t.Run(strings.Join(names, "+"), func(t *testing.T) {
			c, limits := s3NameCandidate(t, names)
			out, err := s3LocalOverview(context.Background(), c, limits)
			s3OverviewZero(t, out, err, ErrS3LocalOverview)
		})
	}
}
