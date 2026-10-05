package syncengine

import (
	"context"
	"errors"
	"sort"
	"time"

	"notepad-server/internal/syncs3"
)

const MaxS3SnapshotBlobs = MaxS3RecordSetItems
const MaxS3SnapshotBlobBytes int64 = 64 * 1024 * 1024

var (
	ErrS3SnapshotReference = errors.New("S3 快照附件读取预算无效，未执行读取")
	ErrS3SnapshotLimit     = errors.New("S3 快照附件超过数量或字节预算，未接受快照")
	ErrS3SnapshotMetadata  = errors.New("S3 快照中相同附件内容的大小声明不一致，未接受快照")
)

// Record limits retain the existing meaning. BlobBytes limits one blob,
// TotalBlobBytes limits the sum of DISTINCT verified blob bytes, not the sum of
// all attachment names, and MaxBlobs limits distinct hashes. All limits are
// explicit and positive, even for a snapshot without attachments. Input limits
// are not a bound on total process memory; decoding and maps also use memory.
type S3SnapshotReadLimits struct {
	Records        S3RecordSetReadLimits
	BlobBytes      int64
	TotalBlobBytes int64
	MaxBlobs       int
}

// S3Snapshot is private, mutable internal data, NOT an IPC summary or authority
// to apply/install anything. Records retain their names and metadata; Blobs is
// keyed by the verified hash, so multiple attachment records can share one byte
// slice. No returned data is cached or reused as authority for another call.
// Purged attachment records have no blob. Every error returns the zero value.
type S3Snapshot struct {
	RecordSet S3RecordSet
	Blobs     map[string][]byte
}

// ReadS3Snapshot verifies a pinned record set and every distinct present
// attachment blob. All record/relationship checks and the entire blob plan
// (including conflicting size declarations) pass before ANY blob request.
// Records are fetched once by ReadS3RecordSet, then blobs in byte-sorted hash
// order. No repeated manifest/record reads, discovery, retries or callbacks.
// At most 1+Records.MaxRecords+MaxBlobs signed GETs share one 15s budget or the
// caller's earlier deadline. Partial records/blobs never escape on failure.
// A trusted pin is still required; success is neither freshness/authentication
// nor permission to write a file/database or interpret a purge as a deletion.
func ReadS3Snapshot(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, limits S3SnapshotReadLimits) (S3Snapshot, error) {
	if ctx == nil || limits.BlobBytes < 1 || limits.BlobBytes > syncs3.MaxObjectBytes ||
		limits.TotalBlobBytes < 1 || limits.TotalBlobBytes > MaxS3SnapshotBlobBytes ||
		limits.MaxBlobs < 1 || limits.MaxBlobs > MaxS3SnapshotBlobs {
		return S3Snapshot{}, ErrS3SnapshotReference
	}
	if err := ctx.Err(); err != nil {
		return S3Snapshot{}, err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	set, err := ReadS3RecordSet(call, client, ref, limits.Records)
	if err != nil {
		return S3Snapshot{}, err
	}
	sizes := make(map[string]int64)
	remaining := limits.TotalBlobBytes
	for _, record := range set.Records {
		if err := call.Err(); err != nil {
			return S3Snapshot{}, err
		}
		if record.Kind != "attachment" || record.State != "present" {
			continue
		}
		// The set was just read/decoded inside this call; no caller-owned
		// mutable Record is accepted as network authority.
		metadata := record.Attachment
		if previous, exists := sizes[metadata.BlobHash]; exists {
			if previous != metadata.Size {
				return S3Snapshot{}, ErrS3SnapshotMetadata
			}
			continue
		}
		if len(sizes) == limits.MaxBlobs || metadata.Size > limits.BlobBytes || metadata.Size > remaining {
			return S3Snapshot{}, ErrS3SnapshotLimit
		}
		sizes[metadata.BlobHash] = metadata.Size
		remaining -= metadata.Size // Nonnegative decoded sizes; no overflowing sum.
	}
	hashes := make([]string, 0, len(sizes))
	for hash := range sizes {
		hashes = append(hashes, hash)
	}
	sort.Strings(hashes)
	blobs := make(map[string][]byte, len(hashes))
	for _, hash := range hashes {
		if err := call.Err(); err != nil {
			return S3Snapshot{}, err
		}
		size := sizes[hash]
		limit := size
		if limit == 0 {
			// Still issue a verified GET for an empty blob. GetObject requires
			// a positive limit and may read its bounded oversize sentinel on
			// failure; only zero bytes can be accepted for this declaration.
			limit = 1
		}
		object, err := client.GetVerifiedObject(call, "blobs/"+hash, limit, hash)
		if err != nil {
			return S3Snapshot{}, err
		}
		if err := call.Err(); err != nil {
			return S3Snapshot{}, err
		}
		if int64(len(object.Bytes)) != size {
			return S3Snapshot{}, ErrS3AttachmentSize
		}
		blobs[hash] = object.Bytes
	}
	if err := call.Err(); err != nil {
		return S3Snapshot{}, err
	}
	return S3Snapshot{RecordSet: set, Blobs: blobs}, nil
}
