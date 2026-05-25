package logic

import (
	"context"
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
