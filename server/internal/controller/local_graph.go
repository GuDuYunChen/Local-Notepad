package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"time"
)

func (c *FileController) LocalGraph(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	out, err := c.LinkDAO.ReadLocalGraph(ctx)
	if err != nil {
		writeErrWithDetail(r, 2020, "读取本地图谱失败", err)
		return
	}
	writeOK(r, out)
}
