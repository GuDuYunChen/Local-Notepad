package service

import (
	"context"
	"database/sql"
	"fmt"

	"notepad-server/internal/model"

	"github.com/google/uuid"
)

type TagService struct {
	DB *sql.DB
}

func NewTagService(db *sql.DB) *TagService {
	return &TagService{DB: db}
}

func (s *TagService) List(ctx context.Context) ([]*model.Tag, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, color FROM tags ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("查询标签失败: %w", err)
	}
	defer rows.Close()

	var out []*model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			return nil, fmt.Errorf("解析标签失败: %w", err)
		}
		out = append(out, &t)
	}
	return out, nil
}

func (s *TagService) Create(ctx context.Context, name, color string) (*model.Tag, error) {
	id := uuid.New().String()
	if color == "" {
		color = "#7e5bef"
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`, id, name, color)
	if err != nil {
		return nil, fmt.Errorf("创建标签失败: %w", err)
	}
	return &model.Tag{ID: id, Name: name, Color: color}, nil
}

func (s *TagService) Delete(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("删除标签失败: %w", err)
	}
	return nil
}

func (s *TagService) GetFileTags(ctx context.Context, fileID string) ([]*model.Tag, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT t.id, t.name, t.color 
		FROM tags t 
		JOIN file_tags ft ON t.id = ft.tag_id 
		WHERE ft.file_id = ? 
		ORDER BY t.name`, fileID)
	if err != nil {
		return nil, fmt.Errorf("查询文件标签失败: %w", err)
	}
	defer rows.Close()

	var out []*model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			return nil, fmt.Errorf("解析文件标签失败: %w", err)
		}
		out = append(out, &t)
	}
	return out, nil
}

func (s *TagService) AddFileTag(ctx context.Context, fileID, tagID string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)`, fileID, tagID)
	if err != nil {
		return fmt.Errorf("添加文件标签失败: %w", err)
	}
	return nil
}

func (s *TagService) RemoveFileTag(ctx context.Context, fileID, tagID string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?`, fileID, tagID)
	if err != nil {
		return fmt.Errorf("移除文件标签失败: %w", err)
	}
	return nil
}

func (s *TagService) GetFilesByTag(ctx context.Context, tagID string) ([]*model.File, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT f.id, f.title, f.content, f.created_at, f.updated_at, f.is_folder, f.parent_id, f.sort_order, f.is_deleted, f.deleted_at, f.is_pinned
		FROM files f
		JOIN file_tags ft ON f.id = ft.file_id
		WHERE ft.tag_id = ? AND f.is_deleted = 0
		ORDER BY f.is_pinned DESC, f.sort_order DESC`, tagID)
	if err != nil {
		return nil, fmt.Errorf("查询标签下文件失败: %w", err)
	}
	defer rows.Close()

	var out []*model.File
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			return nil, fmt.Errorf("解析文件失败: %w", err)
		}
		out = append(out, &f)
	}
	return out, nil
}
