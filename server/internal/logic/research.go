package logic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"notepad-server/internal/model"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

func validateResearchID(id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id || parsed.Version() != 4 {
		return fmt.Errorf("研究任务 ID 必须是规范的 UUID v4")
	}
	return nil
}

func (l *FileLogic) ResearchReceipt(ctx context.Context, id string) (*model.ResearchReceipt, error) {
	if err := validateResearchID(id); err != nil {
		return nil, err
	}
	return l.FileDAO.ResearchReceipt(ctx, id)
}

func (l *FileLogic) CreateResearch(ctx context.Context, id, title, content, parent string) (*model.ResearchReceipt, error) {
	if err := validateResearchID(id); err != nil {
		return nil, err
	}
	// Never silently sanitize a replay payload: the exact submitted bytes define
	// task identity. The NUL separator is forbidden in the two preceding fields.
	if title == "" || title != strings.TrimSpace(title) || utf8.RuneCountInString(title) > 255 || strings.ContainsAny(title, "<>:\"/\\|?*\x00\r\n\t") {
		return nil, fmt.Errorf("研究笔记名称无效，未写入")
	}
	if len(parent) > 255 || strings.ContainsAny(parent, "\x00\r\n\t") {
		return nil, fmt.Errorf("目标目录标识无效")
	}
	if len(content) == 0 || len(content) > 2*1024*1024 || !utf8.ValidString(content) {
		return nil, fmt.Errorf("研究正文为空、编码无效或超过 2 MiB")
	}
	// Only registered, bounded research-document nodes are accepted. Literal
	// [[...]] inside a user's annotation is text, never an implicit backlink.
	var doc struct {
		Root *researchNode `json:"root"`
	}
	if err := json.Unmarshal([]byte(content), &doc); err != nil || doc.Root == nil || doc.Root.Type != "root" {
		return nil, fmt.Errorf("研究正文必须是有效的编辑器文档")
	}
	ids := []string{}
	seen := make(map[string]bool)
	nodes := 0
	var walk func(*researchNode, int) error
	walk = func(n *researchNode, depth int) error {
		nodes++
		if n == nil || depth > 12 || nodes > 20000 {
			return fmt.Errorf("研究正文节点过多或结构无效")
		}
		switch n.Type {
		case "root", "paragraph", "heading", "text", "linebreak":
		case "wiki-link":
			if n.ID == "" || len(n.ID) > 255 || strings.ContainsAny(n.ID, "\x00\r\n") {
				return fmt.Errorf("来源链接标识无效")
			}
			if !seen[n.ID] {
				ids = append(ids, n.ID)
				seen[n.ID] = true
			}
		default:
			return fmt.Errorf("研究正文含不支持的节点")
		}
		for _, child := range n.Children {
			if err := walk(child, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(doc.Root, 0); err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(title + "\x00" + parent + "\x00" + content))
	return l.FileDAO.CreateResearch(ctx, id, hex.EncodeToString(digest[:]), &model.File{ID: uuid.NewString(), Title: title, Content: content, ParentID: parent}, ids)
}

type researchNode struct {
	Type     string          `json:"type"`
	ID       string          `json:"id"`
	Children []*researchNode `json:"children"`
}
