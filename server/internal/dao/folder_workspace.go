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

const FolderWorkspaceLimit = 20000
const folderMetadataLimit = 2 * 1024 * 1024
const folderOrderLimit int64 = 9007199254740000

type FolderWorkspaceItem struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	ParentID       string `json:"parent_id"`
	IsFolder       bool   `json:"is_folder"`
	SortOrder      int64  `json:"sort_order"`
	UpdatedAt      int64  `json:"updated_at"`
	HiddenChildren int    `json:"hidden_children"`
}
type FolderWorkspaceSnapshot struct {
	Version     int                   `json:"version"`
	Complete    bool                  `json:"complete"`
	Revision    string                `json:"revision"`
	HiddenCount int                   `json:"hidden_count"`
	Items       []FolderWorkspaceItem `json:"items"`
}
type folderWorkspaceRow struct {
	ID, Title, ParentID  string
	IsFolder, IsDeleted  bool
	SortOrder, UpdatedAt int64
}
type FolderWorkspaceChange struct {
	RequestID        string   `json:"request_id"`
	ExpectedRevision string   `json:"expected_revision"`
	Kind             string   `json:"kind"`
	IDs              []string `json:"ids"`
	ParentID         string   `json:"parent_id"`
	Name             string   `json:"name"`
}
type FolderWorkspaceResult struct {
	RequestID      string                   `json:"request_id"`
	BeforeRevision string                   `json:"before_revision"`
	Kind           string                   `json:"kind"`
	AppliedIDs     []string                 `json:"applied_ids"`
	Snapshot       *FolderWorkspaceSnapshot `json:"snapshot"`
}

func folderVisible(r folderWorkspaceRow) bool {
	return !r.IsDeleted && !strings.HasPrefix(r.Title, TemplatePrefix)
}
func folderID(id string) bool {
	return len(id) > 0 && len(id) <= 128 && utf8.ValidString(id) && strings.TrimSpace(id) == id && !strings.ContainsAny(id, "\x00\r\n\t") && !strings.ContainsFunc(id, func(r rune) bool { return r < 32 || r == 127 })
}
func folderName(name string) bool {
	return utf8.ValidString(name) && strings.TrimSpace(name) == name && len(name) > 0 && utf8.RuneCountInString(name) <= 255 && name != "." && name != ".." && !strings.HasPrefix(name, TemplatePrefix) && !strings.ContainsAny(name, "<>:\"/\\|?*") && !strings.ContainsFunc(name, func(r rune) bool { return r < 32 || r == 127 })
}

