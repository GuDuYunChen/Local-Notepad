package syncengine

import (
	"context"
	"errors"
	"sort"
	"time"

	"notepad-server/internal/syncs3"
)

// Keep the existing structure validator's work bounded even for deep folder
// chains. These are input limits, not a promise about total process memory.
const MaxS3RecordSetItems = 1024
const MaxS3RecordSetBytes int64 = 64 * 1024 * 1024

var (
	ErrS3RecordSetReference = errors.New("S3 记录集合读取预算无效，未执行读取")
	ErrS3RecordSetLimit     = errors.New("S3 记录集合超过条目或总字节预算，未接受集合")
	ErrS3RecordSetStructure = errors.New("S3 记录集合关系不符合既有规则，未接受集合")
)

// All limits are explicit. ManifestBytes and RecordBytes each lie in
// 1..MaxObjectBytes. TotalRecordBytes bounds the SUM of exact raw record bytes,
// excluding the manifest; MaxRecords lies in 1..MaxS3RecordSetItems. An empty,
// verified manifest is allowed, but is never an instruction to initialize.
type S3RecordSetReadLimits struct {
	ManifestBytes    int64
	RecordBytes      int64
	TotalRecordBytes int64
	MaxRecords       int
}

// S3RecordSet contains private content and mutable Go maps. It is not an IPC
// summary, a capability to apply data, or authority for future network reads.
// Attachment metadata is included; attachment blobs are NOT fetched. Success
// checks existing parent/folder, active-name, tag/link and cycle rules only.
// It does not check inline references, blob existence, freshness or provenance.
// Every error returns the zero value, never a partially usable set.
type S3RecordSet struct {
	Manifest Manifest
	Records  map[string]Record
}

// ReadS3RecordSet verifies one pinned manifest, then every listed record in
// deterministic byte-sorted ItemID order, without re-fetching the manifest for
// each item. Only verified hashes enter object paths. No cache, discovery,
// retries, List/HEAD, callbacks, provider registration or writes are involved.
// At most 1+MaxRecords signed GETs share a single 15s/caller-earlier deadline.
func ReadS3RecordSet(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, limits S3RecordSetReadLimits) (S3RecordSet, error) {
	if ctx == nil || limits.ManifestBytes < 1 || limits.ManifestBytes > syncs3.MaxObjectBytes ||
		limits.RecordBytes < 1 || limits.RecordBytes > syncs3.MaxObjectBytes ||
		limits.TotalRecordBytes < 1 || limits.TotalRecordBytes > MaxS3RecordSetBytes ||
		limits.MaxRecords < 1 || limits.MaxRecords > MaxS3RecordSetItems {
		return S3RecordSet{}, ErrS3RecordSetReference
	}
	if err := ctx.Err(); err != nil {
		return S3RecordSet{}, err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	manifest, err := ReadS3Manifest(call, client, ref, limits.ManifestBytes)
	if err != nil {
		return S3RecordSet{}, err
	}
	if len(manifest.Items) > limits.MaxRecords {
		return S3RecordSet{}, ErrS3RecordSetLimit
	}
	ids := make([]string, 0, len(manifest.Items))
	for id := range manifest.Items {
		if err := call.Err(); err != nil {
			return S3RecordSet{}, err
		}
		// Refuse an invalid identity anywhere before fetching any record, not
		// just when iteration happens to reach that entry.
		if !s3RecordKey(kindForItemKey(id), id) {
			return S3RecordSet{}, ErrS3Record
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	records := make(map[string]Record, len(ids))
	remaining := limits.TotalRecordBytes
	for _, id := range ids {
		if err := call.Err(); err != nil {
			return S3RecordSet{}, err
		}
		if remaining == 0 {
			return S3RecordSet{}, ErrS3RecordSetLimit
		}
		limit := limits.RecordBytes
		if remaining < limit {
			limit = remaining
		}
		hash := manifest.Items[id]
		object, err := client.GetVerifiedObject(call, "objects/"+hash+".json", limit, hash)
		if err != nil {
			return S3RecordSet{}, err
		}
		remaining -= int64(len(object.Bytes)) // GetVerifiedObject enforced limit.
		record, err := decodeS3Record(call, object.Bytes, id)
		if err != nil {
			return S3RecordSet{}, err
		}
		records[id] = record
	}
	if err := call.Err(); err != nil {
		return S3RecordSet{}, err
	}
	// The cache contains EVERY manifest key, so the existing validator cannot
	// invoke a remote method. Passing no remote deliberately prevents fallback
	// I/O. Do not call this until all records have been decoded successfully.
	// Reuse existing semantics rather than quietly tightening recycle/purge
	// rules. Its private diagnostics are discarded, never wrapped or exposed.
	err = validateRemoteStructure(manifest, nil, records)
	// The existing CPU-only validator has no per-step cancellation callback;
	// its work is capped by 1024 records. Observe cancellation before delivery.
	if ctxErr := call.Err(); ctxErr != nil {
		return S3RecordSet{}, ctxErr
	}
	if err != nil {
		return S3RecordSet{}, ErrS3RecordSetStructure
	}
	return S3RecordSet{Manifest: manifest, Records: records}, nil
}
