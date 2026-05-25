package logic

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"notepad-server/internal/dao"
	"notepad-server/internal/model"
	"os"
	"path/filepath"
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
	FileDAO *dao.FileDAO
}

func (l *FileLogic) Create(ctx context.Context, title, content string, isFolder bool, parentID string) (*model.File, error) {
	duplicate, err := l.FileDAO.CheckDuplicate(ctx, parentID, title, "")
	if err != nil {
		return nil, fmt.Errorf("检查重名失败: %w", err)
	}
	if duplicate {
		return nil, fmt.Errorf("目标位置已存在同名文件或文件夹: %s", title)
	}

	f := &model.File{
		ID:       uuid.New().String(),
		Title:    title,
		Content:  content,
		IsFolder: isFolder,
		ParentID: parentID,
	}

	if err := l.FileDAO.Create(ctx, f); err != nil {
		return nil, fmt.Errorf("创建文件失败: %w", err)
	}

	return f, nil
}

func (l *FileLogic) Get(ctx context.Context, id string) (*model.File, error) {
	f, err := l.FileDAO.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	return f, nil
}

func (l *FileLogic) Update(ctx context.Context, id string, title, content, parentID *string, sortOrder *int64, isDeleted *bool, isPinned *bool) (*model.File, error) {
	f, err := l.FileDAO.GetByID(ctx, id)
	if err != nil {
		return nil, err
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
		if *parentID == id {
			return nil, fmt.Errorf("不能将文件夹移动到其自身内部")
		}
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

	if title != nil || parentID != nil {
		duplicate, err := l.FileDAO.CheckDuplicate(ctx, f.ParentID, f.Title, id)
		if err != nil {
			return nil, fmt.Errorf("检查重名失败: %w", err)
		}
		if duplicate {
			return nil, fmt.Errorf("目标位置已存在同名文件或文件夹: %s", f.Title)
		}
	}

	if err := l.FileDAO.Update(ctx, f); err != nil {
		return nil, fmt.Errorf("更新文件失败: %w", err)
	}

	return f, nil
}

func (l *FileLogic) Delete(ctx context.Context, id string) error {
	return l.FileDAO.DeleteRecursive(ctx, id)
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
	tx, err := l.FileDAO.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	var results []*model.File
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO files (id, title, content, created_at, updated_at, is_folder, parent_id) VALUES (?, ?, ?, ?, ?, 0, '')`)
	if err != nil {
		return nil, fmt.Errorf("预编译语句失败: %w", err)
	}
	defer stmt.Close()

	for _, p := range paths {
		if strings.TrimSpace(p) == "" {
			continue
		}
		f, err := l.importPathWithTx(ctx, stmt, p, encoding)
		if err != nil {
			return nil, fmt.Errorf("导入 %s 失败: %w", p, err)
		}
		results = append(results, f)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}
	return results, nil
}

func (l *FileLogic) importPathWithTx(ctx context.Context, stmt *sql.Stmt, path string, encoding string) (*model.File, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("路径解析失败: %w", err)
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}

	contentStr, err := decodeContent(b, encoding)
	if err != nil {
		return nil, err
	}

	now := time.Now().Unix()
	id := uuid.New().String()
	base := filepath.Base(abs)
	title := strings.TrimSuffix(base, filepath.Ext(base))

	if _, err := stmt.ExecContext(ctx, id, title, contentStr, now, now); err != nil {
		return nil, fmt.Errorf("插入数据库失败: %w", err)
	}

	return &model.File{ID: id, Title: title, Content: contentStr, CreatedAt: now, UpdatedAt: now}, nil
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
	data := []byte(f.Content)
	enc := strings.ToLower(strings.TrimSpace(encoding))
	switch enc {
	case "", "utf-8", "utf8":
	case "gbk":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, simplifiedchinese.GBK.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("GBK 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("GBK writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	case "shift-jis", "shift_jis":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, japanese.ShiftJIS.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("Shift-JIS 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("Shift-JIS writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	case "gb18030":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, simplifiedchinese.GB18030.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("GB18030 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("GB18030 writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	case "big5", "big5-hkscs":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, traditionalchinese.Big5.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("Big5 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("Big5 writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	case "euc-cn":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, simplifiedchinese.GB18030.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("EUC-CN 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("EUC-CN writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	case "iso-2022-cn":
		w := &bytes.Buffer{}
		tw := transform.NewWriter(w, simplifiedchinese.GB18030.NewEncoder())
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("ISO-2022-CN 转码失败: %w", err)
		}
		if err := tw.Close(); err != nil {
			return fmt.Errorf("ISO-2022-CN writer 关闭失败: %w", err)
		}
		data = w.Bytes()
	default:
		return fmt.Errorf("不支持的编码: %s", encoding)
	}
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}

func (l *FileLogic) BatchExport(ctx context.Context, ids []string, targetDir string, format string) error {
	for _, id := range ids {
		if err := l.exportItemRecursive(ctx, id, targetDir, format); err != nil {
			return err
		}
	}
	return nil
}

func (l *FileLogic) exportItemRecursive(ctx context.Context, id string, currentDir string, format string) error {
	f, err := l.Get(ctx, id)
	if err != nil {
		return err
	}

	name := sanitizeName(f.Title)
	if name == "" {
		name = "Untitled"
	}

	if f.IsFolder {
		newDir := filepath.Join(currentDir, name)
		if err := os.MkdirAll(newDir, 0755); err != nil {
			return fmt.Errorf("create dir %s failed: %w", newDir, err)
		}

		children, err := l.GetChildren(ctx, id)
		if err != nil {
			return err
		}

		for _, child := range children {
			if err := l.exportItemRecursive(ctx, child.ID, newDir, format); err != nil {
				return err
			}
		}
	} else {
		ext := filepath.Ext(name)
		if ext != "" {
			name = strings.TrimSuffix(name, ext)
		}

		var outPath string
		var err error

		switch format {
		case "markdown", "md":
			name = name + ".md"
			outPath = filepath.Join(currentDir, name)
			err = ExportToMarkdown(f.Content, outPath)
		default:
			name = name + ".docx"
			outPath = filepath.Join(currentDir, name)
			err = ConvertToDocx(f.Content, outPath)
		}

		if err != nil {
			return fmt.Errorf("convert file %s failed: %w", name, err)
		}
	}
	return nil
}

func sanitizeName(name string) string {
	invalid := []string{"<", ">", ":", "\"", "/", "\\", "|", "?", "*"}
	for _, char := range invalid {
		name = strings.ReplaceAll(name, char, "_")
	}
	return strings.TrimSpace(name)
}

func decodeContent(b []byte, encoding string) (string, error) {
	enc := strings.ToLower(strings.TrimSpace(encoding))
	if enc == "" {
		det := chardet.NewTextDetector()
		if r, derr := det.DetectBest(b); derr == nil && r != nil {
			charset := strings.ToLower(r.Charset)
			switch charset {
			case "utf-8", "utf8":
				enc = "utf-8"
			case "gbk", "gb2312":
				enc = "gbk"
			case "gb18030":
				enc = "gb18030"
			case "shift_jis", "shift-jis":
				enc = "shift-jis"
			case "big5", "big5-hkscs":
				enc = "big5"
			case "euc-jp":
				enc = "euc-jp"
			case "euc-cn":
				enc = "euc-cn"
			case "iso-2022-cn":
				enc = "iso-2022-cn"
			default:
				enc = "utf-8"
			}
		} else {
			enc = "utf-8"
		}
	}
	switch enc {
	case "", "utf-8", "utf8":
		return string(b), nil
	case "gbk":
		r := transform.NewReader(bytes.NewReader(b), simplifiedchinese.GBK.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("GBK 解码失败: %w", err)
		}
		return string(decoded), nil
	case "gb18030":
		r := transform.NewReader(bytes.NewReader(b), simplifiedchinese.GB18030.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("GB18030 解码失败: %w", err)
		}
		return string(decoded), nil
	case "shift-jis", "shift_jis":
		r := transform.NewReader(bytes.NewReader(b), japanese.ShiftJIS.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("Shift-JIS 解码失败: %w", err)
		}
		return string(decoded), nil
	case "big5":
		r := transform.NewReader(bytes.NewReader(b), traditionalchinese.Big5.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("Big5 解码失败: %w", err)
		}
		return string(decoded), nil
	case "euc-jp":
		r := transform.NewReader(bytes.NewReader(b), japanese.EUCJP.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("EUC-JP 解码失败: %w", err)
		}
		return string(decoded), nil
	case "iso-2022-cn":
		r := transform.NewReader(bytes.NewReader(b), simplifiedchinese.GB18030.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("ISO-2022-CN 解码失败: %w", err)
		}
		return string(decoded), nil
	case "hz-gb-2312":
		r := transform.NewReader(bytes.NewReader(b), simplifiedchinese.HZGB2312.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("HZ-GB2312 解码失败: %w", err)
		}
		return string(decoded), nil
	case "iso-2022-jp":
		r := transform.NewReader(bytes.NewReader(b), japanese.ISO2022JP.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("ISO-2022-JP 解码失败: %w", err)
		}
		return string(decoded), nil
	case "euc-cn":
		r := transform.NewReader(bytes.NewReader(b), simplifiedchinese.GB18030.NewDecoder())
		decoded, err := io.ReadAll(r)
		if err != nil {
			return "", fmt.Errorf("EUC-CN 解码失败: %w", err)
		}
		return string(decoded), nil
	default:
		return "", fmt.Errorf("不支持的编码: %s", encoding)
	}
}
