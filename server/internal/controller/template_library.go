package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"notepad-server/internal/dao"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

func (c *FileController) RegisterTemplateLibrary(group *ghttp.RouterGroup) {
	group.GET("/template-library", c.TemplateLibrary)
	group.GET("/template-library/items/{id}", c.TemplateLibraryItem)
	group.PUT("/template-library/items/{id}", c.ChangeTemplateLibraryItem)
	group.GET("/template-library/requests/{requestId}", c.TemplateLibraryReceipt)
	group.POST("/template-library/requests/{requestId}", c.CreateTemplateLibraryItem)
}
func (c *FileController) TemplateLibrary(r *ghttp.Request) {
	items, err := c.FileLogic.FileDAO.LibraryTemplates(r.GetCtx())
	if err != nil {
		writeErrWithDetail(r, 1001, "读取模板库失败", err)
		return
	}
	writeOK(r, g.Map{"complete": true, "items": items})
}
func (c *FileController) TemplateLibraryItem(r *ghttp.Request) {
	item, err := c.FileLogic.FileDAO.LibraryTemplate(r.GetCtx(), r.Get("id").String())
	if err != nil {
		writeErrWithDetail(r, 1001, "模板不存在或不属于模板库", err)
		return
	}
	writeOK(r, item)
}
func (c *FileController) ChangeTemplateLibraryItem(r *ghttp.Request) {
	var in struct {
		Expected *dao.LibraryTemplate `json:"expected"`
		Next     *dao.LibraryTemplate `json:"next"`
	}
	if err := r.Parse(&in); err != nil || in.Expected == nil || in.Next == nil {
		writeErr(r, 1005, "必须提供确认时的完整模板", err)
		return
	}
	item, err := c.FileLogic.FileDAO.ChangeLibraryTemplate(r.GetCtx(), r.Get("id").String(), *in.Expected, *in.Next)
	if err != nil {
		writeErrWithDetail(r, 1006, "模板修改未确认", err)
		return
	}
	writeOK(r, item)
}
func (c *FileController) TemplateLibraryReceipt(r *ghttp.Request) {
	receipt, err := c.FileLogic.ResearchReceipt(r.GetCtx(), r.Get("requestId").String())
	if err != nil {
		writeErrWithDetail(r, 1001, "创建记录读取失败", err)
		return
	}
	writeOK(r, receipt)
}

// Both new templates and text-template copies reuse the existing durable
// request ledger and atomic file/FTS/link transaction. There is no new schema.
func (c *FileController) CreateTemplateLibraryItem(r *ghttp.Request) {
	var in struct {
		Kind     string `json:"kind"`
		Title    string `json:"title"`
		Content  string `json:"content"`
		ParentID string `json:"parent_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "模板创建参数无效", err)
		return
	}
	if in.Kind != "template" && in.Kind != "note" {
		writeErr(r, 1005, "创建类型无效", nil)
		return
	}
	if err := dao.ValidateTemplateName(strings.TrimSuffix(in.Title, ".md")); err != nil {
		writeErrWithDetail(r, 1005, "名称无效", err)
		return
	}
	if err := dao.ValidateTemplateBody(in.Content); err != nil {
		writeErrWithDetail(r, 1005, "正文无效", err)
		return
	}
	title := in.Title
	if in.Kind == "template" {
		if in.ParentID != "" {
			writeErr(r, 1005, "模板只能存于模板库", nil)
			return
		}
		title = dao.TemplatePrefix + title
	}
	if strings.HasPrefix(in.Title, dao.TemplatePrefix) {
		writeErr(r, 1005, "不能使用内部模板名称", nil)
		return
	}
	receipt, err := c.FileLogic.CreateResearch(r.GetCtx(), r.Get("requestId").String(), title, in.Content, in.ParentID)
	if err != nil {
		writeErrWithDetail(r, 1006, "创建结果未确认", err)
		return
	}
	// Assert the generic ledger really acknowledges these exact submitted bytes.
	sum := sha256.Sum256([]byte(title + "\x00" + in.ParentID + "\x00" + in.Content))
	if receipt.PayloadSHA256 != hex.EncodeToString(sum[:]) {
		writeErrWithDetail(r, 1006, "创建回执不符", fmt.Errorf("正文指纹不符"))
		return
	}
	writeOK(r, receipt)
}
