package dao

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const AttachmentAuditLimit = 10000
const attachmentAuditReferences = 50000
const attachmentAuditMaxJSON = 8 * 1024 * 1024

type AttachmentAuditNote struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Scope        string `json:"scope"`
	Parsed       bool   `json:"parsed"`
	RejectedURLs int    `json:"rejected_urls"`
}
type AttachmentAuditItem struct {
	Name  string   `json:"name"`
	State string   `json:"state"`
	Bytes int64    `json:"bytes"`
	Notes []string `json:"notes"`
}
type AttachmentAuditTotals struct {
	Files        int   `json:"files"`
	Bytes        int64 `json:"bytes"`
	Referenced   int   `json:"referenced"`
	Unreferenced int   `json:"unreferenced"`
	Missing      int   `json:"missing"`
	Blocked      int   `json:"blocked"`
	Notes        int   `json:"notes"`
	Unparsed     int   `json:"unparsed"`
	RejectedURLs int   `json:"rejected_urls"`
	References   int   `json:"references"`
}
type AttachmentAuditSnapshot struct {
	Version    int                   `json:"version"`
	Complete   bool                  `json:"complete"`
	Revision   string                `json:"revision"`
	CapturedAt int64                 `json:"captured_at"`
	Totals     AttachmentAuditTotals `json:"totals"`
	Items      []AttachmentAuditItem `json:"items"`
	Notes      []AttachmentAuditNote `json:"notes"`
}
type auditEntry struct {
	Name     string
	Size     int64
	Mode     uint32
	Modified int64
}

