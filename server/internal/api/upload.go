package api

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gfile"
)

type UploadAPI struct{}

func (a *UploadAPI) Register(group *ghttp.RouterGroup) {
	group.POST("/upload", a.Upload)
}

func (a *UploadAPI) Upload(r *ghttp.Request) {
	file := r.GetUploadFile("file")
	if file == nil {
		r.Response.WriteJson(g.Map{"code": 1, "message": "请选择文件"})
		return
	}

	// Limit file size (100MB max for now, matching video limit)
	if file.Size > 100*1024*1024 {
		r.Response.WriteJson(g.Map{"code": 1, "message": "文件大小超过限制 (100MB)"})
		return
	}

	uploadDir := "uploads"
	if info, err := os.Stat("server"); err == nil && info.IsDir() {
		uploadDir = filepath.Join("server", "uploads")
	}
	if !gfile.Exists(uploadDir) {
		if err := gfile.Mkdir(uploadDir); err != nil {
			g.Log().Error(r.Context(), "创建上传目录失败", err)
			r.Response.WriteJson(g.Map{"code": 1, "message": "服务端错误: 无法创建上传目录"})
			return
		}
	}

	// Generate filename
	ext := filepath.Ext(file.Filename)
	name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	file.Filename = name
	savedName, err := file.Save(uploadDir)
	if err != nil {
		g.Log().Error(r.Context(), "保存文件失败", err)
		r.Response.WriteJson(g.Map{"code": 1, "message": "保存文件失败"})
		return
	}

	// Return URL
	url := fmt.Sprintf("/uploads/%s", savedName)
	r.Response.WriteJson(g.Map{
		"code":    0,
		"message": "上传成功",
		"data": g.Map{
			"url":      url,
			"filename": file.Filename,
			"size":     file.Size,
		},
	})
}
