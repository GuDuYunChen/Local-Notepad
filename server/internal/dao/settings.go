package dao

import (
	"context"
	"database/sql"
	"notepad-server/internal/model"
)

type SettingsDAO struct {
	DB *sql.DB
}

func (d *SettingsDAO) Get(ctx context.Context) (*model.Settings, error) {
	var s model.Settings
	row := d.DB.QueryRowContext(ctx, `SELECT theme, editor_opts, sync_enabled, sync_endpoint FROM settings WHERE id = 1`)
	if err := row.Scan(&s.Theme, &s.EditorOpts, &s.SyncEnabled, &s.SyncEndpoint); err != nil {
		return nil, err
	}
	return &s, nil
}

func (d *SettingsDAO) Update(ctx context.Context, s *model.Settings) error {
	_, err := d.DB.ExecContext(ctx,
		`UPDATE settings SET theme = ?, editor_opts = ?, sync_enabled = ?, sync_endpoint = ? WHERE id = 1`,
		s.Theme, s.EditorOpts, s.SyncEnabled, s.SyncEndpoint)
	return err
}
