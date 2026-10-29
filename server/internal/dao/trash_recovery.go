package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Recovery is metadata-only. Bodies, tags, histories and save receipts never
// enter the snapshot or UPDATE. Limits are refusal limits, not truncation.
const TrashRecoveryLimit = 20000
const TrashRecoveryBatchLimit = 1000

type TrashRecoveryItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	ParentID  string `json:"parent_id"`
	IsFolder  bool   `json:"is_folder"`
	IsDeleted bool   `json:"is_deleted"`
	SortOrder int64  `json:"sort_order"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt int64  `json:"deleted_at"`
}
type TrashRecoverySnapshot struct {
	Version  int                 `json:"version"`
	Complete bool                `json:"complete"`
	Revision string              `json:"revision"`
	Items    []TrashRecoveryItem `json:"items"`
}
type TrashRecoveryChange struct {
	RequestID        string   `json:"request_id"`
	ExpectedRevision string   `json:"expected_revision"`
	IDs              []string `json:"ids"`
	Mode             string   `json:"mode"`
	ParentID         string   `json:"parent_id"`
}
type TrashRecoveryResult struct {
	RequestID      string                 `json:"request_id"`
	BeforeRevision string                 `json:"before_revision"`
	AppliedIDs     []string               `json:"applied_ids"`
	RestoredIDs    []string               `json:"restored_ids"`
	Snapshot       *TrashRecoverySnapshot `json:"snapshot"`
}

func trashOrdinary(r TrashRecoveryItem) bool { return !strings.HasPrefix(r.Title, TemplatePrefix) }
func trashSnapshotInTx(ctx context.Context, tx *sql.Tx) (*TrashRecoverySnapshot, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,title,COALESCE(parent_id,''),is_folder,is_deleted,COALESCE(sort_order,0),updated_at,COALESCE(deleted_at,0) FROM files ORDER BY id LIMIT 20001`)
	if err != nil {
		return nil, err
	}
	out := &TrashRecoverySnapshot{Version: 1, Complete: true, Items: make([]TrashRecoveryItem, 0)}
	seen := map[string]bool{}
	size := 0
	for rows.Next() {
		var r TrashRecoveryItem
		if err = rows.Scan(&r.ID, &r.Title, &r.ParentID, &r.IsFolder, &r.IsDeleted, &r.SortOrder, &r.UpdatedAt, &r.DeletedAt); err != nil {
			rows.Close()
			return nil, err
		}
		size += len(r.ID) + len(r.Title) + len(r.ParentID)
		if !folderID(r.ID) || seen[r.ID] || (r.ParentID != "" && !folderID(r.ParentID)) || !utf8.ValidString(r.Title) || len(r.Title) > 4000 || r.SortOrder < -folderOrderLimit || r.SortOrder > folderOrderLimit || r.UpdatedAt < 0 || r.UpdatedAt > 9007199254740991 || r.DeletedAt < 0 || r.DeletedAt > 9007199254740991 || size > folderMetadataLimit {
			rows.Close()
			return nil, fmt.Errorf("恢复目录元数据无效或超过完整核对上限，未采用部分结果")
		}
		seen[r.ID] = true
		out.Items = append(out.Items, r)
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	if len(out.Items) > TrashRecoveryLimit {
		return nil, fmt.Errorf("资料库超过20000项，未采用部分结果")
	}
	raw, err := json.Marshal(out.Items)
	if err != nil {
		return nil, err
	}
	h := sha256.Sum256(raw)
	out.Revision = hex.EncodeToString(h[:])
	return out, nil
}
func (d *FileDAO) TrashRecovery(ctx context.Context) (*TrashRecoverySnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out, err := trashSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
func trashLiveTarget(byID map[string]TrashRecoveryItem, id string) error {
	seen := map[string]bool{}
	for id != "" {
		r, ok := byID[id]
		if !ok || r.IsDeleted || !r.IsFolder || !trashOrdinary(r) || seen[id] {
			return fmt.Errorf("恢复目标的父路径缺失、已删除、隐藏或存在循环，请选择现存普通目录或根目录")
		}
		seen[id] = true
		id = r.ParentID
	}
	return nil
}

// Plan under the same writer lock as the final update. A folder's complete
// descendant set is frozen by the revision; added children cannot silently join.
func planTrashRecovery(items []TrashRecoveryItem, in TrashRecoveryChange) ([]string, map[string]string, error) {
	byID := map[string]TrashRecoveryItem{}
	children := map[string][]string{}
	roots := map[string]bool{}
	for _, r := range items {
		byID[r.ID] = r
		children[r.ParentID] = append(children[r.ParentID], r.ID)
	}
	for _, id := range in.IDs {
		r, ok := byID[id]
		if !ok || !r.IsDeleted || !trashOrdinary(r) || roots[id] {
			return nil, nil, fmt.Errorf("只允许选择互不重复的普通回收站项目")
		}
		roots[id] = true
	}
	restored := map[string]bool{}
	parents := map[string]string{}
	for _, root := range in.IDs {
		target := in.ParentID
		if in.Mode == "original" {
			target = byID[root].ParentID
		}
		if err := trashLiveTarget(byID, target); err != nil {
			return nil, nil, err
		}
		parents[root] = target
		queue := []string{root}
		for len(queue) > 0 {
			id := queue[0]
			queue = queue[1:]
			r := byID[id]
			if restored[id] || (id != root && roots[id]) {
				return nil, nil, fmt.Errorf("目录存在循环或同时选择了祖先和内部项目，未执行恢复")
			}
			if !r.IsDeleted || !trashOrdinary(r) {
				return nil, nil, fmt.Errorf("所选目录含活动或模板子项，未扩大恢复范围")
			}
			restored[id] = true
			if len(restored) > TrashRecoveryBatchLimit {
				return nil, nil, fmt.Errorf("本批含超过1000个项目，请缩小恢复范围")
			}
			if len(children[id]) > 0 && !r.IsFolder {
				return nil, nil, fmt.Errorf("笔记存在不合法子项，未执行恢复")
			}
			queue = append(queue, children[id]...)
		}
	}
	// Include all active siblings, including hidden templates, in collision checks.
	names := map[string]map[string]bool{}
	add := func(parent, title string) bool {
		if names[parent] == nil {
			names[parent] = map[string]bool{}
		}
		key := folderFold(title)
		if names[parent][key] {
			return false
		}
		names[parent][key] = true
		return true
	}
	for _, r := range items {
		if !r.IsDeleted {
			add(r.ParentID, r.Title)
		}
	}
	ids := make([]string, 0, len(restored))
	for _, r := range items {
		if restored[r.ID] {
			parent := r.ParentID
			if p, ok := parents[r.ID]; ok {
				parent = p
			}
			if !add(parent, r.Title) {
				return nil, nil, fmt.Errorf("恢复位置存在同名项目，本批不会覆盖、合并或自动改名")
			}
			ids = append(ids, r.ID)
		}
	}
	return ids, parents, nil
}
func (d *FileDAO) RecoverTrash(ctx context.Context, in TrashRecoveryChange) (*TrashRecoveryResult, error) {
	if _, err := uuid.Parse(in.RequestID); err != nil {
		return nil, fmt.Errorf("恢复操作身份无效")
	}
	if !tagWorkspaceRevision.MatchString(in.ExpectedRevision) || len(in.IDs) == 0 || len(in.IDs) > 100 || (in.Mode != "original" && in.Mode != "target") || (in.Mode == "original" && in.ParentID != "") || (in.ParentID != "" && !folderID(in.ParentID)) {
		return nil, fmt.Errorf("恢复范围或版本无效")
	}
	for _, id := range in.IDs {
		if !folderID(id) {
			return nil, fmt.Errorf("恢复身份无效")
		}
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE files SET is_deleted=is_deleted WHERE 0`); err != nil {
		return nil, err
	}
	before, err := trashSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if before.Revision != in.ExpectedRevision {
		return nil, fmt.Errorf("回收站或目录已变化，未恢复；请重新读取并确认")
	}
	ids, parents, err := planTrashRecovery(before.Items, in)
	if err != nil {
		return nil, err
	}
	orders := map[string]int64{}
	if in.Mode == "target" {
		order := int64(0)
		for _, r := range before.Items {
			if !r.IsDeleted && r.ParentID == in.ParentID && r.SortOrder > order {
				order = r.SortOrder
			}
		}
		if order > folderOrderLimit-int64(len(in.IDs))*1000 {
			return nil, fmt.Errorf("恢复目标排序超过安全范围")
		}
		for _, id := range in.IDs {
			order += 1000
			orders[id] = order
		}
	}
	now := time.Now().Unix()
	for _, id := range ids {
		var result sql.Result
		if parent, isRoot := parents[id]; isRoot && in.Mode == "target" {
			result, err = tx.ExecContext(ctx, `UPDATE files SET is_deleted=0,deleted_at=0,updated_at=?,parent_id=?,sort_order=? WHERE id=? AND is_deleted=1`, now, parent, orders[id], id)
		} else {
			result, err = tx.ExecContext(ctx, `UPDATE files SET is_deleted=0,deleted_at=0,updated_at=? WHERE id=? AND is_deleted=1`, now, id)
		}
		if err != nil {
			return nil, err
		}
		n, e := result.RowsAffected()
		if e != nil || n != 1 {
			return nil, fmt.Errorf("恢复未能逐项确认")
		}
	}
	after, err := trashSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &TrashRecoveryResult{RequestID: in.RequestID, BeforeRevision: before.Revision, AppliedIDs: in.IDs, RestoredIDs: ids, Snapshot: after}, nil
}
