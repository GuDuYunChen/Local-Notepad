package logic

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"notepad-server/internal/dao"
	"notepad-server/internal/model"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

const LocalImportContentLimit = 2 * 1024 * 1024

// Account for JSON escaping without reducing the decoded 2 MiB content limit.
const LocalImportRequestLimit = 6*LocalImportContentLimit + 4096

type LocalImportInput struct {
	Title    string `json:"title"`
	Content  string `json:"content"`
	ParentID string `json:"parent_id"`
}

type LocalImportResult struct {
	Status    string                 `json:"status"`
	Receipt   *model.ResearchReceipt `json:"receipt,omitempty"`
	RequestID string                 `json:"request_id,omitempty"`
	Reason    string                 `json:"reason,omitempty"`
	Message   string                 `json:"message,omitempty"`
}

func localImportRejected(id, reason, message string) *LocalImportResult {
	return &LocalImportResult{Status: "rejected", RequestID: id, Reason: reason, Message: message}
}

func validateLocalImportID(id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id || parsed.Version() != 4 || parsed.Variant() != uuid.RFC4122 {
		return fmt.Errorf("导入任务 ID 必须是规范的 UUID v4")
	}
	return nil
}

func (l *FileLogic) LocalImportReceipt(ctx context.Context, id string) (*model.ResearchReceipt, error) {
	if err := validateLocalImportID(id); err != nil {
		return nil, err
	}
	return l.FileDAO.ResearchReceipt(ctx, id)
}

// Even malformed retries must preserve an already bound task identity. A
// rejection is permission to fix a new task only when no receipt exists.
func (l *FileLogic) RejectLocalImportInput(ctx context.Context, id, message string) (*LocalImportResult, error) {
	if err := validateLocalImportID(id); err != nil {
		return localImportRejected(id, "invalid-payload", err.Error()), nil
	}
	receipt, err := l.FileDAO.ResearchReceipt(ctx, id)
	if err != nil {
		return nil, err
	}
	if receipt.Found {
		return localImportPayloadMismatch(id), nil
	}
	return localImportRejected(id, "invalid-payload", message), nil
}

func localImportPayloadMismatch(id string) *LocalImportResult {
	return localImportRejected(id, "payload-mismatch", "此导入任务已绑定不同内容，请查回原结果；不能改写任务或重新创建")
}

func (l *FileLogic) CreateLocalImport(ctx context.Context, id, title, content, parent string) (*LocalImportResult, error) {
	if err := validateLocalImportID(id); err != nil {
		return localImportRejected(id, "invalid-payload", err.Error()), nil
	}
	// A read here closes the invalid-payload replay loophole. The transaction
	// still reserves first and checks identity again to serialize concurrent
	// writers; this read is never the authority for creating a note.
	receipt, err := l.FileDAO.ResearchReceipt(ctx, id)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(title + "\x00" + parent + "\x00" + content))
	hash := hex.EncodeToString(digest[:])
	if receipt.Found {
		if receipt.PayloadSHA256 != hash {
			return localImportPayloadMismatch(id), nil
		}
		return &LocalImportResult{Status: "committed", Receipt: receipt}, nil
	}
	if err := validateLocalImportPayload(title, content, parent); err != nil {
		return localImportRejected(id, "invalid-payload", err.Error()), nil
	}
	receipt, err = l.FileDAO.CreateResearch(ctx, id, hash, &model.File{ID: uuid.NewString(), Title: title, Content: content, ParentID: parent}, nil)
	if err != nil {
		var refusal *dao.ResearchPrecommitError
		if !errors.As(err, &refusal) {
			return nil, err
		}
		switch refusal.Reason {
		case "payload-mismatch":
			return localImportPayloadMismatch(id), nil
		case "name-conflict":
			return localImportRejected(id, refusal.Reason, "目标目录已有同名文件或文件夹，未覆盖；请修改标题后重新确认"), nil
		case "folder-unavailable":
			return localImportRejected(id, refusal.Reason, "目标目录或上级目录不可用，未改存根目录；请重新选择目录"), nil
		default:
			return nil, err
		}
	}
	return &LocalImportResult{Status: "committed", Receipt: receipt}, nil
}

