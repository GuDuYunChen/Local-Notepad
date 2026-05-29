package controller

import (
	"log"
	"notepad-server/internal/dao"
	"notepad-server/internal/logic"
	"notepad-server/internal/model"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

type FileController struct {
	FileLogic *logic.FileLogic
	LinkDAO   *dao.LinkDAO
}

func (c *FileController) Register(group *ghttp.RouterGroup) {
	group.POST("/files", c.Create)
	group.GET("/files/{id}", c.Get)
	group.PUT("/files/{id}", c.Update)
	group.DELETE("/files/{id}", c.Delete)
	group.POST("/files/{id}/restore", c.Restore)
	group.GET("/files/{id}/backlinks", c.Backlinks)
	group.GET("/files/{id}/versions", c.Versions)
	group.POST("/files/{id}/versions/{versionId}/restore", c.RestoreVersion)
	group.GET("/files", c.List)
	group.POST("/files/batch-delete", c.BatchDelete)
	group.POST("/files/import", c.Import)
	group.POST("/files/batch-import", c.BatchImport)
	group.POST("/files/{id}/export", c.Export)
	group.POST("/files/{id}/save-as", c.SaveAs)
	group.GET("/graph", c.Graph)
	group.GET("/files/daily/{date}", c.DailyNote)
	group.GET("/templates", c.ListTemplates)
	group.POST("/templates", c.CreateTemplate)
	group.DELETE("/templates/{id}", c.DeleteTemplate)
}

func (c *FileController) Create(r *ghttp.Request) {
	var in struct {
		Title    string `json:"title" v:"required#文件标题不能为空"`
		Content  string `json:"content"`
		IsFolder bool   `json:"is_folder"`
		ParentID string `json:"parent_id"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	f, err := c.FileLogic.Create(r.GetCtx(), in.Title, in.Content, in.IsFolder, in.ParentID)
	if err != nil {
		writeErr(r, 1006, "创建失败", err)
		return
	}
	writeOK(r, f)
}

func (c *FileController) Get(r *ghttp.Request) {
	id := r.Get("id").String()
	f, err := c.FileLogic.Get(r.GetCtx(), id)
	if err != nil {
		writeErr(r, 1001, "文件不存在", err)
		return
	}
	writeOK(r, f)
}

func (c *FileController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	var in struct {
		Title     *string `json:"title"`
		Content   *string `json:"content"`
		ParentID  *string `json:"parent_id"`
		SortOrder *int64  `json:"sort_order"`
		IsDeleted *bool   `json:"is_deleted"`
		IsPinned  *bool   `json:"is_pinned"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	f, err := c.FileLogic.Update(r.GetCtx(), id, in.Title, in.Content, in.ParentID, in.SortOrder, in.IsDeleted, in.IsPinned)
	if err != nil {
		log.Printf("保存文件失败 id=%s: %v", id, err)
		writeErrWithDetail(r, 1006, "保存失败", err)
		return
	}
	writeOK(r, f)
}

func (c *FileController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := c.FileLogic.Delete(r.GetCtx(), id); err != nil {
		writeErr(r, 1007, "删除失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *FileController) Restore(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := c.FileLogic.Restore(r.GetCtx(), id); err != nil {
		writeErr(r, 1007, "恢复失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *FileController) Backlinks(r *ghttp.Request) {
	id := r.Get("id").String()
	if c.LinkDAO == nil {
		writeOK(r, []*model.Link{})
		return
	}
	links, err := c.LinkDAO.GetBacklinks(r.GetCtx(), id)
	if err != nil {
		writeErr(r, 1001, "查询反向链接失败", err)
		return
	}
	writeOK(r, links)
}

func (c *FileController) Versions(r *ghttp.Request) {
	id := r.Get("id").String()
	versions, err := c.FileLogic.GetVersions(r.GetCtx(), id)
	if err != nil {
		writeErr(r, 1001, "查询版本历史失败", err)
		return
	}
	writeOK(r, versions)
}

func (c *FileController) RestoreVersion(r *ghttp.Request) {
	versionID := r.Get("versionId").Int64()
	if err := c.FileLogic.RestoreVersion(r.GetCtx(), versionID); err != nil {
		writeErr(r, 1007, "恢复版本失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *FileController) BatchDelete(r *ghttp.Request) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}
	if len(in.IDs) == 0 {
		writeErr(r, 1005, "未选择删除项", nil)
		return
	}
	if len(in.IDs) > 500 {
		writeErr(r, 1005, "批量删除数量超过限制（最多500个）", nil)
		return
	}
	if err := c.FileLogic.BatchDelete(r.GetCtx(), in.IDs); err != nil {
		writeErr(r, 1007, "删除失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *FileController) List(r *ghttp.Request) {
	q := r.Get("q").String()
	page := r.Get("page").Int()
	size := r.Get("size").Int()

	if page <= 0 {
		page = 1
	}
	if size <= 0 || size > 200 {
		size = 50
	}

	files, err := c.FileLogic.List(r.GetCtx(), q, page, size)
	if err != nil {
		writeErrWithDetail(r, 1001, "查询失败", err)
		return
	}
	writeOK(r, files)
}

func (c *FileController) Import(r *ghttp.Request) {
	var in struct {
		Path     string `json:"path"`
		Encoding string `json:"encoding"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	f, err := c.FileLogic.ImportPath(r.GetCtx(), in.Path, in.Encoding)
	if err != nil {
		writeErr(r, 1009, "导入失败", err)
		return
	}
	writeOK(r, f)
}

func (c *FileController) BatchImport(r *ghttp.Request) {
	var in struct {
		Paths    []string `json:"paths"`
		Encoding string   `json:"encoding"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	files, err := c.FileLogic.BatchImport(r.GetCtx(), in.Paths, in.Encoding)
	if err != nil {
		writeErr(r, 1009, "导入失败", err)
		return
	}
	writeOK(r, files)
}

func (c *FileController) Export(r *ghttp.Request) {
	id := r.Get("id").String()
	var in struct {
		Format string `json:"format"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}
	if in.Format == "" {
		in.Format = "md"
	}

	data, filename, err := c.FileLogic.BatchExport(r.GetCtx(), []string{id}, in.Format)
	if err != nil {
		writeErr(r, 1008, "导出失败", err)
		return
	}
	r.Response.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	r.Response.Header().Set("Content-Type", "application/octet-stream")
	r.Response.Write(data)
}

func (c *FileController) SaveAs(r *ghttp.Request) {
	id := r.Get("id").String()
	var in struct {
		Path     string `json:"path" v:"required#保存路径不能为空"`
		Encoding string `json:"encoding"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	if err := c.FileLogic.SaveAs(r.GetCtx(), id, in.Path, in.Encoding); err != nil {
		writeErr(r, 1008, "另存为失败", err)
		return
	}
	writeOK(r, nil)
}

func (c *FileController) Graph(r *ghttp.Request) {
	if c.LinkDAO == nil {
		writeOK(r, g.Map{"nodes": []interface{}{}, "edges": []interface{}{}})
		return
	}

	links, err := c.LinkDAO.GetAllLinks(r.GetCtx())
	if err != nil {
		writeErr(r, 1001, "查询知识图谱失败", err)
		return
	}

	files, err := c.FileLogic.List(r.GetCtx(), "", 1, 10000)
	if err != nil {
		writeErr(r, 1001, "查询文件列表失败", err)
		return
	}

	fileMap := make(map[string]*model.File)
	for _, f := range files {
		fileMap[f.ID] = f
	}

	type Node struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Links int    `json:"links"`
	}

	type Edge struct {
		Source string `json:"source"`
		Target string `json:"target"`
	}

	nodeMap := make(map[string]*Node)
	var edges []Edge

	for _, f := range files {
		nodeMap[f.ID] = &Node{ID: f.ID, Label: f.Title, Links: 0}
	}

	for _, l := range links {
		if _, ok := nodeMap[l.SourceID]; !ok {
			continue
		}
		if _, ok := nodeMap[l.TargetID]; !ok {
			continue
		}
		nodeMap[l.SourceID].Links++
		nodeMap[l.TargetID].Links++
		edges = append(edges, Edge{Source: l.SourceID, Target: l.TargetID})
	}

	var nodes []Node
	for _, n := range nodeMap {
		if n.Links > 0 {
			nodes = append(nodes, *n)
		}
	}

	writeOK(r, g.Map{"nodes": nodes, "edges": edges})
}

func (c *FileController) DailyNote(r *ghttp.Request) {
	date := r.Get("date").String()
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	title := date

	files, err := c.FileLogic.List(r.GetCtx(), "", 1, 10000)
	if err != nil {
		writeErr(r, 1001, "查询文件列表失败", err)
		return
	}

	for _, f := range files {
		if f.Title == title && !f.IsFolder {
			writeOK(r, g.Map{"file": f, "created": false})
			return
		}
	}

	f, err := c.FileLogic.Create(r.GetCtx(), title, "", false, "")
	if err != nil {
		writeErr(r, 1006, "创建每日笔记失败", err)
		return
	}

	writeOK(r, g.Map{"file": f, "created": true})
}

func (c *FileController) ListTemplates(r *ghttp.Request) {
	files, err := c.FileLogic.List(r.GetCtx(), "", 1, 10000)
	if err != nil {
		writeErr(r, 1001, "查询模板列表失败", err)
		return
	}

	templates := make([]g.Map, 0)
	for _, f := range files {
		if !f.IsFolder && len(f.Title) > 9 && f.Title[:9] == "__tpl__" {
			templates = append(templates, g.Map{
				"id":      f.ID,
				"title":   f.Title[9:],
				"content": f.Content,
			})
		}
	}

	writeOK(r, templates)
}

func (c *FileController) CreateTemplate(r *ghttp.Request) {
	var in struct {
		Title   string `json:"title" v:"required#模板名称不能为空"`
		Content string `json:"content"`
	}
	if err := r.Parse(&in); err != nil {
		writeErr(r, 1005, "参数错误", err)
		return
	}

	f, err := c.FileLogic.Create(r.GetCtx(), "__tpl__"+in.Title, in.Content, false, "")
	if err != nil {
		writeErr(r, 1006, "创建模板失败", err)
		return
	}

	writeOK(r, g.Map{"id": f.ID, "title": in.Title})
}

func (c *FileController) DeleteTemplate(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := c.FileLogic.Delete(r.GetCtx(), id); err != nil {
		writeErr(r, 1007, "删除模板失败", err)
		return
	}
	writeOK(r, nil)
}

