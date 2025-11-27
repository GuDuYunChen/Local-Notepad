package api

import (
    "github.com/gogf/gf/v2/net/ghttp"
    "github.com/gogf/gf/v2/frame/g"
    "github.com/gogf/gf/v2/errors/gerror"
    "github.com/gogf/gf/v2/util/gconv"
    "notepad-server/internal/service"
    "strconv"
    "strings"
)

// 文件 API：创建/读取/更新/删除/列表
type FileAPI struct { Svc *service.FileService }

// 注册路由
func (a *FileAPI) Register(group *ghttp.RouterGroup) {
    group.GET("/files", a.List)
    group.POST("/files", a.Create)
    group.GET("/files/{id}", a.Get)
    group.PUT("/files/{id}", a.Update)
    group.DELETE("/files/{id}", a.Delete)
    group.POST("/files/{id}/save-as", a.SaveAs)
    group.POST("/files/import", a.Import)
}

// 列表
func (a *FileAPI) List(r *ghttp.Request) {
    q := r.GetQuery("q").String()
    page := toInt(r.GetQuery("page").String(), 1)
    size := toInt(r.GetQuery("size").String(), 20)
    out, err := a.Svc.List(r.GetCtx(), q, page, size)
    if err != nil { writeErr(r, 1001, "查询文件失败", err); return }
    writeOK(r, out)
}

// 创建
func (a *FileAPI) Create(r *ghttp.Request) {
    var in struct{ Title string; Content string }
    if err := r.Parse(&in); err != nil { writeErr(r, 1002, "参数错误", err); return }
    in.Title = strings.TrimSpace(in.Title)
    if in.Title == "" { in.Title = "未命名" }
    f, err := a.Svc.Create(r.GetCtx(), in.Title, in.Content)
    if err != nil { writeErr(r, 1003, "创建失败", err); return }
    writeOK(r, f)
}

// 读取
func (a *FileAPI) Get(r *ghttp.Request) {
    id := r.Get("id").String()
    f, err := a.Svc.Get(r.GetCtx(), id)
    if err != nil { writeErr(r, 1004, "读取失败", err); return }
    writeOK(r, f)
}

// 更新
func (a *FileAPI) Update(r *ghttp.Request) {
    id := r.Get("id").String()
    var in struct{ Title *string; Content *string }
    if err := r.Parse(&in); err != nil { writeErr(r, 1005, "参数错误", err); return }
    f, err := a.Svc.Update(r.GetCtx(), id, in.Title, in.Content)
    if err != nil { writeErr(r, 1006, "更新失败", err); return }
    writeOK(r, f)
}

// 删除
func (a *FileAPI) Delete(r *ghttp.Request) {
    id := r.Get("id").String()
    if err := a.Svc.Delete(r.GetCtx(), id); err != nil { writeErr(r, 1007, "删除失败", err); return }
    writeOK(r, g.Map{"ok": true})
}

// 另存为
func (a *FileAPI) SaveAs(r *ghttp.Request) {
    id := r.Get("id").String()
    var in struct{ Path string; Encoding string }
    if err := r.Parse(&in); err != nil { writeErr(r, 1008, "参数错误", err); return }
    if in.Path == "" { writeErr(r, 1009, "路径不能为空", gerror.New("empty path")); return }
    if err := a.Svc.SaveAs(r.GetCtx(), id, in.Path, in.Encoding); err != nil { writeErr(r, 1010, "另存为失败", err); return }
    writeOK(r, g.Map{"ok": true})
}

// 导入
func (a *FileAPI) Import(r *ghttp.Request) {
    type ImportReq struct {
        Path     string   `json:"path"`
        Paths    []string `json:"paths"`
        Encoding string   `json:"encoding"`
    }
    var in ImportReq
    if err := r.Parse(&in); err != nil { writeErr(r, 1011, "参数错误", err); return }
    // 兼容：paths 为数组或字符串（逗号分隔）
    if len(in.Paths) == 0 {
        if js, _ := r.GetJson(); js != nil {
            val := js.Get("paths").Interface()
            arr := gconv.Strings(val)
            if len(arr) > 0 { in.Paths = arr }
        }
    }
    if len(in.Paths) > 0 {
        var out []interface{}
        for _, p := range in.Paths {
            if strings.TrimSpace(p) == "" { continue }
            f, err := a.Svc.ImportPath(r.GetCtx(), p, in.Encoding)
            if err != nil { writeErr(r, 1013, "导入失败", err); return }
            out = append(out, f)
        }
        writeOK(r, out)
        return
    }
    if in.Path == "" { writeErr(r, 1012, "路径不能为空", gerror.New("empty path")); return }
    f, err := a.Svc.ImportPath(r.GetCtx(), in.Path, in.Encoding)
    if err != nil { writeErr(r, 1013, "导入失败", err); return }
    writeOK(r, f)
}

func toInt(s string, def int) int { if v, err := strconv.Atoi(s); err == nil { return v }; return def }

// 统一响应
func writeOK(r *ghttp.Request, data interface{}) { r.Response.WriteJson(g.Map{"code": 0, "message": "OK", "data": data}) }
func writeErr(r *ghttp.Request, code int, msg string, err error) {
    g.Log().Warning(r.GetCtx(), err)
    r.Response.WriteJson(g.Map{"code": code, "message": msg, "data": nil})
}
