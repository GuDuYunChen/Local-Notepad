package dao

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"notepad-server/internal/model"
	"time"
)

// A receipt is never deleted by version-history pruning. Pending maintenance
// retains the old/new structures even after closing the renderer or restarting.
const EditorSavesSchema = `CREATE TABLE IF NOT EXISTS editor_save_ops (
 request_id TEXT PRIMARY KEY NOT NULL,
 file_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 receipt_json TEXT NOT NULL DEFAULT '',
 before_content TEXT NOT NULL DEFAULT '',
 after_content TEXT NOT NULL DEFAULT '',
 section_mappings TEXT NOT NULL DEFAULT '[]',
 state TEXT NOT NULL DEFAULT 'done' CHECK(state IN ('pending','manual','done','obsolete')),
 created_at INTEGER NOT NULL
)`
const EditorSavesIndex = `CREATE INDEX IF NOT EXISTS idx_editor_save_ops_pending ON editor_save_ops(state,created_at,request_id)`
const EditorSavesDelete = `CREATE TRIGGER IF NOT EXISTS editor_save_ops_delete AFTER DELETE ON files BEGIN
 UPDATE editor_save_ops SET before_content='',after_content='',section_mappings='[]',receipt_json='',state='obsolete' WHERE file_id=old.id;
END`

func editorFile(ctx context.Context, tx *sql.Tx, id string) (*model.File, error) {
	f := &model.File{}
	err := tx.QueryRowContext(ctx, `SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files WHERE id=? AND is_deleted=0`, id).
		Scan(&f.ID, &f.Title, &f.Content, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned)
	return f, err
}
func syncEditorLinks(ctx context.Context, tx *sql.Tx, id string, links []string, now int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM links WHERE source_id=?`, id); err != nil {
		return err
	}
	for _, target := range links {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO links(source_id,target_id,created_at) VALUES(?,?,?)`, id, target, now); err != nil {
			return err
		}
	}
	return nil
}

