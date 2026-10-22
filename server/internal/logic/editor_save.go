package logic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"notepad-server/internal/model"
	"regexp"
	"strings"
)

var editorRequestID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func headingSignature(content string) string {
	var root struct {
		Root struct {
			Children []json.RawMessage `json:"children"`
		} `json:"root"`
	}
	if json.Unmarshal([]byte(content), &root) != nil {
		return "[]"
	}
	var text func(map[string]any) string
	text = func(n map[string]any) string {
		if n["type"] == "text" {
			s, _ := n["text"].(string)
			return s
		}
		if n["type"] == "wiki-link" {
			s, _ := n["title"].(string)
			return s
		}
		s := ""
		if a, ok := n["children"].([]any); ok {
			for _, v := range a {
				if m, ok := v.(map[string]any); ok {
					s += text(m)
				}
			}
		}
		return s
	}
	result := []any{}
	for _, raw := range root.Root.Children {
		var n map[string]any
		if json.Unmarshal(raw, &n) != nil || n["type"] != "heading" {
			continue
		}
		result = append(result, []any{n["tag"], n["level"], strings.Join(strings.Fields(text(n)), " ")})
	}
	b, _ := json.Marshal(result)
	return string(b)
}
func (l *FileLogic) SaveEditorContent(ctx context.Context, id string, in model.EditorSaveInput) (*model.EditorSaveResult, error) {
	if !editorRequestID.MatchString(in.RequestID) || id == "" || len(in.Content) > 16<<20 || len(in.Expected) > 16<<20 || len(in.Mappings) > 65536 {
		return nil, fmt.Errorf("正文保存参数无效")
	}
	if in.Mappings == "" {
		in.Mappings = "[]"
	}
	var mappings []any
	if json.Unmarshal([]byte(in.Mappings), &mappings) != nil || len(mappings) > 500 {
		return nil, fmt.Errorf("章节映射格式无效")
	}
	b, _ := json.Marshal([]string{id, in.Expected, in.Content, in.Mappings})
	hash := sha256.Sum256(b)
	return l.FileDAO.SaveEditor(ctx, id, in, hex.EncodeToString(hash[:]), func(a, b string) bool { return headingSignature(a) != headingSignature(b) }, parseWikiLinks(in.Content))
}
func (l *FileLogic) EditorReferenceJobs(ctx context.Context) ([]model.EditorReferenceJob, error) {
	return l.FileDAO.EditorReferenceJobs(ctx)
}
func (l *FileLogic) CompleteEditorReferences(ctx context.Context, id string, in model.ReferenceCompletion) error {
	if !editorRequestID.MatchString(id) || (in.State != "done" && in.State != "manual") || len(in.Updates) > 100 {
		return fmt.Errorf("引用维护参数无效")
	}
	seen := map[string]bool{}
	for i, u := range in.Updates {
		if u.ID == "" || seen[u.ID] || len(u.Content) > 16<<20 || len(u.Expected) > 16<<20 {
			return fmt.Errorf("引用来源参数无效")
		}
		seen[u.ID] = true
		in.Updates[i].Links = parseWikiLinks(u.Content)
	}
	if in.State == "manual" && len(in.Updates) > 0 {
		return fmt.Errorf("未确认的引用不能写入")
	}
	return l.FileDAO.CompleteEditorReferences(ctx, id, in)
}
