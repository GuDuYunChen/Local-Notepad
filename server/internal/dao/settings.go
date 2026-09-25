package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"notepad-server/internal/model"
)

type SettingsDAO struct {
	DB *sql.DB
}

func (d *SettingsDAO) Get(ctx context.Context) (*model.Settings, error) {
	var s model.Settings
	var editorOpts sql.NullString
	var syncEndpoint sql.NullString
	var syncProvider sql.NullString
	var syncEnabled int

	row := d.DB.QueryRowContext(ctx,
		`SELECT theme, editor_opts, sync_enabled, sync_endpoint, COALESCE(sync_provider,'') FROM settings WHERE id = 1`)
	if err := row.Scan(&s.Theme, &editorOpts, &syncEnabled, &syncEndpoint, &syncProvider); err != nil {
		return nil, err
	}

	s.SyncEnabled = syncEnabled != 0
	s.SyncEndpoint = syncEndpoint.String
	s.SyncProvider = syncProvider.String
	s.EditorOpts = map[string]interface{}{}

	if editorOpts.Valid && editorOpts.String != "" {
		if err := json.Unmarshal([]byte(editorOpts.String), &s.EditorOpts); err != nil {
			return nil, fmt.Errorf("解析 editor_opts 失败: %w", err)
		}
	}

	return &s, nil
}

func (d *SettingsDAO) Update(ctx context.Context, s *model.Settings) error {
	editorJSON, err := json.Marshal(s.EditorOpts)
	if err != nil {
		return fmt.Errorf("序列化 editor_opts 失败: %w", err)
	}

	_, err = d.DB.ExecContext(ctx,
		`UPDATE settings
		 SET theme = ?, editor_opts = ?, sync_enabled = ?, sync_endpoint = ?, sync_provider = ?
		 WHERE id = 1`,
		s.Theme, string(editorJSON), s.SyncEnabled, s.SyncEndpoint, s.SyncProvider)
	return err
}


func (d *SettingsDAO) Diagnostics(ctx context.Context) (*model.Diagnostics, error) {
	diag := &model.Diagnostics{}

	if err := d.DB.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&diag.Integrity); err != nil {
		return nil, fmt.Errorf("quick_check failed: %w", err)
	}
	if err := d.DB.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&diag.JournalMode); err != nil {
		return nil, fmt.Errorf("journal_mode failed: %w", err)
	}

	var foreignKeys int
	if err := d.DB.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		return nil, fmt.Errorf("foreign_keys failed: %w", err)
	}
	diag.ForeignKeys = foreignKeys == 1

	if err := d.DB.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&diag.BusyTimeout); err != nil {
		return nil, fmt.Errorf("busy_timeout failed: %w", err)
	}

	rows, err := d.DB.QueryContext(ctx, `PRAGMA database_list`)
	if err != nil {
		return nil, fmt.Errorf("database_list failed: %w", err)
	}
	for rows.Next() {
		var seq int
		var name string
		var file string
		if err := rows.Scan(&seq, &name, &file); err != nil {
			rows.Close()
			return nil, fmt.Errorf("database_list scan failed: %w", err)
		}
		if name == "main" {
			diag.DatabasePath = file
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM files
		 WHERE is_deleted = 0
		   AND is_folder = 0
		   AND substr(title, 1, 7) != '__tpl__'`,
	).Scan(&diag.ActiveNotes); err != nil {
		return nil, fmt.Errorf("count active notes failed: %w", err)
	}

	if err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM files WHERE is_deleted = 0 AND is_folder = 1`,
	).Scan(&diag.ActiveFolders); err != nil {
		return nil, fmt.Errorf("count active folders failed: %w", err)
	}

	if err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*)
		 FROM files f
		 WHERE f.is_deleted = 1
		   AND NOT (f.is_folder = 0 AND substr(f.title, 1, 7) = '__tpl__')
		   AND (
			 f.parent_id = ''
			 OR NOT EXISTS (
			   SELECT 1 FROM files parent
			   WHERE parent.id = f.parent_id AND parent.is_deleted = 1
			 )
		   )`,
	).Scan(&diag.TrashItems); err != nil {
		return nil, fmt.Errorf("count trash items failed: %w", err)
	}

	if diag.Integrity == "ok" {
		diag.Status = "ok"
	} else {
		diag.Status = "warning"
	}

	return diag, nil
}
