package logic

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"notepad-server/internal/dao"
	"notepad-server/internal/model"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/saintfish/chardet"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/transform"
)

type FileLogic struct {
	FileDAO    *dao.FileDAO
	LinkDAO    *dao.LinkDAO
	VersionDAO *dao.VersionDAO
}

func (l *FileLogic) Create(ctx context.Context, title string, content string, isFolder bool, parentID string) (*model.File, error) {
	title = sanitizeName(title)
	if title == "" {
		return nil, fmt.Errorf("标题不能为空")
	}

	if parentID != "" {
		duplicate, err := l.FileDAO.CheckDuplicate(ctx, parentID, title, "")
		if err != nil {
			return nil, err
		}
		if duplicate {
			return nil, fmt.Errorf("已存在同名文件或文件夹: %s", title)
		}
	}

	f := &model.File{
		ID:       uuid.New().String(),
		Title:    title,
		Content:  content,
		IsFolder: isFolder,
		ParentID: parentID,
	}
	if err := l.FileDAO.Create(ctx, f); err != nil {
		return nil, err
	}
	return f, nil
}

func (l *FileLogic) Get(ctx context.Context, id string) (*model.File, error) {
	f, err := l.FileDAO.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("文件不存在: %w", err)
	}
	return f, nil
}

func (l *FileLogic) Update(ctx context.Context, id string, title, content, parentID *string, sortOrder *int64, isDeleted *bool, isPinned *bool) (*model.File, error) {
	f, err := l.FileDAO.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("文件不存在: %w", err)
	}
	if f.IsDeleted && (isDeleted == nil || *isDeleted) {
		return nil, fmt.Errorf("文件已删除，无法更新")
	}

	if title != nil {
		f.Title = *title
	}
	if content != nil {
		f.Content = *content
	}
	if parentID != nil {
		f.ParentID = *parentID
	}
	if sortOrder != nil {
		f.SortOrder = *sortOrder
	}
	if isDeleted != nil {
		f.IsDeleted = *isDeleted
	}
	if isPinned != nil {
		f.IsPinned = *isPinned
	}

	if err := l.FileDAO.Update(ctx, f); err != nil {
		return nil, err
	}

	if content != nil && l.VersionDAO != nil {
		if err := l.VersionDAO.CreateSnapshot(ctx, id, f.Title, *content); err != nil {
			log.Printf("创建版本快照失败: %v", err)
		} else {
			if err := l.VersionDAO.DeleteOldVersions(ctx, id, 50); err != nil {
				log.Printf("清理旧版本失败: %v", err)
			}
		}
	}

	if content != nil && l.LinkDAO != nil {
		targetIDs := parseWikiLinks(*content)
		if err := l.LinkDAO.SyncLinks(ctx, id, targetIDs); err != nil {
			log.Printf("同步链接失败: %v", err)
		}
	}

	return f, nil
}

func (l *FileLogic) Delete(ctx context.Context, id string) error {
	return l.FileDAO.DeleteRecursive(ctx, id)
}

func (l *FileLogic) Restore(ctx context.Context, id string) error {
	return l.FileDAO.RestoreRecursive(ctx, id)
}

func (l *FileLogic) GetVersions(ctx context.Context, id string) ([]*model.FileVersion, error) {
	if l.VersionDAO == nil {
		return []*model.FileVersion{}, nil
	}
	return l.VersionDAO.GetVersions(ctx, id)
}

func (l *FileLogic) RestoreVersion(ctx context.Context, versionID int64) error {
	if l.VersionDAO == nil {
		return fmt.Errorf("版本功能未启用")
	}
	v, err := l.VersionDAO.GetVersion(ctx, versionID)
	if err != nil {
		return fmt.Errorf("版本不存在: %w", err)
	}
	_, err = l.Update(ctx, v.FileID, &v.Title, &v.Content, nil, nil, nil, nil)
	return err
}

func (l *FileLogic) BatchDelete(ctx context.Context, ids []string) error {
	return l.FileDAO.BatchDeleteRecursive(ctx, ids)
}

func (l *FileLogic) List(ctx context.Context, q string, page, size int) ([]*model.File, error) {
	return l.FileDAO.List(ctx, q, page, size)
}

func (l *FileLogic) GetChildren(ctx context.Context, parentID string) ([]*model.File, error) {
	return l.FileDAO.GetChildren(ctx, parentID)
}

func (l *FileLogic) CleanupOldDeleted(ctx context.Context) error {
	threshold := time.Now().Add(-30 * 24 * time.Hour).Unix()
	return l.FileDAO.CleanupOldDeleted(ctx, threshold)
}

