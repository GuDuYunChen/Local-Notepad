package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
)

func TestUploadRoutePreservesSniffedContentAndReadback(t *testing.T) {
	// These are the exact public 2F.102 Desktop attachment and PNG bytes.
	attachment := []byte("EXPORT102 attachment bytes\n中文原始附件\n")
	if len(attachment) != 46 || fmt.Sprintf("%x", sha256.Sum256(attachment)) != "7c9d82808f6eda5e25e8eee4d88fd05a3a17ca503a740e9ec7b3bd629c3105ac" {
		t.Fatal("the observed Desktop attachment fixture changed")
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGO0bvrGgA0wYRUdtBIAVs4Bw7T4PJAAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		filename string
		media    string
		data     []byte
		accepted bool
	}{
		{"export_fixture_utf8", "export102.txt", "text/plain", attachment, true},
		{"long_utf8_text", "long.txt", "text/plain", []byte(strings.Repeat("长文本 UTF8 attachment\n", 80)), true},
		{"original_png", "export102-a.png", "image/png", png, true},
		{"nul_is_not_declared_text", "binary.txt", "text/plain", []byte("text\x00binary"), false},
		{"empty_file_keeps_existing_behavior", "empty.txt", "text/plain", nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			uploadDir := filepath.Join(root, "uploads")
			server := ghttp.GetServer(fmt.Sprintf("upload-route-%d", time.Now().UnixNano()))
			server.SetAddr("127.0.0.1:0")
			server.SetClientMaxBodySize(100 * 1024 * 1024)
			server.SetDumpRouterMap(false)
			server.SetAccessLogEnabled(false)
			server.SetErrorLogEnabled(false)
			server.SetLogStdout(false)
			c := &UploadController{UploadDir: uploadDir}
			c.Register(server.Group("/api"))
			if err := server.Start(); err != nil {
				t.Fatal("isolated real upload route did not start", err)
			}
			t.Cleanup(func() {
				if err := server.Shutdown(); err != nil {
					t.Error("isolated real upload route did not stop", err)
				}
			})
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			header := textproto.MIMEHeader{}
			header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": tc.filename}))
			header.Set("Content-Type", tc.media)
			part, err := form.CreatePart(header)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(tc.data); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			address := fmt.Sprintf("http://127.0.0.1:%d/api/upload", server.GetListenedPort())
			req, err := http.NewRequest(http.MethodPost, address, &body)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", form.FormDataContentType())
			req.Header.Set("Origin", "null")
			client := &http.Client{Timeout: 5 * time.Second}
			response, err := client.Do(req)
			if err != nil {
				t.Fatal("real multipart request failed", err)
			}
			defer response.Body.Close()
			raw, err := io.ReadAll(response.Body)
			if err != nil || response.StatusCode != http.StatusOK {
				t.Fatalf("upload HTTP status=%d error=%v body=%s", response.StatusCode, err, raw)
			}
			var result struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
				Data    *struct {
					URL      string `json:"url"`
					Filename string `json:"filename"`
					Size     int64  `json:"size"`
				} `json:"data"`
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal("real upload envelope did not decode", err)
			}
			entries, err := os.ReadDir(uploadDir)
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			t.Logf("real-upload fixture=%s bytes=%d sha256=%x HTTP=%d code=%d message=%q outputs=%d", tc.filename, len(tc.data), sha256.Sum256(tc.data), response.StatusCode, result.Code, result.Message, len(entries))
			if !tc.accepted {
				if result.Code != 1010 || result.Message != "文件内容类型不匹配: application/octet-stream" || result.Data != nil || len(entries) != 0 {
					t.Fatalf("binary content must be refused without output: body=%s outputs=%d", raw, len(entries))
				}
				return
			}
			if result.Code != 0 || result.Data == nil || len(entries) != 1 {
				t.Fatalf("allowed content was not saved: body=%s outputs=%d", raw, len(entries))
			}
			name := result.Data.Filename
			if filepath.Base(name) != name || name != entries[0].Name() || entries[0].IsDir() || result.Data.URL != "/uploads/"+name || result.Data.Size != int64(len(tc.data)) {
				t.Fatalf("upload receipt does not match its single local file: %s", raw)
			}
			stored, err := os.ReadFile(filepath.Join(uploadDir, name))
			if err != nil || !bytes.Equal(stored, tc.data) {
				t.Fatalf("uploaded file changed bytes: error=%v actual=%x expected=%x", err, sha256.Sum256(stored), sha256.Sum256(tc.data))
			}
		})
	}
}

func TestUploadMIMEPreservesReadErrorsAndEOF(t *testing.T) {
	readFailure := errors.New("synthetic upload read failure")
	for _, tc := range []struct {
		name   string
		reader io.Reader
	}{
		{"without_bytes", iotest.ErrReader(readFailure)},
		{"with_text_prefix", iotest.DataErrReader(io.MultiReader(strings.NewReader("text prefix"), iotest.ErrReader(readFailure)))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mediaType, err := sniffUploadMIME(tc.reader)
			if !errors.Is(err, readFailure) || mediaType != "" {
				t.Fatalf("non-EOF read error became an accepted MIME: type=%q err=%v", mediaType, err)
			}
		})
	}
	t.Run("final_bytes_with_eof", func(t *testing.T) {
		mediaType, err := sniffUploadMIME(iotest.DataErrReader(strings.NewReader("final text")))
		if err != nil || mediaType != "text/plain" {
			t.Fatalf("valid final bytes with EOF were lost: type=%q err=%v", mediaType, err)
		}
	})
}
