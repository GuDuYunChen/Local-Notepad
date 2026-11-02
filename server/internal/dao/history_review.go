package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const HistoryReviewLimit = 500

type HistoryReviewVersion struct {
	ID           int64  `json:"id"`
	FileID       string `json:"file_id"`
	Title        string `json:"title"`
	CreatedAt    int64  `json:"created_at"`
	ContentBytes int64  `json:"content_bytes"`
}
type HistoryReviewBody struct {
	HistoryReviewVersion
	Content     string `json:"content"`
	ContentHash string `json:"content_hash"`
}
type HistoryReview struct {
	Version    int                    `json:"version"`
	Complete   bool                   `json:"complete"`
	CapturedAt int64                  `json:"captured_at"`
	Revision   string                 `json:"revision"`
	Current    ComparisonNote         `json:"current"`
	Versions   []HistoryReviewVersion `json:"versions"`
	Selected   *HistoryReviewBody     `json:"selected"`
	Total      int                    `json:"total"`
}

// Current saved body, the COMPLETE retained history index and the selected
// historical body belong to one SQLite read transaction. No restoration,
// pruning, schema change or note-body write is performed here.
func (d *FileDAO) ReadHistoryReview(ctx context.Context, fileID string, versionID int64) (*HistoryReview, error) {
	if !comparisonID(fileID) || versionID < 0 {
		return nil, fmt.Errorf("请选择有效的普通笔记与历史快照")
	}
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := &HistoryReview{Version: 1, CapturedAt: time.Now().UTC().Unix(), Versions: make([]HistoryReviewVersion, 0)}
	n := &out.Current
	var folder, deleted bool
	var size sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT id,title,parent_id,updated_at,is_folder,is_deleted,length(CAST(content AS BLOB)) FROM files WHERE id=?`, fileID).Scan(&n.ID, &n.Title, &n.ParentID, &n.UpdatedAt, &folder, &deleted, &size)
	if err != nil {
		return nil, fmt.Errorf("历史来源不可用")
	}
	if folder || deleted || strings.HasPrefix(n.Title, TemplatePrefix) || !utf8.ValidString(n.Title) || len(n.Title) > 4000 || (n.ParentID != "" && !comparisonID(n.ParentID)) || n.UpdatedAt < 0 || n.UpdatedAt > 253402300799 {
		return nil, fmt.Errorf("仅允许查看当前普通笔记的历史")
	}
	if !size.Valid || size.Int64 < 0 || size.Int64 > ComparisonBodyLimit {
		return nil, fmt.Errorf("当前保存正文超过512KiB预算或不可读取，未返回截断内容")
	}
	if err = tx.QueryRowContext(ctx, `SELECT content FROM files WHERE id=?`, fileID).Scan(&n.Content); err != nil {
		return nil, err
	}
	if !utf8.ValidString(n.Content) || int64(len(n.Content)) != size.Int64 {
		return nil, fmt.Errorf("当前正文编码无效")
	}
	n.ContentBytes = len(n.Content)
	sum := sha256.Sum256([]byte(n.Content))
	n.ContentHash = hex.EncodeToString(sum[:])
	n.Folder = "根目录"
	if n.ParentID != "" {
		var title string
		var isFolder, isDeleted bool
		e := tx.QueryRowContext(ctx, `SELECT title,is_folder,is_deleted FROM files WHERE id=?`, n.ParentID).Scan(&title, &isFolder, &isDeleted)
		if e != nil && e != sql.ErrNoRows {
			return nil, e
		}
		n.Folder = "位置不可用"
		if e == nil && isFolder && !isDeleted && !strings.HasPrefix(title, TemplatePrefix) {
			if !utf8.ValidString(title) || len(title) > 4000 {
				return nil, fmt.Errorf("目录名称无效")
			}
			n.Folder = title
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,file_id,title,created_at,length(CAST(content AS BLOB)) FROM file_versions WHERE file_id=? ORDER BY created_at DESC,id DESC LIMIT ?`, fileID, HistoryReviewLimit+1)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v HistoryReviewVersion
		if err = rows.Scan(&v.ID, &v.FileID, &v.Title, &v.CreatedAt, &v.ContentBytes); err != nil {
			rows.Close()
			return nil, fmt.Errorf("历史索引字段无效")
		}
		if v.ID <= 0 || v.ID > 9007199254740991 || v.FileID != fileID || !utf8.ValidString(v.Title) || len(v.Title) > 4000 || v.CreatedAt < 0 || v.CreatedAt > 253402300799 || v.ContentBytes < 0 || v.ContentBytes > 9007199254740991 {
			rows.Close()
			return nil, fmt.Errorf("历史索引字段无效")
		}
		out.Versions = append(out.Versions, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(out.Versions) > HistoryReviewLimit {
		return nil, fmt.Errorf("保留快照超过500份，未返回部分索引")
	}
	out.Total = len(out.Versions)
	if versionID != 0 {
		var selected *HistoryReviewVersion
		for i := range out.Versions {
			if out.Versions[i].ID == versionID {
				selected = &out.Versions[i]
				break
			}
		}
		if selected == nil {
			return nil, fmt.Errorf("所选快照不存在、已清理或不属于该笔记")
		}
		if selected.ContentBytes > ComparisonBodyLimit {
			return nil, fmt.Errorf("所选历史正文超过512KiB预算，未返回截断内容")
		}
		out.Selected = &HistoryReviewBody{HistoryReviewVersion: *selected}
		if err = tx.QueryRowContext(ctx, `SELECT content FROM file_versions WHERE id=? AND file_id=?`, versionID, fileID).Scan(&out.Selected.Content); err != nil {
			return nil, err
		}
		if !utf8.ValidString(out.Selected.Content) || int64(len(out.Selected.Content)) != selected.ContentBytes {
			return nil, fmt.Errorf("历史正文编码无效")
		}
		sum = sha256.Sum256([]byte(out.Selected.Content))
		out.Selected.ContentHash = hex.EncodeToString(sum[:])
	}
	encoded, err := json.Marshal(struct {
		Current  ComparisonNote
		Versions []HistoryReviewVersion
		Selected *HistoryReviewBody
	}{out.Current, out.Versions, out.Selected})
	if err != nil {
		return nil, err
	}
	sum = sha256.Sum256(encoded)
	out.Revision = hex.EncodeToString(sum[:])
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out.Complete = true
	return out, nil
}
