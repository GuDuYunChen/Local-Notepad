package syncengine

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const S3LocalOverviewFormat = "local-notepad-s3-local-candidate-overview"

var ErrS3LocalOverview = errors.New("本地只读候选概览未完成，未接受统计结果")

// S3LocalKindOverview counts records, not transfers or sync actions. The file
// kind includes folders and recycled files; attachments describe metadata.
type S3LocalKindOverview struct {
	Kind        string `json:"kind"`
	Records     int    `json:"records"`
	RecordBytes int64  `json:"record_bytes"`
}

// S3LocalOverview contains no source identity, path, record body, hash, stored
// remote identity or credentials. Counts still disclose coarse local activity;
// this is not public telemetry. Value fields and a fixed array retain no private
// candidate maps. It is a LOCAL inventory, not the existing remote plan overview.
// CompleteForPreview is always false. ObservedStable says only that the original
// bounded D1/A1/D2/A2 observations agreed, NOT that they form an atomic snapshot.
type S3LocalOverview struct {
	Format             string                 `json:"format"`
	Version            int                    `json:"version"`
	ReadOnly           bool                   `json:"read_only"`
	ObservedStable     bool                   `json:"observed_stable"`
	CompleteForPreview bool                   `json:"complete_for_preview"`
	Records            int                    `json:"records"`
	RecordBytes        int64                  `json:"record_bytes"`
	AttachmentBytes    int64                  `json:"attachment_bytes"`
	BaseItems          int                    `json:"base_items"`
	Kinds              [4]S3LocalKindOverview `json:"kinds"`
}

// ReadS3LocalOverview obtains its OWN candidate through the accepted reader; it
// does not accept a caller-created candidate or trust caller-provided counters.
// Reading, cleanup and projection share one 5s/caller-earlier deadline. Canonical
// records, all component/union budgets, the closed relationship graph and the
// attachment-byte sum are checked before any statistics leave this function.
// Every failure returns the zero overview and a fixed error/context sentinel.
//
// No HTTP/IPC registration, database/file writes, caching, retries, settings or
// remote access. Borrowed db/root remain open. There is no preview authorization,
// pin inference, purge count or directional upload/download classification.
func ReadS3LocalOverview(ctx context.Context, db *sql.DB, root S3LocalAttachmentRoot, limits S3LocalCandidateLimits) (S3LocalOverview, error) {
	if ctx == nil {
		return S3LocalOverview{}, ErrS3LocalOverview
	}
	call, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	candidate, err := ReadS3LocalCandidate(call, db, root, limits)
	if err != nil {
		return S3LocalOverview{}, s3LocalOverviewError(call)
	}
	return s3LocalOverview(call, candidate, limits)
}

func s3LocalOverviewError(ctx context.Context) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	return ErrS3LocalOverview
}

// Internal-only: never expose this projector as a way to certify arbitrary
// caller data. Canonical equality is required because the source reader itself
// emits canonical Record JSON; silently repairing it would hide an invariant bug.
func s3LocalOverview(ctx context.Context, c S3LocalCandidate, limits S3LocalCandidateLimits) (S3LocalOverview, error) {
	zero := S3LocalOverview{}
	fail := func() (S3LocalOverview, error) { return zero, s3LocalOverviewError(ctx) }
	if ctx == nil || ctx.Err() != nil || !s3LocalCandidateLimitsValid(limits) || !c.ObservedStable || c.CompleteForPreview ||
		c.LocalRecords == nil || c.BaseItems == nil || len(c.LocalRecords) > limits.Records || len(c.BaseItems) > limits.Database.BaseItems ||
		c.AttachmentBytes < 0 || c.AttachmentBytes > limits.Attachments.TotalFileBytes ||
		(c.StoredRemoteStoreID != "" && !s3ManifestID(c.StoredRemoteStoreID)) ||
		(c.StoredRemoteRevision != "" && !objectHashPattern.MatchString(c.StoredRemoteRevision)) ||
		(c.StoredRemoteStoreID == "" && c.StoredRemoteRevision != "") ||
		(len(c.BaseItems) > 0 && (c.StoredRemoteStoreID == "" || c.StoredRemoteRevision == "")) {
		return fail()
	}
	if _, err := s3PlanHashes(ctx, c.BaseItems); err != nil {
		return fail()
	}
	out := S3LocalOverview{Format: S3LocalOverviewFormat, Version: 1, ReadOnly: true, ObservedStable: true,
		BaseItems: len(c.BaseItems), Kinds: [4]S3LocalKindOverview{{Kind: "file"}, {Kind: "tag"}, {Kind: "file-tag"}, {Kind: "attachment"}}}
	rows := make(map[string]Record, len(c.LocalRecords))
	hashes := make(map[string]string, len(c.LocalRecords))
	var databaseBytes, attachmentRecordBytes int64
	databaseRecords := 0
	for id, raw := range c.LocalRecords {
		if ctx.Err() != nil || !s3ManifestID(id) {
			return fail()
		}
		kind, index := kindForItemKey(id), -1
		for i, row := range out.Kinds {
			if row.Kind == kind {
				index = i
				break
			}
		}
		n := int64(len(raw))
		if index < 0 || n > limits.TotalRecordBytes-out.RecordBytes {
			return fail()
		}
		if kind == "attachment" {
			if out.Kinds[index].Records >= limits.Attachments.Attachments || n > limits.Attachments.RecordBytes || n > limits.Attachments.TotalRecordBytes-attachmentRecordBytes {
				return fail()
			}
			attachmentRecordBytes += n
		} else {
			if databaseRecords >= limits.Database.Records || n > limits.Database.RecordBytes || n > limits.Database.TotalRecordBytes-databaseBytes {
				return fail()
			}
			databaseRecords++
			databaseBytes += n
		}
		record, err := decodeS3Record(ctx, []byte(raw), id)
		if err != nil || record.State != "present" {
			return fail()
		}
		canonical, hash, err := encodeRecord(record)
		if err != nil || string(canonical) != raw {
			return fail()
		}
		if kind == "attachment" {
			size := record.Attachment.Size
			if size < 0 || size > limits.Attachments.FileBytes || size > limits.Attachments.TotalFileBytes-out.AttachmentBytes {
				return fail()
			}
			out.AttachmentBytes += size
		}
		rows[id], hashes[id] = record, hash
		out.Kinds[index].Records++
		out.Kinds[index].RecordBytes += n
		out.Records++
		out.RecordBytes += n
	}
	if ctx.Err() != nil || out.AttachmentBytes != c.AttachmentBytes ||
		validateRemoteStructure(Manifest{Items: hashes}, nil, rows) != nil || ctx.Err() != nil {
		return fail()
	}
	return out, nil
}