func (l *FileLogic) ImportPath(ctx context.Context, path string, encoding string) (*model.File, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("路径解析失败: %w", err)
	}
	if !isPathInSandbox(abs, "") {
		return nil, fmt.Errorf("拒绝访问: 文件路径不在允许范围内")
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}

	content, err := decodeContent(b, encoding)
	if err != nil {
		return nil, err
	}

	base := filepath.Base(abs)
	title := strings.TrimSuffix(base, filepath.Ext(base))
	return l.Create(ctx, title, content, false, "")
}

func (l *FileLogic) BatchImport(ctx context.Context, paths []string, encoding string) ([]*model.File, error) {
	var out []*model.File
	for _, p := range paths {
		f, err := l.ImportPath(ctx, p, encoding)
		if err != nil {
			return out, err
		}
		out = append(out, f)
	}
	return out, nil
}

func (l *FileLogic) SaveAs(ctx context.Context, id string, path string, encoding string) error {
	f, err := l.Get(ctx, id)
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("路径解析失败: %w", err)
	}
	if !isPathInSandbox(abs, "") {
		return fmt.Errorf("拒绝访问: 保存路径不在允许范围内")
	}

	var b []byte
	if strings.HasSuffix(strings.ToLower(path), ".md") {
		b = []byte(f.Content)
	} else {
		b = []byte(f.Content)
	}

	if err := os.WriteFile(abs, b, 0644); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}

func (l *FileLogic) Export(ctx context.Context, id string, format string) ([]byte, string, error) {
	f, err := l.Get(ctx, id)
	if err != nil {
		return nil, "", err
	}

	if format == "md" {
		return []byte(f.Content), f.Title + ".md", nil
	}

	return nil, "", fmt.Errorf("不支持的导出格式: %s", format)
}

func (l *FileLogic) BatchExport(ctx context.Context, ids []string, format string) ([]byte, string, error) {
	var buf bytes.Buffer
	for i, id := range ids {
		f, err := l.Get(ctx, id)
		if err != nil {
			continue
		}
		if i > 0 {
			buf.WriteString("\n---\n\n")
		}
		buf.WriteString("# " + f.Title + "\n\n")
		buf.WriteString(f.Content)
	}
	return buf.Bytes(), "export." + format, nil
}

func sanitizeName(name string) string {
	invalid := []string{"<", ">", ":", "\"", "/", "\\", "|", "?", "*"}
	for _, char := range invalid {
		name = strings.ReplaceAll(name, char, "_")
	}
	return strings.TrimSpace(name)
}

func parseWikiLinks(content string) []string {
	re := regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	matches := re.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)
	var ids []string
	for _, m := range matches {
		id := m[1]
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func isPathInSandbox(absPath string, sandboxRoot string) bool {
	if sandboxRoot == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return false
		}
		sandboxRoot = home
	}
	rel, err := filepath.Rel(sandboxRoot, absPath)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)
}

func decodeContent(b []byte, encoding string) (string, error) {
	if encoding == "" {
		detector := chardet.NewTextDetector()
		result, err := detector.DetectBest(b)
		if err == nil {
			encoding = result.Charset
		}
	}

	var enc transform.Transformer
	switch strings.ToLower(encoding) {
	case "utf-8", "utf8":
		return string(b), nil
	case "gbk", "gb2312", "gb18030", "cp936":
		enc = simplifiedchinese.GBK.NewDecoder()
	case "big5", "cp950":
		enc = traditionalchinese.Big5.NewDecoder()
	case "shift_jis", "sjis", "x-sjis":
		enc = japanese.ShiftJIS.NewDecoder()
	case "euc-jp":
		enc = japanese.EUCJP.NewDecoder()
	case "iso-2022-jp":
		enc = japanese.ISO2022JP.NewDecoder()
	default:
		if strings.HasPrefix(strings.ToLower(encoding), "utf-8") || strings.HasPrefix(strings.ToLower(encoding), "utf8") {
			return string(b), nil
		}
		if strings.HasPrefix(strings.ToLower(encoding), "gb") {
			enc = simplifiedchinese.GBK.NewDecoder()
		} else if strings.ToLower(encoding) == "big5" {
			enc = traditionalchinese.Big5.NewDecoder()
		} else {
			return string(b), nil
		}
	}

	r := transform.NewReader(bytes.NewReader(b), enc)
	out, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("解码失败 (%s): %w", encoding, err)
	}
	return string(out), nil
}