// DecodeLocalImportInput rejects duplicate and unknown keys rather than
// silently changing the exact payload used as the task identity.
func DecodeLocalImportInput(body []byte) (*LocalImportInput, error) {
	if len(body) == 0 || len(body) > LocalImportRequestLimit || !utf8.Valid(body) {
		return nil, fmt.Errorf("导入请求为空、编码无效或过大")
	}
	value, err := decodeLocalImportJSON(body)
	if err != nil {
		return nil, fmt.Errorf("导入请求必须是有效 JSON，不能含重复字段")
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 3 {
		return nil, fmt.Errorf("导入请求必须包含且只包含 title、content、parent_id")
	}
	title, titleOK := object["title"].(string)
	content, contentOK := object["content"].(string)
	parent, parentOK := object["parent_id"].(string)
	if !titleOK || !contentOK || !parentOK {
		return nil, fmt.Errorf("导入标题、正文和目标目录必须是字符串")
	}
	return &LocalImportInput{Title: title, Content: content, ParentID: parent}, nil
}

func validateLocalImportPayload(title, content, parent string) error {
	if title == "" || !utf8.ValidString(title) || title != strings.TrimSpace(title) || utf8.RuneCountInString(title) > 255 || strings.ContainsAny(title, "<>:\"/\\|?*") || strings.HasPrefix(title, "__tpl__") || strings.IndexFunc(title, unicode.IsControl) >= 0 {
		return fmt.Errorf("导入笔记名称无效：请输入不超过 255 字且不含保留字符的标题")
	}
	if !utf8.ValidString(parent) || len(parent) > 255 || strings.IndexFunc(parent, unicode.IsControl) >= 0 {
		return fmt.Errorf("目标目录标识无效")
	}
	if len(content) == 0 || len(content) > LocalImportContentLimit || !utf8.ValidString(content) {
		return fmt.Errorf("导入正文为空、编码无效或超过 2 MiB")
	}
	value, err := decodeLocalImportJSON([]byte(content))
	if err != nil {
		return fmt.Errorf("导入正文必须是有效且有界的编辑器文档，不能含重复字段")
	}
	doc, ok := value.(map[string]any)
	if !ok || len(doc) != 1 {
		return fmt.Errorf("导入正文必须仅含编辑器根节点")
	}
	root, ok := doc["root"].(map[string]any)
	if !ok || root["type"] != "root" {
		return fmt.Errorf("导入正文缺少编辑器根节点")
	}
	count := 0
	if err := validateLocalImportNode(root, "", 0, &count); err != nil {
		return fmt.Errorf("导入正文结构无效：%w", err)
	}
	return nil
}

// The JSON token walk has its own budget, including values that are not
// Lexical nodes. It rejects duplicate keys before any map overwrites occur.
func decodeLocalImportJSON(raw []byte) (any, error) {
	if !validLocalImportJSONUnicode(raw) {
		return nil, fmt.Errorf("JSON contains an unpaired Unicode surrogate")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	remaining := 300000
	var read func(int) (any, error)
	read = func(depth int) (any, error) {
		remaining--
		if depth > 136 || remaining < 0 {
			return nil, fmt.Errorf("JSON structure exceeds budget")
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		delim, composite := token.(json.Delim)
		if !composite {
			return token, nil
		}
		switch delim {
		case '{':
			object := make(map[string]any)
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, fmt.Errorf("invalid key")
				}
				if _, exists := object[key]; exists {
					return nil, fmt.Errorf("duplicate key")
				}
				value, err := read(depth + 1)
				if err != nil {
					return nil, err
				}
				object[key] = value
			}
			if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
				return nil, fmt.Errorf("invalid object ending")
			}
			return object, nil
		case '[':
			array := make([]any, 0)
			for decoder.More() {
				value, err := read(depth + 1)
				if err != nil {
					return nil, err
				}
				array = append(array, value)
			}
			if end, err := decoder.Token(); err != nil || end != json.Delim(']') {
				return nil, fmt.Errorf("invalid array ending")
			}
			return array, nil
		default:
			return nil, fmt.Errorf("unexpected delimiter")
		}
	}
	value, err := read(0)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, fmt.Errorf("trailing JSON")
	}
	return value, nil
}

// encoding/json replaces lone UTF-16 surrogate escapes with U+FFFD. Reject
// them instead: parsing must not silently rewrite imported text or identity.
func validLocalImportJSONUnicode(raw []byte) bool {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' || i+1 >= len(raw) {
			continue
		}
		if raw[i+1] != 'u' {
			i++
			continue
		}
		if i+6 > len(raw) {
			return false
		}
		value, err := strconv.ParseUint(string(raw[i+2:i+6]), 16, 16)
		if err != nil {
			return false
		}
		if value >= 0xDC00 && value <= 0xDFFF {
			return false
		}
		if value >= 0xD800 && value <= 0xDBFF {
			if i+12 > len(raw) || raw[i+6] != '\\' || raw[i+7] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(raw[i+8:i+12]), 16, 16)
			if err != nil || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			i += 6
		}
		i += 5
	}
	return true
}

