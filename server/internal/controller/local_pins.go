package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/dao"
	"time"
)

func (c *FileController) RegisterLocalPins(group *ghttp.RouterGroup) {
	group.GET("/local-pins", c.LocalPins)
	group.GET("/local-pins/{id}", c.LocalPin)
	group.PUT("/local-pins/{id}", c.ChangeLocalPin)
}
func (c *FileController) LocalPins(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.LocalPins(ctx)
	if err != nil {
		writeErrWithDetail(r, 2025, "读取置顶笔记失败", err)
		return
	}
	writeOK(r, out)
}
func (c *FileController) LocalPin(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.LocalPin(ctx, r.Get("id").String())
	if err != nil {
		writeErrWithDetail(r, 2025, "核对置顶状态失败", err)
		return
	}
	writeOK(r, out)
}
func (c *FileController) ChangeLocalPin(r *ghttp.Request) {
	var in dao.LocalPinChange
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2026, "置顶操作参数无效", err)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.ChangeLocalPin(ctx, r.Get("id").String(), in)
	if err != nil {
		writeErrWithDetail(r, 2026, "置顶修改未确认", err)
		return
	}
	writeOK(r, out)
}
