package syncengine

import (
	"context"
	"testing"
)

// A candidate is private internal data, not a public preview authorization.
// Construct canonical adversarial records without requiring a case-sensitive
// Windows directory. The real filesystem path is exercised in the Linux test.
func s3NameCandidate(t *testing.T, names []string) (S3LocalCandidate, S3LocalCandidateLimits) {
	t.Helper()
	c, limits := s3OverviewCandidate(t)
	for id := range c.LocalRecords {
		if kindForItemKey(id) == "attachment" {
			delete(c.LocalRecords, id)
		}
	}
	c.AttachmentBytes = 0
	for _, name := range names {
		b, _, err := encodeRecord(presentAttachmentRecord(AttachmentPayload{Name: name, Size: 1, BlobHash: hashBytes([]byte("x"))}))
		if err != nil {
			t.Fatal(err)
		}
		c.LocalRecords[attachmentItemKey(name)] = string(b)
		c.AttachmentBytes++
	}
	return c, limits
}

func TestS3LocalOverviewRefusesAttachmentCaseAliases(t *testing.T) {
	pairs := [][2]string{
		{"PRIVATE_report.txt", "PRIVATE_REPORT.txt"},
		{"PRIVATE_雪.png", "PRIVATE_雪.PNG"},
		{"PRIVATE_K.bin", "PRIVATE_K.bin"},
		{"PRIVATE_Σ.bin", "PRIVATE_ς.bin"},
		{"PRIVATE_S.bin", "PRIVATE_ſ.bin"},
	}
	for _, pair := range pairs {
		for _, reverse := range []bool{false, true} {
			names := []string{pair[0], pair[1]}
			if reverse {
				names[0], names[1] = names[1], names[0]
			}
			t.Run(names[0], func(t *testing.T) {
				c, limits := s3NameCandidate(t, names)
				got, err := s3LocalOverview(context.Background(), c, limits)
				s3OverviewZero(t, got, err, ErrS3LocalOverview)
			})
		}
	}
}

func TestS3LocalOverviewRechecksPortableAttachmentNames(t *testing.T) {
	for _, name := range []string{"CON.txt", "PRIVATE_tail.", "PRIVATE_tail ", "PRIVATE_a:b", "PRIVATE_a?b"} {
		t.Run(name, func(t *testing.T) {
			c, limits := s3NameCandidate(t, []string{name})
			got, err := s3LocalOverview(context.Background(), c, limits)
			s3OverviewZero(t, got, err, ErrS3LocalOverview)
		})
	}
}

func TestS3LocalOverviewDistinctAttachmentNamesRemainExact(t *testing.T) {
	// This policy is simple Unicode folding, not normalization, transliteration,
	// an NTFS collation emulator, or a full proof of cross-filesystem portability.
	for _, names := range [][]string{
		{"PRIVATE_one.txt", "PRIVATE_two.TXT"},
		{"PRIVATE_ß.bin", "PRIVATE_ss.bin"},
		{"PRIVATE_é.bin", "PRIVATE_e\u0301.bin"},
		{"PRIVATE_雪.png", "PRIVATE_雨.png"},
	} {
		t.Run(names[0], func(t *testing.T) {
			c, limits := s3NameCandidate(t, names)
			got, err := s3LocalOverview(context.Background(), c, limits)
			if err != nil || got.Kinds[3].Records != 2 || got.AttachmentBytes != 2 || got.CompleteForPreview {
				t.Fatal("distinct names lost or promoted", err)
			}
			for _, name := range names {
				if _, ok := c.LocalRecords[attachmentItemKey(name)]; !ok {
					t.Fatal("input name rewritten")
				}
			}
		})
	}
}

func TestS3LocalAttachmentNameAvailabilityPolicy(t *testing.T) {
	for _, tc := range []struct {
		name string
		seen []string
		want bool
	}{
		{"empty.txt", nil, true},
		{"PRIVATE_same.txt", []string{"PRIVATE_same.txt"}, false},
		{"PRIVATE_same.TXT", []string{"PRIVATE_same.txt"}, false},
		{"PRIVATE_K.bin", []string{"PRIVATE_K.bin"}, false},
		{"PRIVATE_ς.bin", []string{"PRIVATE_Σ.bin"}, false},
		{"CON.txt", nil, false},
		{"PRIVATE_tail.", nil, false},
		{"雪.png", []string{"雨.png"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := s3LocalAttachmentNameAvailable(tc.name, tc.seen); got != tc.want {
				t.Fatal("incorrect conservative name policy")
			}
		})
	}
}
