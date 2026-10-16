package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"notepad-server/internal/model"
	"strings"
	"unicode/utf8"
)

const LocalPinLimit = 2000
const localPinBytes = 2 * 1024 * 1024

type LocalPinItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	IsFolder  bool   `json:"is_folder"`
	IsPinned  bool   `json:"is_pinned"`
	UpdatedAt int64  `json:"updated_at"`
}
type LocalPinSnapshot struct {
	Scope    string         `json:"scope"`
	Complete bool           `json:"complete"`
	Items    []LocalPinItem `json:"items"`
}
type LocalPinChange struct {
	Title    string `json:"title"`
	IsFolder *bool  `json:"is_folder"`
	Expected *bool  `json:"expected_pinned"`
	Pinned   *bool  `json:"pinned"`
}

func validPinItem(item LocalPinItem) bool {
	return localGraphIdentity(item.ID) && utf8.ValidString(item.Title) && len(item.Title) <= 16384 && !strings.HasPrefix(item.Title, TemplatePrefix) && item.UpdatedAt >= 0
}
func pinItem(ctx context.Context, tx *sql.Tx, id string) (LocalPinItem, error) {
	var item LocalPinItem
	if !localGraphIdentity(id) {
		return item, errors.New("置顶目标身份无效")
	}
	err := tx.QueryRowContext(ctx, `SELECT id,title,is_folder,is_pinned,updated_at FROM files WHERE id=? AND is_deleted=0`, id).Scan(&item.ID, &item.Title, &item.IsFolder, &item.IsPinned, &item.UpdatedAt)
	if err != nil {
		return LocalPinItem{}, errors.New("目标不存在或已移入回收站")
	}
	if !validPinItem(item) {
		return LocalPinItem{}, errors.New("置顶目标元数据无效，模板不能置顶")
	}
	return item, nil
}
func (d *FileDAO) LocalPins(ctx context.Context) (*LocalPinSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := &LocalPinSnapshot{Scope: "active-note-pins-v1", Items: make([]LocalPinItem, 0)}
	rows, err := tx.QueryContext(ctx, `SELECT id,title,is_folder,is_pinned,updated_at FROM files WHERE is_folder=0 AND is_deleted=0 AND substr(title,1,7)<>? ORDER BY id LIMIT ?`, TemplatePrefix, LocalPinLimit+1)
	if err != nil {
		return nil, err
	}
	size := 0
	for rows.Next() {
		var item LocalPinItem
		if err = rows.Scan(&item.ID, &item.Title, &item.IsFolder, &item.IsPinned, &item.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		size += len(item.ID) + len(item.Title) + 80
		if !validPinItem(item) || item.IsFolder {
			rows.Close()
			return nil, errors.New("置顶笔记元数据无效")
		}
		if len(out.Items) >= LocalPinLimit || size > localPinBytes {
			rows.Close()
			return nil, errors.New("笔记库超过2000篇或2MiB完整读取上限，未采用部分列表")
		}
		out.Items = append(out.Items, item)
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if len(encoded) > localPinBytes {
		return nil, errors.New("笔记库元数据超过2MiB完整读取上限")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out.Complete = true
	return out, nil
}
func (d *FileDAO) LocalPin(ctx context.Context, id string) (LocalPinItem, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return LocalPinItem{}, err
	}
	defer tx.Rollback()
	item, err := pinItem(ctx, tx, id)
	if err != nil {
		return LocalPinItem{}, err
	}
	if err = tx.Commit(); err != nil {
		return LocalPinItem{}, err
	}
	return item, nil
}

// Reserve the write before reading and change only the pin column. Never write
// an old File struct (body/title/parent/revision) back to SQLite for a pin action.
func (d *FileDAO) ChangeLocalPin(ctx context.Context, id string, in LocalPinChange) (LocalPinItem, error) {
	if in.Expected == nil || in.Pinned == nil || in.IsFolder == nil || *in.Expected == *in.Pinned {
		return LocalPinItem{}, errors.New("必须提供确认时的置顶状态与不同的目标状态")
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return LocalPinItem{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE files SET is_pinned=is_pinned WHERE 0`); err != nil {
		return LocalPinItem{}, err
	}
	item, err := pinItem(ctx, tx, id)
	if err != nil {
		return LocalPinItem{}, err
	}
	if item.Title != in.Title || item.IsFolder != *in.IsFolder || item.IsPinned != *in.Expected {
		return LocalPinItem{}, errors.New("笔记身份或置顶状态已变化，请先核对当前状态")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE files SET is_pinned=? WHERE id=?`, *in.Pinned, id); err != nil {
		return LocalPinItem{}, err
	}
	item.IsPinned = *in.Pinned
	if err = ctx.Err(); err != nil {
		return LocalPinItem{}, err
	}
	if err = tx.Commit(); err != nil {
		return LocalPinItem{}, err
	}
	return item, nil
}

// Compatibility for the old pin-only endpoint. It keeps its File response and
// folder support, but no longer rewrites any unrelated column or edited time.
func (d *FileDAO) SetLegacyPin(ctx context.Context, id string, pinned bool) (*model.File, error) {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE files SET is_pinned=is_pinned WHERE 0`); err != nil {
		return nil, err
	}
	if _, err = pinItem(ctx, tx, id); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE files SET is_pinned=? WHERE id=?`, pinned, id); err != nil {
		return nil, err
	}
	var f model.File
	err = tx.QueryRowContext(ctx, `SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files WHERE id=?`, id).Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &f, nil
}
