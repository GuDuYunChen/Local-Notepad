package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"strconv"
	"time"
)

func (c *FileController) HistoryReview(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	bad := len(q["file"]) != 1 || len(q) > 2
	for k := range q {
		if k != "file" && k != "version" {
			bad = true
		}
	}
	var version int64
	if values, ok := q["version"]; ok {
		if len(values) != 1 {
			bad = true
		} else {
			var err error
			version, err = strconv.ParseInt(values[0], 10, 64)
			if err != nil || version <= 0 || strconv.FormatInt(version, 10) != values[0] {
				bad = true
			}
		}
	}
	if bad {
		writeErr(r, 2028, "历史请求参数无效或重复", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 8*time.Second)
	defer cancel()
	out, err := c.FileLogic.FileDAO.ReadHistoryReview(ctx, q.Get("file"), version)
	if err != nil {
		writeErrWithDetail(r, 2028, "历史读取未完成，未修改任何笔记", err)
		return
	}
	writeOK(r, out)
}
