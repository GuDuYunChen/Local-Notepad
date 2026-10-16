package logic

import (
	"context"
	"testing"
)

func TestPinOnlyUpdateMustNeverWriteBodyOrEditedTime(t *testing.T) {
	l := newFileLogicTestDB(t)
	ctx := context.Background()
	f, e := l.Create(ctx, "Pin.md", "original", false, "")
	if e != nil {
		t.Fatal(e)
	}
	_, e = l.FileDAO.DB.Exec(`CREATE TRIGGER reject_other_columns BEFORE UPDATE OF title,content,parent_id,sort_order,updated_at,is_deleted ON files BEGIN SELECT RAISE(ABORT,'pin attempted body metadata update'); END`)
	if e != nil {
		t.Fatal(e)
	}
	pinned := true
	got, e := l.Update(ctx, f.ID, nil, nil, nil, nil, nil, &pinned)
	if e != nil {
		t.Fatalf("pin-only update attempted unrelated columns: %v", e)
	}
	if !got.IsPinned || got.Content != f.Content || got.UpdatedAt != f.UpdatedAt || got.Title != f.Title {
		t.Fatal(got)
	}
}
