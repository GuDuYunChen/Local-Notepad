package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"time"
)

func (c *FileController) DuplicateNotes(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 8*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.DuplicateNotes(ctx)
	if err != nil {
		writeErrWithDetail(r, 2026, "重复笔记检查未完成，请检查资料库或重试", err)
		return
	}
	writeOK(r, out)
}
