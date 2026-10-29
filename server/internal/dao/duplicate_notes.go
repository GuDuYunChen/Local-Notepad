package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const DuplicateNotesLimit = 20000
const duplicateNotesBodyBudget = 64 * 1024 * 1024
const duplicateNoteBodyLimit = 16 * 1024 * 1024

type DuplicateNote struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	ParentID     string `json:"parent_id"`
	Folder       string `json:"folder"`
	UpdatedAt    int64  `json:"updated_at"`
	ContentHash  string `json:"content_hash"`
	ContentBytes int64  `json:"content_bytes"`
}
type DuplicateNoteGroup struct {
	Hash         string   `json:"hash"`
	IDs          []string `json:"ids"`
	ContentBytes int64    `json:"content_bytes"`
}
type DuplicateNoteTotals struct {
	Notes            int   `json:"notes"`
	Folders          int   `json:"folders"`
	Templates        int   `json:"templates"`
	Trash            int   `json:"trash"`
	Empty            int   `json:"empty"`
	Groups           int   `json:"groups"`
	DuplicateNotes   int   `json:"duplicate_notes"`
	AdditionalCopies int   `json:"additional_copies"`
	ContentBytes     int64 `json:"content_bytes"`
}
type DuplicateNotesSnapshot struct {
	Version    int                  `json:"version"`
	Complete   bool                 `json:"complete"`
	Revision   string               `json:"revision"`
	CapturedAt int64                `json:"captured_at"`
	Totals     DuplicateNoteTotals  `json:"totals"`
	Notes      []DuplicateNote      `json:"notes"`
	Groups     []DuplicateNoteGroup `json:"groups"`
}

// Compares exact saved UTF-8 bytes, not rendered text or semantic similarity.
// A single read transaction observes metadata and bodies. No writes or attachment reads.
func (d *FileDAO) DuplicateNotes(ctx context.Context) (*DuplicateNotesSnapshot, error) {
	return d.duplicateNotesAt(ctx, time.Now().UTC(), DuplicateNotesLimit, duplicateNotesBodyBudget)
}
func (d *FileDAO) duplicateNotesAt(ctx context.Context, now time.Time, limit int, budget int64) (*DuplicateNotesSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	var size, maximum int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN is_deleted=0 AND is_folder=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0),COALESCE(MAX(CASE WHEN is_deleted=0 AND is_folder=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0) FROM files`, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix).Scan(&count, &size, &maximum)
	if err != nil {
		return nil, err
	}
	if count > limit || size > budget || maximum > duplicateNoteBodyLimit {
		return nil, fmt.Errorf("超过完整检查上限（20000条、正文合计64MiB、单篇16MiB），未返回部分结果")
	}
	type meta struct {
		ID, Title, Parent string
		Updated           int64
		Folder, Deleted   bool
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,title,parent_id,updated_at,is_folder,is_deleted FROM files ORDER BY id`)
	if err != nil {
		return nil, err
	}
	all := make([]meta, 0, count)
	folders := map[string]string{}
	metadataBytes := 0
	for rows.Next() {
		var m meta
		if err = rows.Scan(&m.ID, &m.Title, &m.Parent, &m.Updated, &m.Folder, &m.Deleted); err != nil {
			rows.Close()
			return nil, err
		}
		metadataBytes += len(m.ID) + len(m.Title) + len(m.Parent)
		if err = ctx.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if len(all) >= limit || metadataBytes > 2*1024*1024 || !utf8.ValidString(m.ID) || !utf8.ValidString(m.Parent) || validateNoteTagID(m.ID) != nil || strings.IndexFunc(m.ID, unicode.IsControl) >= 0 || (m.Parent != "" && (validateNoteTagID(m.Parent) != nil || strings.IndexFunc(m.Parent, unicode.IsControl) >= 0)) || len(m.Title) > 4000 || !utf8.ValidString(m.Title) || m.Updated < 0 || m.Updated > 253402300799 {
			rows.Close()
			return nil, fmt.Errorf("元数据无效或超过完整检查上限")
		}
		all = append(all, m)
		if m.Folder && !m.Deleted && !strings.HasPrefix(m.Title, TemplatePrefix) {
			folders[m.ID] = m.Title
		}
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	out := &DuplicateNotesSnapshot{Version: 1, CapturedAt: now.Unix(), Notes: []DuplicateNote{}, Groups: []DuplicateNoteGroup{}}
	revision := sha256.New()
	enc := json.NewEncoder(revision)
	if err = enc.Encode(all); err != nil {
		return nil, err
	}
	bodies := map[string]string{}
	groups := map[string]*DuplicateNoteGroup{}
	for _, m := range all {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		if m.Deleted {
			out.Totals.Trash++
			continue
		}
		if m.Folder {
			out.Totals.Folders++
			continue
		}
		if strings.HasPrefix(m.Title, TemplatePrefix) {
			out.Totals.Templates++
			continue
		}
		var body string
		if err = tx.QueryRowContext(ctx, `SELECT content FROM files WHERE id=?`, m.ID).Scan(&body); err != nil {
			return nil, err
		}
		if !utf8.ValidString(body) {
			return nil, fmt.Errorf("正文编码无效，未采用部分结果")
		}
		digest := sha256.Sum256([]byte(body))
		hash := hex.EncodeToString(digest[:])
		n := DuplicateNote{ID: m.ID, Title: m.Title, ParentID: m.Parent, Folder: "根目录", UpdatedAt: m.Updated, ContentHash: hash, ContentBytes: int64(len(body))}
		if m.Parent != "" {
			if name, ok := folders[m.Parent]; ok {
				n.Folder = name
			} else {
				n.Folder = "位置不可用"
			}
		}
		out.Notes = append(out.Notes, n)
		out.Totals.Notes++
		out.Totals.ContentBytes += n.ContentBytes
		if err = enc.Encode(hash); err != nil {
			return nil, err
		}
		if len(body) == 0 {
			out.Totals.Empty++
			continue
		}
		if previous, ok := bodies[hash]; ok {
			// Never silently turn a digest collision into an equal-body assertion.
			if previous != body {
				return nil, fmt.Errorf("正文摘要存在歧义，检查已拒绝")
			}
			groups[hash].IDs = append(groups[hash].IDs, m.ID)
		} else {
			bodies[hash] = body
			groups[hash] = &DuplicateNoteGroup{Hash: hash, IDs: []string{m.ID}, ContentBytes: n.ContentBytes}
		}
	}
	for _, g := range groups {
		if len(g.IDs) >= 2 {
			out.Groups = append(out.Groups, *g)
			out.Totals.DuplicateNotes += len(g.IDs)
			out.Totals.AdditionalCopies += len(g.IDs) - 1
		}
	}
	sort.Slice(out.Groups, func(i, j int) bool { return out.Groups[i].Hash < out.Groups[j].Hash })
	out.Totals.Groups = len(out.Groups)
	out.Revision = hex.EncodeToString(revision.Sum(nil))
	if out.Totals.ContentBytes != size {
		return nil, fmt.Errorf("完整检查范围不一致")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out.Complete = true
	return out, nil
}
