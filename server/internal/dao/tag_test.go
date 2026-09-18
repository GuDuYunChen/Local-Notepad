package dao

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestDeleteTagRemovesOnlyItsAssociations(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()

	schema := []string{
		`CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT)`,
		`CREATE TABLE file_tags (file_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (file_id, tag_id))`,
	}
	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}

	for _, stmt := range []string{
		`INSERT INTO tags (id, name, color) VALUES ('tag-a', 'A', '#000')`,
		`INSERT INTO tags (id, name, color) VALUES ('tag-b', 'B', '#111')`,
		`INSERT INTO file_tags (file_id, tag_id) VALUES ('file-1', 'tag-a')`,
		`INSERT INTO file_tags (file_id, tag_id) VALUES ('file-2', 'tag-a')`,
		`INSERT INTO file_tags (file_id, tag_id) VALUES ('file-1', 'tag-b')`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("seed tag data: %v", err)
		}
	}

	tagDAO := &TagDAO{DB: db}
	if err := tagDAO.Delete(context.Background(), "tag-a"); err != nil {
		t.Fatalf("Delete tag-a: %v", err)
	}

	var tagACount, tagBCount, tagALinks, tagBLinks int
	if err := db.QueryRow(`SELECT COUNT(*) FROM tags WHERE id = 'tag-a'`).Scan(&tagACount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM tags WHERE id = 'tag-b'`).Scan(&tagBCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM file_tags WHERE tag_id = 'tag-a'`).Scan(&tagALinks); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM file_tags WHERE tag_id = 'tag-b'`).Scan(&tagBLinks); err != nil {
		t.Fatal(err)
	}

	if tagACount != 0 || tagALinks != 0 {
		t.Fatalf("deleted tag still has data: tag=%d links=%d", tagACount, tagALinks)
	}
	if tagBCount != 1 || tagBLinks != 1 {
		t.Fatalf("unrelated tag changed: tag=%d links=%d", tagBCount, tagBLinks)
	}
}
