package dao

import (
	"context"
	"database/sql"
	"fmt"
	"notepad-server/internal/model"
	notesearch "notepad-server/internal/search"
	"strings"
	"time"
)

type FileDAO struct {
	DB          *sql.DB
	searchCache notesearch.DocumentCache
}

func (d *FileDAO) NextSortOrder(ctx context.Context, parentID string) (int64, error) {
	var maxSort sql.NullInt64
	err := d.DB.QueryRowContext(
		ctx,
		`SELECT MAX(sort_order) FROM files WHERE parent_id = ? AND is_deleted = 0`,
		parentID,
	).Scan(&maxSort)
	if err != nil {
		return 0, err
	}

	if !maxSort.Valid {
		return 1000, nil
	}
	return maxSort.Int64 + 1000, nil
}

func (d *FileDAO) Create(ctx context.Context, f *model.File) error {
	now := time.Now().Unix()
	f.CreatedAt = now
	f.UpdatedAt = now
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

func (d *FileDAO) GetByIDIncludingDeleted(ctx context.Context, id string) (*model.File, error) {
	var f model.File
	row := d.DB.QueryRowContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
		 FROM files WHERE id = ?`, id)
	if err := row.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
		return nil, err
	}
	return &f, nil
}

func (d *FileDAO) GetSubtreeIncludingDeleted(ctx context.Context, id string) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx, `
		WITH RECURSIVE sub(id) AS (
			SELECT id FROM files WHERE id = ?
			UNION
			SELECT f.id
			FROM files f
			JOIN sub ON f.parent_id = sub.id
			WHERE f.parent_id != f.id
		)
		SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
		FROM files
		WHERE id IN sub`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.File, 0)
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

func (d *FileDAO) ListTrashRoots(ctx context.Context) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx, `
		SELECT f.id, f.title, '', f.created_at, f.updated_at, f.is_folder, f.parent_id, f.sort_order, f.is_deleted, f.deleted_at, f.is_pinned
		FROM files f
		WHERE f.is_deleted = 1
		  AND NOT (f.is_folder = 0 AND substr(f.title, 1, 7) = '__tpl__')
		  AND (
			f.parent_id = ''
			OR NOT EXISTS (
				SELECT 1 FROM files parent
				WHERE parent.id = f.parent_id AND parent.is_deleted = 1
			)
		  )
		ORDER BY f.deleted_at DESC, f.updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.File, 0)
	for rows.Next() {
		var f model.File
		if err := rows.Scan(
			&f.ID,
			&f.Title,
			&f.Content,
			&f.CreatedAt,
			&f.UpdatedAt,
			&f.IsFolder,
			&f.ParentID,
			&f.SortOrder,
			&f.IsDeleted,
			&f.DeletedAt,
			&f.IsPinned,
		); err != nil {
			return nil, err
		}
		out = append(out, &f)
	}
	return out, rows.Err()
}

func (d *FileDAO) PermanentDeleteRecursive(ctx context.Context, id string) error {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin permanent delete tx failed: %w", err)
	}
	defer tx.Rollback()

	subtree := `
		WITH RECURSIVE sub(id) AS (
			SELECT id FROM files WHERE id = ? AND is_deleted = 1
			UNION
			SELECT f.id
			FROM files f
			JOIN sub ON f.parent_id = sub.id
			WHERE f.is_deleted = 1 AND f.parent_id != f.id
		)
	`

	statements := []struct {
		query string
		args  []interface{}
	}{
		{
			query: subtree + ` DELETE FROM file_tags WHERE file_id IN (SELECT id FROM sub)`,
			args:  []interface{}{id},
		},
		{
			query: subtree + ` DELETE FROM file_versions WHERE file_id IN (SELECT id FROM sub)`,
			args:  []interface{}{id},
		},
		{
			query: subtree + ` DELETE FROM links
				WHERE source_id IN (SELECT id FROM sub)
				   OR target_id IN (SELECT id FROM sub)`,
			args: []interface{}{id},
		},
		{
			query: subtree + ` DELETE FROM files WHERE id IN (SELECT id FROM sub)`,
			args:  []interface{}{id},
		},
	}

	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return fmt.Errorf("permanent delete failed: %w", err)
		}
	}

	return tx.Commit()
}

func (d *FileDAO) EmptyTrash(ctx context.Context) error {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin empty trash tx failed: %w", err)
	}
	defer tx.Rollback()

	statements := []string{
		`DELETE FROM file_tags WHERE file_id IN (SELECT id FROM files WHERE is_deleted = 1)`,
		`DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE is_deleted = 1)`,
		`DELETE FROM links
		  WHERE source_id IN (SELECT id FROM files WHERE is_deleted = 1)
		     OR target_id IN (SELECT id FROM files WHERE is_deleted = 1)`,
		`DELETE FROM files WHERE is_deleted = 1`,
	}

	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("empty trash failed: %w", err)
		}
	}

	return tx.Commit()
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
	q = strings.TrimSpace(q)
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
		likePattern := escapeLikePattern(q)
		ftsQuery := escapeFTS5Query(q)
		if ftsQuery == "" {
			query = `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
				FROM files
				WHERE is_deleted = 0
				  AND NOT (is_folder = 0 AND substr(title, 1, 7) = '__tpl__')
				  AND (title LIKE ? ESCAPE '\' OR content LIKE ? ESCAPE '\')
				ORDER BY is_pinned DESC,
				  CASE
					WHEN title LIKE ? ESCAPE '\' THEN 0
					WHEN content LIKE ? ESCAPE '\' THEN 1
					ELSE 2
				  END,
				  updated_at DESC,
				  sort_order DESC
				LIMIT ? OFFSET ?`
			args = []interface{}{likePattern, likePattern, likePattern, likePattern, size, offset}
		} else {
			query = `SELECT f.id, f.title, f.content, f.created_at, f.updated_at, f.is_folder, f.parent_id, f.sort_order, f.is_deleted, f.deleted_at, f.is_pinned
				FROM files f
				WHERE f.is_deleted = 0
				  AND NOT (f.is_folder = 0 AND substr(f.title, 1, 7) = '__tpl__')
				  AND (
					f.title LIKE ? ESCAPE '\'
					OR f.content LIKE ? ESCAPE '\'
					OR f.rowid IN (
						SELECT rowid FROM files_fts WHERE files_fts MATCH ?
					)
				  )
				ORDER BY f.is_pinned DESC,
				  CASE
					WHEN f.title LIKE ? ESCAPE '\' THEN 0
					WHEN f.content LIKE ? ESCAPE '\' THEN 1
					ELSE 2
				  END,
				  f.updated_at DESC,
				  f.sort_order DESC
				LIMIT ? OFFSET ?`
			args = []interface{}{likePattern, likePattern, ftsQuery, likePattern, likePattern, size, offset}
		}
	} else {
		query = `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned 
			FROM files
			WHERE is_deleted = 0
			  AND NOT (is_folder = 0 AND substr(title, 1, 7) = '__tpl__')
			ORDER BY is_pinned DESC, sort_order DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`
		args = []interface{}{size, offset}
	}

	rows, err := d.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.File, 0)
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

