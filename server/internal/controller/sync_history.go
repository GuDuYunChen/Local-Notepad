package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/syncengine"
	"strconv"
	"time"
)

func (c *SyncController) ConflictHistory(r *ghttp.Request) {
	filter := r.GetQuery("filter", "all").String()
	limit := syncengine.ConflictHistoryPageSize
	if raw := r.GetQuery("limit").String(); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 50 {
			writeErr(r, 4014, "记录分页参数无效", nil)
			return
		}
		limit = value
	}
	// The single SQLite connection may be held by an active sync. End the read
	// rather than blocking indefinitely; a timeout is never an empty history.
	ctx, cancel := context.WithTimeout(r.GetCtx(), 3*time.Second)
	defer cancel()
	value, err := c.Engine.ConflictHistory(ctx, filter, r.GetQuery("before").String(), limit)
	if err != nil {
		writeErr(r, 4014, "未能读取冲突处理记录，请重新读取或检查筛选条件", nil)
		return
	}
	writeOK(r, value)
}
