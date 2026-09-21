package logic

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportToMarkdownPreservesFormulasAndChecklists(t *testing.T) {
	state := `{
	  "root": {
	    "children": [
	      {
	        "type": "paragraph",
	        "children": [
	          {"type":"text","text":"energy "},
	          {"type":"formula","expression":"E = mc^2","displayMode":false}
	        ]
	      },
	      {
	        "type":"formula",
	        "expression":"\\int_0^1 x^2 \\, dx",
	        "displayMode":true
	      },
	      {
	        "type":"list",
	        "listType":"check",
	        "children":[
	          {
	            "type":"listitem",
	            "checked":false,
	            "children":[{"type":"text","text":"未完成"}]
	          },
	          {
	            "type":"listitem",
	            "checked":true,
	            "children":[{"type":"text","text":"已完成"}]
	          }
	        ]
	      }
	    ]
	  }
	}`

	path := filepath.Join(t.TempDir(), "export.md")
	if err := ExportToMarkdown(state, path); err != nil {
		t.Fatalf("ExportToMarkdown: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read markdown: %v", err)
	}
	got := string(raw)

	for _, want := range []string{
		"energy $E = mc^2$",
		"$$\n\\int_0^1 x^2 \\, dx\n$$",
		"- [ ] 未完成",
		"- [x] 已完成",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("markdown missing %q:\n%s", want, got)
		}
	}
}


func TestExportToMarkdownPreservesModernLexicalStructure(t *testing.T) {
	state := `{
	  "root": {
	    "children": [
	      {
	        "type":"heading",
	        "tag":"h2",
	        "children":[{"type":"text","text":"二级标题","format":0}]
	      },
	      {
	        "type":"paragraph",
	        "children":[
	          {"type":"text","text":"删除","format":4},
	          {"type":"text","text":" "},
	          {
	            "type":"link",
	            "url":"https://example.com/docs",
	            "children":[{"type":"text","text":"链接","format":0}]
	          }
	        ]
	      },
	      {
	        "type":"code-block",
	        "language":"javascript",
	        "code":"const answer = 42;"
	      },
	      {"type":"divider","version":1}
	    ]
	  }
	}`

	path := filepath.Join(t.TempDir(), "modern.md")
	if err := ExportToMarkdown(state, path); err != nil {
		t.Fatalf("ExportToMarkdown: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read markdown: %v", err)
	}
	got := string(raw)

	for _, want := range []string{
		"## 二级标题",
		"~~删除~~",
		"[链接](https://example.com/docs)",
		"```javascript\nconst answer = 42;\n```",
		"---",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("markdown missing %q:\n%s", want, got)
		}
	}
}
