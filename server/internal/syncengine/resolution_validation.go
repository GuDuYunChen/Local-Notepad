package syncengine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Both *sql.DB and *sql.Tx can read records. A remote database choice must be
// validated against the same transaction snapshot that is actually updated.
type localRecordQuery interface {
	QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error)
}

func validateRemoteResolution(ctx context.Context, manifest Manifest, remote SyncRemote, chosen Record) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	_, hash, err := encodeRecord(chosen)
	if err != nil {
		return err
	}
	candidate := manifest
	candidate.Items = copyItems(manifest.Items)
	candidate.Items[chosen.ID] = hash
	// The chosen object need not be uploaded to validate the prospective tree.
	if err = validateRemoteStructure(candidate, remote, map[string]Record{chosen.ID: chosen}); err != nil {
		return fmt.Errorf("所选本机版本会使远端结构无效，未发布；请先处理相关冲突: %w", err)
	}
	return ctx.Err()
}

func validateLocalResolution(ctx context.Context, locals map[string]Record, chosen Record) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	chosen, err := normalizeRecord(chosen)
	if err != nil {
		return err
	}
	candidate := make(map[string]Record, len(locals)+1)
	for id, record := range locals {
		candidate[id] = record
	}
	candidate[chosen.ID] = chosen
	if chosen.State == "purged" && (chosen.Kind == "file" || chosen.Kind == "tag") {
		// Match applyRemoteTx's existing relation cascade, not a new cascade.
		// Children of a folder are NOT deleted implicitly; they must be handled
		// first, otherwise the shared structural validator rejects the orphan.
		for id, record := range candidate {
			link := record.FileTag
			if record.Kind == "file-tag" && link != nil &&
				((chosen.Kind == "file" && link.FileID == chosen.ID) ||
					(chosen.Kind == "tag" && link.TagID == strings.TrimPrefix(chosen.ID, "tag:"))) {
				delete(candidate, id)
			}
		}
	}
	manifest := Manifest{Items: make(map[string]string, len(candidate))}
	for id, record := range candidate {
		if err := ctx.Err(); err != nil {
			return err
		}
		hash, err := recordHash(record)
		if err != nil {
			return err
		}
		manifest.Items[id] = hash
	}
	// Complete cache: validation is in-memory and never fetches remote bytes.
	if err := validateRemoteStructure(manifest, nil, candidate); err != nil {
		return fmt.Errorf("所选远端版本会使本机结构无效，未应用；请先处理相关冲突: %w", err)
	}
	return ctx.Err()
}

// Validate, apply and advance base in one SQLite transaction. Filesystem
// attachments retain their separate preservation path and recovery semantics.
func (e *Engine) applyResolutionRecord(ctx context.Context, conflict Conflict, chosen Record) error {
	if chosen.ID != conflict.ItemID || chosen.Kind == "attachment" {
		return fmt.Errorf("冲突对象身份无效")
	}
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	base := map[string]string{}
	var baseHash string
	err = tx.QueryRowContext(ctx, `SELECT object_hash FROM sync_base WHERE item_id=?`, conflict.ItemID).Scan(&baseHash)
	if err == nil {
		base[conflict.ItemID] = baseHash
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if baseHash != conflict.BaseHash {
		return fmt.Errorf("冲突基线已变化，请重新同步生成冲突")
	}
	locals, err := e.localRecordsWith(ctx, tx)
	if err != nil {
		return err
	}
	_, hash, _, err := localRecordFor(conflict.ItemID, locals, base)
	if err != nil {
		return err
	}
	if hash != conflict.LocalHash {
		return fmt.Errorf("本机内容在冲突产生后已变化，请重新同步")
	}
	if err = validateLocalResolution(ctx, locals, chosen); err != nil {
		return err
	}
	if err = e.applyRemoteTx(ctx, tx, chosen); err != nil {
		return err
	}
	if err = e.setBaseWith(tx, ctx, conflict.ItemID, conflict.RemoteHash); err != nil {
		return err
	}
	return tx.Commit()
}
