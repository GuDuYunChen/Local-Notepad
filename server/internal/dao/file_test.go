package dao

import (
	"context"
	"database/sql"
	"testing"

	"notepad-server/internal/model"

	_ "modernc.org/sqlite"
)

func TestEscapeFTS5Query(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "single chinese term", in: "工业富联", want: `"工业富联"*`},
		{name: "multiple terms", in: "project plan", want: `"project"* AND "plan"*`},
		{name: "strip operators", in: "hello*(world)?", want: `"helloworld"*`},
		{name: "trim spaces", in: "  hello  world  ", want: `"hello"* AND "world"*`},
		{name: "empty", in: "   ", want: ""},
		{name: "operators only", in: "***???", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := escapeFTS5Query(tt.in); got != tt.want {
				t.Fatalf("escapeFTS5Query(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestEscapeLikePattern(t *testing.T) {
	got := escapeLikePattern(" 100%_\\safe ")
	want := `%100\%\_\\safe%`
	if got != want {
		t.Fatalf("escapeLikePattern() = %q, want %q", got, want)
	}
}

func newSearchTestDAO(t *testing.T) *FileDAO {
	t.Helper()

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	schema := []string{
		`CREATE TABLE files (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			is_folder INTEGER DEFAULT 0,
			parent_id TEXT DEFAULT '',
			sort_order INTEGER DEFAULT 0,
			is_deleted INTEGER DEFAULT 0,
			deleted_at INTEGER DEFAULT 0,
			is_pinned INTEGER DEFAULT 0
		)`,
		`CREATE VIRTUAL TABLE files_fts USING fts5(title, content, content='files', content_rowid='rowid')`,
		`CREATE TRIGGER files_fts_insert AFTER INSERT ON files BEGIN
			INSERT INTO files_fts(rowid, title, content)
			VALUES (new.rowid, COALESCE(new.title, ''), COALESCE(new.content, ''));
		END`,
	}

	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create search schema: %v", err)
		}
	}

	return &FileDAO{DB: db}
}

func seedSearchFile(t *testing.T, dao *FileDAO, id, title, content string) {
	t.Helper()
	if err := dao.Create(context.Background(), &model.File{
		ID:      id,
		Title:   title,
		Content: content,
	}); err != nil {
		t.Fatalf("seed %s: %v", title, err)
	}
}

func TestFileDAOListSearch(t *testing.T) {
	dao := newSearchTestDAO(t)
	ctx := context.Background()

	seedSearchFile(t, dao, "project", "项目计划", "milestone schedule")
	seedSearchFile(t, dao, "industrial", "行业观察", "industrial platform roadmap")
	seedSearchFile(t, dao, "other", "其他笔记", "unrelated")

	t.Run("partial title match", func(t *testing.T) {
		files, err := dao.List(ctx, "项目", 1, 20)
		if err != nil {
			t.Fatalf("List partial title: %v", err)
		}
		if len(files) == 0 || files[0].ID != "project" {
			t.Fatalf("expected project note first, got %#v", files)
		}
	})

	t.Run("content prefix match", func(t *testing.T) {
		files, err := dao.List(ctx, "indust", 1, 20)
		if err != nil {
			t.Fatalf("List content prefix: %v", err)
		}
		if len(files) != 1 || files[0].ID != "industrial" {
			t.Fatalf("expected industrial note, got %#v", files)
		}
	})

	t.Run("operator-only input stays safe", func(t *testing.T) {
		files, err := dao.List(ctx, "***???", 1, 20)
		if err != nil {
			t.Fatalf("List operator-only: %v", err)
		}
		if len(files) != 0 {
			t.Fatalf("expected no matches, got %#v", files)
		}
	})
}
