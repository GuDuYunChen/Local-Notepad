package tasklist

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMarkdownChecklistScope(t *testing.T) {
	cases := []struct {
		name, body  string
		count, done int
		supported   bool
	}{
		{"plain", "- [ ] 写作\n- [x] 完成\n1. [X] Review", 3, 2, true},
		{"bracket markdown", "[标题](a)\n* [ ] 一个", 1, 0, true},
		{"nested three spaces", "  - [ ] 次级\n   + [x] 已做", 2, 1, true},
		{"fence", "```md\n- [ ] 代码\n```\n- [ ] 真任务", 1, 0, true},
		{"long fence", "````\n```\n- [ ] 仍是代码\n````\n- [x] 真任务", 1, 1, true},
		{"tilde fence", "~~~ text\n- [ ] 代码\n~~~\n- [ ] 真任务", 1, 0, true},
		{"quote excluded", "> - [ ] 引用\n正文 - [ ] 行内", 0, 0, true},
		{"deep indentation explicit gap", "    - [ ] 四空格\n\t\t\t\t- [ ] 制表符", 0, 0, false},
		{"empty", "", 0, 0, true}, {"empty label", "- [ ]", 1, 0, true},
		{"crlf", "- [ ] 一\r\n- [x] 二", 2, 1, true},
		{"json root corrupted", `{"root":`, 0, 0, false},
		{"valid unknown json", `{"anything": "- [ ] no"}`, 0, 0, false},
		{"array json", `["- [ ] no"]`, 0, 0, false},
		{"legacy string", `"- [ ] legacy"`, 1, 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Extract(c.body)
			done := 0
			for _, i := range r.Items {
				if i.Done {
					done++
				}
			}
			if len(r.Items) != c.count || done != c.done || r.Supported != c.supported || r.TooLarge {
				t.Fatalf("%+v", r)
			}
		})
	}
}
func TestLexicalTasksDoNotInventTasksFromCodeOrMetadata(t *testing.T) {
	body := `{"root":{"children":[{"type":"list","listType":"check","$":{"localBlockId":"b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"children":[{"type":"listitem","checked":false,"children":[{"type":"text","text":"父任务"},{"type":"list","listType":"check","children":[{"type":"listitem","checked":true,"children":[{"type":"text","text":"子任务"}]}]}]},{"type":"listitem","checked":true,"children":[{"type":"link","url":"- [ ] not task","children":[{"type":"text","text":"链接"}]},{"type":"formula","expression":"private"}]}]},{"type":"code-block","code":"- [ ] code"},{"type":"text","text":"- [ ] inline is not a checkbox"}]}}`
	r := Extract(body)
	if !r.Supported || len(r.Items) != 3 || r.Items[0].Text != "父任务" || r.Items[1].Text != "子任务" || r.Items[0].Done || !r.Items[1].Done || !r.Items[2].Truncated {
		t.Fatalf("%+v", r)
	}
	for i, item := range r.Items {
		if item.Ordinal != i+1 || item.Format != "lexical" || item.Line != 0 || item.BlockID != "b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
			t.Fatal(item)
		}
	}
	if strings.Contains(r.Items[2].Text, "private") {
		t.Fatal("opaque content exposed")
	}
}
func TestUnknownOrMalformedNodesMarkCoverageGap(t *testing.T) {
	for _, body := range []string{`{"root":{"children":[{"type":"unknown","children":[{"type":"list","listType":"check","children":[]}]}]}}`, `{"root":{"children":[{"type":"list","listType":"check","children":[{"type":"listitem","checked":"true","children":[]}]}]}}`, `{"root":{"children":[{"type":"paragraph","children":"bad"}]}}`} {
		r := Extract(body)
		if r.Supported {
			t.Fatal(body, r)
		}
	}
}
func TestTextTruncationAndBoundedStructure(t *testing.T) {
	r := Extract("- [ ] " + strings.Repeat("中", MaxText+1))
	if len([]rune(r.Items[0].Text)) != MaxText || !r.Items[0].Truncated {
		t.Fatal(r)
	}
	r = Extract(strings.Repeat("- [ ] t\n", MaxTasks+1))
	if !r.TooLarge || len(r.Items) != 0 {
		t.Fatal("partial over-cap accepted")
	}
	var v any = map[string]any{"type": "text", "text": "x"}
	for i := 0; i < 130; i++ {
		v = map[string]any{"type": "paragraph", "children": []any{v}}
	}
	b, _ := json.Marshal(map[string]any{"root": map[string]any{"children": []any{v}}})
	r = Extract(string(b))
	if !r.TooLarge || len(r.Items) != 0 {
		t.Fatal("depth accepted")
	}
}
func TestDuplicateBlockIDsDoNotClaimPreciseNavigation(t *testing.T) {
	n := `{"type":"list","listType":"check","$":{"localBlockId":"b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"children":[{"type":"listitem","checked":false,"children":[]}]}`
	r := Extract(`{"root":{"children":[` + n + `,` + n + `]}}`)
	if len(r.Items) != 2 {
		t.Fatal(r)
	}
	for _, i := range r.Items {
		if i.BlockID != "" {
			t.Fatal("ambiguous block", i)
		}
	}
}
