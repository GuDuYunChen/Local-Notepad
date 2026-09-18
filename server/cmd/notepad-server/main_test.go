package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveUploadPathUsesDatabaseDirectory(t *testing.T) {
	root := t.TempDir()
	dbPath := filepath.Join(root, "data.db")
	if got, want := resolveUploadPath(dbPath), filepath.Join(root, "uploads"); got != want {
		t.Fatalf("resolveUploadPath() = %q, want %q", got, want)
	}
}

func TestMigrateLegacyUploadsCopiesDirectAndNestedEntries(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "legacy")
	target := filepath.Join(root, "target")
	if err := os.MkdirAll(filepath.Join(legacy, "nested-name"), 0755); err != nil {
		t.Fatalf("mkdir nested legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "direct.jpg"), []byte("direct"), 0644); err != nil {
		t.Fatalf("write direct file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "nested-name", "original.png"), []byte("nested"), 0644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	copied, err := migrateLegacyUploads(legacy, target)
	if err != nil {
		t.Fatalf("migrateLegacyUploads: %v", err)
	}
	if copied != 2 {
		t.Fatalf("copied = %d, want 2", copied)
	}

	direct, err := os.ReadFile(filepath.Join(target, "direct.jpg"))
	if err != nil || string(direct) != "direct" {
		t.Fatalf("direct migration failed: %q, %v", direct, err)
	}
	nested, err := os.ReadFile(filepath.Join(target, "nested-name"))
	if err != nil || string(nested) != "nested" {
		t.Fatalf("nested migration failed: %q, %v", nested, err)
	}
}

func TestMigrateLegacyUploadsDoesNotOverwriteExistingTarget(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "legacy")
	target := filepath.Join(root, "target")
	if err := os.MkdirAll(legacy, 0755); err != nil {
		t.Fatalf("mkdir legacy: %v", err)
	}
	if err := os.MkdirAll(target, 0755); err != nil {
		t.Fatalf("mkdir target: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "same.png"), []byte("legacy"), 0644); err != nil {
		t.Fatalf("write legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(target, "same.png"), []byte("current"), 0644); err != nil {
		t.Fatalf("write target: %v", err)
	}

	copied, err := migrateLegacyUploads(legacy, target)
	if err != nil {
		t.Fatalf("migrateLegacyUploads: %v", err)
	}
	if copied != 0 {
		t.Fatalf("copied = %d, want 0", copied)
	}
	content, err := os.ReadFile(filepath.Join(target, "same.png"))
	if err != nil || string(content) != "current" {
		t.Fatalf("existing target was overwritten: %q, %v", content, err)
	}
}

func TestFlattenUploadEntriesFlattensSingleFileDirectory(t *testing.T) {
	root := t.TempDir()
	nestedDir := filepath.Join(root, "asset-key")
	if err := os.MkdirAll(nestedDir, 0755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nestedDir, "photo.jpg"), []byte("image"), 0644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	flattenUploadEntries(root)

	info, err := os.Stat(filepath.Join(root, "asset-key"))
	if err != nil {
		t.Fatalf("flattened file missing: %v", err)
	}
	if info.IsDir() {
		t.Fatal("asset-key should be a file after flattening")
	}
	content, err := os.ReadFile(filepath.Join(root, "asset-key"))
	if err != nil || string(content) != "image" {
		t.Fatalf("unexpected flattened content: %q, %v", content, err)
	}
}
