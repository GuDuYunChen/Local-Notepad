package controller

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gfile"
)

type UploadController struct{}

var allowedExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true, ".bmp": true, ".ico": true,
	".mp4": true, ".webm": true, ".ogg": true, ".mov": true, ".avi": true,
	".pdf": true,
	".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true,
	".txt": true, ".md": true, ".csv": true, ".json": true, ".xml": true, ".yaml": true, ".yml": true,
	".zip": true, ".rar": true, ".7z": true,
}

var allowedMIMETypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/svg+xml": true, "image/bmp": true, "image/x-icon": true,
	"video/mp4": true, "video/webm": true, "video/ogg": true, "video/quicktime": true, "video/x-msvideo": true,
	"application/pdf": true,
	"application/msword": true, "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"application/vnd.ms-powerpoint": true, "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"text/plain": true, "text/markdown": true, "text/csv": true, "application/json": true, "application/xml": true, "text/xml": true, "application/x-yaml": true, "text/yaml": true,
	"application/zip": true, "application/x-rar-compressed": true, "application/x-7z-compressed": true,
}

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

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedExtensions[ext] {
		writeErr(r, 1010, fmt.Sprintf("不支持的文件类型: %s", ext), nil)
		return
	}

	f, err := file.Open()
	if err != nil {
		writeErr(r, 1010, "文件读取失败", err)
		return
	}
	buffer := make([]byte, 512)
	n, _ := f.Read(buffer)
	f.Close()
	if n > 0 {
		mimeType := http.DetectContentType(buffer)
		if !allowedMIMETypes[mimeType] {
			writeErr(r, 1010, fmt.Sprintf("文件内容类型不匹配: %s", mimeType), nil)
			return
		}
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