func (d *FileDAO) SaveEditor(ctx context.Context, id string, in model.EditorSaveInput, hash string, structureChanged func(string, string) bool, links []string) (*model.EditorSaveResult, error) {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	// Obtain the SQLite write reservation BEFORE reading any mutable state.
	reservation, err := tx.ExecContext(ctx, `INSERT INTO editor_save_ops(request_id,file_id,payload_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(request_id) DO NOTHING`, in.RequestID, id, hash, now)
	if err != nil {
		return nil, err
	}
	n, err := reservation.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		var priorID, priorHash, receipt, state string
		if err = tx.QueryRowContext(ctx, `SELECT file_id,payload_hash,receipt_json,state FROM editor_save_ops WHERE request_id=?`, in.RequestID).Scan(&priorID, &priorHash, &receipt, &state); err != nil {
			return nil, err
		}
		if priorID != id || priorHash != hash || receipt == "" {
			return nil, fmt.Errorf("保存请求已对应其他内容或笔记已删除，未重复写入")
		}
		// A stored receipt proves an earlier commit, not the CURRENT body.
		// Read under the same write reservation so the returned outcome and
		// body describe one database observation. Replays never write files.
		var recorded struct {
			Rejected bool `json:"editor_save_rejected"`
		}
		if err = json.Unmarshal([]byte(receipt), &recorded); err != nil {
			return nil, err
		}
		if state == "obsolete" && !recorded.Rejected {
			return nil, fmt.Errorf("保存请求已失效，未重复写入")
		}
		current, err := editorFile(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		outcome := "applied"
		if recorded.Rejected {
			outcome = "conflict"
		} else if current.Content != in.Content {
			outcome = "superseded"
		}
		return &model.EditorSaveResult{File: current, SaveReceipt: model.EditorSaveReceipt{
			RequestID: in.RequestID, Outcome: outcome, ReferencePending: state == "pending" || state == "manual",
		}}, nil
	}
	f, err := editorFile(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if f.IsFolder {
		return nil, fmt.Errorf("目标不是笔记，未写入")
	}
	if f.Content != in.Expected {
		// Persist a terminal non-writing decision. Dropping the reservation
		// here would let a delayed duplicate apply if the body later reverted
		// to Expected, even after the user had resolved the conflict.
		metadata := *f
		metadata.Content = ""
		encoded, e := json.Marshal(struct {
			*model.File
			Rejected bool `json:"editor_save_rejected"`
		}{&metadata, true})
		if e != nil {
			return nil, e
		}
		if _, err = tx.ExecContext(ctx, `UPDATE editor_save_ops SET receipt_json=?,state='obsolete' WHERE request_id=?`, string(encoded), in.RequestID); err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return &model.EditorSaveResult{File: f, SaveReceipt: model.EditorSaveReceipt{RequestID: in.RequestID, Outcome: "conflict"}}, nil
	}
	changed := structureChanged(f.Content, in.Content)
	before := f.Content
	if before != in.Content {
		if _, err = tx.ExecContext(ctx, `INSERT INTO file_versions(file_id,title,content,created_at) VALUES(?,?,?,?)`, id, f.Title, before, now); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE files SET content=?,updated_at=? WHERE id=? AND content=? AND is_deleted=0`, in.Content, now, id, before); err != nil {
			return nil, err
		}
		if err = syncEditorLinks(ctx, tx, id, links, now); err != nil {
			return nil, err
		}
		f.Content = in.Content
		f.UpdatedAt = now
	}
	// Store the receipt metadata without retaining another full body indefinitely.
	metadata := *f
	metadata.Content = ""
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	state, oldText, newText, mappings := "done", "", "", "[]"
	if changed {
		state = "pending"
		oldText = before
		newText = in.Content
		mappings = in.Mappings
	}
	if _, err = tx.ExecContext(ctx, `UPDATE editor_save_ops SET receipt_json=?,before_content=?,after_content=?,section_mappings=?,state=? WHERE request_id=?`, string(encoded), oldText, newText, mappings, state, in.RequestID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM file_versions WHERE file_id=? AND id NOT IN (SELECT id FROM file_versions WHERE file_id=? ORDER BY created_at DESC,id DESC LIMIT 50)`, id, id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &model.EditorSaveResult{File: f, SaveReceipt: model.EditorSaveReceipt{RequestID: in.RequestID, Outcome: "applied", ReferencePending: changed}}, nil
}

func (d *FileDAO) EditorReferenceJobs(ctx context.Context) ([]model.EditorReferenceJob, error) {
	rows, err := d.DB.QueryContext(ctx, `SELECT o.request_id,o.file_id,f.title,o.before_content,o.after_content,o.section_mappings,o.state FROM editor_save_ops o JOIN files f ON f.id=o.file_id WHERE o.state IN ('pending','manual') AND f.is_deleted=0 ORDER BY o.created_at,o.rowid LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.EditorReferenceJob{}
	for rows.Next() {
		var j model.EditorReferenceJob
		if err = rows.Scan(&j.RequestID, &j.FileID, &j.Title, &j.Before, &j.After, &j.Mappings, &j.State); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (d *FileDAO) CompleteEditorReferences(ctx context.Context, requestID string, in model.ReferenceCompletion) error {
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Lock before comparing source content. No read-then-unconditional-write race.
	if _, err = tx.ExecContext(ctx, `UPDATE editor_save_ops SET state=state WHERE request_id=?`, requestID); err != nil {
		return err
	}
	var target, state string
	if err = tx.QueryRowContext(ctx, `SELECT file_id,state FROM editor_save_ops WHERE request_id=?`, requestID).Scan(&target, &state); err != nil {
		return err
	}
	if state == "done" || state == "obsolete" {
		return nil
	}
	if in.State == "done" {
		f, e := editorFile(ctx, tx, target)
		if e != nil {
			return e
		}
		if f.Content != in.TargetContent {
			return fmt.Errorf("目标已变化，引用任务保留待重试")
		}
		now := time.Now().Unix()
		for _, u := range in.Updates {
			source, e := editorFile(ctx, tx, u.ID)
			if e != nil {
				return e
			}
			if source.Content != u.Expected {
				return fmt.Errorf("来源正文已变化，未覆盖，引用任务保留待重试")
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO file_versions(file_id,title,content,created_at) VALUES(?,?,?,?)`, u.ID, source.Title, source.Content, now); err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE files SET content=?,updated_at=? WHERE id=?`, u.Content, now, u.ID); err != nil {
				return err
			}
			if err = syncEditorLinks(ctx, tx, u.ID, u.Links, now); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE editor_save_ops SET state='done',before_content='',after_content='',section_mappings='[]' WHERE request_id=?`, requestID)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE editor_save_ops SET state='manual' WHERE request_id=?`, requestID)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