func (d *FileDAO) ListAllMetadata(ctx context.Context) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, title, '', created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
		 FROM files
		 WHERE is_deleted = 0
		   AND NOT (is_folder = 0 AND substr(title, 1, 7) = '__tpl__')
		 ORDER BY is_pinned DESC, sort_order DESC, created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.File, 0)
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			return nil, err
		}
		out = append(out, &f)
	}
	return out, rows.Err()
}

func (d *FileDAO) FindActiveByTitle(ctx context.Context, parentID, title string) (*model.File, error) {
	var f model.File
	row := d.DB.QueryRowContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
		 FROM files
		 WHERE is_deleted = 0 AND parent_id = ? AND title = ? COLLATE NOCASE
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		parentID, title,
	)
	if err := row.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
		return nil, err
	}
	return &f, nil
}

func (d *FileDAO) ListTemplates(ctx context.Context) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned
		 FROM files
		 WHERE is_deleted = 0
		   AND is_folder = 0
		   AND substr(title, 1, 7) = '__tpl__'
		 ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.File, 0)
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			return nil, err
		}
		out = append(out, &f)
	}
	return out, rows.Err()
}

func (d *FileDAO) IsDescendant(ctx context.Context, ancestorID, candidateID string) (bool, error) {
	if ancestorID == "" || candidateID == "" {
		return false, nil
	}

	var exists int
	err := d.DB.QueryRowContext(ctx, `
		WITH RECURSIVE descendants(id) AS (
			SELECT id FROM files WHERE parent_id = ? AND is_deleted = 0
			UNION
			SELECT f.id
			FROM files f
			JOIN descendants dsc ON f.parent_id = dsc.id
			WHERE f.is_deleted = 0
		)
		SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?)`,
		ancestorID, candidateID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists == 1, nil
}

func (d *FileDAO) CheckDuplicate(ctx context.Context, parentID, title, excludeID string) (bool, error) {
	var count int
	var err error
	if excludeID != "" {
		err = d.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE parent_id = ? AND title = ? COLLATE NOCASE AND id != ? AND is_deleted = 0", parentID, title, excludeID).Scan(&count)
	} else {
		err = d.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE parent_id = ? AND title = ? COLLATE NOCASE AND is_deleted = 0", parentID, title).Scan(&count)
	}
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (d *FileDAO) GetChildren(ctx context.Context, parentID string) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted, deleted_at, is_pinned 
		 FROM files WHERE parent_id = ? AND is_deleted = 0
		 ORDER BY is_pinned DESC, sort_order DESC, created_at DESC, id DESC`, parentID)
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
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin cleanup tx failed: %w", err)
	}
	defer tx.Rollback()

	deletedIDs := `SELECT id FROM files WHERE is_deleted = 1 AND deleted_at < ?`
	statements := []struct {
		query string
		args  []interface{}
	}{
		{
			query: `DELETE FROM file_tags WHERE file_id IN (` + deletedIDs + `)`,
			args:  []interface{}{threshold},
		},
		{
			query: `DELETE FROM file_versions WHERE file_id IN (` + deletedIDs + `)`,
			args:  []interface{}{threshold},
		},
		{
			query: `DELETE FROM links
				WHERE source_id IN (` + deletedIDs + `)
				   OR target_id IN (` + deletedIDs + `)`,
			args: []interface{}{threshold, threshold},
		},
		{
			query: `DELETE FROM files WHERE is_deleted = 1 AND deleted_at < ?`,
			args:  []interface{}{threshold},
		},
	}

	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return fmt.Errorf("cleanup deleted file data failed: %w", err)
		}
	}

	return tx.Commit()
}

func escapeFTS5Query(q string) string {
	normalized := strings.TrimSpace(q)
	replacer := strings.NewReplacer(
		`"`, `""`,
		`*`, ``,
		`(`, ``,
		`)`, ``,
		`?`, ``,
	)
	normalized = strings.TrimSpace(replacer.Replace(normalized))
	terms := strings.Fields(normalized)
	if len(terms) == 0 {
		return ""
	}

	parts := make([]string, 0, len(terms))
	for _, term := range terms {
		parts = append(parts, `"`+term+`"*`)
	}
	return strings.Join(parts, " AND ")
}

func escapeLikePattern(q string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`%`, `\%`,
		`_`, `\_`,
	)
	return "%" + replacer.Replace(strings.TrimSpace(q)) + "%"
}
