package syncengine

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestS3LocalNamesLinuxRefuseCaseAliasesBeforeBodyReads(t *testing.T) {
	for _, api := range []string{"snapshot", "candidate", "overview"} {
		for _, sameContent := range []bool{false, true} {
			suffix := "different-content"
			second := []byte("PRIVATE_SECOND")
			if sameContent {
				suffix = "same-content"
				second = []byte("PRIVATE_FIRST")
			}
			t.Run(api+"/"+suffix, func(t *testing.T) {
				entries := map[string][]byte{"PRIVATE_report.txt": []byte("PRIVATE_FIRST"), "PRIVATE_REPORT.txt": second}
				root := s3AttachmentFixture(t, entries)
				f := s3DBFixtureNew()
				switch api {
				case "snapshot":
					got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
					s3AttachmentZero(t, got, err, ErrS3LocalAttachmentEntry)
				case "candidate":
					got, err := ReadS3LocalCandidate(context.Background(), s3DBOpen(t, f), root, s3CandidateLimits())
					s3CandidateZero(t, got, err, ErrS3LocalAttachmentEntry)
				case "overview":
					got, err := ReadS3LocalOverview(context.Background(), s3DBOpen(t, f), root, s3CandidateLimits())
					s3OverviewZero(t, got, err, ErrS3LocalOverview)
				}
				if root.opens != 1 || root.stats != 0 {
					t.Fatal("collision should stop after directory listing, before bodies or retries")
				}
				if api != "snapshot" && (f.begins.Load() != 1 || f.rollbacks.Load() != 1 || f.commits.Load() != 0) {
					t.Fatal("candidate continued after refusal or leaked its database transaction")
				}
				for name, want := range entries {
					got, err := os.ReadFile(filepath.Join(root.directory, name))
					if err != nil || string(got) != string(want) {
						t.Fatal("conflicting attachment mutated")
					}
				}
			})
		}
	}
}

func TestS3LocalNamesLinuxRefuseAliasesInFinalListing(t *testing.T) {
	root := s3AttachmentFixture(t, map[string][]byte{"PRIVATE_name.bin": []byte("PRIVATE_ORIGINAL")})
	root.beforeOpen = func(name string, n int) error {
		if name == "." && n == 3 {
			return os.WriteFile(filepath.Join(root.directory, "PRIVATE_NAME.bin"), []byte("PRIVATE_LATE"), 0600)
		}
		return nil
	}
	got, err := ReadS3LocalAttachmentSnapshot(context.Background(), root, s3AttachmentLimits())
	s3AttachmentZero(t, got, err, ErrS3LocalAttachmentEntry)
	if root.opens != 3 {
		t.Fatal("late collision was retried or reopened")
	}
}
