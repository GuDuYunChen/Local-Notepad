package controller

import (
	"io"
	"notepad-server/internal/logic"

	"github.com/gogf/gf/v2/net/ghttp"
)

func (c *FileController) RegisterLocalImport(group *ghttp.RouterGroup) {
	group.GET("/local-import/requests/{requestId}", c.LocalImportReceipt)
	group.POST("/local-import/requests/{requestId}", c.CreateLocalImport)
}

func (c *FileController) LocalImportReceipt(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	// Only the router supplies task identity; query/body keys cannot shadow it.
	receipt, err := c.FileLogic.LocalImportReceipt(r.GetCtx(), r.GetRouter("requestId").String())
	if err != nil {
		writeErr(r, 1005, "导入任务查回未完成，请保留当前任务后重试", err)
		return
	}
	writeOK(r, receipt)
}

func (c *FileController) CreateLocalImport(r *ghttp.Request) {
	r.Response.Header().Set("Cache-Control", "no-store")
	id := r.GetRouter("requestId").String()
	// The application permits 100 MiB video uploads globally. This document
	// route reads only its own bounded envelope, including chunked requests.
	body, err := io.ReadAll(io.LimitReader(r.Body, int64(logic.LocalImportRequestLimit)+1))
	if err != nil {
		writeErr(r, 1006, "导入请求读取未完成，请保留当前任务并查回结果", err)
		return
	}
	in, err := logic.DecodeLocalImportInput(body)
	var result *logic.LocalImportResult
	if err != nil {
		result, err = c.FileLogic.RejectLocalImportInput(r.GetCtx(), id, err.Error())
	} else {
		result, err = c.FileLogic.CreateLocalImport(r.GetCtx(), id, in.Title, in.Content, in.ParentID)
	}
	if err != nil {
		// A transport/database/commit/context error does not establish whether
		// the write committed. Never label it as a safely editable rejection.
		writeErr(r, 1006, "导入结果尚未确认，请保留当前任务并查回结果", err)
		return
	}
	writeOK(r, result)
}
