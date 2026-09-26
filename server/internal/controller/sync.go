package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/syncengine"
)

type SyncController struct {
	Engine   *syncengine.Engine
	Recovery *syncengine.RecoveryRunner
}

func (c *SyncController) Register(group *ghttp.RouterGroup) {
	if c.Recovery == nil {
		c.Recovery = syncengine.NewRecoveryRunner(c.Engine)
	}
	group.GET("/sync/status", c.Status)
	group.POST("/sync/check", c.Check)
	group.POST("/sync/auto", c.ConfigureAuto)
	group.POST("/sync/plan", c.Plan)
	group.POST("/sync/run", c.Run)
	group.POST("/sync/rebind", c.Rebind)
	group.GET("/sync/conflicts", c.Conflicts)
	group.POST("/sync/conflicts/{id}/resolve", c.Resolve)
}
func (c *SyncController) Status(r *ghttp.Request) {
	value, err := c.Recovery.Status(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 4001, "读取同步状态失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Check(r *ghttp.Request) {
	value, err := c.Recovery.CheckRemote(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 4008, "同步连接检查失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) ConfigureAuto(r *ghttp.Request) {
	var input struct {
		Enabled         bool `json:"enabled"`
		IntervalMinutes int  `json:"interval_minutes"`
	}
	if err := r.Parse(&input); err != nil {
		writeErr(r, 4009, "自动同步参数错误", err)
		return
	}
	value, err := c.Recovery.ConfigureAuto(r.GetCtx(), input.Enabled, input.IntervalMinutes)
	if err != nil {
		writeErrWithDetail(r, 4010, "更新自动同步失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Plan(r *ghttp.Request) {
	value, err := c.Recovery.Plan(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 4002, "同步预演失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Run(r *ghttp.Request) {
	var input struct {
		AcknowledgeUncertain bool `json:"acknowledge_uncertain"`
	}
	if err := r.Parse(&input); err != nil {
		writeErr(r, 4011, "同步恢复确认参数错误", err)
		return
	}
	value, err := c.Recovery.Run(r.GetCtx(), input.AcknowledgeUncertain)
	if err != nil {
		writeErrWithDetail(r, 4003, "同步执行失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Rebind(r *ghttp.Request) {
	value, err := c.Recovery.Rebind(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 4007, "重新绑定同步远端失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Conflicts(r *ghttp.Request) {
	value, err := c.Engine.Conflicts(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 4004, "读取同步冲突失败", err)
		return
	}
	writeOK(r, value)
}
func (c *SyncController) Resolve(r *ghttp.Request) {
	var input struct {
		Choice string `json:"choice"`
	}
	if err := r.Parse(&input); err != nil {
		writeErr(r, 4005, "冲突解决参数错误", err)
		return
	}
	if err := c.Recovery.Resolve(r.GetCtx(), r.Get("id").String(), input.Choice); err != nil {
		writeErrWithDetail(r, 4006, "解决同步冲突失败", err)
		return
	}
	writeOK(r, nil)
}
