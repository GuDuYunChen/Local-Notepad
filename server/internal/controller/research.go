package controller

import (
	"encoding/json"
	"github.com/gogf/gf/v2/net/ghttp"
	"strings"
)

func (c *FileController) ResearchReceipt(r *ghttp.Request) {
	result, err := c.FileLogic.ResearchReceipt(r.GetCtx(), strings.TrimPrefix(r.URL.Path, "/api/research-notes/"))
	if err != nil {
		writeErrWithDetail(r, 1005, "研究任务查回失败", err)
		return
	}
	writeOK(r, result)
}
func (c *FileController) CreateResearch(r *ghttp.Request) {
	if len(r.GetBody()) > 3*1024*1024 {
		writeErr(r, 1005, "研究请求超过 3 MiB", nil)
		return
	}
	var in struct {
		Title    string `json:"title"`
		Content  string `json:"content"`
		ParentID string `json:"parent_id"`
	}
	if err := json.Unmarshal(r.GetBody(), &in); err != nil {
		writeErr(r, 1005, "研究请求格式错误", err)
		return
	}
	result, err := c.FileLogic.CreateResearch(r.GetCtx(), strings.TrimPrefix(r.URL.Path, "/api/research-notes/"), in.Title, in.Content, in.ParentID)
	if err != nil {
		writeErrWithDetail(r, 1006, "研究笔记创建未完成", err)
		return
	}
	writeOK(r, result)
}
