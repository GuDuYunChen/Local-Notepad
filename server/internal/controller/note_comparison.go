package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"time"
)

func (c *FileController) CompareNotes(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	if len(q) != 2 || len(q["left"]) != 1 || len(q["right"]) != 1 {
		writeErr(r, 2027, "请选择两篇不同笔记，参数不能重复或附加", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 8*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.CompareNotes(ctx, q.Get("left"), q.Get("right"))
	if err != nil {
		writeErrWithDetail(r, 2027, "笔记比较未完成，请重新选择或重试", err)
		return
	}
	writeOK(r, out)
}
