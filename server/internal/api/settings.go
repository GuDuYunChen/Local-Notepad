package api

import (
    "github.com/gogf/gf/v2/net/ghttp"
    "notepad-server/internal/service"
    "notepad-server/internal/model"
)

// 设置 API
type SettingsAPI struct { Svc *service.SettingsService }

func (a *SettingsAPI) Register(group *ghttp.RouterGroup) {
    group.GET("/settings", a.Get)
    group.PUT("/settings", a.Update)
}

// 获取设置
func (a *SettingsAPI) Get(r *ghttp.Request) {
    s, err := a.Svc.Get(r.GetCtx())
    if err != nil { writeErr(r, 2001, "读取设置失败", err); return }
    writeOK(r, s)
}

// 更新设置
func (a *SettingsAPI) Update(r *ghttp.Request) {
    var in model.Settings
    if err := r.Parse(&in); err != nil { writeErr(r, 2002, "参数错误", err); return }
    s, err := a.Svc.Update(r.GetCtx(), &in)
    if err != nil { writeErr(r, 2003, "更新设置失败", err); return }
    writeOK(r, s)
}
