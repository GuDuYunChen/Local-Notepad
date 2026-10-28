package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

const TagWorkspaceLinkLimit = 50000
const TagWorkspacePageSize = 50

var tagWorkspaceColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var tagWorkspaceRevision = regexp.MustCompile(`^[0-9a-f]{64}$`)

type WorkspaceTag struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	ActiveCount int    `json:"active_count"`
	HiddenCount int    `json:"hidden_count"`
	TotalCount  int    `json:"total_count"`
}
type TagWorkspaceSnapshot struct {
	Version  int             `json:"version"`
	Complete bool            `json:"complete"`
	Revision string          `json:"revision"`
	Tags     []*WorkspaceTag `json:"tags"`
}
type workspaceTagLink struct {
	TagID, FileID, Title string
	Folder, Deleted      bool
}
type TagWorkspaceNote struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
type TagWorkspacePage struct {
	TagID    string             `json:"tag_id"`
	Revision string             `json:"revision"`
	Complete bool               `json:"complete"`
	Offset   int                `json:"offset"`
	Total    int                `json:"total"`
	HasMore  bool               `json:"has_more"`
	Notes    []TagWorkspaceNote `json:"notes"`
}
type TagWorkspaceChange struct {
	RequestID        string `json:"request_id"`
	Kind             string `json:"kind"`
	ExpectedRevision string `json:"expected_revision"`
	ID               string `json:"id"`
	TargetID         string `json:"target_id"`
	Name             string `json:"name"`
	Color            string `json:"color"`
}
type TagWorkspaceResult struct {
	RequestID      string                `json:"request_id"`
	Kind           string                `json:"kind"`
	BeforeRevision string                `json:"before_revision"`
	Snapshot       *TagWorkspaceSnapshot `json:"snapshot"`
}

func activeWorkspaceLink(link workspaceTagLink) bool {
	return !link.Folder && !link.Deleted && !strings.HasPrefix(link.Title, TemplatePrefix)
}

