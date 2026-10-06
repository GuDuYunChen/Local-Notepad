package syncengine

import (
	"context"
	"errors"
	"sort"
	"time"

	"notepad-server/internal/syncs3"
)

var (
	ErrS3PlanRecordBasis = errors.New("S3 预览的完整本地记录依据无效，未执行远端读取")
	ErrS3PlanRecordLimit = errors.New("S3 预览本地记录超过显式预算，未执行远端读取")
)

// S3PlanRecordBasis is a COMPLETE caller-supplied local record snapshot and
// common-base hashes for StoreID. Records are the existing Record JSON, keyed
// by exact ItemID, not hashes supplied in place of content. Maps must be non-nil;
// an explicitly empty local map retains the existing missing-with-base policy.
// Completeness/provenance cannot be established from the values themselves.
// This function does not scan a database or grant authority to apply changes.
//
// JSON strings are immutable; map entries are copied before parsing/network I/O.
// The caller must not concurrently mutate either map while it is being copied.
// Inputs contain private content and must not be logged as a safe summary.
type S3PlanRecordBasis struct {
	StoreID      string
	LocalRecords map[string]string
	BaseItems    map[string]string
}

// Every limit is explicit. LocalRecordBytes is 1..32MiB, TotalLocalRecordBytes
// 1..64MiB, MaxLocalRecords 1..1024. Each record is charged the LARGER of its raw
// JSON and canonical existing-engine encoding, not merely its content length.
// Plan retains the independent remote-record and union bounds. These are input
// budgets, not total process-memory guarantees; attachment bytes are not read.
type S3PlanRecordLimits struct {
	LocalRecordBytes      int64
	TotalLocalRecordBytes int64
	MaxLocalRecords       int
	Plan                  S3PlanReadLimits
}

// ReadS3PlanOverviewFromRecords validates the full local record set and derives
// canonical hashes with the existing encodeRecord, BEFORE any remote request.
// Formatting/field order of JSON must not manufacture a content conflict. Record
// identities, every payload, Unicode and duplicate fields use decodeS3Record;
// folder/tag/link relationships reuse the original structure validator without
// a remote fallback. All local failures return fixed errors and zero overview.
//
// It then calls ReadS3PlanOverview exactly once with detached hash maps. Local
// validation, remote reading and counting share 15s or the earlier caller limit.
// Existing classifiers, recycle/purge rules and hash-only APIs are unchanged.
// No database/file/state writes, provider, HTTP/IPC route, settings, persistence,
// retries, blob reads or automatic work are introduced. Success is a comparison,
// not sync completion, freshness/authentication or permission to apply a purge.
func ReadS3PlanOverviewFromRecords(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, basis S3PlanRecordBasis, limits S3PlanRecordLimits) (S3PlanOverview, error) {
	if ctx == nil {
		return S3PlanOverview{}, ErrS3PlanRecordBasis
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	hashes, err := s3PlanRecordHashes(call, ref, basis, limits)
	if err != nil {
		return S3PlanOverview{}, err
	}
	return ReadS3PlanOverview(call, client, ref, hashes, limits.Plan)
}

func s3PlanRecordHashes(ctx context.Context, ref S3ManifestReference, basis S3PlanRecordBasis, limits S3PlanRecordLimits) (S3PlanLocalBasis, error) {
	if err := ctx.Err(); err != nil {
		return S3PlanLocalBasis{}, s3OverviewReadError(err)
	}
	if !s3ManifestID(basis.StoreID) || basis.StoreID != ref.StoreID || basis.LocalRecords == nil {
		return S3PlanLocalBasis{}, ErrS3PlanRecordBasis
	}
	if limits.LocalRecordBytes < 1 || limits.LocalRecordBytes > syncs3.MaxObjectBytes ||
		limits.TotalLocalRecordBytes < 1 || limits.TotalLocalRecordBytes > MaxS3RecordSetBytes ||
		limits.MaxLocalRecords < 1 || limits.MaxLocalRecords > MaxS3RecordSetItems ||
		len(basis.LocalRecords) > limits.MaxLocalRecords {
		return S3PlanLocalBasis{}, ErrS3PlanRecordLimit
	}
	base, err := s3PlanHashes(ctx, basis.BaseItems)
	if err != nil {
		if ctx.Err() != nil {
			return S3PlanLocalBasis{}, s3OverviewReadError(ctx.Err())
		}
		return S3PlanLocalBasis{}, ErrS3PlanRecordBasis
	}
	// Check ALL raw sizes/identities before parsing even the first record.
	raw := make(map[string]string, len(basis.LocalRecords))
	ids := make([]string, 0, len(basis.LocalRecords))
	charged := int64(0)
	for id, text := range basis.LocalRecords {
		if err := ctx.Err(); err != nil {
			return S3PlanLocalBasis{}, s3OverviewReadError(err)
		}
		if !s3ManifestID(id) || !s3RecordKey(kindForItemKey(id), id) {
			return S3PlanLocalBasis{}, ErrS3PlanRecordBasis
		}
		n := int64(len(text))
		if n > limits.LocalRecordBytes || n > limits.TotalLocalRecordBytes-charged {
			return S3PlanLocalBasis{}, ErrS3PlanRecordLimit
		}
		charged += n
		raw[id] = text
		ids = append(ids, id)
	}
	sort.Strings(ids)
	hashes := make(map[string]string, len(ids))
	records := make(map[string]Record, len(ids))
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return S3PlanLocalBasis{}, s3OverviewReadError(err)
		}
		record, err := decodeS3Record(ctx, []byte(raw[id]), id)
		if err != nil {
			if ctx.Err() != nil {
				return S3PlanLocalBasis{}, s3OverviewReadError(ctx.Err())
			}
			return S3PlanLocalBasis{}, ErrS3PlanRecordBasis
		}
		encoded, hash, err := encodeRecord(record)
		if err != nil {
			return S3PlanLocalBasis{}, ErrS3PlanRecordBasis
		}
		n := int64(len(encoded))
		if n > limits.LocalRecordBytes {
			return S3PlanLocalBasis{}, ErrS3PlanRecordLimit
		}
		if extra := n - int64(len(raw[id])); extra > 0 {
			if extra > limits.TotalLocalRecordBytes-charged {
				return S3PlanLocalBasis{}, ErrS3PlanRecordLimit
			}
			charged += extra
		}
		hashes[id], records[id] = hash, record
	}
	// The complete cache prevents any validator fallback I/O. Its CPU work has
	// no per-step cancellation hook; cap it at 1024 and check before AND after.
	if err := ctx.Err(); err != nil {
		return S3PlanLocalBasis{}, s3OverviewReadError(err)
	}
	err = validateRemoteStructure(Manifest{Items: hashes}, nil, records)
	if ctx.Err() != nil {
		return S3PlanLocalBasis{}, s3OverviewReadError(ctx.Err())
	}
	if err != nil {
		return S3PlanLocalBasis{}, ErrS3PlanRecordBasis // Discard private diagnostics.
	}
	return S3PlanLocalBasis{StoreID: basis.StoreID, LocalItems: hashes, BaseItems: base}, nil
}
