package service

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "notepad-server/internal/model"
)

// 设置服务：读取与更新应用设置
type SettingsService struct { DB *sql.DB }

// 获取设置
func (s *SettingsService) Get(ctx context.Context) (*model.Settings, error) {
    var theme string
    var editorOptsStr sql.NullString
    var syncEnabled sql.NullInt64
    var syncEndpoint sql.NullString
    row := s.DB.QueryRowContext(ctx, `SELECT theme, editor_opts, sync_enabled, sync_endpoint FROM settings WHERE id = 1`)
    if err := row.Scan(&theme, &editorOptsStr, &syncEnabled, &syncEndpoint); err != nil {
        return nil, fmt.Errorf("读取设置失败: %w", err)
    }
    var editorOpts map[string]interface{}
    if editorOptsStr.Valid && editorOptsStr.String != "" {
        _ = json.Unmarshal([]byte(editorOptsStr.String), &editorOpts)
    }
    return &model.Settings{
        Theme: theme,
        EditorOpts: editorOpts,
        SyncEnabled: syncEnabled.Valid && syncEnabled.Int64 == 1,
        SyncEndpoint: syncEndpoint.String,
    }, nil
}

// 更新设置
func (s *SettingsService) Update(ctx context.Context, in *model.Settings) (*model.Settings, error) {
    var editorOptsStr *string
    if in.EditorOpts != nil {
        b, _ := json.Marshal(in.EditorOpts)
        str := string(b)
        editorOptsStr = &str
    }
    _, err := s.DB.ExecContext(ctx,
        `UPDATE settings SET theme = COALESCE(?, theme), editor_opts = COALESCE(?, editor_opts), sync_enabled = COALESCE(?, sync_enabled), sync_endpoint = COALESCE(?, sync_endpoint) WHERE id = 1`,
        nullable(in.Theme), nullable(editorOptsStr), boolToIntPtr(in.SyncEnabled), nullable(in.SyncEndpoint),
    )
    if err != nil { return nil, fmt.Errorf("更新设置失败: %w", err) }
    return s.Get(ctx)
}

func nullable[T any](v T) *T { return &v }
func boolToIntPtr(b bool) *int {
    if b { x := 1; return &x }
    x := 0; return &x
}

