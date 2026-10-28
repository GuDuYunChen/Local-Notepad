// Package tasklist extracts saved checklist items without changing documents.
package tasklist

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

const MaxTasks = 10000
const MaxText = 1024

type Item struct {
	Ordinal   int    `json:"ordinal"`
	Text      string `json:"text"`
	Done      bool   `json:"done"`
	Format    string `json:"format"`
	Line      int    `json:"line"`
	BlockID   string `json:"block_id"`
	Truncated bool   `json:"truncated"`
}
type Result struct {
	Items     []Item
	Supported bool
	TooLarge  bool
}

var taskLine = regexp.MustCompile(`^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[\t ]+\[([ xX])\](?:[\t ]+(.*)|$)`)
var indentedTask = regexp.MustCompile(`^[\t ]{4,}(?:[-+*]|[0-9]{1,9}[.)])[\t ]+\[[ xX]\]`)
var blockIdentity = regexp.MustCompile(`^b-[a-f0-9]{32}$`)

func excerpt(s string) (string, bool) {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= MaxText {
		return s, false
	}
	return string([]rune(s)[:MaxText]), true
}
func Extract(body string) Result {
	out := Result{Items: []Item{}, Supported: true}
	if !utf8.ValidString(body) {
		out.Supported = false
		return out
	}
	trimmed := strings.TrimSpace(body)
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, `"`) {
		var v any
		if json.Unmarshal([]byte(trimmed), &v) == nil {
			if text, ok := v.(string); ok {
				return markdown(text)
			}
			m, ok := v.(map[string]any)
			if !ok {
				out.Supported = false
				return out
			}
			root, ok := m["root"].(map[string]any)
			if !ok {
				out.Supported = false
				return out
			}
			children, ok := root["children"].([]any)
			if !ok {
				out.Supported = false
				return out
			}
			visited := 0
			add := func(s string, done bool, block string, incomplete bool) {
				text, cut := excerpt(s)
				out.Items = append(out.Items, Item{Ordinal: len(out.Items) + 1, Text: text, Done: done, Format: "lexical", BlockID: block, Truncated: cut || incomplete})
				if len(out.Items) > MaxTasks {
					out.TooLarge = true
				}
			}
			var label func(any, int) (string, bool)
			label = func(v any, depth int) (string, bool) {
				visited++
				if visited > 200000 || depth > 128 {
					out.TooLarge = true
					return "", false
				}
				n, ok := v.(map[string]any)
				if !ok {
					return "", false
				}
				typ, _ := n["type"].(string)
				switch typ {
				case "text":
					s, ok := n["text"].(string)
					return s, ok
				case "linebreak", "tab":
					return " ", true
				case "list":
					return "", true
				}
				switch typ {
				case "link", "autolink", "mark", "paragraph", "listitem":
				default:
					return "[非文本内容]", false
				}
				c, ok := n["children"].([]any)
				if !ok {
					return "", false
				}
				var b strings.Builder
				complete := true
				for _, child := range c {
					if out.TooLarge {
						break
					}
					s, ok := label(child, depth+1)
					b.WriteString(s)
					complete = complete && ok
				}
				return b.String(), complete
			}
			var walk func(any, int, string, string)
			walk = func(v any, depth int, parent, block string) {
				if out.TooLarge {
					return
				}
				visited++
				if visited > 200000 || depth > 128 {
					out.TooLarge = true
					return
				}
				n, ok := v.(map[string]any)
				if !ok {
					out.Supported = false
					return
				}
				typ, _ := n["type"].(string)
				if typ == "listitem" && parent == "check" {
					done, ok := n["checked"].(bool)
					if !ok {
						out.Supported = false
					} else {
						text, complete := label(n, depth)
						add(text, done, block, !complete)
					}
				}
				switch typ {
				case "code", "code-block", "image", "image-grid", "video", "audio", "file", "formula", "wiki-link", "horizontalrule", "text", "linebreak", "tab":
					return
				}
				switch typ {
				case "list", "listitem", "paragraph", "heading", "quote", "link", "autolink", "mark", "table", "tablerow", "tablecell":
				default:
					out.Supported = false
					return
				}
				next := ""
				if typ == "list" {
					next, _ = n["listType"].(string)
					if next != "check" && next != "bullet" && next != "number" {
						out.Supported = false
					}
				}
				c, ok := n["children"].([]any)
				if !ok {
					out.Supported = false
					return
				}
				for _, child := range c {
					walk(child, depth+1, next, block)
				}
			}
			ids := map[string]int{}
			for _, child := range children {
				if n, ok := child.(map[string]any); ok {
					if state, ok := n["$"].(map[string]any); ok {
						if s, ok := state["localBlockId"].(string); ok && blockIdentity.MatchString(s) {
							ids[s]++
						}
					}
				}
			}
			for _, child := range children {
				block := ""
				if n, ok := child.(map[string]any); ok {
					if state, ok := n["$"].(map[string]any); ok {
						if s, ok := state["localBlockId"].(string); ok && ids[s] == 1 {
							block = s
						}
					}
				}
				walk(child, 0, "", block)
			}
			if out.TooLarge {
				out.Items = []Item{}
			}
			return out
		}
		if strings.HasPrefix(trimmed, "{") && strings.Contains(trimmed, `"root"`) {
			out.Supported = false
			return out
		}
	}
	return markdown(body)
}
func markdown(body string) Result {
	out := Result{Items: []Item{}, Supported: true}
	fence := byte(0)
	length := 0
	for i, line := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		s := strings.TrimLeft(line, " ")
		indent := len(line) - len(s)
		if indent <= 3 && len(s) >= 3 && (s[0] == '`' || s[0] == '~') {
			n := 0
			for n < len(s) && s[n] == s[0] {
				n++
			}
			if n >= 3 {
				if fence == 0 {
					if s[0] != '`' || !strings.Contains(s[n:], "`") {
						fence = s[0]
						length = n
						continue
					}
				} else if s[0] == fence && n >= length && strings.TrimSpace(s[n:]) == "" {
					fence = 0
					continue
				}
			}
		}
		if fence != 0 {
			continue
		}
		if indentedTask.MatchString(line) {
			out.Supported = false
			continue
		}
		m := taskLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		text, cut := excerpt(m[2])
		out.Items = append(out.Items, Item{Ordinal: len(out.Items) + 1, Text: text, Done: m[1] != " ", Format: "markdown", Line: i + 1, Truncated: cut})
		if len(out.Items) > MaxTasks {
			out.TooLarge = true
			out.Items = []Item{}
			return out
		}
	}
	return out
}
