package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"notepad-server/internal/tasklist"
	"strings"
	"time"
	"unicode/utf8"
)

type TaskCenterNote struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	UpdatedAt   int64  `json:"updated_at"`
	ContentHash string `json:"content_hash"`
	Supported   bool   `json:"supported"`
}
type TaskCenterItem struct {
	tasklist.Item
	NoteID string `json:"note_id"`
}
type TaskCenterTotals struct {
	Notes       int `json:"notes"`
	WithTasks   int `json:"with_tasks"`
	Unsupported int `json:"unsupported"`
	Tasks       int `json:"tasks"`
	Pending     int `json:"pending"`
	Done        int `json:"done"`
	Folders     int `json:"folders"`
	Templates   int `json:"templates"`
	Trash       int `json:"trash"`
}
type TaskCenterSnapshot struct {
	Version    int              `json:"version"`
	Complete   bool             `json:"complete"`
	Revision   string           `json:"revision"`
	CapturedAt int64            `json:"captured_at"`
	Totals     TaskCenterTotals `json:"totals"`
	Notes      []TaskCenterNote `json:"notes"`
	Items      []TaskCenterItem `json:"items"`
}

func (d *FileDAO) TaskCenter(ctx context.Context) (*TaskCenterSnapshot, error) {
	return d.taskCenter(ctx, LibraryStatisticsLimit, libraryStatisticsBytes)
}
func (d *FileDAO) taskCenter(ctx context.Context, limit int, budget int64) (*TaskCenterSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	var total, max int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN is_folder=0 AND is_deleted=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0),COALESCE(MAX(CASE WHEN is_folder=0 AND is_deleted=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0) FROM files`, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix).Scan(&count, &total, &max)
	if err != nil {
		return nil, err
	}
	if count > limit || total > budget || max > libraryStatisticsNoteBytes {
		return nil, fmt.Errorf("资料库超过待办完整读取上限，未返回部分结果")
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,title,updated_at,is_folder,is_deleted,CASE WHEN is_folder=0 AND is_deleted=0 AND substr(title,1,?)!=? THEN content ELSE '' END FROM files ORDER BY id`, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix)
	if err != nil {
		return nil, err
	}
	out := &TaskCenterSnapshot{Version: 1, Complete: true, CapturedAt: time.Now().Unix(), Notes: []TaskCenterNote{}, Items: []TaskCenterItem{}}
	hash := sha256.New()
	enc := json.NewEncoder(hash)
	metadata := 0
	for rows.Next() {
		var id, title, body string
		var updated int64
		var folder, deleted bool
		if err = rows.Scan(&id, &title, &updated, &folder, &deleted, &body); err != nil {
			rows.Close()
			return nil, err
		}
		if err = ctx.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		metadata += len(id) + len(title)
		if validateNoteTagID(id) != nil || !utf8.ValidString(title) || len(title) > 4000 || !utf8.ValidString(body) || metadata > 2*1024*1024 || updated < 0 || updated > 253402300799 {
			rows.Close()
			return nil, fmt.Errorf("待办来源元数据无效或超过上限")
		}
		enc.Encode([]any{id, title, updated, folder, deleted})
		if deleted {
			out.Totals.Trash++
			continue
		}
		if folder {
			out.Totals.Folders++
			continue
		}
		if strings.HasPrefix(title, TemplatePrefix) {
			out.Totals.Templates++
			continue
		}
		sum := sha256.Sum256([]byte(body))
		contentHash := hex.EncodeToString(sum[:])
		enc.Encode(contentHash)
		parsed := tasklist.Extract(body)
		if parsed.TooLarge || len(out.Items)+len(parsed.Items) > tasklist.MaxTasks {
			rows.Close()
			return nil, fmt.Errorf("待办结构或数量超过完整读取上限")
		}
		out.Notes = append(out.Notes, TaskCenterNote{id, title, updated, contentHash, parsed.Supported})
		out.Totals.Notes++
		if !parsed.Supported {
			out.Totals.Unsupported++
		}
		if len(parsed.Items) > 0 {
			out.Totals.WithTasks++
		}
		for _, item := range parsed.Items {
			out.Items = append(out.Items, TaskCenterItem{item, id})
			out.Totals.Tasks++
			if item.Done {
				out.Totals.Done++
			} else {
				out.Totals.Pending++
			}
		}
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	out.Revision = hex.EncodeToString(hash.Sum(nil))
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if len(raw) > 8*1024*1024 {
		return nil, fmt.Errorf("待办清单超过完整响应上限")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
