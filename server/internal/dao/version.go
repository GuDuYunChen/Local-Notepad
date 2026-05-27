package dao

import (
	"context"
	"database/sql"
	"notepad-server/internal/model"
	"time"
)

type VersionDAO struct {
	DB *sql.DB
}

func (d *VersionDAO) CreateSnapshot(ctx context.Context, fileID, title, content string) error {
	now := time.Now().Unix()
	_, err := d.DB.ExecContext(ctx,
		`INSERT INTO file_versions (file_id, title, content, created_at) VALUES (?, ?, ?, ?)`,
		fileID, title, content, now)
	return err
}

func (d *VersionDAO) GetVersions(ctx context.Context, fileID string) ([]*model.FileVersion, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, file_id, title, content, created_at FROM file_versions WHERE file_id = ? ORDER BY created_at DESC LIMIT 50`,
		fileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []*model.FileVersion
	for rows.Next() {
		var v model.FileVersion
		if err := rows.Scan(&v.ID, &v.FileID, &v.Title, &v.Content, &v.CreatedAt); err != nil {
			return nil, err
		}
		versions = append(versions, &v)
	}
	return versions, nil
}

func (d *VersionDAO) GetVersion(ctx context.Context, versionID int64) (*model.FileVersion, error) {
	var v model.FileVersion
	row := d.DB.QueryRowContext(ctx,
		`SELECT id, file_id, title, content, created_at FROM file_versions WHERE id = ?`,
		versionID)
	if err := row.Scan(&v.ID, &v.FileID, &v.Title, &v.Content, &v.CreatedAt); err != nil {
		return nil, err
	}
	return &v, nil
}

func (d *VersionDAO) DeleteOldVersions(ctx context.Context, fileID string, keepCount int) error {
	_, err := d.DB.ExecContext(ctx,
		`DELETE FROM file_versions WHERE file_id = ? AND id NOT IN (SELECT id FROM file_versions WHERE file_id = ? ORDER BY created_at DESC LIMIT ?)`,
		fileID, fileID, keepCount)
	return err
}
