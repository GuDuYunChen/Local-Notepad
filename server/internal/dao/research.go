package dao

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"notepad-server/internal/model"
	"time"
)

const ResearchRequestsSchema = `CREATE TABLE IF NOT EXISTS research_note_requests (
 request_id TEXT PRIMARY KEY NOT NULL,
 payload_sha256 TEXT NOT NULL,
 file_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 parent_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
)`

// No foreign key to files: deleting a note must not erase its replay guard.
type researchQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readResearchReceipt(ctx context.Context, q researchQuerier, requestID string) (*model.ResearchReceipt, error) {
	r := &model.ResearchReceipt{RequestID: requestID}
	err := q.QueryRowContext(ctx, `SELECT r.payload_sha256,r.file_id,r.title,r.parent_id,r.created_at,
 CASE WHEN f.id IS NULL THEN 'missing' WHEN f.is_deleted=1 THEN 'deleted' ELSE 'available' END
 FROM research_note_requests r LEFT JOIN files f ON f.id=r.file_id WHERE r.request_id=?`, requestID).
		Scan(&r.PayloadSHA256, &r.FileID, &r.Title, &r.ParentID, &r.CreatedAt, &r.State)
	if errors.Is(err, sql.ErrNoRows) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	r.Found = true
	return r, nil
}

func (d *FileDAO) ResearchReceipt(ctx context.Context, requestID string) (*model.ResearchReceipt, error) {
	return readResearchReceipt(ctx, d.DB, requestID)
}

// The reservation is the FIRST SQL statement, obtaining SQLite's write lock
// before any read. Reservation, file, FTS triggers and links commit together.
// A failed/aborted transaction publishes none of them. A retry uses the same
// request ID and payload hash; it never relies on a title search for identity.
func (d *FileDAO) CreateResearch(ctx context.Context, requestID, hash string, f *model.File, links []string) (*model.ResearchReceipt, error) {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	reserved, err := tx.ExecContext(ctx, `INSERT INTO research_note_requests(request_id,payload_sha256,file_id,title,parent_id,created_at)
 VALUES(?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING`, requestID, hash, f.ID, f.Title, f.ParentID, now)
	if err != nil {
		return nil, err
	}
	added, err := reserved.RowsAffected()
	if err != nil {
		return nil, err
	}
	if added == 0 {
		receipt, err := readResearchReceipt(ctx, tx, requestID)
		if err != nil {
			return nil, err
		}
		if !receipt.Found || receipt.PayloadSHA256 != hash {
			return nil, fmt.Errorf("此研究任务已绑定不同内容，未覆盖原笔记或重新创建")
		}
		return receipt, nil // read of an existing receipt needs no write commit
	}
	// Validate the entire parent chain without loops or deleted ancestors.
	seen := make(map[string]bool)
	for id := f.ParentID; id != ""; {
		if seen[id] {
			return nil, fmt.Errorf("目标目录结构存在循环，未创建")
		}
		seen[id] = true
		var folder, deleted bool
		var parent string
		if err := tx.QueryRowContext(ctx, `SELECT is_folder,is_deleted,parent_id FROM files WHERE id=?`, id).Scan(&folder, &deleted, &parent); err != nil {
			return nil, fmt.Errorf("目标目录不存在或不可读取，未改存根目录: %w", err)
		}
		if !folder || deleted {
			return nil, fmt.Errorf("目标目录或上级目录不可用，未创建")
		}
		id = parent
	}
	var duplicate int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM files WHERE parent_id=? AND title=? COLLATE NOCASE AND is_deleted=0`, f.ParentID, f.Title).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate > 0 {
		return nil, fmt.Errorf("已存在同名文件或文件夹，未覆盖；请另存一份新标题的研究草稿")
	}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sort_order),0)+1000 FROM files WHERE parent_id=? AND is_deleted=0`, f.ParentID).Scan(&f.SortOrder); err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned)
 VALUES(?,?,?,?,?,0,?,?,0,0,0)`, f.ID, f.Title, f.Content, now, now, f.ParentID, f.SortOrder)
	if err != nil {
		return nil, err
	}
	for _, id := range links {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO links(source_id,target_id,created_at) VALUES(?,?,?)`, f.ID, id, now); err != nil {
			return nil, err
		}
	}
	r := &model.ResearchReceipt{Found: true, RequestID: requestID, PayloadSHA256: hash, FileID: f.ID, Title: f.Title, ParentID: f.ParentID, CreatedAt: now, State: "available"}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r, nil
}
