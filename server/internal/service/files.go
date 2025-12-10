package service

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
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

// 文件服务：封装文件的创建、读取、更新、删除
type FileService struct {
	DB *sql.DB
}

// 创建文件或文件夹
func (s *FileService) Create(ctx context.Context, title, content string, isFolder bool, parentID string) (*model.File, error) {
	now := time.Now().Unix()
	id := uuid.New().String()
	// 新建项默认排序在最前（假设 SortOrder 越大越靠前，或者使用 updated_at）
	// 这里我们初始化 SortOrder 为 now，方便排序
	_, err := s.DB.ExecContext(ctx, `INSERT INTO files (id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`, id, title, content, now, now, isFolder, parentID, now)
	if err != nil {
		return nil, fmt.Errorf("创建文件失败: %w", err)
	}
	return &model.File{ID: id, Title: title, Content: content, CreatedAt: now, UpdatedAt: now, IsFolder: isFolder, ParentID: parentID, SortOrder: now, IsDeleted: false}, nil
}

// 获取文件
func (s *FileService) Get(ctx context.Context, id string) (*model.File, error) {
	var f model.File
	row := s.DB.QueryRowContext(ctx, `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted FROM files WHERE id = ? AND is_deleted = 0`, id)
	if err := row.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("文件不存在: %w", err)
		}
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	return &f, nil
}

// 更新文件
func (s *FileService) Update(ctx context.Context, id string, title, content, parentID *string, sortOrder *int64, isDeleted *bool) (*model.File, error) {
	f, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
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

	// Prevent updating if file is deleted (unless restoring)
	if f.IsDeleted && (isDeleted == nil || *isDeleted) {
		if isDeleted == nil || *isDeleted == true {
			return nil, fmt.Errorf("文件已删除，无法更新")
		}
	}

	// 检查重名冲突 (如果修改了 Title 或 ParentID)
	newTitle := f.Title
	newParentID := f.ParentID
	checkConflict := false
	if title != nil {
		newTitle = *title
		checkConflict = true
	}
	if parentID != nil {
		newParentID = *parentID
		checkConflict = true
	}

	if checkConflict {
		var count int
		err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE parent_id = ? AND title = ? AND id != ? AND is_deleted = 0", newParentID, newTitle, id).Scan(&count)
		if err != nil {
			return nil, fmt.Errorf("检查重名失败: %w", err)
		}
		if count > 0 {
			return nil, fmt.Errorf("目标位置已存在同名文件或文件夹: %s", newTitle)
		}
	}

	f.UpdatedAt = time.Now().Unix()
	_, err = s.DB.ExecContext(ctx, `UPDATE files SET title = ?, content = ?, parent_id = ?, sort_order = ?, is_deleted = ?, updated_at = ? WHERE id = ?`, f.Title, f.Content, f.ParentID, f.SortOrder, f.IsDeleted, f.UpdatedAt, id)
	if err != nil {
		return nil, fmt.Errorf("更新文件失败: %w", err)
	}

	// 记录操作日志
	if parentID != nil || sortOrder != nil {
		log.Printf("[Move] File %s (%s) moved to Parent: %s, Order: %d", f.Title, f.ID, f.ParentID, f.SortOrder)
	}

	return f, nil
}

// 删除文件 (Recursive Soft Delete)
func (s *FileService) Delete(ctx context.Context, id string) error {
	// 使用递归 CTE 查找所有子文件
	// 注意：SQLite CTE 支持递归
	query := `
	WITH RECURSIVE sub(id) AS (
		SELECT id FROM files WHERE id = ?
		UNION ALL
		SELECT f.id FROM files f JOIN sub ON f.parent_id = sub.id
	)
	UPDATE files SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id IN sub;
	`
	now := time.Now().Unix()
	_, err := s.DB.ExecContext(ctx, query, id, now, now)
	if err != nil {
		return fmt.Errorf("删除文件失败: %w", err)
	}
	return nil
}

// CleanupOldDeleted 清理超过 30 天的已删除文件
func (s *FileService) CleanupOldDeleted(ctx context.Context) error {
	threshold := time.Now().Add(-30 * 24 * time.Hour).Unix()
	_, err := s.DB.ExecContext(ctx, `DELETE FROM files WHERE is_deleted = 1 AND deleted_at < ?`, threshold)
	if err != nil {
		return fmt.Errorf("清理旧文件失败: %w", err)
	}
	return nil
}

// 列出文件（按 SortOrder 降序, IsFolder 降序）
func (s *FileService) List(ctx context.Context, q string, page, size int) ([]*model.File, error) {
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	offset := (page - 1) * size
	// 注意：SQLite boolean true is 1. ORDER BY is_folder DESC means folders first.
	// 需求调整：支持文件夹和文件混合排序，因此移除 is_folder DESC
	// 按 sort_order DESC 排序
	query := `SELECT id, title, content, created_at, updated_at, is_folder, parent_id, sort_order, is_deleted FROM files WHERE is_deleted = 0 AND (title LIKE ? OR content LIKE ?) ORDER BY sort_order DESC LIMIT ? OFFSET ?`
	rows, err := s.DB.QueryContext(ctx, query, "%"+q+"%", "%"+q+"%", size, offset)
	if err != nil {
		return nil, fmt.Errorf("查询文件失败: %w", err)
	}
	defer rows.Close()
	var out []*model.File
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted); err != nil {
			return nil, fmt.Errorf("解析文件失败: %w", err)
		}
		out = append(out, &f)
	}
	return out, nil
}

// 另存为：将指定文件内容写入到给定路径，支持编码（当前仅utf-8）
func (s *FileService) SaveAs(ctx context.Context, id string, path string, encoding string) error {
	f, err := s.Get(ctx, id)
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
		// 无需转码
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
		// 使用 GB18030 编码近似支持 EUC-CN
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
		// 使用 GB18030 近似支持 ISO-2022-CN
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

// 批量导入
func (s *FileService) BatchImport(ctx context.Context, paths []string, encoding string) ([]*model.File, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
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

	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		f, err := s.importPathWithTx(ctx, stmt, path, encoding)
		if err != nil {
			return nil, fmt.Errorf("导入 %s 失败: %w", path, err)
		}
		results = append(results, f)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}
	return results, nil
}

// 内部辅助：使用事务导入单个文件
func (s *FileService) importPathWithTx(ctx context.Context, stmt *sql.Stmt, path string, encoding string) (*model.File, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("路径解析失败: %w", err)
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	// ... (编码转换逻辑与 ImportPath 相同，这里简化复用)
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

// 提取出的解码逻辑
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

// 导入：从本地路径读取文本并创建新文件，支持编码（当前仅utf-8）
func (s *FileService) ImportPath(ctx context.Context, path string, encoding string) (*model.File, error) {
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
	return s.Create(ctx, title, content, false, "")
}
