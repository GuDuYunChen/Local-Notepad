package dao

import (
	"context"
	"database/sql"
	"notepad-server/internal/model"

	"github.com/google/uuid"
)

type TagDAO struct {
	DB *sql.DB
}

func (d *TagDAO) List(ctx context.Context) ([]*model.Tag, error) {
	rows, err := d.DB.QueryContext(ctx, `SELECT id, name, color FROM tags ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			return nil, err
		}
		out = append(out, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (d *TagDAO) Create(ctx context.Context, name, color string) (*model.Tag, error) {
	id := uuid.New().String()
	_, err := d.DB.ExecContext(ctx, `INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`, id, name, color)
	if err != nil {
		return nil, err
	}
	return &model.Tag{ID: id, Name: name, Color: color}, nil
}

func (d *TagDAO) Delete(ctx context.Context, id string) error {
	_, err := d.DB.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	return err
}

func (d *TagDAO) DeleteFileTags(ctx context.Context, fileID string) error {
	_, err := d.DB.ExecContext(ctx, `DELETE FROM file_tags WHERE file_id = ?`, fileID)
	return err
}

func (d *TagDAO) GetFileTags(ctx context.Context, fileID string) ([]*model.Tag, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT t.id, t.name, t.color FROM tags t 
		 JOIN file_tags ft ON t.id = ft.tag_id WHERE ft.file_id = ?`, fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			return nil, err
		}
		out = append(out, &t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (d *TagDAO) AddFileTag(ctx context.Context, fileID, tagID string) error {
	_, err := d.DB.ExecContext(ctx, `INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)`, fileID, tagID)
	return err
}

func (d *TagDAO) RemoveFileTag(ctx context.Context, fileID, tagID string) error {
	_, err := d.DB.ExecContext(ctx, `DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?`, fileID, tagID)
	return err
}

func (d *TagDAO) GetFilesByTag(ctx context.Context, tagID string) ([]*model.File, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT f.id, f.title, f.content, f.created_at, f.updated_at, f.is_folder, f.parent_id, f.sort_order, f.is_deleted, f.deleted_at, f.is_pinned 
		 FROM files f JOIN file_tags ft ON f.id = ft.file_id WHERE ft.tag_id = ? AND f.is_deleted = 0`, tagID)
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
