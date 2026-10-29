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

func (c *FileController) RegisterTrashRecovery(g *ghttp.RouterGroup) {
	g.GET("/trash-recovery", c.TrashRecovery)
	g.POST("/trash-recovery/restore", c.RecoverTrash)
}
func (c *FileController) TrashRecovery(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.TrashRecovery(ctx)
	if err != nil {
		writeErrWithDetail(r, 2040, "读取恢复工作台失败", err)
		return
	}
	writeOK(r, out)
}
func (c *FileController) RecoverTrash(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	raw, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil || len(raw) > 65536 {
		writeErr(r, 2041, "恢复请求过大或读取失败", nil)
		return
	}
	var in dao.TrashRecoveryChange
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&in); err != nil {
		writeErr(r, 2041, "恢复请求无效", nil)
		return
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		writeErr(r, 2041, "恢复请求包含额外数据", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.RecoverTrash(ctx, in)
	if err != nil {
		writeErrWithDetail(r, 2041, "恢复结果未确认，请只读核对当前状态", err)
		return
	}
	writeOK(r, out)
}
