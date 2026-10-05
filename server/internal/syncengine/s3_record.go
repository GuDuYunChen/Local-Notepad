package syncengine

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"notepad-server/internal/syncs3"
)

var (
	ErrS3RecordReference = errors.New("S3 记录读取依据或预算无效，未执行读取")
	ErrS3RecordMissing   = errors.New("指定清单未包含所选记录，未读取记录对象")
	ErrS3Record          = errors.New("S3 记录结构或身份不符合所选条目，未接受记录")
)

// Both the manifest pin and ItemID are explicit. Never accept a caller-mutated
// Manifest.Items map as a substitute for re-reading the pinned manifest bytes.
// Manifest must come from an independently trusted source, not a remote claim.
type S3RecordReference struct {
	Manifest S3ManifestReference
	ItemID   string
}

// Each object has its own caller-selected bound (1..MaxObjectBytes). At most
// one manifest and one record are read. A single 15s budget covers both reads,
// their hashes and decoding; a shorter caller deadline is never extended.
type S3RecordReadLimits struct {
	ManifestBytes int64
	RecordBytes   int64
}

// ReadS3Record consumes exactly one entry from a pinned manifest. It reuses the
// existing Manifest/Record formats and GetVerifiedObject; it never guesses keys,
// searches latest/List, retries, fetches attachment blobs or installs anything.
// Absence and HTTP 404 remain errors, not purged records or empty-store hints.
// Success validates this record ONLY, not parent/tag references, the full tree,
// attachment bytes, provenance, freshness or authority to apply any deletion.
// Record contains private content: this is internal data, NOT a safe IPC result.
// Every failure returns the zero Record, including cancellation after reading.
func ReadS3Record(ctx context.Context, client *syncs3.ReadClient, ref S3RecordReference, limits S3RecordReadLimits) (Record, error) {
	if ctx == nil || !s3ManifestID(ref.ItemID) || limits.ManifestBytes < 1 || limits.ManifestBytes > syncs3.MaxObjectBytes ||
		limits.RecordBytes < 1 || limits.RecordBytes > syncs3.MaxObjectBytes {
		return Record{}, ErrS3RecordReference
	}
	if err := ctx.Err(); err != nil {
		return Record{}, err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	manifest, err := ReadS3Manifest(call, client, ref.Manifest, limits.ManifestBytes)
	if err != nil {
		return Record{}, err
	}
	if err := call.Err(); err != nil {
		return Record{}, err
	}
	hash, exists := manifest.Items[ref.ItemID]
	if !exists {
		return Record{}, ErrS3RecordMissing
	}
	object, err := client.GetVerifiedObject(call, "objects/"+hash+".json", limits.RecordBytes, hash)
	if err != nil {
		return Record{}, err
	}
	record, err := decodeS3Record(call, object.Bytes, ref.ItemID)
	if err != nil {
		return Record{}, err
	}
	if err := call.Err(); err != nil {
		return Record{}, err
	}
	return record, nil
}

// Reuse the pinned-manifest token scanner to reject duplicate/escaped aliases,
// unknown/case-aliased members and nulls at EVERY object level before unmarshaling.
// Map its parser errors to a fixed record error, preserving context cancellation.
func s3RecordFields(ctx context.Context, raw []byte, required, optional []string) (map[string]json.RawMessage, error) {
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, name := range required {
		allowed[name] = true
	}
	for _, name := range optional {
		allowed[name] = true
	}
	fields := make(map[string]json.RawMessage)
	err := s3ManifestMembers(ctx, raw, len(allowed), func(name string, value json.RawMessage) error {
		if !allowed[name] {
			return ErrS3Record
		}
		fields[name] = value
		return nil
	})
	if err != nil {
		return nil, s3RecordError(ctx)
	}
	for _, name := range required {
		if _, ok := fields[name]; !ok {
			return nil, ErrS3Record
		}
	}
	return fields, nil
}

func s3RecordError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return ErrS3Record
}

