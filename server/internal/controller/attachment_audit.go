package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"time"
)

func (c *UploadController) AttachmentAudit(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	if c.FileDAO == nil {
		writeErr(r, 2024, "附件检查未配置", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 8*time.Second)
	defer cancel()
	result, err := c.FileDAO.AttachmentAudit(ctx, c.UploadDir)
	if err != nil {
		writeErr(r, 2024, "完整附件检查未生成；目录可能变化、不可读取或超过上限，请重试。未修改任何资料。", nil)
		return
	}
	writeOK(r, result)
}