var localImportColor = regexp.MustCompile(`^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,32}|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\- ]{1,100}\))$`)
var localImportToken = regexp.MustCompile(`^[a-zA-Z0-9_+#.\-]{1,128}$`)

// Exact values exported by CodeBlockNode.validateLanguage in the importer.
const localImportCodeLanguages = " plaintext html css scss less javascript typescript jsx tsx json python java c cpp csharp go rust php ruby swift kotlin yaml markdown sql bash powershell markup xml objectivec dart scala groovy perl lua r matlab elixir erlang haskell clojure lisp scheme fsharp vbnet assembly dockerfile nginx ini toml makefile cmake diff http graphql protobuf latex coffeescript handlebars twig awk shell "

func importNumber(value any, min, max float64) bool {
	n, ok := value.(json.Number)
	if !ok {
		return false
	}
	f, err := n.Float64()
	return err == nil && !math.IsInf(f, 0) && f >= min && f <= max && f == math.Trunc(f)
}

func importStringIn(value any, options ...string) bool {
	s, ok := value.(string)
	if !ok {
		return false
	}
	for _, option := range options {
		if s == option {
			return true
		}
	}
	return false
}

func localImportURL(raw string) bool {
	if raw == "" || len(raw) > 8192 || strings.TrimSpace(raw) != raw || strings.Contains(raw, "\\") || strings.HasPrefix(raw, "//") || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Scheme) {
	case "":
		return parsed.Host == ""
	case "http", "https":
		return parsed.Host != "" && parsed.User == nil
	case "mailto", "tel":
		return parsed.Opaque != "" && !strings.HasPrefix(parsed.Opaque, "//")
	default:
		return false
	}
}

