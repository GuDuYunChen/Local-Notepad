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
	        "expression":"\\\\int_0^1 x^2 \\\\, dx",
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
