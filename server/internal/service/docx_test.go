package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConvertToDocx(t *testing.T) {
	content := "# Hello\n\nThis is a paragraph.\n\n- Item 1\n- Item 2"
	tmpDir := t.TempDir()
	outputPath := filepath.Join(tmpDir, "test.docx")

	err := ConvertToDocx(content, outputPath)
	if err != nil {
		t.Fatalf("ConvertToDocx failed: %v", err)
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		t.Fatalf("docx file was not created")
	}
}
