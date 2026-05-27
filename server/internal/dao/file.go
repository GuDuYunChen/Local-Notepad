package dao

import (
	"context"
	"database/sql"
	"fmt"
	"notepad-server/internal/model"
	"strings"
	"time"
)

type FileDAO struct {
	DB *sql.DB
}

func (d *FileDAO) Create(ctx context.Context, f *model.File) error {
	now := time.Now().Unix()
	_, err := d.DB.ExecContext(ctx,
		`INSERT INTO files (id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, is_pinned) 
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
		f.ID, f.Title, f.Content, now, now, f.IsFolder, f.ParentID, f.SortOrder)
	return err
}

func (d *FileDAO) GetByID(ctx context.Context, id string) (*model.File, error) {
	var f model.File
	row := d.DB.QueryRowContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned 
		 FROM files WHERE id = ? AND is_deleted = 0`, id)
	if err := row.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
		return nil, err
	}
	return &f, nil
}

func (d *FileDAO) Update(ctx context.Context, f *model.File) error {
	f.UpdatedAt = time.Now().Unix()
	_, err := d.DB.ExecContext(ctx,
		`UPDATE files SET title = ?, content = ?, parent_id = ?, sort_order = ?, is_deleted = ?, is_pinned = ?, updated_at = ? WHERE id = ?`,
		f.Title, f.Content, f.ParentID, f.SortOrder, f.IsDeleted, f.IsPinned, f.UpdatedAt, f.ID)
	return err
}

func (d *FileDAO) DeleteRecursive(ctx context.Context, id string) error {
	now := time.Now().Unix()
	query := `
	WITH RECURSIVE sub(id) AS (
		SELECT id FROM files WHERE id = ?
		UNION ALL
		SELECT f.id FROM files f JOIN sub ON f.parent_id = sub.id WHERE f.parent_id != f.id
	)
	UPDATE files SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id IN sub;`
	_, err := d.DB.ExecContext(ctx, query, id, now, now)
	return err
}

func (d *FileDAO) RestoreRecursive(ctx context.Context, id string) error {
	query := `
	WITH RECURSIVE sub(id) AS (
		SELECT id FROM files WHERE id = ?
		UNION ALL
		SELECT f.id FROM files f JOIN sub ON f.parent_id = sub.id WHERE f.parent_id != f.id
	)
	UPDATE files SET is_deleted = 0, deleted_at = 0, updated_at = ? WHERE id IN sub;`
	_, err := d.DB.ExecContext(ctx, query, id, time.Now().Unix())
	return err
}

func (d *FileDAO) BatchDeleteRecursive(ctx context.Context, ids []string) error {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx failed: %w", err)
	}
	defer tx.Rollback()

	query := `
	WITH RECURSIVE sub(id) AS (
		SELECT id FROM files WHERE id = ?
		UNION ALL
		SELECT f.id FROM files f JOIN sub ON f.parent_id = sub.id WHERE f.parent_id != f.id
	)
	UPDATE files SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id IN sub;`

	now := time.Now().Unix()
	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return fmt.Errorf("prepare stmt failed: %w", err)
	}
	defer stmt.Close()

	for _, id := range ids {
		if _, err := stmt.ExecContext(ctx, id, now, now); err != nil {
			return fmt.Errorf("delete id %s failed: %w", id, err)
		}
	}

	return tx.Commit()
}

func (d *FileDAO) List(ctx context.Context, q string, page, size int) ([]*model.File, error) {
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	offset := (page - 1) * size

	var query string
	var args []interface{}

	if q != "" {
		query = `SELECT f.id, f.title, f.content, f.created_at, f.updated_at, f.is_folder, f.parent_id, f.sort_order, f.is_deleted, f.deleted_at, f.is_pinned 
			FROM files f
			INNER JOIN files_fts ft ON f.rowid = ft.rowid
			WHERE f.is_deleted = 0 AND files_fts MATCH ?
			ORDER BY f.is_pinned DESC, f.sort_order DESC LIMIT ? OFFSET ?`
		args = []interface{}{escapeFTS5Query(q), size, offset}
	} else {
		query = `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned 
			FROM files WHERE is_deleted = 0 
			ORDER BY is_pinned DESC, sort_order DESC LIMIT ? OFFSET ?`
		args = []interface{}{size, offset}
	}

	rows, err := d.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*model.File
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			return nil, err
		}
		out = append(out, &f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (d *FileDAO) CheckDuplicate(ctx context.Context, parentID, title, excludeID string) (bool, error) {
	var count int
	var err error
	if excludeID != "" {
		err = d.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE parent_id = ? AND title = ? AND id != ? AND is_deleted = 0", parentID, title, excludeID).Scan(&count)
	} else {
		err = d.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE parent_id = ? AND title = ? AND is_deleted = 0", parentID, title).Scan(&count)
	}
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (d *FileDAO) GetChildren(ctx context.Context, parentID string) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned 
		 FROM files WHERE parent_id = ? AND is_deleted = 0`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*model.File
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			return nil, err
		}
		out = append(out, &f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (d *FileDAO) CleanupOldDeleted(ctx context.Context, threshold int64) error {
	_, err := d.DB.ExecContext(ctx, `DELETE FROM files WHERE is_deleted = 1 AND deleted_at < ?`, threshold)
	return err
}

func escapeFTS5Query(q string) string {
	escaped := strings.ReplaceAll(q, `"`, `""`)
	escaped = strings.ReplaceAll(escaped, `*`, ``)
	escaped = strings.ReplaceAll(escaped, `(`, ``)
	escaped = strings.ReplaceAll(escaped, `)`, ``)
	escaped = strings.ReplaceAll(escaped, `?`, ``)
	return `"` + escaped + `"`
}
