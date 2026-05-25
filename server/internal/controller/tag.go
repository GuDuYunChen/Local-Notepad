package controller

import (
	"notepad-server/internal/logic"

	"github.com/gogf/gf/v2/net/ghttp"
)

type TagController struct {
	TagLogic *logic.TagLogic
}

func (c *TagController) Register(group *ghttp.RouterGroup) {
	group.GET("/tags", c.List)
	group.POST("/tags", c.Create)
	group.DELETE("/tags/{id}", c.Delete)
	group.GET("/files/{file_id}/tags", c.GetFileTags)
	group.POST("/files/{file_id}/tags", c.AddFileTag)
	group.DELETE("/files/{file_id}/tags/{tag_id}", c.RemoveFileTag)
	group.GET("/tags/{tag_id}/files", c.GetFilesByTag)
}

func (c *TagController) List(r *ghttp.Request) {
	tags, err := c.TagLogic.List(r.GetCtx())
	if err != nil {
		writeErr(r, 2001, "查询标签失败", err)
		return
	}
	writeOK(r, tags)
}

func (c *TagController) Create(r *ghttp.Request) {
	var in struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2002, "参数错误", err)
		return
	}
	if in.Name == "" {
		writeErr(r, 2003, "标签名称不能为空", nil)
		return
	}

	tag, err := c.TagLogic.Create(r.GetCtx(), in.Name, in.Color)
	if err != nil {
		writeErr(r, 2004, "创建标签失败", err)
		return
	}
	writeOK(r, tag)
}

func (c *TagController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := c.TagLogic.Delete(r.GetCtx(), id); err != nil {
		writeErr(r, 2005, "删除标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *TagController) GetFileTags(r *ghttp.Request) {
	fileID := r.Get("file_id").String()
	tags, err := c.TagLogic.GetFileTags(r.GetCtx(), fileID)
	if err != nil {
		writeErr(r, 2006, "查询文件标签失败", err)
		return
	}
	writeOK(r, tags)
}

func (c *TagController) AddFileTag(r *ghttp.Request) {
	var in struct {
		FileID string `json:"file_id"`
		TagID  string `json:"tag_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2007, "参数错误", err)
		return
	}
	if err := c.TagLogic.AddFileTag(r.GetCtx(), in.FileID, in.TagID); err != nil {
		writeErr(r, 2008, "添加标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *TagController) RemoveFileTag(r *ghttp.Request) {
	var in struct {
		FileID string `json:"file_id"`
		TagID  string `json:"tag_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2009, "参数错误", err)
		return
	}
	if err := c.TagLogic.RemoveFileTag(r.GetCtx(), in.FileID, in.TagID); err != nil {
		writeErr(r, 2010, "移除标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *TagController) GetFilesByTag(r *ghttp.Request) {
	tagID := r.Get("tag_id").String()
	files, err := c.TagLogic.GetFilesByTag(r.GetCtx(), tagID)
	if err != nil {
		writeErr(r, 2011, "查询标签下文件失败", err)
		return
	}
	writeOK(r, files)
}
