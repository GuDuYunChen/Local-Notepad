package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/gogf/gf/v2/net/ghttp"
	"io"
	"notepad-server/internal/dao"
	"time"
)

func (c *FileController) RegisterFolderWorkspace(g *ghttp.RouterGroup) {
	g.GET("/folder-workspace", c.FolderWorkspace)
	g.POST("/folder-workspace/changes", c.ChangeFolderWorkspace)
}
func (c *FileController) FolderWorkspace(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.FolderWorkspace(ctx)
	if err != nil {
		writeErrWithDetail(r, 2030, "读取文件夹整理工作台失败", err)
		return
	}
	writeOK(r, out)
}
func (c *FileController) ChangeFolderWorkspace(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	var in dao.FolderWorkspaceChange
	raw, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil || len(raw) > 65536 {
		writeErr(r, 2031, "文件夹操作请求超过限制或读取失败", nil)
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		writeErr(r, 2031, "文件夹操作参数无效", nil)
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeErr(r, 2031, "操作请求包含额外数据", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.ChangeFolderWorkspace(ctx, in)
	if err != nil {
		writeErrWithDetail(r, 2031, "目录修改未确认，请核对当前状态", err)
		return
	}
	writeOK(r, out)
}
