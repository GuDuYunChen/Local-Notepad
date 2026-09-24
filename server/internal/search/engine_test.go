package search

import (
	"context"
	"encoding/json"
	"fmt"
	"notepad-server/internal/model"
	"strings"
	"testing"
)

func lexical(children string) string { return `{"root":{"type":"root","children":[` + children + `]}}` }
func paragraph(text string) string {
	b, _ := json.Marshal(text)
	return `{"type":"paragraph","children":[{"type":"text","text":` + string(b) + `}]}`
}
func searchRows(t *testing.T, files []model.File, options Options) Response {
	t.Helper()
	engine, err := New(options, files)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if err := engine.Add(context.Background(), f.ID, f.Content); err != nil {
			t.Fatal(err)
		}
	}
	result, err := engine.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestExtractionFormattingAndBoundaries(t *testing.T) {
	cases := []struct{ name, content, want string }{
		{"formatting", lexical(`{"type":"paragraph","children":[{"type":"text","text":"关"},{"type":"text","text":"关","format":1}]}`), "关关"},
		{"paragraph", lexical(paragraph("关") + "," + paragraph("关")), "关\n\n关"},
		{"inline", lexical(`{"type":"paragraph","children":[{"type":"text","text":"Mary "},{"type":"link","url":"ignored","children":[{"type":"text","text":"Jane"}]}]}`), "Mary Jane"},
		{"table", lexical(`{"type":"table","children":[{"type":"tablecell","children":[{"type":"text","text":"关"}]},{"type":"tablecell","children":[{"type":"text","text":"关"}]}]}`), "关\n\n关"},
		{"whitespace", lexical(paragraph(" \tMary\t \u00a0Jane \r\n行尾 ")), "Mary Jane \n行尾"},
		{"nfc", lexical(paragraph("E\u0301lodie")), "Élodie"},
		{"legacy", "  raw\t  body\r\n ", "  raw\t  body\r\n "},
		{"jsonString", `"关关来了"`, "关关来了"},
		{"todo", lexical(`{"type":"todo","text":"关关出发"}`), "关关出发"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if d := Extract(c.content); d.Prose != c.want {
				t.Fatalf("got %q want %q", d.Prose, c.want)
			}
		})
	}
}
func TestDecorationKindsAndMetadata(t *testing.T) {
	content := lexical(`{"type":"paragraph","children":[{"type":"text","text":"关"},{"type":"wiki-link","title":"小关","id":"secret-id","sectionPath":["身世"]},{"type":"text","text":"关"}]},` +
		`{"type":"code-block","code":"关关 = 1"},{"type":"image","src":"secret-url","caption":"关关的画像"},{"type":"formula","expression":"x + y"}`)
	d := Extract(content)
	if d.Prose != "关\n关" || len(d.Extras) != 4 {
		t.Fatalf("%+v", d)
	}
	for _, f := range d.Extras {
		if strings.Contains(f.Text, "secret") {
			t.Fatal("searched hidden metadata")
		}
	}
	if d.Extras[3].Kind != "formula" || d.Extras[3].Text != "x + y" {
		t.Fatal("formula lost")
	}
}
func TestMalformedStatesNeverSearchJSONKeys(t *testing.T) {
	for _, s := range []string{`{"title":"关关"}`, `{"root":{"children":"关关"}}`, `{"root":bad`, `null`, `42`} {
		if !Extract(s).Unsupported {
			t.Fatalf("not marked unsupported: %s", s)
		}
	}
}
func TestCodeTextNotProse(t *testing.T) {
	d := Extract(lexical(`{"type":"code","children":[{"type":"code-highlight","text":"关关"}]}`))
	if d.Prose != "" || len(d.Extras) != 1 || d.Extras[0].Text != "关关" {
		t.Fatalf("%+v", d)
	}
}
func TestLiteralOperators(t *testing.T) {
	for _, q := range []string{"100%_", "A+B", "[draft]", "AND OR", "a.b", "**", "a\\b", "^x$"} {
		r := searchRows(t, []model.File{{ID: "1", Title: "note", Content: "before " + q + " after"}}, Options{Query: q})
		if r.Total != 1 || r.TotalOccurrences != 1 || r.Items[0].Snippets[0].Match != q {
			t.Fatalf("%q: %+v", q, r)
		}
	}
}
func TestCaseSensitiveAndInsensitive(t *testing.T) {
	files := []model.File{{ID: "1", Title: "note", Content: "Alice ALICE alice"}}
	if r := searchRows(t, files, Options{Query: "alice"}); r.TotalOccurrences != 3 {
		t.Fatal(r)
	}
	if r := searchRows(t, files, Options{Query: "alice", MatchCase: true}); r.TotalOccurrences != 1 {
		t.Fatal(r)
	}
}
func TestTitleAndBodyFilters(t *testing.T) {
	files := []model.File{{ID: "1", Title: "关关.md", Content: "无"}, {ID: "2", Title: "正文.md", Content: "关关"}}
	for _, c := range []struct {
		source string
		total  int
	}{{"all", 2}, {"title", 1}, {"body", 1}} {
		r := searchRows(t, files, Options{Query: "关关", Source: c.source})
		if r.Total != c.total {
			t.Fatal(r)
		}
	}
}
func TestTitleRankingAndStableTies(t *testing.T) {
	files := []model.File{{ID: "c", Title: "other", Content: "word", UpdatedAt: 100}, {ID: "b", Title: "word suffix"}, {ID: "a", Title: "word"}, {ID: "d", Title: "has word"}}
	r := searchRows(t, files, Options{Query: "word"})
	for i, want := range []string{"a", "b", "d", "c"} {
		if r.Items[i].ID != want {
			t.Fatal(r)
		}
	}
	r = searchRows(t, files, Options{Query: "word", Sort: "updated"})
	if r.Items[0].ID != "c" {
		t.Fatal(r)
	}
}
func TestMoreThanTwentyAndFiftyResults(t *testing.T) {
	files := []model.File{}
	for i := 0; i < 73; i++ {
		files = append(files, model.File{ID: fmt.Sprintf("n%03d", i), Title: "matched", Content: "matched"})
	}
	first := searchRows(t, files, Options{Query: "matched", Page: 1})
	last := searchRows(t, files, Options{Query: "matched", Page: 4})
	if first.Total != 73 || first.Pages != 4 || len(first.Items) != 20 || len(last.Items) != 13 || last.Items[12].ID != "n072" {
		t.Fatal(first, last)
	}
	if first.Revision != last.Revision {
		t.Fatal("pagination changed snapshot")
	}
}
func TestFolderDescendantsPinnedAndTime(t *testing.T) {
	files := []model.File{{ID: "p", Title: "项目", IsFolder: true}, {ID: "v", Title: "第一卷", IsFolder: true, ParentID: "p"}, {ID: "a", Title: "a", Content: "目标", ParentID: "v", IsPinned: true, UpdatedAt: 500}, {ID: "b", Title: "b", Content: "目标", ParentID: "p", UpdatedAt: 100}, {ID: "c", Title: "c", Content: "目标", UpdatedAt: 600}}
	r := searchRows(t, files, Options{Query: "目标", FolderID: "p"})
	if r.Total != 2 || len(r.Folders) != 2 {
		t.Fatal(r)
	}
	r = searchRows(t, files, Options{Query: "目标", FolderID: "p", Pinned: true, Since: 300})
	if r.Total != 1 || r.Items[0].FolderPath != "项目 / 第一卷" {
		t.Fatal(r)
	}
}
func TestDeletedTemplateAndBrokenAncestors(t *testing.T) {
	files := []model.File{{ID: "p", Title: "trash", IsFolder: true, IsDeleted: true}, {ID: "a", Title: "match", ParentID: "p"}, {ID: "b", Title: "__tpl__match"}, {ID: "c", Title: "match", IsDeleted: true}, {ID: "d", Title: "match", ParentID: "missing"}, {ID: "cycle", Title: "match", IsFolder: true, ParentID: "cycle"}, {ID: "valid", Title: "match"}}
	r := searchRows(t, files, Options{Query: "match"})
	if r.Total != 1 || r.Items[0].ID != "valid" {
		t.Fatal(r)
	}
}
func TestInvalidFolderIsNotAnEmptySuccess(t *testing.T) {
	if _, err := New(Options{FolderID: "missing"}, nil); err == nil {
		t.Fatal("missing scope accepted")
	}
}
func TestBodyChangeSameTimestampInvalidatesPage(t *testing.T) {
	files := []model.File{{ID: "a", Title: "match", Content: "old", UpdatedAt: 100}}
	r := searchRows(t, files, Options{Query: "match"})
	files[0].Content = "new"
	engine, _ := New(Options{Query: "match", Revision: r.Revision}, files)
	engine.Add(context.Background(), "a", "new")
	if _, err := engine.Finish(); err != ErrChanged {
		t.Fatal(err)
	}
}
func TestNamesAndDeletesChangeSnapshot(t *testing.T) {
	files := []model.File{{ID: "a", Title: "match"}}
	r := searchRows(t, files, Options{})
	files[0].Title = "changed"
	next := searchRows(t, files, Options{})
	if r.Revision == next.Revision {
		t.Fatal("title change lost")
	}
	files[0].IsDeleted = true
	if searchRows(t, files, Options{}).Revision == next.Revision {
		t.Fatal("delete lost")
	}
}
func TestBoundedUnicodeExcerptsAndOffsets(t *testing.T) {
	content := lexical(paragraph(strings.Repeat("😀", 60) + "关关" + strings.Repeat("𠮷", 100)))
	r := searchRows(t, []model.File{{ID: "a", Title: "note", Content: content}}, Options{Query: "关关"})
	s := r.Items[0].Snippets[0]
	if s.Start != 120 || s.End != 122 || len([]rune(s.Before)) != 42 || len([]rune(s.After)) != 74 || !s.Leading || !s.Trailing {
		t.Fatalf("%+v", s)
	}
}
func TestSampleCapDoesNotCapCounts(t *testing.T) {
	r := searchRows(t, []model.File{{ID: "a", Title: "note", Content: strings.Repeat("关关 ", 1000)}}, Options{Query: "关关"})
	if r.TotalOccurrences != 1000 || len(r.Items[0].Snippets) != 3 {
		t.Fatal(r)
	}
}
func TestSnippetBoundariesStayInParagraph(t *testing.T) {
	r := searchRows(t, []model.File{{ID: "a", Title: "note", Content: lexical(paragraph("不应出现") + "," + paragraph("关关来了") + "," + paragraph("不应出现"))}}, Options{Query: "关关"})
	s := r.Items[0].Snippets[0]
	if s.Before != "" || s.After != "来了" {
		t.Fatal(s)
	}
}
func TestEmptyAndHugePages(t *testing.T) {
	r := searchRows(t, nil, Options{Page: 999999, PageSize: 500})
	if r.Page != 1 || r.Pages != 1 || r.Total != 0 || r.PageSize != 50 || r.Items == nil {
		t.Fatal(r)
	}
}
func TestUnsupportedBodiesStillAllowTitleMatch(t *testing.T) {
	r := searchRows(t, []model.File{{ID: "a", Title: "match", Content: `{"root":bad`}}, Options{Query: "match"})
	if r.Total != 1 || r.Unsupported != 1 || !r.Items[0].TitleMatch || r.TotalOccurrences != 0 {
		t.Fatal(r)
	}
}
func TestReadOnlyResponseContainsNoFullBody(t *testing.T) {
	content := "private-prefix " + strings.Repeat("body ", 1000) + "needle"
	r := searchRows(t, []model.File{{ID: "a", Title: "note", Content: content}}, Options{Query: "needle"})
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), "private-prefix") || strings.Contains(string(b), `"content":`) {
		t.Fatal("full body leaked")
	}
}
func TestQueryValidation(t *testing.T) {
	for _, o := range []Options{{Query: strings.Repeat("x", 129)}, {Source: "bad"}, {Sort: "bad"}, {Since: -1}, {Revision: strings.Repeat("x", 65)}} {
		if _, err := New(o, nil); err == nil {
			t.Fatal("invalid option accepted", o)
		}
	}
}
func TestCancellation(t *testing.T) {
	e, _ := New(Options{Query: "x"}, []model.File{{ID: "a", Title: "a"}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e.Add(ctx, "a", "x") != context.Canceled {
		t.Fatal("cancel ignored")
	}
}
func TestFormattingSplitDoesNotMissOrJoinParagraphs(t *testing.T) {
	files := []model.File{{ID: "a", Title: "one", Content: lexical(`{"type":"paragraph","children":[{"type":"text","text":"关"},{"type":"text","text":"关","format":1}]}`)}, {ID: "b", Title: "two", Content: lexical(paragraph("关") + "," + paragraph("关"))}}
	r := searchRows(t, files, Options{Query: "关关"})
	if r.Total != 1 || r.Items[0].ID != "a" {
		t.Fatal(r)
	}
}
func TestTenThousandMetadataRows(t *testing.T) {
	files := make([]model.File, 10000)
	for i := range files {
		files[i] = model.File{ID: fmt.Sprintf("n%05d", i), Title: "目标", Content: "目标"}
	}
	r := searchRows(t, files, Options{Query: "目标", Page: 500})
	if r.Total != 10000 || len(r.Items) != 20 || r.Items[19].ID != "n09999" {
		t.Fatal(r.Total, r.Page)
	}
}

func TestAnchorFindsCurrentPageByIdentity(t *testing.T) {
	files := make([]model.File, 65)
	for i := range files {
		files[i] = model.File{ID: fmt.Sprintf("n%03d", i), Title: fmt.Sprintf("第%03d章", i), Content: "needle"}
	}
	result := searchRows(t, files, Options{Query: "needle", Sort: "title", PageSize: 20, Page: 1, AnchorID: "n064"})
	if !result.AnchorFound || result.AnchorID != "n064" || result.Page != 4 || len(result.Items) != 5 {
		t.Fatal(result)
	}
}
func TestAnchorFollowsReorderedAndRenamedFile(t *testing.T) {
	files := []model.File{{ID: "a", Title: "A", Content: "needle"}, {ID: "b", Title: "B", Content: "needle"}, {ID: "c", Title: "C", Content: "needle"}}
	before := searchRows(t, files, Options{Query: "needle", Sort: "title", PageSize: 1, AnchorID: "b"})
	files[1].Title = "Z"
	after := searchRows(t, files, Options{Query: "needle", Sort: "title", PageSize: 1, AnchorID: "b"})
	if before.Page != 2 || after.Page != 3 || after.Items[0].ID != "b" {
		t.Fatal(before, after)
	}
}
func TestAnchorDoesNotMatchAnIdenticalTitle(t *testing.T) {
	result := searchRows(t, []model.File{{ID: "a", Title: "same"}, {ID: "b", Title: "same"}}, Options{PageSize: 1, AnchorID: "b"})
	if result.Page != 2 || result.Items[0].ID != "b" {
		t.Fatal(result)
	}
}
func TestAnchorMissingStaysWithinFilteredResults(t *testing.T) {
	files := []model.File{{ID: "a", Title: "target", Content: "needle", IsPinned: false}, {ID: "b", Title: "other", Content: "needle", IsPinned: true}}
	result := searchRows(t, files, Options{Query: "needle", Pinned: true, AnchorID: "a", Page: 9})
	if result.AnchorFound || result.Total != 1 || result.Items[0].ID != "b" || result.Page != 1 {
		t.Fatal(result)
	}
}
func TestAnchorDeletedOrChangedTextIsNotFound(t *testing.T) {
	for _, target := range []model.File{{ID: "a", Title: "target", Content: "needle", IsDeleted: true}, {ID: "a", Title: "target", Content: "other"}} {
		result := searchRows(t, []model.File{target}, Options{Query: "needle", AnchorID: "a", Page: 4})
		if result.AnchorFound || result.Total != 0 || result.Page != 1 || result.AnchorID != "a" {
			t.Fatal(result)
		}
	}
}
func TestAnchorCannotBypassRevisionCheck(t *testing.T) {
	engine, err := New(Options{AnchorID: "a", Revision: "stale"}, []model.File{{ID: "a", Title: "one"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = engine.Add(context.Background(), "a", "body"); err != nil {
		t.Fatal(err)
	}
	if _, err = engine.Finish(); err != ErrChanged {
		t.Fatal(err)
	}
}
func TestAnchorRejectsOversizedAndNullIDs(t *testing.T) {
	for _, id := range []string{strings.Repeat("x", 513), "a\x00b"} {
		if _, err := New(Options{AnchorID: id}, nil); err == nil {
			t.Fatal("invalid anchor accepted")
		}
	}
}
func TestAnchorWithoutTargetPreservesOrdinaryPagination(t *testing.T) {
	files := []model.File{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	result := searchRows(t, files, Options{Page: 2, PageSize: 1})
	if result.AnchorID != "" || result.AnchorFound || result.Page != 2 || result.Items[0].ID != "b" {
		t.Fatal(result)
	}
}
