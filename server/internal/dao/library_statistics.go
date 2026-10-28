package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	notesearch "notepad-server/internal/search"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const LibraryStatisticsLimit = 20000
const libraryStatisticsBytes = 64 * 1024 * 1024
const libraryStatisticsNoteBytes = 16 * 1024 * 1024

type LibraryStatisticsTotals struct {
	Notes        int   `json:"notes"`
	Folders      int   `json:"folders"`
	Templates    int   `json:"templates"`
	Trash        int   `json:"trash"`
	Tags         int   `json:"tags"`
	UnusedTags   int   `json:"unused_tags"`
	Tagged       int   `json:"tagged"`
	Pinned       int   `json:"pinned"`
	NoText       int   `json:"no_text"`
	Unsupported  int   `json:"unsupported"`
	Characters   int   `json:"characters"`
	ContentBytes int64 `json:"content_bytes"`
}
type LibraryStatisticsNote struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Folder        string `json:"folder"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
	Pinned        bool   `json:"pinned"`
	TagCount      int    `json:"tag_count"`
	Characters    int    `json:"characters"`
	ContentBytes  int64  `json:"content_bytes"`
	TextSupported bool   `json:"text_supported"`
}
type LibraryStatisticsDay struct {
	Day     string `json:"day"`
	Created int    `json:"created"`
	Updated int    `json:"updated"`
}
type LibraryStatisticsSnapshot struct {
	Version    int                     `json:"version"`
	Complete   bool                    `json:"complete"`
	Revision   string                  `json:"revision"`
	CapturedAt int64                   `json:"captured_at"`
	DayUTC     string                  `json:"day_utc"`
	Totals     LibraryStatisticsTotals `json:"totals"`
	Activity   []LibraryStatisticsDay  `json:"activity"`
	Notes      []LibraryStatisticsNote `json:"notes"`
}

func statisticsCharacters(s string) int {
	n := 0
	for _, r := range s {
		if !unicode.IsSpace(r) && r != '\ufeff' {
			n++
		}
	}
	return n
}

// One read transaction: never mix file/tag snapshots or send bodies to the UI.
// These are searchable-text characters, not words, disk usage or edit events.
func (d *FileDAO) LibraryStatistics(ctx context.Context) (*LibraryStatisticsSnapshot, error) {
	return d.libraryStatisticsAt(ctx, time.Now().UTC(), LibraryStatisticsLimit, libraryStatisticsBytes)
}
func (d *FileDAO) libraryStatisticsAt(ctx context.Context, now time.Time, limit int, budget int64) (*LibraryStatisticsSnapshot, error) {
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	var totalBytes, maxBytes int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN is_deleted=0 AND is_folder=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0),COALESCE(MAX(CASE WHEN is_deleted=0 AND is_folder=0 AND substr(title,1,?)!=? THEN length(CAST(content AS BLOB)) ELSE 0 END),0) FROM files`, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix, utf8.RuneCountInString(TemplatePrefix), TemplatePrefix).Scan(&count, &totalBytes, &maxBytes)
	if err != nil {
		return nil, err
	}
	if count > limit || totalBytes > budget || maxBytes > libraryStatisticsNoteBytes {
		return nil, fmt.Errorf("资料库超过本次完整统计上限（20000条、正文合计64MiB、单篇16MiB），未返回部分统计")
	}
	tags, links, err := tagWorkspaceInTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	tagCounts := map[string]int{}
	for _, l := range links {
		tagCounts[l.FileID]++
	}
	type meta struct {
		ID, Title, Parent       string
		Created, Updated        int64
		Folder, Deleted, Pinned bool
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,title,parent_id,created_at,updated_at,is_folder,is_deleted,is_pinned FROM files ORDER BY id`)
	if err != nil {
		return nil, err
	}
	all := make([]meta, 0, count)
	folders := map[string]string{}
	metadataBytes := 0
	for rows.Next() {
		var m meta
		if err = rows.Scan(&m.ID, &m.Title, &m.Parent, &m.Created, &m.Updated, &m.Folder, &m.Deleted, &m.Pinned); err != nil {
			rows.Close()
			return nil, err
		}
		metadataBytes += len(m.ID) + len(m.Title) + len(m.Parent)
		if err = ctx.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if len(all) >= limit || metadataBytes > 2*1024*1024 || validateNoteTagID(m.ID) != nil || len(m.Title) > 4000 || !utf8.ValidString(m.Title) || m.Created < 0 || m.Updated < 0 || m.Created > 253402300799 || m.Updated > 253402300799 {
			rows.Close()
			return nil, fmt.Errorf("资料库元数据无效或超出完整统计上限")
		}
		all = append(all, m)
		if m.Folder && !m.Deleted {
			folders[m.ID] = m.Title
		}
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	out := &LibraryStatisticsSnapshot{Version: 1, Complete: true, CapturedAt: now.Unix(), DayUTC: now.UTC().Format("2006-01-02"), Notes: []LibraryStatisticsNote{}, Activity: []LibraryStatisticsDay{}}
	hash := sha256.New()
	enc := json.NewEncoder(hash)
	enc.Encode(tags.Revision)
	enc.Encode(all)
	enc.Encode(out.DayUTC)
	dayIndex := map[string]int{}
	for i := 29; i >= 0; i-- {
		day := now.UTC().AddDate(0, 0, -i).Format("2006-01-02")
		dayIndex[day] = len(out.Activity)
		out.Activity = append(out.Activity, LibraryStatisticsDay{Day: day})
	}
	out.Totals.Tags = len(tags.Tags)
	for _, t := range tags.Tags {
		if t.TotalCount == 0 {
			out.Totals.UnusedTags++
		}
	}
	// Read one bounded body at a time; the transaction owns the entire observation.
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
			return nil, fmt.Errorf("正文编码无效，未返回不完整统计")
		}
		sum := sha256.Sum256([]byte(body))
		enc.Encode(hex.EncodeToString(sum[:]))
		doc := notesearch.Extract(body)
		n := LibraryStatisticsNote{ID: m.ID, Title: m.Title, CreatedAt: m.Created, UpdatedAt: m.Updated, Pinned: m.Pinned, TagCount: tagCounts[m.ID], ContentBytes: int64(len(body)), TextSupported: !doc.Unsupported, Folder: "根目录"}
		if m.Parent != "" {
			if label, ok := folders[m.Parent]; ok {
				n.Folder = label
			} else {
				n.Folder = "位置不可用"
			}
		}
		if n.TextSupported {
			n.Characters = statisticsCharacters(doc.Prose)
			for _, extra := range doc.Extras {
				n.Characters += statisticsCharacters(extra.Text)
			}
			if n.Characters == 0 {
				out.Totals.NoText++
			}
		} else {
			out.Totals.Unsupported++
		}
		if n.Pinned {
			out.Totals.Pinned++
		}
		if n.TagCount > 0 {
			out.Totals.Tagged++
		}
		out.Totals.Characters += n.Characters
		out.Totals.ContentBytes += n.ContentBytes
		out.Notes = append(out.Notes, n)
		if index, ok := dayIndex[time.Unix(m.Created, 0).UTC().Format("2006-01-02")]; ok {
			out.Activity[index].Created++
		}
		if index, ok := dayIndex[time.Unix(m.Updated, 0).UTC().Format("2006-01-02")]; ok {
			out.Activity[index].Updated++
		}
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	out.Totals.Notes = len(out.Notes)
	out.Revision = hex.EncodeToString(hash.Sum(nil))
	sort.Slice(out.Notes, func(i, j int) bool {
		a, b := out.Notes[i], out.Notes[j]
		if a.UpdatedAt != b.UpdatedAt {
			return a.UpdatedAt > b.UpdatedAt
		}
		return a.ID < b.ID
	})
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