// Reads one complete metadata snapshot inside the same transaction used for a
// mutation. Never read note bodies, invent missing relationships or hash partial
// data. Hidden relationships (trash, folders, templates) remain visible as counts.
func tagWorkspaceInTx(ctx context.Context, tx *sql.Tx) (*TagWorkspaceSnapshot, []workspaceTagLink, error) {
	out := &TagWorkspaceSnapshot{Version: 1, Complete: true, Tags: make([]*WorkspaceTag, 0)}
	rows, err := tx.QueryContext(ctx, `SELECT id,name,COALESCE(color,'') FROM tags ORDER BY name COLLATE NOCASE,id LIMIT 501`)
	if err != nil {
		return nil, nil, err
	}
	byID := make(map[string]*WorkspaceTag)
	for rows.Next() {
		tag := &WorkspaceTag{}
		if err = rows.Scan(&tag.ID, &tag.Name, &tag.Color); err != nil {
			rows.Close()
			return nil, nil, err
		}
		if err = validateNoteTagID(tag.ID); err != nil || len(tag.Name) == 0 || len(tag.Name) > 4000 || len(tag.Color) > 1000 {
			rows.Close()
			return nil, nil, fmt.Errorf("标签库包含无效记录，未采用不完整列表")
		}
		out.Tags = append(out.Tags, tag)
		byID[tag.ID] = tag
	}
	err = errors.Join(rows.Err(), rows.Close())
	if err != nil {
		return nil, nil, err
	}
	if len(out.Tags) > NoteTagCatalogLimit {
		return nil, nil, fmt.Errorf("标签库超过500项完整读取上限")
	}
	rows, err = tx.QueryContext(ctx, `SELECT ft.tag_id,ft.file_id,f.title,f.is_folder,f.is_deleted FROM file_tags ft LEFT JOIN files f ON f.id=ft.file_id ORDER BY ft.tag_id,ft.file_id LIMIT 50001`)
	if err != nil {
		return nil, nil, err
	}
	links := make([]workspaceTagLink, 0)
	for rows.Next() {
		var l workspaceTagLink
		if err = rows.Scan(&l.TagID, &l.FileID, &l.Title, &l.Folder, &l.Deleted); err != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("标签关联指向缺失或无效笔记，未修改数据")
		}
		tag := byID[l.TagID]
		if tag == nil || validateNoteTagID(l.FileID) != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("标签关联不完整，未修改数据")
		}
		tag.TotalCount++
		if activeWorkspaceLink(l) {
			tag.ActiveCount++
		} else {
			tag.HiddenCount++
		}
		links = append(links, l)
	}
	err = errors.Join(rows.Err(), rows.Close())
	if err != nil {
		return nil, nil, err
	}
	if len(links) > TagWorkspaceLinkLimit {
		return nil, nil, fmt.Errorf("标签关联超过50000项完整核对上限")
	}
	data, err := json.Marshal(struct {
		Tags  []*WorkspaceTag
		Links []workspaceTagLink
	}{out.Tags, links})
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.Sum256(data)
	out.Revision = hex.EncodeToString(digest[:])
	return out, links, nil
}
func (d *TagDAO) TagWorkspace(ctx context.Context) (*TagWorkspaceSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out, _, err := tagWorkspaceInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
func (d *TagDAO) TagWorkspaceNotes(ctx context.Context, id, revision string, offset int) (*TagWorkspacePage, error) {
	if validateNoteTagID(id) != nil || !tagWorkspaceRevision.MatchString(revision) || offset < 0 || offset > TagWorkspaceLinkLimit || offset%TagWorkspacePageSize != 0 {
		return nil, fmt.Errorf("标签分页或读取版本无效")
	}
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	snapshot, links, err := tagWorkspaceInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if snapshot.Revision != revision {
		return nil, fmt.Errorf("标签库已变化，请重新读取后查看")
	}
	found := false
	for _, tag := range snapshot.Tags {
		if tag.ID == id {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("标签已不存在，请重新读取")
	}
	notes := make([]TagWorkspaceNote, 0)
	for _, link := range links {
		if link.TagID == id && activeWorkspaceLink(link) {
			notes = append(notes, TagWorkspaceNote{ID: link.FileID, Title: link.Title})
		}
	}
	if offset > len(notes) {
		return nil, fmt.Errorf("分页位置已失效")
	}
	end := offset + TagWorkspacePageSize
	if end > len(notes) {
		end = len(notes)
	}
	out := &TagWorkspacePage{TagID: id, Revision: revision, Complete: true, Offset: offset, Total: len(notes), HasMore: end < len(notes), Notes: notes[offset:end]}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
func (d *TagDAO) ChangeTagWorkspace(ctx context.Context, in TagWorkspaceChange) (*TagWorkspaceResult, error) {
	if _, err := uuid.Parse(in.RequestID); err != nil {
		return nil, fmt.Errorf("操作身份无效")
	}
	if !tagWorkspaceRevision.MatchString(in.ExpectedRevision) || validateNoteTagID(in.ID) != nil {
		return nil, fmt.Errorf("必须提供确认时的完整标签版本与身份")
	}
	switch in.Kind {
	case "create", "rename":
		if err := ValidateNoteTagName(in.Name); err != nil {
			return nil, err
		}
		if !tagWorkspaceColor.MatchString(in.Color) || in.TargetID != "" {
			return nil, fmt.Errorf("标签颜色或操作范围无效")
		}
		if in.Kind == "create" {
			if _, err := uuid.Parse(in.ID); err != nil {
				return nil, fmt.Errorf("新标签身份无效")
			}
		}
	case "merge":
		if validateNoteTagID(in.TargetID) != nil || in.TargetID == in.ID || in.Name != "" || in.Color != "" {
			return nil, fmt.Errorf("请选择不同的目标标签")
		}
	case "delete":
		if in.TargetID != "" || in.Name != "" || in.Color != "" {
			return nil, fmt.Errorf("删除操作范围无效")
		}
	default:
		return nil, fmt.Errorf("不支持的标签操作")
	}
	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Reserve the SQLite writer BEFORE reading, so the comparison and the entire
	// union/rename/delete are atomic with concurrent note-tag operations.
	if _, err = tx.ExecContext(ctx, `DELETE FROM file_tags WHERE 0`); err != nil {
		return nil, err
	}
	before, _, err := tagWorkspaceInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if before.Revision != in.ExpectedRevision {
		return nil, fmt.Errorf("标签库或关联已变化，未覆盖；请重新读取并确认")
	}
	byID := make(map[string]*WorkspaceTag)
	for _, tag := range before.Tags {
		byID[tag.ID] = tag
	}
	if in.Kind != "create" && byID[in.ID] == nil {
		return nil, fmt.Errorf("源标签不存在")
	}
	if in.Kind == "create" {
		if byID[in.ID] != nil || len(before.Tags) >= NoteTagCatalogLimit {
			return nil, fmt.Errorf("标签身份已存在或已达到500项上限")
		}
	}
	if in.Kind == "create" || in.Kind == "rename" {
		for _, tag := range before.Tags {
			if tag.Name == in.Name && tag.ID != in.ID {
				return nil, fmt.Errorf("同名标签已存在，请选择合并而非覆盖")
			}
		}
	}
	switch in.Kind {
	case "create":
		_, err = tx.ExecContext(ctx, `INSERT INTO tags(id,name,color) VALUES(?,?,?)`, in.ID, in.Name, in.Color)
	case "rename":
		_, err = tx.ExecContext(ctx, `UPDATE tags SET name=?,color=? WHERE id=?`, in.Name, in.Color, in.ID)
	case "merge":
		if byID[in.TargetID] == nil {
			return nil, fmt.Errorf("目标标签不存在")
		}
		_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO file_tags(file_id,tag_id) SELECT file_id,? FROM file_tags WHERE tag_id=?`, in.TargetID, in.ID)
		if err != nil {
			return nil, err
		}
		fallthrough
	case "delete":
		if _, err = tx.ExecContext(ctx, `DELETE FROM file_tags WHERE tag_id=?`, in.ID); err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM tags WHERE id=?`, in.ID)
	}
	if err != nil {
		return nil, err
	}
	after, _, err := tagWorkspaceInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &TagWorkspaceResult{RequestID: in.RequestID, Kind: in.Kind, BeforeRevision: in.ExpectedRevision, Snapshot: after}, nil
}
