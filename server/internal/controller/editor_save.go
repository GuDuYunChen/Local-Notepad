package controller

import (
	"context"
	"github.com/gogf/gf/v2/net/ghttp"
	"notepad-server/internal/model"
	"time"
)

func (c *FileController) SaveEditor(r *ghttp.Request, in model.EditorSaveInput) {
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	result, err := c.FileLogic.SaveEditorContent(ctx, r.Get("id").String(), in)
	if err != nil {
		writeErrWithDetail(r, 1006, "正文保存未获确认，草稿保留；请重试核对同一请求", err)
		return
	}
	writeOK(r, result)
}
func (c *FileController) EditorReferenceJobs(r *ghttp.Request) {
	ctx, cancel := context.WithTimeout(r.GetCtx(), 3*time.Second)
	defer cancel()
	jobs, err := c.FileLogic.EditorReferenceJobs(ctx)
	if err != nil {
		writeErr(r, 1006, "引用待办读取失败，不影响已保存正文", nil)
		return
	}
	writeOK(r, jobs)
}
func (c *FileController) CompleteEditorReferences(r *ghttp.Request) {
	var in model.ReferenceCompletion
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "引用维护参数错误", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.GetCtx(), 5*time.Second)
	defer cancel()
	if err := c.FileLogic.CompleteEditorReferences(ctx, r.Get("requestId").String(), in); err != nil {
		writeErrWithDetail(r, 1006, "引用维护未完成，正文已保存，任务保留", err)
		return
	}
	writeOK(r, true)
}
