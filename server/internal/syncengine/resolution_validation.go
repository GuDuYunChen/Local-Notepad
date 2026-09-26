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

// A nil error alone is not a durable write receipt (e.g. SQLite RAISE(IGNORE)).
// Both history protection and terminal conflict state must affect exactly one row.
func requireOneResolutionWrite(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s失败: %w", operation, err)
	}
	if result == nil {
		return fmt.Errorf("%s未确认", operation)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s回执无法核实: %w", operation, err)
	}
	if count != 1 {
		return fmt.Errorf("%s未确认：预期更新一条记录，实际 %d 条", operation, count)
	}
	return nil
}

// Recheck the open lifecycle as well as the base in the transaction that will
// commit it. An earlier lock/read does not authorize a retired or replaced row.
func resolutionBase(ctx context.Context, tx *sql.Tx, conflict Conflict) (map[string]string, error) {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM sync_conflicts
		WHERE id=? AND item_id=? AND base_hash=? AND local_hash=? AND remote_hash=? AND status='open'`,
		conflict.ID, conflict.ItemID, conflict.BaseHash, conflict.LocalHash, conflict.RemoteHash).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("同步冲突已变化或不再待处理，请重新对照")
	}
	if err != nil {
		return nil, fmt.Errorf("核实待处理冲突失败: %w", err)
	}
	base := map[string]string{}
	var hash string
	err = tx.QueryRowContext(ctx, `SELECT object_hash FROM sync_base WHERE item_id=?`, conflict.ItemID).Scan(&hash)
	if err == nil {
		base[conflict.ItemID] = hash
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if hash != conflict.BaseHash {
		return nil, fmt.Errorf("冲突基线已变化，请重新同步生成冲突")
	}
	return base, nil
}

// Base and the explicit side-selection receipt are a single SQLite commit.
func (e *Engine) finishResolutionTx(ctx context.Context, tx *sql.Tx, conflict Conflict, choice string) error {
	var hash string
	switch choice {
	case "local":
		hash = conflict.LocalHash
	case "remote":
		hash = conflict.RemoteHash
	default:
		return fmt.Errorf("冲突解决方式仅支持 local 或 remote")
	}
	if !objectHashPattern.MatchString(hash) {
		return fmt.Errorf("所选冲突版本不可用")
	}
	if err := e.setBaseWith(tx, ctx, conflict.ItemID, hash); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE sync_conflicts SET status='resolved',resolution=?,resolved_at=?
		WHERE id=? AND item_id=? AND base_hash=? AND local_hash=? AND remote_hash=? AND status='open'`,
		choice, e.now().Unix(), conflict.ID, conflict.ItemID, conflict.BaseHash, conflict.LocalHash, conflict.RemoteHash)
	return requireOneResolutionWrite(result, err, "保存冲突处理回执")
}

// Used AFTER publishing a local choice or applying filesystem attachment bytes.
// A failed metadata commit does not undo those external effects. The caller must
// retain the existing uncertain-write recovery boundary, never replay silently.
func (e *Engine) finishResolution(ctx context.Context, conflict Conflict, choice string) error {
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = resolutionBase(ctx, tx, conflict); err != nil {
		return err
	}
	if err = e.finishResolutionTx(ctx, tx, conflict, choice); err != nil {
		return err
	}
	return tx.Commit()
}

// Validate, apply, advance base AND record the choice in one SQLite transaction.
// Filesystem attachments retain their separate preservation/recovery semantics.
func (e *Engine) applyResolutionRecord(ctx context.Context, conflict Conflict, chosen Record) error {
	if chosen.ID != conflict.ItemID || chosen.Kind == "attachment" {
		return fmt.Errorf("冲突对象身份无效")
	}
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	base, err := resolutionBase(ctx, tx, conflict)
	if err != nil {
		return err
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
	if err = e.finishResolutionTx(ctx, tx, conflict, "remote"); err != nil {
		return err
	}
	return tx.Commit()
}
