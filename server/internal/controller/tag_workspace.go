package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/dao"
	"strconv"
	"time"
)

func (c *TagController) RegisterTagWorkspace(group *ghttp.RouterGroup) {
	group.GET("/tag-workspace", c.TagWorkspace)
	group.GET("/tag-workspace/{id}/notes", c.TagWorkspaceNotes)
	group.POST("/tag-workspace/changes", c.ChangeTagWorkspace)
}
func (c *TagController) TagWorkspace(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.TagLogic.TagDAO.TagWorkspace(ctx)
	if err != nil {
		writeErrWithDetail(r, 2020, "读取标签工作台失败", err)
		return
	}
	writeOK(r, out)
}
func (c *TagController) TagWorkspaceNotes(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	offset, err := strconv.Atoi(r.Get("offset", "0").String())
	if err != nil {
		writeErr(r, 2021, "分页位置无效", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.TagLogic.TagDAO.TagWorkspaceNotes(ctx, r.Get("id").String(), r.Get("revision").String(), offset)
	if err != nil {
		writeErrWithDetail(r, 2021, "关联笔记读取失败", err)
		return
	}
	writeOK(r, out)
}
func (c *TagController) ChangeTagWorkspace(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	var in dao.TagWorkspaceChange
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2022, "标签操作参数无效", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.TagLogic.TagDAO.ChangeTagWorkspace(ctx, in)
	if err != nil {
		writeErrWithDetail(r, 2022, "标签修改未确认，请核对当前标签库", err)
		return
	}
	writeOK(r, out)
}
