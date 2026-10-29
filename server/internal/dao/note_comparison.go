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
	"unicode"
	"unicode/utf8"
)

const ComparisonBodyLimit = 512 * 1024

type ComparisonNote struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	ParentID     string `json:"parent_id"`
	Folder       string `json:"folder"`
	UpdatedAt    int64  `json:"updated_at"`
	Content      string `json:"content"`
	ContentHash  string `json:"content_hash"`
	ContentBytes int    `json:"content_bytes"`
}
type NoteComparison struct {
	Version    int               `json:"version"`
	Complete   bool              `json:"complete"`
	CapturedAt int64             `json:"captured_at"`
	Revision   string            `json:"revision"`
	Notes      [2]ComparisonNote `json:"notes"`
	RawEqual   bool              `json:"raw_equal"`
}

func comparisonID(id string) bool {
	return id != "" && len(id) <= 128 && utf8.ValidString(id) && strings.TrimSpace(id) == id && strings.IndexFunc(id, unicode.IsControl) < 0
}

// Observe exactly two ordinary saved notes in ONE read transaction. This does
// not restore, merge, normalize or write either note, its tags or its history.
func (d *FileDAO) CompareNotes(ctx context.Context, left, right string) (*NoteComparison, error) {
	if !comparisonID(left) || !comparisonID(right) || left == right {
		return nil, fmt.Errorf("请选择两篇不同的普通笔记")
	}
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := &NoteComparison{Version: 1, CapturedAt: time.Now().UTC().Unix()}
	for i, id := range []string{left, right} {
		n := &out.Notes[i]
		var folder, deleted bool
		var size sql.NullInt64
		err = tx.QueryRowContext(ctx, `SELECT id,title,parent_id,updated_at,is_folder,is_deleted,length(CAST(content AS BLOB)) FROM files WHERE id=?`, id).Scan(&n.ID, &n.Title, &n.ParentID, &n.UpdatedAt, &folder, &deleted, &size)
		if err != nil {
			return nil, fmt.Errorf("比较来源不可用: %w", err)
		}
		if n.ID != id || folder || deleted || strings.HasPrefix(n.Title, TemplatePrefix) || !utf8.ValidString(n.Title) || len(n.Title) > 4000 || (n.ParentID != "" && !comparisonID(n.ParentID)) || n.UpdatedAt < 0 || n.UpdatedAt > 253402300799 {
			return nil, fmt.Errorf("比较来源不是有效的普通笔记")
		}
		if !size.Valid || size.Int64 < 0 || size.Int64 > ComparisonBodyLimit {
			return nil, fmt.Errorf("每篇保存正文上限512KiB，未返回截断内容")
		}
		if err = tx.QueryRowContext(ctx, `SELECT content FROM files WHERE id=?`, id).Scan(&n.Content); err != nil {
			return nil, err
		}
		if !utf8.ValidString(n.Content) || int64(len(n.Content)) != size.Int64 {
			return nil, fmt.Errorf("正文编码或长度无效")
		}
		n.ContentBytes = len(n.Content)
		digest := sha256.Sum256([]byte(n.Content))
		n.ContentHash = hex.EncodeToString(digest[:])
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
	}
	raw, err := json.Marshal(out.Notes)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	out.Revision = hex.EncodeToString(digest[:])
	out.RawEqual = out.Notes[0].Content == out.Notes[1].Content
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out.Complete = true
	return out, nil
}
