// Package search implements read-only literal search over displayed note content.
package search

import (
	"encoding/json"
	"golang.org/x/text/unicode/norm"
	"strings"
)

type Field struct {
	Kind string
	Text string
}
type Document struct {
	Prose       string
	Extras      []Field
	Unsupported bool
}

// Keep the whitespace rules aligned with JavaScript's \s, not unicode.IsSpace
// (NEL is not JS whitespace). Prose offsets are in NFC-normalized UTF-16 units.
func space(r rune) bool {
	return r == '\t' || r == '\n' || r == '\v' || r == '\f' || r == '\r' || r == ' ' || r == 0xa0 || r == 0x1680 ||
		(r >= 0x2000 && r <= 0x200a) || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
}
func normalizeProse(s string) string {
	s = strings.ReplaceAll(strings.ReplaceAll(norm.NFC.String(s), "\r\n", "\n"), "\r", "\n")
	var out strings.Builder
	prevSpace := false
	for _, r := range s {
		if r != '\n' && space(r) {
			if !prevSpace {
				out.WriteByte(' ')
			}
			prevSpace = true
		} else {
			out.WriteRune(r)
			prevSpace = false
		}
	}
	return strings.TrimFunc(out.String(), space)
}
func stringValue(node map[string]any, key string) string { s, _ := node[key].(string); return s }
func utf16Size(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xffff {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func Extract(content string) Document {
	if content == "" {
		return Document{}
	}
	var state any
	if err := json.Unmarshal([]byte(content), &state); err != nil {
		// A broken serialized editor state must not make JSON property names searchable.
		if strings.Contains(content, `"root"`) && strings.HasPrefix(strings.TrimSpace(content), "{") {
			return Document{Unsupported: true}
		}
		return Document{Prose: norm.NFC.String(content)}
	}
	if s, ok := state.(string); ok {
		return Document{Prose: norm.NFC.String(s)}
	}
	object, ok := state.(map[string]any)
	if !ok {
		return Document{Unsupported: true}
	}
	root, ok := object["root"].(map[string]any)
	if !ok {
		return Document{Unsupported: true}
	}
	if _, ok := root["children"].([]any); !ok {
		return Document{Unsupported: true}
	}
	doc := Document{}
	var prose strings.Builder
	var inline func(any, int) string
	inline = func(value any, depth int) string {
		if depth > 256 {
			return ""
		}
		n, ok := value.(map[string]any)
		if !ok {
			return ""
		}
		if stringValue(n, "type") == "linebreak" {
			return "\n"
		}
		var b strings.Builder
		b.WriteString(stringValue(n, "text"))
		if cs, ok := n["children"].([]any); ok {
			for _, c := range cs {
				b.WriteString(inline(c, depth+1))
			}
		}
		return b.String()
	}
	var visit func(any, int)
	visit = func(value any, depth int) {
		if depth > 256 {
			doc.Unsupported = true
			return
		}
		n, ok := value.(map[string]any)
		if !ok {
			return
		}
		typ := stringValue(n, "type")
		extra := ""
		kind := ""
		switch typ {
		case "wiki-link":
			kind = "link"
			extra = stringValue(n, "title")
			if sections, ok := n["sectionPath"].([]any); ok {
				for _, s := range sections {
					if text, ok := s.(string); ok {
						extra += " › " + text
					}
				}
			}
		case "code-block":
			kind = "code"
			extra = stringValue(n, "code")
		case "code", "code-highlight":
			kind = "code"
			extra = inline(n, 0)
		case "image":
			kind = "image"
			extra = stringValue(n, "caption")
			if extra == "" {
				extra = stringValue(n, "alt")
			}
		case "formula":
			kind = "formula"
			extra = stringValue(n, "expression")
		}
		if kind != "" {
			if extra != "" {
				doc.Extras = append(doc.Extras, Field{kind, normalizeProse(extra)})
			}
			prose.WriteByte('\n')
			return
		}
		if typ == "linebreak" || typ == "horizontalrule" {
			prose.WriteByte('\n')
			return
		}
		if typ == "text" {
			prose.WriteString(stringValue(n, "text"))
			return
		}
		if typ == "tab" {
			prose.WriteByte(' ')
			return
		}
		block := typ == "paragraph" || typ == "heading" || typ == "quote" || typ == "list" || typ == "listitem" || typ == "table" || typ == "tablerow" || typ == "tablecell" || typ == "todo"
		if block {
			prose.WriteByte('\n')
		}
		if typ == "todo" {
			prose.WriteString(stringValue(n, "text"))
		}
		children, _ := n["children"].([]any)
		for _, c := range children {
			visit(c, depth+1)
		}
		if block || len(children) == 0 {
			prose.WriteByte('\n')
		}
	}
	visit(root, 0)
	if doc.Unsupported {
		return Document{Unsupported: true}
	}
	doc.Prose = normalizeProse(prose.String())
	return doc
}