// SQLite NOCASE folds ASCII only; use the same equality for batch collision checks.
func folderFold(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return r
	}, s)
}
func folderSnapshotInTx(ctx context.Context, tx *sql.Tx) (*FolderWorkspaceSnapshot, []folderWorkspaceRow, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,title,COALESCE(parent_id,''),is_folder,is_deleted,COALESCE(sort_order,0),updated_at FROM files ORDER BY id LIMIT 20001`)
	if err != nil {
		return nil, nil, err
	}
	all := make([]folderWorkspaceRow, 0)
	byID := map[string]folderWorkspaceRow{}
	size := 0
	for rows.Next() {
		var r folderWorkspaceRow
		if err = rows.Scan(&r.ID, &r.Title, &r.ParentID, &r.IsFolder, &r.IsDeleted, &r.SortOrder, &r.UpdatedAt); err != nil {
			rows.Close()
			return nil, nil, err
		}
		size += len(r.ID) + len(r.Title) + len(r.ParentID)
		if !folderID(r.ID) || (r.ParentID != "" && !folderID(r.ParentID)) || !utf8.ValidString(r.Title) || len(r.Title) > 4000 || r.SortOrder < -folderOrderLimit || r.SortOrder > folderOrderLimit || r.UpdatedAt < 0 || r.UpdatedAt > 9007199254740991 || size > folderMetadataLimit {
			rows.Close()
			return nil, nil, fmt.Errorf("目录元数据无效或超过完整核对上限，未采用部分结果")
		}
		if _, exists := byID[r.ID]; exists {
			rows.Close()
			return nil, nil, fmt.Errorf("目录身份重复")
		}
		all = append(all, r)
		byID[r.ID] = r
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, nil, err
	}
	if len(all) > FolderWorkspaceLimit {
		return nil, nil, fmt.Errorf("资料库超过20000项，未采用部分目录")
	}
	// Validate the visible forest without recursion. Hidden/trash rows remain in
	// the revision and direct-child counts, so deleting a folder cannot orphan them.
	done := map[string]bool{}
	for _, r := range all {
		if !folderVisible(r) {
			continue
		}
		chain := []string{}
		visiting := map[string]bool{}
		id := r.ID
		for id != "" && !done[id] {
			if visiting[id] {
				return nil, nil, fmt.Errorf("目录存在循环，请先通过原资料恢复流程处理")
			}
			visiting[id] = true
			chain = append(chain, id)
			node, ok := byID[id]
			if !ok || !folderVisible(node) {
				return nil, nil, fmt.Errorf("普通资料的父目录缺失或已隐藏，未允许修改")
			}
			if node.ParentID != "" {
				p, ok := byID[node.ParentID]
				if !ok || !p.IsFolder || !folderVisible(p) {
					return nil, nil, fmt.Errorf("父目录缺失、不是文件夹或已隐藏")
				}
			}
			id = node.ParentID
		}
		for _, id := range chain {
			done[id] = true
		}
	}
	out := &FolderWorkspaceSnapshot{Version: 1, Complete: true, Items: make([]FolderWorkspaceItem, 0)}
	hidden := map[string]int{}
	for _, r := range all {
		if !folderVisible(r) {
			out.HiddenCount++
			hidden[r.ParentID]++
		}
	}
	for _, r := range all {
		if folderVisible(r) {
			out.Items = append(out.Items, FolderWorkspaceItem{ID: r.ID, Title: r.Title, ParentID: r.ParentID, IsFolder: r.IsFolder, SortOrder: r.SortOrder, UpdatedAt: r.UpdatedAt, HiddenChildren: hidden[r.ID]})
		}
	}
	raw, err := json.Marshal(all)
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.Sum256(raw)
	out.Revision = hex.EncodeToString(digest[:])
	return out, all, nil
}
func (d *FileDAO) FolderWorkspace(ctx context.Context) (*FolderWorkspaceSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out, _, err := folderSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
func (d *FileDAO) ChangeFolderWorkspace(ctx context.Context, in FolderWorkspaceChange) (*FolderWorkspaceResult, error) {
	if _, err := uuid.Parse(in.RequestID); err != nil {
		return nil, fmt.Errorf("操作身份无效")
	}
	if !tagWorkspaceRevision.MatchString(in.ExpectedRevision) || len(in.IDs) == 0 || len(in.IDs) > 100 || (in.ParentID != "" && !folderID(in.ParentID)) {
		return nil, fmt.Errorf("目录操作范围或确认版本无效")
	}
	selected := map[string]bool{}
	for _, id := range in.IDs {
		if !folderID(id) || selected[id] {
			return nil, fmt.Errorf("重复或无效的目录身份")
		}
		selected[id] = true
	}
	switch in.Kind {
	case "create":
		if len(in.IDs) != 1 || !folderName(in.Name) {
			return nil, fmt.Errorf("新建文件夹名称无效")
		}
		if _, err := uuid.Parse(in.IDs[0]); err != nil {
			return nil, fmt.Errorf("新文件夹身份无效")
		}
	case "rename":
		if len(in.IDs) != 1 || !folderName(in.Name) || in.ParentID != "" {
			return nil, fmt.Errorf("文件夹改名范围无效")
		}
	case "move":
		if in.Name != "" {
			return nil, fmt.Errorf("移动不能混合改名")
		}
	case "trash-empty":
		if len(in.IDs) != 1 || in.Name != "" || in.ParentID != "" {
			return nil, fmt.Errorf("仅允许单个空文件夹移到回收站")
		}
	default:
		return nil, fmt.Errorf("不支持的目录操作")
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Obtain the writer before reading the frozen metadata. All selected rows are
	// validated before the first real update. No note content is selected/written.
	if _, err = tx.ExecContext(ctx, `UPDATE files SET parent_id=parent_id WHERE 0`); err != nil {
		return nil, err
	}
	before, all, err := folderSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if before.Revision != in.ExpectedRevision {
		return nil, fmt.Errorf("目录已变化，未覆盖；请重新读取并确认")
	}
	byID := map[string]folderWorkspaceRow{}
	for _, r := range all {
		byID[r.ID] = r
	}
	if in.Kind == "create" {
		if _, ok := byID[in.IDs[0]]; ok || len(all) >= FolderWorkspaceLimit {
			return nil, fmt.Errorf("身份已存在或资料库已达到上限")
		}
	} else {
		for _, id := range in.IDs {
			r, ok := byID[id]
			if !ok || !folderVisible(r) {
				return nil, fmt.Errorf("所选资料已缺失或在模板/回收站中")
			}
			if in.Kind != "move" && !r.IsFolder {
				return nil, fmt.Errorf("这里只能修改文件夹，不改笔记标题或正文")
			}
		}
	}
	if in.Kind == "create" || in.Kind == "move" {
		if in.ParentID != "" {
			p, ok := byID[in.ParentID]
			if !ok || !p.IsFolder || !folderVisible(p) {
				return nil, fmt.Errorf("目标必须是现存普通文件夹或根目录")
			}
		}
	}
	if in.Kind == "move" {
		for _, id := range in.IDs {
			r := byID[id]
			if r.ParentID == in.ParentID {
				return nil, fmt.Errorf("所选项目已在目标目录，未执行空操作")
			}
			for p := r.ParentID; p != ""; p = byID[p].ParentID {
				if selected[p] {
					return nil, fmt.Errorf("不能同时移动祖先与其内部项目")
				}
			}
		}
		for p := in.ParentID; p != ""; p = byID[p].ParentID {
			if selected[p] {
				return nil, fmt.Errorf("不能移动到自己或自己的子目录")
			}
		}
	}
	if in.Kind == "trash-empty" {
		for _, r := range all {
			if r.ParentID == in.IDs[0] {
				return nil, fmt.Errorf("文件夹含普通、模板或回收站子项，不能删除；请先整理")
			}
		}
	}
	if in.Kind == "rename" && byID[in.IDs[0]].Title == in.Name {
		return nil, fmt.Errorf("名称没有变化")
	}
	if in.Kind != "trash-empty" {
		parent := in.ParentID
		if in.Kind == "rename" {
			parent = byID[in.IDs[0]].ParentID
		}
		names := map[string]bool{}
		for _, r := range all {
			if !r.IsDeleted && r.ParentID == parent && !selected[r.ID] {
				names[folderFold(r.Title)] = true
			}
		}
		for _, id := range in.IDs {
			name := in.Name
			if in.Kind == "move" {
				name = byID[id].Title
			}
			fold := folderFold(name)
			if names[fold] {
				return nil, fmt.Errorf("目标目录有同名项目或所选项目互相重名，不会覆盖或合并")
			}
			names[fold] = true
		}
	}
	now := time.Now().Unix()
	order := int64(0)
	if in.Kind == "create" || in.Kind == "move" {
		for _, r := range all {
			if !r.IsDeleted && r.ParentID == in.ParentID && r.SortOrder > order {
				order = r.SortOrder
			}
		}
		if order > folderOrderLimit-int64(len(in.IDs))*1000 {
			return nil, fmt.Errorf("目标目录排序超出安全范围")
		}
	}
	for _, id := range in.IDs {
		var result sql.Result
		switch in.Kind {
		case "create":
			order += 1000
			result, err = tx.ExecContext(ctx, `INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned) VALUES(?,?,'',?,?,1,?,?,0,0,0)`, id, in.Name, now, now, in.ParentID, order)
		case "rename":
			result, err = tx.ExecContext(ctx, `UPDATE files SET title=?,updated_at=? WHERE id=?`, in.Name, now, id)
		case "move":
			order += 1000
			result, err = tx.ExecContext(ctx, `UPDATE files SET parent_id=?,sort_order=?,updated_at=? WHERE id=?`, in.ParentID, order, now, id)
		case "trash-empty":
			result, err = tx.ExecContext(ctx, `UPDATE files SET is_deleted=1,deleted_at=?,updated_at=? WHERE id=?`, now, now, id)
		}
		if err != nil {
			return nil, err
		}
		n, e := result.RowsAffected()
		if e != nil || n != 1 {
			return nil, fmt.Errorf("目录修改未能逐项确认")
		}
	}
	after, _, err := folderSnapshotInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &FolderWorkspaceResult{RequestID: in.RequestID, BeforeRevision: in.ExpectedRevision, Kind: in.Kind, AppliedIDs: in.IDs, Snapshot: after}, nil
}
