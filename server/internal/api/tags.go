package api

import (
	"notepad-server/internal/service"

	"github.com/gogf/gf/v2/net/ghttp"
)

type TagAPI struct {
	Svc *service.TagService
}

func NewTagAPI(svc *service.TagService) *TagAPI {
	return &TagAPI{Svc: svc}
}

func (a *TagAPI) Register(group *ghttp.RouterGroup) {
	group.GET("/tags", a.List)
	group.POST("/tags", a.Create)
	group.DELETE("/tags/{id}", a.Delete)
	group.GET("/files/{file_id}/tags", a.GetFileTags)
	group.POST("/files/{file_id}/tags", a.AddFileTag)
	group.DELETE("/files/{file_id}/tags/{tag_id}", a.RemoveFileTag)
	group.GET("/tags/{tag_id}/files", a.GetFilesByTag)
}

func (a *TagAPI) List(r *ghttp.Request) {
	tags, err := a.Svc.List(r.GetCtx())
	if err != nil {
		writeErr(r, 2001, "查询标签失败", err)
		return
	}
	writeOK(r, tags)
}

func (a *TagAPI) Create(r *ghttp.Request) {
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

	tag, err := a.Svc.Create(r.GetCtx(), in.Name, in.Color)
	if err != nil {
		writeErr(r, 2004, "创建标签失败", err)
		return
	}
	writeOK(r, tag)
}

func (a *TagAPI) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := a.Svc.Delete(r.GetCtx(), id); err != nil {
		writeErr(r, 2005, "删除标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (a *TagAPI) GetFileTags(r *ghttp.Request) {
	fileID := r.Get("file_id").String()
	tags, err := a.Svc.GetFileTags(r.GetCtx(), fileID)
	if err != nil {
		writeErr(r, 2006, "查询文件标签失败", err)
		return
	}
	writeOK(r, tags)
}

func (a *TagAPI) AddFileTag(r *ghttp.Request) {
	var in struct {
		FileID string `json:"file_id"`
		TagID  string `json:"tag_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2007, "参数错误", err)
		return
	}
	if err := a.Svc.AddFileTag(r.GetCtx(), in.FileID, in.TagID); err != nil {
		writeErr(r, 2008, "添加标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (a *TagAPI) RemoveFileTag(r *ghttp.Request) {
	var in struct {
		FileID string `json:"file_id"`
		TagID  string `json:"tag_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 2009, "参数错误", err)
		return
	}
	if err := a.Svc.RemoveFileTag(r.GetCtx(), in.FileID, in.TagID); err != nil {
		writeErr(r, 2010, "移除标签失败", err)
		return
	}
	writeOK(r, nil)
}

func (a *TagAPI) GetFilesByTag(r *ghttp.Request) {
	tagID := r.Get("tag_id").String()
	files, err := a.Svc.GetFilesByTag(r.GetCtx(), tagID)
	if err != nil {
		writeErr(r, 2011, "查询标签下文件失败", err)
		return
	}
	writeOK(r, files)
}