func validateLocalImportNode(node map[string]any, parent string, depth int, count *int) error {
	*count++
	if depth > 64 || *count > 20000 {
		return fmt.Errorf("节点超过 20000 或层级超过 64")
	}
	kind, ok := node["type"].(string)
	if !ok || !importNumber(node["version"], 1, 1) {
		return fmt.Errorf("节点类型或版本无效")
	}
	element := false
	fields := "type version"
	switch kind {
	case "root", "paragraph", "heading", "quote", "list", "listitem", "link", "autolink", "code", "table", "tablerow", "tablecell":
		element = true
		fields += " children direction format indent textFormat textStyle"
	case "text", "code-highlight", "tab":
		fields += " detail format mode style text"
	case "linebreak", "divider", "formula", "code-block":
	default:
		return fmt.Errorf("含未注册的导入节点")
	}
	switch kind {
	case "heading":
		fields += " tag"
	case "quote":
		fields += " shadowRoot"
	case "list":
		fields += " listType start tag"
	case "listitem":
		fields += " value checked"
	case "link":
		fields += " url rel target title"
	case "autolink":
		fields += " url rel target title isUnlinked"
	case "code":
		fields += " language theme"
	case "code-highlight":
		fields += " highlightType"
	case "table":
		fields += " colWidths rowStriping frozenColumnCount frozenRowCount"
	case "tablerow":
		fields += " height"
	case "tablecell":
		fields += " colSpan rowSpan headerState width backgroundColor verticalAlign"
	case "formula":
		fields += " expression displayMode"
	case "code-block":
		fields += " code language"
	}
	allowed := strings.Fields(fields)
	for key, value := range node {
		if !slices.Contains(allowed, key) {
			return fmt.Errorf("节点含不支持的属性")
		}
		valid := true
		switch key {
		case "direction":
			valid = value == nil || importStringIn(value, "ltr", "rtl")
		case "format":
			if element {
				valid = importStringIn(value, "", "left", "right", "center", "justify", "start", "end")
			} else {
				valid = importNumber(value, 0, 2047)
			}
		case "textFormat":
			valid = importNumber(value, 0, 2047)
		case "detail":
			valid = importNumber(value, 0, 3)
		case "indent":
			valid = importNumber(value, 0, 64)
		case "style", "textStyle":
			// The Markdown/plain importer never emits CSS. Preserve that local
			// boundary instead of accepting url(), imports or arbitrary styles.
			valid = value == ""
		case "mode":
			valid = importStringIn(value, "normal", "token", "segmented")
		case "start", "value":
			valid = importNumber(value, 0, 1000000)
		case "checked", "isUnlinked", "rowStriping", "shadowRoot", "displayMode":
			_, valid = value.(bool)
		case "colSpan", "rowSpan":
			valid = importNumber(value, 1, 100)
		case "frozenColumnCount", "frozenRowCount":
			valid = importNumber(value, 0, 1000)
		case "headerState":
			valid = importNumber(value, 0, 3)
		case "width", "height":
			valid = importNumber(value, 1, 10000)
		case "verticalAlign":
			valid = importStringIn(value, "middle", "bottom")
		case "backgroundColor":
			s, isString := value.(string)
			valid = value == nil || (isString && (s == "" || localImportColor.MatchString(s)))
		case "colWidths":
			widths, isArray := value.([]any)
			valid = isArray && len(widths) <= 1000
			for _, width := range widths {
				valid = valid && importNumber(width, 1, 10000)
			}
		case "rel", "target", "title":
			s, isString := value.(string)
			valid = value == nil || (isString && len(s) <= 8192 && strings.IndexFunc(s, unicode.IsControl) < 0)
			if key == "target" && value != nil {
				valid = importStringIn(value, "", "_blank", "_self", "_parent", "_top")
			}
		case "language", "theme", "highlightType":
			s, isString := value.(string)
			valid = value == nil || (isString && (s == "" || localImportToken.MatchString(s)))
		case "text", "code", "expression":
			_, valid = value.(string)
		}
		if !valid {
			return fmt.Errorf("节点属性值无效")
		}
	}
	if !localImportChildAllowed(parent, kind, node) {
		return fmt.Errorf("节点父子关系无效")
	}
	switch kind {
	case "heading":
		if !importStringIn(node["tag"], "h1", "h2", "h3", "h4", "h5", "h6") {
			return fmt.Errorf("标题级别无效")
		}
	case "list":
		if !importStringIn(node["listType"], "number", "bullet", "check") || !importNumber(node["start"], 0, 1000000) || (node["listType"] == "number" && node["tag"] != "ol") || (node["listType"] != "number" && node["tag"] != "ul") {
			return fmt.Errorf("列表属性无效")
		}
	case "listitem":
		if !importNumber(node["value"], 0, 1000000) {
			return fmt.Errorf("列表项序号无效")
		}
	case "link", "autolink":
		link, ok := node["url"].(string)
		if !ok || !localImportURL(link) {
			return fmt.Errorf("链接地址不安全或无效")
		}
	case "text", "code-highlight", "tab":
		if _, ok := node["text"].(string); !ok || (kind == "tab" && node["text"] != "\t") {
			return fmt.Errorf("文字节点无效")
		}
	case "formula":
		_, expression := node["expression"].(string)
		_, display := node["displayMode"].(bool)
		if !expression || !display {
			return fmt.Errorf("公式节点无效")
		}
	case "code-block":
		_, code := node["code"].(string)
		language, languageOK := node["language"].(string)
		if !code || !languageOK || !localImportToken.MatchString(language) || !strings.Contains(localImportCodeLanguages, " "+language+" ") {
			return fmt.Errorf("代码块无效")
		}
	case "tablecell":
		// Bound expanded table cells too, not merely serialized node count.
		area := 1
		for _, span := range []string{"colSpan", "rowSpan"} {
			if value, ok := node[span].(json.Number); ok {
				n, _ := value.Float64()
				area *= int(n)
			}
		}
		*count += area - 1
		if *count > 20000 {
			return fmt.Errorf("展开后的表格超过结构预算")
		}
	}
	if element {
		children, ok := node["children"].([]any)
		if !ok {
			return fmt.Errorf("容器节点缺少子节点数组")
		}
		childParent := kind
		if kind == "quote" && node["shadowRoot"] == true {
			childParent = "tablecell"
		}
		for _, child := range children {
			object, ok := child.(map[string]any)
			if !ok {
				return fmt.Errorf("子节点不是对象")
			}
			if err := validateLocalImportNode(object, childParent, depth+1, count); err != nil {
				return err
			}
		}
	}
	return nil
}

func localImportChildAllowed(parent, kind string, node map[string]any) bool {
	inline := kind == "text" || kind == "linebreak" || kind == "link" || kind == "autolink" || (kind == "formula" && node["displayMode"] == false)
	block := kind == "paragraph" || kind == "heading" || kind == "quote" || kind == "list" || kind == "table" || kind == "code" || kind == "code-block" || kind == "divider" || (kind == "formula" && node["displayMode"] == true)
	switch parent {
	case "":
		return kind == "root"
	case "root", "tablecell":
		return block
	case "paragraph", "heading", "quote":
		return inline
	case "list":
		return kind == "listitem"
	case "listitem":
		return inline || kind == "list"
	case "link", "autolink":
		return kind == "text" || kind == "linebreak" || (kind == "formula" && node["displayMode"] == false)
	case "code":
		return kind == "text" || kind == "code-highlight" || kind == "linebreak" || kind == "tab"
	case "table":
		return kind == "tablerow"
	case "tablerow":
		return kind == "tablecell"
	default:
		return false
	}
}
