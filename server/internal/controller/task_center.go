package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"time"
)

func (c *FileController) TaskCenter(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 8*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.TaskCenter(ctx)
	if err != nil {
		writeErrWithDetail(r, 2025, "待办清单未能完整读取，请重试", err)
		return
	}
	writeOK(r, out)
}
