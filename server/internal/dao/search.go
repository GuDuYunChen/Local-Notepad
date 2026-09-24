package dao

import (
	"context"
	"database/sql"
	"notepad-server/internal/model"
	notesearch "notepad-server/internal/search"
)

// GlobalSearch uses one read transaction for folder metadata and note bodies.
// Bodies are processed one row at a time; only bounded excerpts reach the renderer.
// Parsing is reused by current body hash; results and revisions are never cached.
func (d *FileDAO) GlobalSearch(ctx context.Context, options notesearch.Options) (notesearch.Response, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return notesearch.Response{}, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,title,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files ORDER BY id`)
	if err != nil {
		return notesearch.Response{}, err
	}
	files := []model.File{}
	for rows.Next() {
		var f model.File
		if err = rows.Scan(&f.ID, &f.Title, &f.CreatedAt, &f.UpdatedAt, &f.IsFolder, &f.ParentID, &f.SortOrder, &f.IsDeleted, &f.DeletedAt, &f.IsPinned); err != nil {
			rows.Close()
			return notesearch.Response{}, err
		}
		files = append(files, f)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return notesearch.Response{}, err
	}
	engine, err := notesearch.NewWithCache(options, files, &d.searchCache)
	if err != nil {
		return notesearch.Response{}, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT id,content FROM files WHERE is_deleted=0 AND is_folder=0 ORDER BY id`)
	if err != nil {
		return notesearch.Response{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, content string
		if err = rows.Scan(&id, &content); err != nil {
			return notesearch.Response{}, err
		}
		if err = engine.Add(ctx, id, content); err != nil {
			return notesearch.Response{}, err
		}
	}
	if err = rows.Err(); err != nil {
		return notesearch.Response{}, err
	}
	return engine.Finish()
}
