package search

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/text/unicode/norm"
	"hash"
	"notepad-server/internal/model"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

type Options struct {
	Query     string
	Source    string
	FolderID  string
	Pinned    bool
	Since     int64
	Sort      string
	MatchCase bool
	Page      int
	PageSize  int
	Revision  string
	AnchorID  string
}
type Folder struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type Snippet struct {
	Kind     string `json:"kind"`
	Before   string `json:"before"`
	Match    string `json:"match"`
	After    string `json:"after"`
	Leading  bool   `json:"leading"`
	Trailing bool   `json:"trailing"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
}
type Result struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	UpdatedAt   int64     `json:"updated_at"`
	IsPinned    bool      `json:"is_pinned"`
	FolderPath  string    `json:"folder_path"`
	TitleMatch  bool      `json:"title_match"`
	BodyCount   int       `json:"body_count"`
	Snippets    []Snippet `json:"snippets"`
	ContentHash string    `json:"content_sha256"`
	rank        int
}
type Response struct {
	AnchorID         string   `json:"anchor_id,omitempty"`
	AnchorFound      bool     `json:"anchor_found"`
	Items            []Result `json:"items"`
	Folders          []Folder `json:"folders"`
	Total            int      `json:"total"`
	TotalOccurrences int      `json:"total_occurrences"`
	Page             int      `json:"page"`
	Pages            int      `json:"pages"`
	PageSize         int      `json:"page_size"`
	Revision         string   `json:"revision"`
	Scanned          int      `json:"scanned"`
	Unsupported      int      `json:"unsupported"`
	Query            string   `json:"query"`
	CacheHits        int      `json:"cache_hits"`
	Parsed           int      `json:"parsed"`
}
type Engine struct {
	cache                             *DocumentCache
	cacheHits, parsed                 int
	options                           Options
	pattern                           *regexp.Regexp
	files                             map[string]model.File
	paths                             map[string]string
	folders                           []Folder
	results                           []Result
	digest                            hash.Hash
	scanned, unsupported, occurrences int
}

var ErrChanged = errors.New("资料库已变化，请刷新检索后重新翻页")

func New(options Options, files []model.File) (*Engine, error) {
	return NewWithCache(options, files, nil)
}

func NewWithCache(options Options, files []model.File, cache *DocumentCache) (*Engine, error) {
	options.Query = strings.TrimFunc(norm.NFC.String(options.Query), space)
	if utf8.RuneCountInString(options.Query) > 128 {
		return nil, errors.New("关键词最多 128 个字符")
	}
	if options.Source == "" {
		options.Source = "all"
	}
	if options.Source != "all" && options.Source != "title" && options.Source != "body" {
		return nil, errors.New("不支持的搜索来源")
	}
	if options.Sort == "" {
		options.Sort = "relevance"
	}
	if options.Sort != "relevance" && options.Sort != "updated" && options.Sort != "title" {
		return nil, errors.New("不支持的排序方式")
	}
	if options.Since < 0 {
		return nil, errors.New("无效的修改时间范围")
	}
	if options.Page <= 0 {
		options.Page = 1
	}
	if options.PageSize <= 0 {
		options.PageSize = 20
	}
	if options.PageSize > 50 {
		options.PageSize = 50
	}
	if len(options.AnchorID) > 512 || strings.ContainsRune(options.AnchorID, 0) {
		return nil, errors.New("无效的返回笔记标识")
	}
	if len(options.Revision) > 64 {
		return nil, errors.New("无效的检索版本")
	}
	e := &Engine{cache: cache, options: options, files: map[string]model.File{}, paths: map[string]string{}, folders: []Folder{}, results: []Result{}, digest: sha256.New()}
	expr := regexp.QuoteMeta(options.Query)
	if !options.MatchCase {
		expr = "(?i)" + expr
	}
	e.pattern = regexp.MustCompile(expr)
	// Canonical ordering makes versions independent of database iteration order.
	metadata := append([]model.File(nil), files...)
	sort.Slice(metadata, func(i, j int) bool { return metadata[i].ID < metadata[j].ID })
	for _, file := range metadata {
		file.Content = ""
		e.files[file.ID] = file
		encoded, _ := json.Marshal(file)
		e.digest.Write(encoded)
		e.digest.Write([]byte{0})
	}
	for _, file := range metadata {
		if file.IsDeleted {
			continue
		}
		path, ancestors, valid := e.path(file.ID)
		if !valid {
			continue
		}
		if file.IsFolder {
			e.folders = append(e.folders, Folder{file.ID, path})
			continue
		}
		if options.Pinned && !file.IsPinned || options.Since > 0 && file.UpdatedAt < options.Since {
			continue
		}
		if options.FolderID != "" {
			included := false
			for _, id := range ancestors {
				if id == options.FolderID {
					included = true
					break
				}
			}
			if !included {
				continue
			}
		}
		e.paths[file.ID] = path
	}
	sort.Slice(e.folders, func(i, j int) bool {
		if e.folders[i].Label != e.folders[j].Label {
			return e.folders[i].Label < e.folders[j].Label
		}
		return e.folders[i].ID < e.folders[j].ID
	})
	if options.FolderID != "" {
		found := false
		for _, f := range e.folders {
			if f.ID == options.FolderID {
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New("所选目录不存在或已删除，请选择其他范围")
		}
	}
	return e, nil
}
func (e *Engine) path(id string) (string, []string, bool) {
	current, ok := e.files[id]
	if !ok {
		return "", nil, false
	}
	labels := []string{}
	ancestors := []string{}
	seen := map[string]bool{}
	if current.IsFolder {
		labels = append(labels, current.Title)
	}
	for {
		if current.IsDeleted || strings.HasPrefix(current.Title, "__tpl__") || seen[current.ID] {
			return "", nil, false
		}
		seen[current.ID] = true
		if current.ParentID == "" {
			break
		}
		parent, exists := e.files[current.ParentID]
		if !exists || !parent.IsFolder {
			return "", nil, false
		}
		ancestors = append(ancestors, parent.ID)
		labels = append(labels, parent.Title)
		current = parent
	}
	for left, right := 0, len(labels)-1; left < right; left, right = left+1, right-1 {
		labels[left], labels[right] = labels[right], labels[left]
	}
	if len(labels) == 0 {
		return "根目录", ancestors, true
	}
	return strings.Join(labels, " / "), ancestors, true
}
func (e *Engine) Includes(id string) bool { _, ok := e.paths[id]; return ok }

func (e *Engine) Add(ctx context.Context, id, content string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !e.Includes(id) {
		return nil
	}
	e.scanned++
	f := e.files[id]
	sum := sha256.Sum256([]byte(content))
	contentHash := hex.EncodeToString(sum[:])
	e.digest.Write([]byte(id))
	e.digest.Write([]byte{0})
	e.digest.Write(sum[:])
	result := Result{ID: id, Title: f.Title, UpdatedAt: f.UpdatedAt, IsPinned: f.IsPinned, FolderPath: e.paths[id], Snippets: []Snippet{}, ContentHash: contentHash, rank: 3}
	if e.options.Query == "" {
		e.results = append(e.results, result)
		return nil
	}
	if e.options.Source != "body" {
		title := norm.NFC.String(f.Title)
		match := e.pattern.FindStringIndex(title)
		result.TitleMatch = match != nil
		if match != nil {
			result.rank = 2
			if match[0] == 0 {
				result.rank = 1
			}
			if match[0] == 0 && match[1] == len(title) {
				result.rank = 0
			}
		}
	}
	if e.options.Source != "title" {
		document, hit := e.cache.extract(sum, content)
		if hit {
			e.cacheHits++
		} else {
			e.parsed++
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if document.Unsupported {
			e.unsupported++
		}
		fields := append([]Field{{"body", document.Prose}}, document.Extras...)
		for _, field := range fields {
			offset := 0
			for offset < len(field.Text) {
				if result.BodyCount%256 == 0 {
					if err := ctx.Err(); err != nil {
						return err
					}
				}
				match := e.pattern.FindStringIndex(field.Text[offset:])
				if match == nil {
					break
				}
				start, end := offset+match[0], offset+match[1]
				offset = end
				result.BodyCount++
				if len(result.Snippets) < 3 {
					result.Snippets = append(result.Snippets, excerpt(field, start, end))
				}
			}
		}
	}
	if result.TitleMatch || result.BodyCount > 0 {
		e.results = append(e.results, result)
		e.occurrences += result.BodyCount
	}
	return nil
}
func excerpt(field Field, start, end int) Snippet {
	pstart := strings.LastIndex(field.Text[:start], "\n") + 1
	pend := len(field.Text)
	if next := strings.Index(field.Text[end:], "\n"); next >= 0 {
		pend = end + next
	}
	before, after := []rune(field.Text[pstart:start]), []rune(field.Text[end:pend])
	leading, trailing := len(before) > 42, len(after) > 74
	if leading {
		before = before[len(before)-42:]
	}
	if trailing {
		after = after[:74]
	}
	return Snippet{Kind: field.Kind, Before: string(before), Match: field.Text[start:end], After: string(after), Leading: leading, Trailing: trailing, Start: utf16Size(field.Text[:start]), End: utf16Size(field.Text[:end])}
}
func (e *Engine) Finish() (Response, error) {
	revision := hex.EncodeToString(e.digest.Sum(nil))
	if e.options.Revision != "" && e.options.Revision != revision {
		return Response{}, ErrChanged
	}
	sort.Slice(e.results, func(i, j int) bool {
		a, b := e.results[i], e.results[j]
		if e.options.Sort == "relevance" && e.options.Query != "" && a.rank != b.rank {
			return a.rank < b.rank
		}
		if e.options.Sort == "title" && a.Title != b.Title {
			return a.Title < b.Title
		}
		if a.UpdatedAt != b.UpdatedAt {
			return a.UpdatedAt > b.UpdatedAt
		}
		return a.ID < b.ID
	})
	total := len(e.results)
	pages := (total + e.options.PageSize - 1) / e.options.PageSize
	if pages < 1 {
		pages = 1
	}
	page := e.options.Page
	anchorFound := false
	if e.options.AnchorID != "" {
		// Resolve identity only within the filtered, freshly sorted result set.
		for index, result := range e.results {
			if result.ID == e.options.AnchorID {
				page = index/e.options.PageSize + 1
				anchorFound = true
				break
			}
		}
	}
	if page > pages {
		page = pages
	}
	start := (page - 1) * e.options.PageSize
	end := start + e.options.PageSize
	if end > total {
		end = total
	}
	return Response{AnchorID: e.options.AnchorID, AnchorFound: anchorFound, Items: e.results[start:end], Folders: e.folders, Total: total, TotalOccurrences: e.occurrences, Page: page, Pages: pages, PageSize: e.options.PageSize, Revision: revision, Scanned: e.scanned, Unsupported: e.unsupported, Query: e.options.Query, CacheHits: e.cacheHits, Parsed: e.parsed}, nil
}
