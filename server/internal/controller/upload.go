package controller

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gfile"
)

type UploadController struct{}

func (c *UploadController) Register(group *ghttp.RouterGroup) {
	group.POST("/upload", c.Upload)
}

func (c *UploadController) Upload(r *ghttp.Request) {
	file := r.GetUploadFile("file")
	if file == nil {
		writeErr(r, 1010, "请选择文件", nil)
		return
	}

	if file.Size > 100*1024*1024 {
		writeErr(r, 1010, "文件大小超过限制 (100MB)", nil)
		return
	}

	uploadDir := "uploads"
	if info, err := os.Stat("server"); err == nil && info.IsDir() {
		uploadDir = filepath.Join("server", "uploads")
	}
	if !gfile.Exists(uploadDir) {
		if err := gfile.Mkdir(uploadDir); err != nil {
			writeErr(r, 1010, "服务端错误: 无法创建上传目录", err)
			return
		}
	}

	ext := filepath.Ext(file.Filename)
	name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	file.Filename = name
	savedName, err := file.Save(uploadDir)
	if err != nil {
		writeErr(r, 1010, "保存文件失败", err)
		return
	}

	url := fmt.Sprintf("/uploads/%s", savedName)
	writeOK(r, g.Map{
		"url":      url,
		"filename": file.Filename,
		"size":     file.Size,
	})
}
