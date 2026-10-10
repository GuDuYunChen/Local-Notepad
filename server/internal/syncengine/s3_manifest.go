package syncengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"notepad-server/internal/syncs3"
)

// This is an explicit read, not a SyncRemote/provider: no List, latest-version
// discovery, writes, local installation or sync-state changes are available.
const MaxS3ManifestItems = 100000

var (
	ErrS3ManifestReference = errors.New("S3 清单读取依据无效，未执行读取")
	ErrS3Manifest          = errors.New("S3 清单格式或身份不符合读取依据，未接受清单")
)

// S3ManifestReference must come from an independently trusted source. A hash
// copied from an untrusted filename/response cannot authenticate that source.
// Pinning a generation is not evidence that it is the newest generation.
type S3ManifestReference struct {
	StoreID    string
	Generation int64
	SHA256     string
}

// ReadS3Manifest reads exactly manifests/<20-digit-generation>-<sha256>.json
// under the client's configured prefix. It reuses GetVerifiedObject and the
// existing Manifest wire format. limit is a caller-selected byte budget, at
// most syncs3.MaxObjectBytes. Every error returns a zero Manifest, never an
// empty-store initialization hint. Referenced records/blobs and tree structure
// have NOT been read or validated; this result alone must not authorize apply.
func ReadS3Manifest(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, limit int64) (Manifest, error) {
	if ctx == nil || !s3ManifestID(ref.StoreID) || ref.Generation < 1 ||
		!objectHashPattern.MatchString(ref.SHA256) || limit < 1 || limit > syncs3.MaxObjectBytes {
		return Manifest{}, ErrS3ManifestReference
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	// One deadline covers GET, hash validation and JSON interpretation. Nested
	// read-client budgets can only shorten it. Parsing also checks cancellation.
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	key := fmt.Sprintf("manifests/%020d-%s.json", ref.Generation, ref.SHA256)
	object, err := client.GetVerifiedObject(call, key, limit, ref.SHA256)
	if err != nil {
		return Manifest{}, err // The existing client exposes only fixed errors/status.
	}
	manifest, err := decodeS3Manifest(call, object.Bytes, ref)
	if err != nil {
		return Manifest{}, err
	}
	if err := call.Err(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func s3ManifestID(s string) bool {
	if len(s) == 0 || len(s) > 1024 || !utf8.ValidString(s) || strings.TrimSpace(s) == "" {
		return false
	}
	for _, c := range s {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true // Identity is exact, not trimmed, case-folded or normalized.
}

// encoding/json v1 accepts duplicate names and replaces malformed UTF-8/UTF-16
// with U+FFFD. Reject these ambiguities before decoding a pinned identity.
func s3ManifestJSON(ctx context.Context, raw []byte) error {
	if !utf8.Valid(raw) || !json.Valid(raw) {
		return ErrS3Manifest
	}
	quoted := false
	for i := 0; i < len(raw); i++ {
		if i%4096 == 0 {
			if err := ctx.Err(); err != nil {
				return err
			}
		}
		if raw[i] == '"' {
			quoted = !quoted
		} else if quoted && raw[i] == '\\' {
			i++ // JSON validity above guarantees that an escaped byte exists.
			if raw[i] != 'u' {
				continue
			}
			code, _ := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
			i += 4
			if code >= 0xdc00 && code <= 0xdfff {
				return ErrS3Manifest
			}
			if code >= 0xd800 && code <= 0xdbff {
				if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
					return ErrS3Manifest
				}
				low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
				if err != nil || low < 0xdc00 || low > 0xdfff {
					return ErrS3Manifest
				}
				i += 6
			}
		}
	}
	return ctx.Err()
}

// Tokenize names instead of decoding into a struct/map: duplicates (including
// escaped aliases) must fail rather than overwrite an earlier member.
func s3ManifestMembers(ctx context.Context, raw []byte, max int, take func(string, json.RawMessage) error) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return ErrS3Manifest
	}
	seen := make(map[string]bool)
	for decoder.More() {
		if err := ctx.Err(); err != nil {
			return err
		}
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] || len(seen) >= max {
			return ErrS3Manifest
		}
		seen[key] = true
		var value json.RawMessage
		if decoder.Decode(&value) != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return ErrS3Manifest
		}
		if err := take(key, value); err != nil {
			return err
		}
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') {
		return ErrS3Manifest
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrS3Manifest
	}
	return ctx.Err()
}

func decodeS3Manifest(ctx context.Context, raw []byte, ref S3ManifestReference) (Manifest, error) {
	if err := s3ManifestJSON(ctx, raw); err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	fields := 0
	err := s3ManifestMembers(ctx, raw, 7, func(key string, value json.RawMessage) error {
		fields++
		var target interface{}
		switch key {
		case "format":
			target = &manifest.Format
		case "version":
			target = &manifest.Version
		case "store_id":
			target = &manifest.StoreID
		case "generation":
			target = &manifest.Generation
		case "updated_at":
			target = &manifest.UpdatedAt
		case "device_id":
			target = &manifest.DeviceID
		case "items":
			manifest.Items = make(map[string]string)
			return s3ManifestMembers(ctx, value, MaxS3ManifestItems, func(id string, hashJSON json.RawMessage) error {
				var hash string
				if !s3ManifestID(id) || json.Unmarshal(hashJSON, &hash) != nil || !objectHashPattern.MatchString(hash) {
					return ErrS3Manifest
				}
				manifest.Items[id] = hash
				return nil
			})
		default:
			return ErrS3Manifest
		}
		if json.Unmarshal(value, target) != nil {
			return ErrS3Manifest
		}
		return nil
	})
	if err != nil {
		return Manifest{}, err
	}
	if fields != 7 || manifest.Format != ManifestFormat || manifest.Version != ManifestVersion ||
		manifest.StoreID != ref.StoreID || manifest.Generation != ref.Generation ||
		!s3ManifestID(manifest.DeviceID) || manifest.Items == nil {
		return Manifest{}, ErrS3Manifest
	}
	if _, err := time.Parse(time.RFC3339Nano, manifest.UpdatedAt); err != nil {
		return Manifest{}, ErrS3Manifest
	}
	manifest.Revision = ref.SHA256
	return manifest, nil
}
