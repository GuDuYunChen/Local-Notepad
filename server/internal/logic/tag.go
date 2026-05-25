package logic

import (
	"context"
	"fmt"
	"notepad-server/internal/dao"
	"notepad-server/internal/model"
)

type TagLogic struct {
	TagDAO *dao.TagDAO
}

func (l *TagLogic) List(ctx context.Context) ([]*model.Tag, error) {
	return l.TagDAO.List(ctx)
}

func (l *TagLogic) Create(ctx context.Context, name, color string) (*model.Tag, error) {
	if color == "" {
		color = "#7e5bef"
	}
	return l.TagDAO.Create(ctx, name, color)
}

func (l *TagLogic) Delete(ctx context.Context, id string) error {
	if err := l.TagDAO.DeleteFileTags(ctx, id); err != nil {
		return fmt.Errorf("清理文件标签关联失败: %w", err)
	}
	return l.TagDAO.Delete(ctx, id)
}

func (l *TagLogic) GetFileTags(ctx context.Context, fileID string) ([]*model.Tag, error) {
	return l.TagDAO.GetFileTags(ctx, fileID)
}

func (l *TagLogic) AddFileTag(ctx context.Context, fileID, tagID string) error {
	return l.TagDAO.AddFileTag(ctx, fileID, tagID)
}

func (l *TagLogic) RemoveFileTag(ctx context.Context, fileID, tagID string) error {
	return l.TagDAO.RemoveFileTag(ctx, fileID, tagID)
}

func (l *TagLogic) GetFilesByTag(ctx context.Context, tagID string) ([]*model.File, error) {
	return l.TagDAO.GetFilesByTag(ctx, tagID)
}
