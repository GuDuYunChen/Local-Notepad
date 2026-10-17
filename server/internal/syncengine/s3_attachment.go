package syncengine

import (
	"context"
	"errors"
	"time"

	"notepad-server/internal/syncs3"
)

var (
	ErrS3AttachmentReference   = errors.New("S3 附件读取依据或预算无效，未执行读取")
	ErrS3AttachmentUnavailable = errors.New("所选记录没有可读取的附件内容，未读取附件对象")
	ErrS3AttachmentSize        = errors.New("S3 附件内容大小与已验证记录不一致，未接受附件")
)

// All three limits are explicit, positive and at most MaxObjectBytes. At most
// one manifest, one record and one blob are fetched, with a shared 15s deadline
// (or the caller's earlier deadline). No discovery, prefetch, cache or retries.
type S3AttachmentReadLimits struct {
	ManifestBytes int64
	RecordBytes   int64
	BlobBytes     int64
}

// S3AttachmentObject is internal, private data, NOT a renderer-safe summary or
// permission to materialize a file. Metadata uses the existing attachment wire
// type. Neither the name nor the bytes may be logged or exposed through the
// byte-only preflight IPC. Every failed read returns the zero value.
type S3AttachmentObject struct {
	Metadata AttachmentPayload
	Bytes    []byte
}

// ReadS3Attachment re-reads the pinned manifest and exact attachment record via
// ReadS3Record, then reads blobs/<verified hash>. Caller-provided mutable Record
// or AttachmentPayload values are never accepted as authority. The final bytes
// must match BOTH the record's SHA-256 and declared size. ETag/remote checksum
// headers cannot replace either check. Even a zero-byte attachment needs its
// one verified blob GET; a missing/purged record or 404 is not an empty blob.
//
// A successful read does not authenticate the pin, establish freshness, check
// record relationships or authorize local installation/deletion. No filesystem,
// database, provider, configuration or credential persistence is involved.
func ReadS3Attachment(ctx context.Context, client *syncs3.ReadClient, ref S3RecordReference, limits S3AttachmentReadLimits) (S3AttachmentObject, error) {
	if ctx == nil || !s3ManifestID(ref.ItemID) || kindForItemKey(ref.ItemID) != "attachment" ||
		!s3RecordKey("attachment", ref.ItemID) || limits.ManifestBytes < 1 || limits.ManifestBytes > syncs3.MaxObjectBytes ||
		limits.RecordBytes < 1 || limits.RecordBytes > syncs3.MaxObjectBytes || limits.BlobBytes < 1 || limits.BlobBytes > syncs3.MaxObjectBytes {
		return S3AttachmentObject{}, ErrS3AttachmentReference
	}
	if err := ctx.Err(); err != nil {
		return S3AttachmentObject{}, err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	record, err := ReadS3Record(call, client, ref, S3RecordReadLimits{ManifestBytes: limits.ManifestBytes, RecordBytes: limits.RecordBytes})
	if err != nil {
		return S3AttachmentObject{}, err
	}
	if err := call.Err(); err != nil {
		return S3AttachmentObject{}, err
	}
	if record.Kind != "attachment" || record.State != "present" || record.Attachment == nil {
		return S3AttachmentObject{}, ErrS3AttachmentUnavailable
	}
	metadata := *record.Attachment
	if metadata.Size > limits.BlobBytes {
		return S3AttachmentObject{}, syncs3.ErrTooLarge
	}
	object, err := client.GetVerifiedObject(call, "blobs/"+metadata.BlobHash, limits.BlobBytes, metadata.BlobHash)
	if err != nil {
		return S3AttachmentObject{}, err
	}
	if err := call.Err(); err != nil {
		return S3AttachmentObject{}, err
	}
	if int64(len(object.Bytes)) != metadata.Size {
		return S3AttachmentObject{}, ErrS3AttachmentSize
	}
	return S3AttachmentObject{Metadata: metadata, Bytes: object.Bytes}, nil
}
