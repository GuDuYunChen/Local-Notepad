package syncengine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Check the actual transaction snapshot after all metadata statements/triggers.
// A one-row UPDATE receipt alone cannot prove the base or final row contents.
func verifyResolutionMetadata(ctx context.Context, tx *sql.Tx, c Conflict, choice, hash string, resolvedAt int64) error {
	var count int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM sync_conflicts c
		JOIN sync_base b ON b.item_id=c.item_id
		WHERE c.id=? AND c.item_id=? AND c.base_hash=? AND c.local_hash=? AND c.remote_hash=?
		AND c.status='resolved' AND c.resolution=? AND c.resolved_at=? AND b.object_hash=?`,
		c.ID, c.ItemID, c.BaseHash, c.LocalHash, c.RemoteHash, choice, resolvedAt, hash).Scan(&count)
	if err != nil {
		return fmt.Errorf("核对冲突处理结果失败: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("同步基线或冲突处理记录与所选版本不一致，未提交本机事务")
	}
	return nil
}

// Read only the selected database object, not the whole workspace or attachment
// bytes. Run AFTER finishResolutionTx, so its triggers cannot change this object
// after verification. No subsequent writes occur before the caller's Commit.
func verifyAppliedResolution(ctx context.Context, tx *sql.Tx, chosen Record) error {
	chosen, err := normalizeRecord(chosen)
	if err != nil {
		return err
	}
	var actual Record
	switch chosen.Kind {
	case "file":
		var p FilePayload
		err = tx.QueryRowContext(ctx, `SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned
			FROM files WHERE id=?`, chosen.ID).Scan(&p.ID, &p.Title, &p.Content, &p.CreatedAt, &p.UpdatedAt,
			&p.IsFolder, &p.ParentID, &p.SortOrder, &p.IsDeleted, &p.DeletedAt, &p.IsPinned)
		actual = presentRecord(p)
	case "tag":
		var p TagPayload
		err = tx.QueryRowContext(ctx, `SELECT id,name,color FROM tags WHERE id=?`, strings.TrimPrefix(chosen.ID, "tag:")).Scan(&p.ID, &p.Name, &p.Color)
		actual = presentTagRecord(p)
	case "file-tag":
		var fileID, tagID string
		if chosen.FileTag != nil {
			fileID, tagID = chosen.FileTag.FileID, chosen.FileTag.TagID
		} else {
			// Preserve the existing tombstone decoder; present payload IDs may
			// themselves contain colons and must not be reparsed from the key.
			parts := strings.Split(strings.TrimPrefix(chosen.ID, "filetag:"), ":")
			if len(parts) != 2 {
				return fmt.Errorf("标签关联冲突键无效")
			}
			fileID, tagID = parts[0], parts[1]
		}
		var p FileTagPayload
		err = tx.QueryRowContext(ctx, `SELECT file_id,tag_id FROM file_tags WHERE file_id=? AND tag_id=?`, fileID, tagID).Scan(&p.FileID, &p.TagID)
		actual = presentFileTagRecord(p)
	default:
		return fmt.Errorf("不支持核对该数据库冲突类型")
	}
	if errors.Is(err, sql.ErrNoRows) && chosen.State == "purged" {
		return verifyResolutionPurge(ctx, tx, chosen)
	}
	if err != nil {
		return fmt.Errorf("核对所选版本的实际保存结果失败: %w", err)
	}
	if chosen.State == "purged" {
		return fmt.Errorf("所选删除状态尚未实际应用，未提交本机事务")
	}
	expectedHash, err := recordHash(chosen)
	if err != nil {
		return err
	}
	actualHash, err := recordHash(actual)
	if err != nil {
		return err
	}
	if actualHash != expectedHash {
		return fmt.Errorf("实际保存的内容与所选版本不一致，未提交本机事务")
	}
	return nil
}

// Verify only the established applyRemoteTx purge rules; do not introduce a
// new cascade, remove unrelated history or silently repair the workspace.
func verifyResolutionPurge(ctx context.Context, tx *sql.Tx, chosen Record) error {
	var count int
	var err error
	switch chosen.Kind {
	case "file":
		err = tx.QueryRowContext(ctx, `SELECT
			(SELECT COUNT(*) FROM file_tags WHERE file_id=?) +
			(SELECT COUNT(*) FROM file_versions WHERE file_id=?) +
			(SELECT COUNT(*) FROM links WHERE source_id=? OR target_id=?)`,
			chosen.ID, chosen.ID, chosen.ID, chosen.ID).Scan(&count)
	case "tag":
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM file_tags WHERE tag_id=?`, strings.TrimPrefix(chosen.ID, "tag:")).Scan(&count)
	case "file-tag":
		return nil // The relationship row itself has already been verified absent.
	default:
		return fmt.Errorf("不支持核对该删除类型")
	}
	if err != nil {
		return fmt.Errorf("核对删除后的关联记录失败: %w", err)
	}
	if count != 0 {
		return fmt.Errorf("删除后的关联记录未完整更新，未提交本机事务")
	}
	return nil
}
