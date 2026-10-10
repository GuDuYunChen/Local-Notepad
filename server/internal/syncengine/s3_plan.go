package syncengine

import (
	"context"
	"errors"
	"time"

	"notepad-server/internal/syncs3"
)

// A plan is bounded by the union of local, common-base and remote identities.
const MaxS3PlanItems = 3 * MaxS3RecordSetItems

var (
	ErrS3PlanBasis = errors.New("S3 预览的本地依据或仓库身份无效，未执行读取")
	ErrS3PlanLimit = errors.New("S3 预览条目超过显式预算，未接受计划")
)

// S3PlanLocalBasis is an explicit COMPLETE local hash snapshot and its common
// base, both supplied by trusted internal code for StoreID. Empty maps must be
// non-nil. This function does NOT obtain a database snapshot or authenticate the
// supplied hashes. Callers must not mutate these maps concurrently with the
// call. Detached copies are made before any network request.
//
// As in the existing engine, local absence WITH a common base is interpreted
// as a local purge candidate; absence WITHOUT a base is merely absence. Supply
// an incomplete local map and the preview is NOT a preview of the real store.
// It remains an internal comparison, never permission to apply a purge.
type S3PlanLocalBasis struct {
	StoreID    string
	LocalItems map[string]string
	BaseItems  map[string]string
}

type S3PlanReadLimits struct {
	Records  S3RecordSetReadLimits
	MaxItems int // 1..MaxS3PlanItems, including all three identity sets.
}

func s3PlanHashes(ctx context.Context, items map[string]string) (map[string]string, error) {
	if items == nil || len(items) > MaxS3RecordSetItems {
		return nil, ErrS3PlanBasis
	}
	copy := make(map[string]string, len(items))
	for id, hash := range items {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !s3ManifestID(id) || !s3RecordKey(kindForItemKey(id), id) || !objectHashPattern.MatchString(hash) {
			return nil, ErrS3PlanBasis
		}
		copy[id] = hash
	}
	return copy, nil
}

// ReadS3Plan compares an explicit local/common-base hash snapshot with a freshly
// verified pinned remote record set. The existing classifyItem and purge hash
// format are reused; no new conflict or deletion policy is invented. Stable
// byte-sorted Plan.Items and counts retain the existing Plan representation.
// NeedsInit is ALWAYS false: even an empty pinned manifest is an existing store.
//
// The Plan contains private identities and hashes, not an IPC-safe summary.
// "upload"/"download"/"conflict" are classifications, NOT executable actions.
// Local record content/relations and attachment blob availability are NOT
// verified here. No database, files, sync state, blobs, provider registration,
// discovery, retries or writes are involved. All remote reads use the original
// RecordSet limits and one 15s/caller-earlier deadline. Every error returns the
// zero Plan, including a too-large union or cancellation after remote reads.
// A trusted pin does not prove freshness, credentials or write/List permission.
func ReadS3Plan(ctx context.Context, client *syncs3.ReadClient, ref S3ManifestReference, basis S3PlanLocalBasis, limits S3PlanReadLimits) (Plan, error) {
	if ctx == nil || !s3ManifestID(basis.StoreID) || basis.StoreID != ref.StoreID {
		return Plan{}, ErrS3PlanBasis
	}
	if limits.MaxItems < 1 || limits.MaxItems > MaxS3PlanItems {
		return Plan{}, ErrS3PlanLimit
	}
	if err := ctx.Err(); err != nil {
		return Plan{}, err
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	locals, err := s3PlanHashes(call, basis.LocalItems)
	if err != nil {
		return Plan{}, err
	}
	base, err := s3PlanHashes(call, basis.BaseItems)
	if err != nil {
		return Plan{}, err
	}
	// unionIDs accepts records only to enumerate keys. No content is retained.
	localKeys := make(map[string]Record, len(locals))
	for id := range locals {
		localKeys[id] = Record{}
	}
	if len(unionIDs(localKeys, base, nil)) > limits.MaxItems {
		return Plan{}, ErrS3PlanLimit
	}
	set, err := ReadS3RecordSet(call, client, ref, limits.Records)
	if err != nil {
		return Plan{}, err
	}
	ids := unionIDs(localKeys, base, set.Manifest.Items)
	if len(ids) > limits.MaxItems {
		return Plan{}, ErrS3PlanLimit
	}
	plan := Plan{StoreID: set.Manifest.StoreID, Generation: set.Manifest.Generation,
		Revision: set.Manifest.Revision, Items: make([]PlanItem, 0, len(ids))}
	for _, id := range ids {
		if err := call.Err(); err != nil {
			return Plan{}, err
		}
		localHash, exists := locals[id]
		if !exists && base[id] != "" {
			// Identical to localRecordFor's established missing-with-base rule.
			localHash, err = recordHash(purgedRecordForKey(id))
			if err != nil {
				return Plan{}, ErrS3PlanBasis
			}
			exists = true
		}
		remoteHash := set.Manifest.Items[id]
		action := classifyItem(id, base[id], localHash, remoteHash, exists)
		plan.Items = append(plan.Items, PlanItem{ID: id, Action: action, BaseHash: base[id], LocalHash: localHash, RemoteHash: remoteHash})
		switch action {
		case "upload":
			plan.Uploads++
		case "download":
			plan.Downloads++
		case "conflict":
			plan.Conflicts++
		case "noop":
			plan.Noops++
		default:
			return Plan{}, ErrS3PlanBasis
		}
	}
	if err := call.Err(); err != nil {
		return Plan{}, err
	}
	return plan, nil
}
