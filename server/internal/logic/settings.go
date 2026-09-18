package logic

import (
	"context"
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

func (l *SettingsLogic) Update(ctx context.Context, s *model.Settings) (*model.Settings, error) {
	if err := l.SettingsDAO.Update(ctx, s); err != nil {
		return nil, err
	}
	return s, nil
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
