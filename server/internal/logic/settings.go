package logic

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"notepad-server/internal/dao"
	"notepad-server/internal/model"
)

type SettingsLogic struct {
	SettingsDAO *dao.SettingsDAO
}

func (l *SettingsLogic) Get(ctx context.Context) (*model.Settings, error) {
	return l.SettingsDAO.Get(ctx)
}

func (l *SettingsLogic) Update(ctx context.Context, patch *model.SettingsPatch) (*model.Settings, error) {
	current, err := l.SettingsDAO.Get(ctx)
	if err != nil {
		return nil, err
	}

	if patch.Theme != nil {
		if *patch.Theme != "light" && *patch.Theme != "dark" {
			return nil, fmt.Errorf("不支持的主题: %s", *patch.Theme)
		}
		current.Theme = *patch.Theme
	}
	if patch.EditorOpts != nil {
		current.EditorOpts = *patch.EditorOpts
	}
	if patch.SyncEnabled != nil {
		current.SyncEnabled = *patch.SyncEnabled
	}
	if patch.SyncEndpoint != nil {
		if len(*patch.SyncEndpoint) > 2048 { return nil, fmt.Errorf("同步端点长度超过限制") }
		current.SyncEndpoint = strings.TrimSpace(*patch.SyncEndpoint)
	}
	if patch.SyncProvider != nil {
		provider := strings.TrimSpace(*patch.SyncProvider)
		if provider != "" && provider != "local-lab" && provider != "webdav" {
			return nil, fmt.Errorf("当前不支持的同步 provider: %s", provider)
		}
		current.SyncProvider = provider
	}
	if patch.SyncUsername != nil {
		username := strings.TrimSpace(*patch.SyncUsername)
		if len(username) > 512 { return nil, fmt.Errorf("WebDAV 用户名长度超过限制") }
		current.SyncUsername = username
	}
	if patch.SyncPassword != nil {
		if len(*patch.SyncPassword) > 4096 { return nil, fmt.Errorf("WebDAV 密码长度超过限制") }
		current.SyncPassword = *patch.SyncPassword
		current.SyncPasswordSet = current.SyncPassword != ""
	}
	if current.SyncEnabled && current.SyncProvider == "" {
		return nil, fmt.Errorf("启用同步前需要选择同步 provider")
	}
	if current.SyncEnabled && current.SyncProvider == "webdav" {
		if err := validateWebDAVEndpoint(current.SyncEndpoint); err != nil { return nil, err }
	}

	if current.EditorOpts == nil {
		current.EditorOpts = map[string]interface{}{}
	}

	if err := l.SettingsDAO.Update(ctx, current); err != nil {
		return nil, err
	}
	return current, nil
}


func validateWebDAVEndpoint(raw string) error {
	value := strings.TrimSpace(raw)
	if value == "" { return fmt.Errorf("启用 WebDAV 前需要填写同步端点") }
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("WebDAV 端点必须是有效的 http/https URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("WebDAV 端点不能包含账号、查询参数或片段")
	}
	if parsed.Scheme == "http" {
		host := strings.Trim(parsed.Hostname(), "[]")
		ip := net.ParseIP(host)
		if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
			return fmt.Errorf("非本机 WebDAV 必须使用 HTTPS")
		}
	}
	return nil
}

func (l *SettingsLogic) Diagnostics(ctx context.Context) (*model.Diagnostics, error) {
	diag, err := l.SettingsDAO.Diagnostics(ctx)
	if err != nil {
		return nil, err
	}

	if diag.DatabasePath != "" {
		diag.DataDir = filepath.Dir(diag.DatabasePath)
		diag.BackupDir = filepath.Join(diag.DataDir, "backups")
		diag.UploadDir = filepath.Join(diag.DataDir, "uploads")

		if stat, err := os.Stat(diag.DatabasePath); err == nil {
			diag.DatabaseSize = stat.Size()
		}

		entries, err := os.ReadDir(diag.BackupDir)
		if err == nil {
			backups := make([]string, 0)
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				name := entry.Name()
				if strings.HasPrefix(name, "backup-") && strings.HasSuffix(name, ".db") {
					backups = append(backups, name)
				}
			}
			sort.Strings(backups)
			diag.BackupCount = len(backups)

			if len(backups) > 0 {
				latest := backups[len(backups)-1]
				raw := strings.TrimSuffix(strings.TrimPrefix(latest, "backup-"), ".db")
				if parsed, err := time.ParseInLocation("20060102-150405", raw, time.Local); err == nil {
					diag.LatestBackupAt = parsed.Unix()
				}
			}
		}
	}

	return diag, nil
}
