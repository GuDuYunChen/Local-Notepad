package controller

import (
	"context"
	"errors"
	"github.com/gogf/gf/v2/net/ghttp"
	notesearch "notepad-server/internal/search"
	"time"
)

func (c *FileController) GlobalSearch(r *ghttp.Request) {
	ctx, cancel := context.WithTimeout(r.GetCtx(), 10*time.Second)
	defer cancel()
	result, err := c.FileLogic.FileDAO.GlobalSearch(ctx, notesearch.Options{
		Query: r.Get("q").String(), Source: r.Get("source").String(), FolderID: r.Get("folder_id").String(),
		Pinned: r.Get("pinned").Bool(), Since: r.Get("since").Int64(), Sort: r.Get("sort").String(), MatchCase: r.Get("match_case").Bool(),
		AnchorID: r.Get("anchor_id").String(), Page: r.Get("page").Int(), PageSize: r.Get("size").Int(), Revision: r.Get("revision").String(),
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			writeErr(r, 1005, "检索超时，请缩小目录或时间范围后重试", nil)
			return
		}
		writeErrWithDetail(r, 1005, "检索未完成", err)
		return
	}
	writeOK(r, result)
}
