package controller

import (
	"notepad-server/internal/logic"
	"notepad-server/internal/model"

	"github.com/gogf/gf/v2/net/ghttp"
)

type SettingsController struct {
	SettingsLogic *logic.SettingsLogic
}

func (c *SettingsController) Register(group *ghttp.RouterGroup) {
	group.GET("/settings", c.Get)
	group.PUT("/settings", c.Update)
}

func (c *SettingsController) Get(r *ghttp.Request) {
	s, err := c.SettingsLogic.Get(r.GetCtx())
	if err != nil {
		writeErr(r, 3001, "读取设置失败", err)
		return
	}
	writeOK(r, s)
}

func (c *SettingsController) Update(r *ghttp.Request) {
	var in model.Settings
	if err := r.Parse(&in); err != nil {
		writeErr(r, 3002, "参数错误", err)
		return
	}
	s, err := c.SettingsLogic.Update(r.GetCtx(), &in)
	if err != nil {
		writeErr(r, 3003, "更新设置失败", err)
		return
	}
	writeOK(r, s)
}
