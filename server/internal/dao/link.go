package dao

import (
	"context"
	"database/sql"
	"notepad-server/internal/model"
	"time"
)

type LinkDAO struct {
	DB *sql.DB
}

func (d *LinkDAO) SyncLinks(ctx context.Context, sourceID string, targetIDs []string) error {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM links WHERE source_id = ?`, sourceID); err != nil {
		return err
	}

	now := time.Now().Unix()
	stmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO links (source_id, target_id, created_at) VALUES (?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, targetID := range targetIDs {
		if _, err := stmt.ExecContext(ctx, sourceID, targetID, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (d *LinkDAO) GetBacklinks(ctx context.Context, targetID string) ([]*model.Link, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, source_id, target_id, created_at FROM links WHERE target_id = ? ORDER BY created_at DESC`,
		targetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var links []*model.Link
	for rows.Next() {
		var l model.Link
		if err := rows.Scan(&l.ID, &l.SourceID, &l.TargetID, &l.CreatedAt); err != nil {
			return nil, err
		}
		links = append(links, &l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return links, nil
}

func (d *LinkDAO) GetOutgoingLinks(ctx context.Context, sourceID string) ([]*model.Link, error) {
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, source_id, target_id, created_at FROM links WHERE source_id = ? ORDER BY created_at DESC`,
		sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var links []*model.Link
	for rows.Next() {
		var l model.Link
		if err := rows.Scan(&l.ID, &l.SourceID, &l.TargetID, &l.CreatedAt); err != nil {
			return nil, err
		}
		links = append(links, &l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return links, nil
}
