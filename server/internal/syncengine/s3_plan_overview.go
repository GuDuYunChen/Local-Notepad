package syncengine

import (
	"context"
	"errors"
	"time"

	"notepad-server/internal/syncs3"
)

const S3PlanOverviewFormat = "local-notepad-s3-plan-overview"

var (
	ErrS3PlanOverviewRead = errors.New("S3 只读预览未完成，未接受统计结果")
	ErrS3PlanOverview     = errors.New("S3 只读预览统计不符合约定，未接受结果")
)

// Candidate counts describe comparisons, not completed transfers or permission
// to apply them. Counts themselves disclose coarse activity and are not public
// telemetry. No store/item identity, revision, hash, title, content or credential
// is retained in this representation.
type S3PlanOverviewCounts struct {
	Total              int `json:"total"`
	UploadCandidates   int `json:"upload_candidates"`
	DownloadCandidates int `json:"download_candidates"`
	Conflicts          int `json:"conflicts"`
	Noops              int `json:"noops"`
}

type S3PlanKindOverview struct {
	Kind   string               `json:"kind"`
	Counts S3PlanOverviewCounts `json:"counts"`
}

type S3PlanOverview struct {
	Format   string               `json:"format"`
	Version  int                  `json:"version"`
	ReadOnly bool                 `json:"read_only"`
	Counts   S3PlanOverviewCounts `json:"counts"`
	// Fixed order and cardinality, even for a verified empty comparison.
	Kinds [4]S3PlanKindOverview `json:"kinds"`
}

// ReadS3PlanOverview performs exactly the original pinned comparison and then
// projects it to identity-free counts. It does not accept a caller-supplied Plan
// as evidence, use a cache, or fetch anything beyond ReadS3Plan. Input basis and
// pin still need the trusted, complete provenance required by ReadS3Plan.
//
// Success says neither "synchronized" nor "safe to apply". It does not verify
// local content, attachment blobs, freshness, credentials or write/List rights.
// No HTTP/IPC route, provider, database/file/state writes or automatic work is
// registered. A future caller must bind results to its own input generation;
// intentionally absent identities cannot be used as a result association key.
//
// Reading AND projection share one 15s/caller-earlier deadline. Every error
// returns the zero overview; cancellations retain their standard sentinel, all
// other underlying errors become a fixed refusal, not private diagnostic text.
func ReadS3PlanOverview(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, basis S3PlanLocalBasis, limits S3PlanReadLimits) (S3PlanOverview, error) {
	if ctx == nil {
		return S3PlanOverview{}, ErrS3PlanOverviewRead
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	plan, err := ReadS3Plan(call, client, ref, basis, limits)
	if err != nil {
		return S3PlanOverview{}, s3OverviewReadError(err)
	}
	return s3PlanOverview(call, plan)
}

func s3OverviewReadError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrS3PlanOverviewRead
}

func (c *S3PlanOverviewCounts) add(action string) {
	c.Total++
	switch action {
	case "upload":
		c.UploadCandidates++
	case "download":
		c.DownloadCandidates++
	case "conflict":
		c.Conflicts++
	case "noop":
		c.Noops++
	}
}

// Check the complete internal result before accepting derived statistics. A
// future accidental classifier/counter change must not silently hide conflicts.
// This unexported projector is pure, bounded and never consults remote state.
func s3PlanOverview(ctx context.Context, plan Plan) (S3PlanOverview, error) {
	if ctx == nil {
		return S3PlanOverview{}, ErrS3PlanOverview
	}
	if err := ctx.Err(); err != nil {
		return S3PlanOverview{}, s3OverviewReadError(err)
	}
	if !s3ManifestID(plan.StoreID) || plan.Generation < 1 || !objectHashPattern.MatchString(plan.Revision) ||
		plan.NeedsInit || plan.Items == nil || len(plan.Items) > MaxS3PlanItems {
		return S3PlanOverview{}, ErrS3PlanOverview
	}
	out := S3PlanOverview{Format: S3PlanOverviewFormat, Version: 1, ReadOnly: true,
		Kinds: [4]S3PlanKindOverview{{Kind: "file"}, {Kind: "tag"}, {Kind: "file-tag"}, {Kind: "attachment"}}}
	for index, item := range plan.Items {
		if err := ctx.Err(); err != nil {
			return S3PlanOverview{}, s3OverviewReadError(err)
		}
		kind := kindForItemKey(item.ID)
		if !s3ManifestID(item.ID) || !s3RecordKey(kind, item.ID) || (index > 0 && plan.Items[index-1].ID >= item.ID) {
			return S3PlanOverview{}, ErrS3PlanOverview
		}
		for _, hash := range []string{item.BaseHash, item.LocalHash, item.RemoteHash} {
			if hash != "" && !objectHashPattern.MatchString(hash) {
				return S3PlanOverview{}, ErrS3PlanOverview
			}
		}
		if item.LocalHash == "" && item.RemoteHash == "" {
			return S3PlanOverview{}, ErrS3PlanOverview
		}
		expected := classifyItem(item.ID, item.BaseHash, item.LocalHash, item.RemoteHash, item.LocalHash != "")
		if item.Action != expected {
			return S3PlanOverview{}, ErrS3PlanOverview
		}
		row := -1
		for i := range out.Kinds {
			if out.Kinds[i].Kind == kind {
				row = i
				break
			}
		}
		if row < 0 {
			return S3PlanOverview{}, ErrS3PlanOverview
		}
		out.Counts.add(item.Action)
		out.Kinds[row].Counts.add(item.Action)
	}
	if plan.Uploads != out.Counts.UploadCandidates || plan.Downloads != out.Counts.DownloadCandidates ||
		plan.Conflicts != out.Counts.Conflicts || plan.Noops != out.Counts.Noops {
		return S3PlanOverview{}, ErrS3PlanOverview
	}
	if err := ctx.Err(); err != nil {
		return S3PlanOverview{}, s3OverviewReadError(err)
	}
	return out, nil
}
