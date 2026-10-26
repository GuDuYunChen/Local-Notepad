package logic

import (
	"context"
	"encoding/json"
	"fmt"
	"notepad-server/internal/model"
	"strings"
	"testing"
)

// The new block metadata uses the original SaveEditorContent transaction. It
// must not introduce a second save path or lose the existing file backlink.
func TestBlockReferencesUseOriginalSaveReceiptsAndBacklinks(t *testing.T) {
	l := saveTestLogic(t)
	ctx := context.Background()
	source, err := l.Create(ctx, "块来源.md", "source", false, "")
	if err != nil {
		t.Fatal(err)
	}
	anchor := "b-" + strings.Repeat("a", 32)
	sourceBody := fmt.Sprintf(`{"root":{"type":"root","children":[{"type":"paragraph","$":{"localBlockId":%q},"children":[{"type":"text","text":"source"}]}]}}`, anchor)
	saved, err := l.SaveEditorContent(ctx, source.ID, model.EditorSaveInput{RequestID: strings.Repeat("1", 32), Expected: source.Content, Content: sourceBody})
	if err != nil || saved.Content != sourceBody {
		t.Fatal(saved, err)
	}
	target, err := l.Create(ctx, "块目标.md", "before", false, "")
	if err != nil {
		t.Fatal(err)
	}
	targetBody := fmt.Sprintf(`{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"wiki-link","id":%q,"title":"块来源.md","sectionPath":[],"blockId":%q,"embedded":false}]},{"type":"wiki-link","id":%q,"title":"块来源.md","sectionPath":[],"blockId":%q,"embedded":true}]}}`, source.ID, anchor, source.ID, anchor)
	in := model.EditorSaveInput{RequestID: strings.Repeat("2", 32), Expected: target.Content, Content: targetBody}
	got, err := l.SaveEditorContent(ctx, target.ID, in)
	if err != nil || got.Content != targetBody {
		t.Fatal(got, err)
	}
	// Original public read returns every bit of identity and mode; no projection
	// or flattening is allowed on the durable content.
	reopened, err := l.Get(ctx, target.ID)
	if err != nil || reopened.Content != targetBody {
		t.Fatal(reopened, err)
	}
	var count int
	if err = l.FileDAO.DB.QueryRow(`SELECT COUNT(*) FROM links WHERE source_id=? AND target_id=?`, target.ID, source.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("backlink identity", count, err)
	}
	changedBody := strings.Replace(sourceBody, `"text":"source"`, `"text":"changed"`, 1)
	if _, err = l.SaveEditorContent(ctx, source.ID, model.EditorSaveInput{RequestID: strings.Repeat("3", 32), Expected: sourceBody, Content: changedBody}); err != nil {
		t.Fatal(err)
	}
	unchanged, _ := l.Get(ctx, target.ID)
	if unchanged.Content != targetBody {
		t.Fatal("changing source rewrote the referencing note")
	}
	loaded, _ := l.Get(ctx, source.ID)
	var doc map[string]any
	if err = json.Unmarshal([]byte(loaded.Content), &doc); err != nil || !strings.Contains(loaded.Content, anchor) {
		t.Fatal("source anchor lost", err)
	}
	// Superseded retry must not resurrect a deleted anchor or overwrite newer body.
	newer := `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"newer without anchor"}]}]}}`
	last := model.EditorSaveInput{RequestID: strings.Repeat("4", 32), Expected: changedBody, Content: newer}
	if _, err = l.SaveEditorContent(ctx, source.ID, last); err != nil {
		t.Fatal(err)
	}
	_, err = l.SaveEditorContent(ctx, source.ID, model.EditorSaveInput{RequestID: strings.Repeat("3", 32), Expected: sourceBody, Content: changedBody})
	if err != nil {
		t.Fatal(err)
	}
	loaded, _ = l.Get(ctx, source.ID)
	if loaded.Content != newer {
		t.Fatal("old receipt restored removed block")
	}
}