// A metadata-only inventory. No attachment contents are opened, hashed or deleted.
// Root-relative Lstat refuses to follow links. Root identity and both inventories
// must agree; this is not a filesystem/SQLite atomic snapshot or a content check.
func attachmentInventory(ctx context.Context, root *os.Root, limit int) ([]auditEntry, error) {
	f, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	entries, err := f.ReadDir(limit + 1)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(entries) > limit {
		return nil, errors.New("附件条目超过检查上限")
	}
	out := make([]auditEntry, 0, len(entries))
	namesBytes := 0
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		name := entry.Name()
		namesBytes += len(name)
		if !auditName(name) || namesBytes > 1024*1024 {
			return nil, errors.New("附件名称无效或超过检查上限")
		}
		info, e := root.Lstat(name)
		if e != nil {
			return nil, e
		}
		if info.Size() < 0 || info.Size() > 9007199254740991 {
			return nil, errors.New("附件大小无法表示")
		}
		out = append(out, auditEntry{name, info.Size(), uint32(info.Mode()), info.ModTime().UnixNano()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func auditName(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 1024 || !utf8.ValidString(name) || strings.TrimSpace(name) != name || strings.ContainsAny(name, "/\\:") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// Only local flat /uploads URLs are resolved. No network request, arbitrary local
// path, URL credentials, encoded traversal or nested directory is ever opened.
func auditURL(raw string) (string, bool, bool) {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	u, err := url.Parse(raw)
	if err != nil {
		return "", false, strings.Contains(raw, "/uploads/")
	}
	local := u.Scheme == "" && u.Host == "" && strings.HasPrefix(raw, "/uploads/")
	if u.Scheme == "http" || u.Scheme == "https" {
		host := strings.ToLower(u.Hostname())
		local = u.User == nil && (host == "127.0.0.1" || host == "localhost" || host == "::1")
	}
	if !local || !strings.HasPrefix(u.Path, "/uploads/") {
		return "", false, false
	}
	name := strings.TrimPrefix(u.Path, "/uploads/")
	if !auditName(name) || strings.Contains(name, "%") {
		return "", false, true
	}
	return name, true, false
}

var auditURLPattern = regexp.MustCompile(`(?i)[a-z][a-z0-9+.-]*://[^\s<>"'\x60)\]]+|//[^\s<>"'\x60)\]]+|/uploads/[^\s<>"'\x60)\]]+`)

func auditBodyReferences(body string) ([]string, bool, int) {
	found := map[string]bool{}
	rejected := 0
	parsed := true
	visited := 0
	var scan func(string, bool)
	scan = func(s string, whole bool) {
		if whole {
			if name, ok, bad := auditURL(s); ok {
				found[name] = true
				return
			} else if bad {
				rejected++
				return
			}
		}
		for _, location := range auditURLPattern.FindAllStringIndex(s, attachmentAuditReferences+1) {
			if location[0] > 0 && !strings.ContainsRune(" \t\r\n(<[=\"'`", rune(s[location[0]-1])) {
				continue
			}
			m := s[location[0]:location[1]]
			name, ok, bad := auditURL(m)
			if ok {
				found[name] = true
			}
			if bad {
				rejected++
			}
			if len(found)+rejected > attachmentAuditReferences {
				return
			}
		}
	}
	trimmed := strings.TrimSpace(body)
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "\"") {
		var value any
		if json.Unmarshal([]byte(body), &value) != nil {
			if strings.HasPrefix(trimmed, "{") && strings.Contains(body, `"root"`) {
				parsed = false
			} else {
				scan(body, false)
			}
		} else {
			var walk func(any, int, string)
			walk = func(v any, depth int, key string) {
				visited++
				if depth > 128 || visited > 200000 {
					parsed = false
					return
				}
				switch x := v.(type) {
				case string:
					scan(x, key == "src" || key == "url" || key == "href")
				case []any:
					for _, child := range x {
						walk(child, depth+1, "")
					}
				case map[string]any:
					keys := make([]string, 0, len(x))
					for k := range x {
						keys = append(keys, k)
					}
					sort.Strings(keys)
					for _, k := range keys {
						walk(x[k], depth+1, k)
					}
				}
			}
			if m, ok := value.(map[string]any); ok {
				r, ok := m["root"].(map[string]any)
				if !ok {
					parsed = false
				} else if _, ok = r["children"].([]any); !ok {
					parsed = false
				}
			}
			if _, ok := value.([]any); ok {
				parsed = false
			}
			walk(value, 0, "")
		}
	} else {
		scan(body, false)
	}
	names := make([]string, 0, len(found))
	for name := range found {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, parsed, rejected
}

func (d *FileDAO) AttachmentAudit(ctx context.Context, directory string) (*AttachmentAuditSnapshot, error) {
	return d.attachmentAudit(ctx, directory, AttachmentAuditLimit, LibraryStatisticsLimit, libraryStatisticsBytes, nil)
}
func (d *FileDAO) attachmentAudit(ctx context.Context, directory string, fileLimit, noteLimit int, bodyBudget int64, afterRead func()) (*AttachmentAuditSnapshot, error) {
	if directory == "" {
		return nil, errors.New("附件目录未配置")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var root *os.Root
	var rootInfo os.FileInfo
	before := []auditEntry{}
	info, err := os.Lstat(directory)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, errors.New("附件根目录不是普通目录")
		}
		rootInfo = info
		root, err = os.OpenRoot(directory)
		if err != nil {
			return nil, err
		}
		defer root.Close()
		actual, e := root.Stat(".")
		if e != nil || !os.SameFile(info, actual) {
			return nil, errors.New("附件目录身份已变化")
		}
		before, err = attachmentInventory(ctx, root, fileLimit)
		if err != nil {
			return nil, err
		}
	}
	tx, err := d.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	var bytes, max int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(length(CAST(content AS BLOB))),0),COALESCE(MAX(length(CAST(content AS BLOB))),0) FROM files WHERE is_folder=0`).Scan(&count, &bytes, &max)
	if err != nil {
		return nil, err
	}
	if count > noteLimit || bytes > bodyBudget || max > libraryStatisticsNoteBytes {
		return nil, errors.New("保存正文超过完整检查上限；没有返回部分结果")
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,title,content,is_deleted FROM files WHERE is_folder=0 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	out := &AttachmentAuditSnapshot{Version: 1, Complete: true, CapturedAt: time.Now().Unix(), Items: []AttachmentAuditItem{}, Notes: []AttachmentAuditNote{}}
	refs := map[string][]string{}
	hash := sha256.New()
	enc := json.NewEncoder(hash)
	metadataBytes := 0
	references := 0
	for rows.Next() {
		if err = ctx.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		var id, title, body string
		var deleted bool
		if err = rows.Scan(&id, &title, &body, &deleted); err != nil {
			rows.Close()
			return nil, err
		}
		metadataBytes += len(id) + len(title)
		if validateNoteTagID(id) != nil || len(title) > 4000 || !utf8.ValidString(title) || !utf8.ValidString(body) || metadataBytes > 2*1024*1024 {
			rows.Close()
			return nil, errors.New("笔记元数据无效或超出上限")
		}
		scope := "active"
		if deleted {
			scope = "trash"
		} else if strings.HasPrefix(title, TemplatePrefix) {
			scope = "template"
		}
		names, parsed, rejected := auditBodyReferences(body)
		references += len(names)
		if references > attachmentAuditReferences || out.Totals.RejectedURLs+rejected > attachmentAuditReferences {
			rows.Close()
			return nil, errors.New("候选引用超过完整检查上限")
		}
		out.Notes = append(out.Notes, AttachmentAuditNote{id, title, scope, parsed, rejected})
		if !parsed {
			out.Totals.Unparsed++
		}
		out.Totals.RejectedURLs += rejected
		for _, name := range names {
			refs[name] = append(refs[name], id)
		}
		bodyHash := sha256.Sum256([]byte(body))
		enc.Encode([]any{id, title, scope, hex.EncodeToString(bodyHash[:])})
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	if len(out.Notes) != count {
		return nil, errors.New("笔记快照不完整")
	}
	if afterRead != nil {
		afterRead()
	}
	if root != nil {
		after, e := attachmentInventory(ctx, root, fileLimit)
		if e != nil {
			return nil, e
		}
		a, _ := json.Marshal(before)
		b, _ := json.Marshal(after)
		current, e := os.Lstat(directory)
		if e != nil || !os.SameFile(current, rootInfo) || string(a) != string(b) {
			return nil, errors.New("附件目录已变化；请重新检查")
		}
	} else if _, e := os.Lstat(directory); !os.IsNotExist(e) {
		return nil, errors.New("附件目录状态已变化；请重新检查")
	}
	entries := map[string]auditEntry{}
	for _, e := range before {
		entries[e.Name] = e
	}
	all := map[string]bool{}
	for n := range entries {
		all[n] = true
	}
	for n := range refs {
		all[n] = true
	}
	if len(all) > fileLimit {
		return nil, errors.New("附件与缺失引用总数超过完整检查上限")
	}
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		item := AttachmentAuditItem{Name: name, Notes: refs[name]}
		if item.Notes == nil {
			item.Notes = []string{}
		}
		if e, ok := entries[name]; ok {
			if !os.FileMode(e.Mode).IsRegular() {
				item.State = "blocked"
				out.Totals.Blocked++
			} else {
				item.Bytes = e.Size
				out.Totals.Files++
				out.Totals.Bytes += e.Size
				if len(item.Notes) > 0 {
					item.State = "available"
					out.Totals.Referenced++
				} else {
					item.State = "unreferenced"
					out.Totals.Unreferenced++
				}
			}
		} else {
			item.State = "missing"
			out.Totals.Missing++
		}
		out.Totals.References += len(item.Notes)
		out.Items = append(out.Items, item)
	}
	out.Totals.Notes = len(out.Notes)
	if out.Totals.Bytes > 9007199254740991 {
		return nil, errors.New("附件总大小无法表示")
	}
	enc.Encode(before)
	enc.Encode(out.Items)
	enc.Encode(out.Totals)
	out.Revision = hex.EncodeToString(hash.Sum(nil))
	raw, err := json.Marshal(out)
	if err != nil || len(raw) > attachmentAuditMaxJSON {
		return nil, fmt.Errorf("完整检查报告超过8MiB上限")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
