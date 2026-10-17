package dao

import (
	"context"
	"database/sql"
	"fmt"
	"notepad-server/internal/model"
	"time"

	"github.com/google/uuid"
)

func ValidDailyDate(date string) bool {
	if len(date) != 10 || date[4] != '-' || date[7] != '-' {
		return false
	}
	d, err := time.Parse("2006-01-02", date)
	return err == nil && d.Year() > 0 && d.Format("2006-01-02") == date
}

// Matches the installed Lexical empty paragraph serializer; the paired JS test
// rejects any change in this contract. Existing bodies are never rewritten.
const dailyInitialContent = `{"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}`

const dailyInsertSQL = `INSERT INTO files
 (id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned)
 SELECT ?, ?, ?, ?, ?, 0, '', COALESCE((SELECT MAX(sort_order) FROM files WHERE parent_id = '' AND is_deleted = 0), 0) + 1000, 0, 0, 0
 WHERE NOT EXISTS (SELECT 1 FROM files WHERE parent_id = '' AND title = ? AND is_deleted = 0)`

const dailySelectSQL = `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
 FROM files WHERE parent_id = '' AND title = ? AND is_deleted = 0 ORDER BY id LIMIT 2`

type dailyQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readDaily(ctx context.Context, db dailyQuerier, date string) (*model.File, error) {
	rows, err := db.QueryContext(ctx, dailySelectSQL, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result *model.File
	for rows.Next() {
		var file model.File
		if err := rows.Scan(&file.ID, &file.Title, &file.Content, &file.CreatedAt, &file.UpdatedAt,
			&file.IsFolder, &file.ParentID, &file.SortOrder, &file.IsDeleted, &file.DeletedAt, &file.IsPinned); err != nil {
			return nil, err
		}
		if result != nil || file.IsFolder {
			return nil, fmt.Errorf("该日期存在同名文件夹或多份记录，请先在笔记列表处理，未覆盖任何内容")
		}
		result = &file
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// The predicate and insertion are one SQL statement; daily requests cannot
// both pass a separate check-then-create gap. Existing bodies are not updated.
func (d *FileDAO) OpenDaily(ctx context.Context, date string, readOnly bool) (*model.File, bool, error) {
	if !ValidDailyDate(date) {
		return nil, false, fmt.Errorf("每日笔记日期无效，需使用真实的 YYYY-MM-DD 日期")
	}
	if readOnly {
		file, err := readDaily(ctx, d.DB, date)
		return file, false, err
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	result, err := tx.ExecContext(ctx, dailyInsertSQL, uuid.NewString(), date, dailyInitialContent, now, now, date)
	if err != nil {
		return nil, false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return nil, false, err
	}
	file, err := readDaily(ctx, tx, date)
	if err != nil {
		return nil, false, err
	}
	if file == nil {
		return nil, false, fmt.Errorf("每日笔记创建结果未确认")
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return file, count == 1, nil
}