func decodeS3Record(ctx context.Context, raw []byte, itemID string) (Record, error) {
	if err := s3ManifestJSON(ctx, raw); err != nil {
		return Record{}, s3RecordError(ctx)
	}
	fields, err := s3RecordFields(ctx, raw,
		[]string{"format", "version", "kind", "id", "state"}, []string{"file", "tag", "file_tag", "attachment"})
	if err != nil {
		return Record{}, err
	}
	var record Record
	for name, dest := range map[string]interface{}{"format": &record.Format, "version": &record.Version,
		"kind": &record.Kind, "id": &record.ID, "state": &record.State} {
		if json.Unmarshal(fields[name], dest) != nil {
			return Record{}, ErrS3Record
		}
	}
	if record.ID != itemID || !s3ManifestID(record.ID) || record.Kind != kindForItemKey(itemID) {
		return Record{}, ErrS3Record
	}
	if record.State == "purged" {
		if len(fields) != 5 || !s3RecordKey(record.Kind, record.ID) {
			return Record{}, ErrS3Record
		}
	} else if record.State == "present" {
		payloadName := record.Kind
		if payloadName == "file-tag" {
			payloadName = "file_tag"
		}
		var required []string
		var dest interface{}
		switch record.Kind {
		case "file":
			required = []string{"id", "title", "content", "created_at", "updated_at", "is_folder", "parent_id", "sort_order", "is_deleted", "deleted_at", "is_pinned"}
			record.File = &FilePayload{}
			dest = record.File
		case "tag":
			required = []string{"id", "name", "color"}
			record.Tag = &TagPayload{}
			dest = record.Tag
		case "file-tag":
			required = []string{"file_id", "tag_id"}
			record.FileTag = &FileTagPayload{}
			dest = record.FileTag
		case "attachment":
			required = []string{"name", "size", "blob_hash"}
			record.Attachment = &AttachmentPayload{}
			dest = record.Attachment
		default:
			return Record{}, ErrS3Record
		}
		payload, ok := fields[payloadName]
		if !ok || len(fields) != 6 {
			return Record{}, ErrS3Record
		}
		if _, err := s3RecordFields(ctx, payload, required, nil); err != nil {
			return Record{}, err
		}
		if json.Unmarshal(payload, dest) != nil || !s3RecordPayloadIDs(record) {
			return Record{}, ErrS3Record
		}
	} else {
		return Record{}, ErrS3Record
	}
	// Existing payload/state checks are not duplicated or weakened. Discard their
	// diagnostics rather than exposing a potentially private value in an error.
	normalized, err := normalizeRecord(record)
	if err != nil {
		return Record{}, ErrS3Record
	}
	if err := ctx.Err(); err != nil {
		return Record{}, err
	}
	return normalized, nil
}

func s3RecordKey(kind, id string) bool {
	switch kind {
	case "file":
		return s3ManifestID(id) && kindForItemKey(id) == "file"
	case "tag":
		return s3ManifestID(strings.TrimPrefix(id, "tag:"))
	case "file-tag":
		parts := strings.Split(strings.TrimPrefix(id, "filetag:"), ":")
		return len(parts) == 2 && s3ManifestID(parts[0]) && s3ManifestID(parts[1])
	case "attachment":
		name, ok := attachmentNameFromKey(id)
		return ok && s3ManifestID(name) && attachmentItemKey(name) == id
	}
	return false
}

func s3RecordPayloadIDs(r Record) bool {
	if !s3RecordKey(r.Kind, r.ID) {
		return false
	}
	switch r.Kind {
	case "file":
		return s3ManifestID(r.File.ID) && (r.File.ParentID == "" || s3ManifestID(r.File.ParentID))
	case "tag":
		return s3ManifestID(r.Tag.ID)
	case "file-tag":
		return s3ManifestID(r.FileTag.FileID) && s3ManifestID(r.FileTag.TagID) &&
			!strings.Contains(r.FileTag.FileID, ":") && !strings.Contains(r.FileTag.TagID, ":")
	case "attachment":
		return s3ManifestID(r.Attachment.Name)
	}
	return false
}
