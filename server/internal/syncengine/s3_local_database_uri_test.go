package syncengine

import (
	"net/url"
	"strings"
	"testing"
)

// Test-fixture URI construction only. The input is filepath.ToSlash of an
// owned local test database's absolute path. A drive-letter path needs the
// leading slash so URL.String cannot turn "D:" into the URI authority.
// This helper never opens a path and is not production database configuration.
func s3SQLiteReadOnlyURL(slashPath string) string {
	if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	u := url.URL{Scheme: "file", Path: slashPath, RawQuery: "mode=ro"}
	return u.String()
}

func TestS3SQLiteReadOnlyURLPaths(t *testing.T) {
	// Execute both platform shapes on every runner. The SQLite integration
	// still opens the real owned path and verifies that UPDATE is refused.
	for _, path := range []string{
		"D:/a/_temp/owned/data.db",
		"C:/Users/runneradmin/AppData/Local/Temp/data.db",
		"D:/owned space/雪%23?#/data.db",
		"/tmp/owned/data.db",
		"/tmp/owned space/雪%23?#/data.db",
	} {
		uri := s3SQLiteReadOnlyURL(path)
		u, err := url.Parse(uri)
		wantPath := path
		if !strings.HasPrefix(wantPath, "/") {
			wantPath = "/" + wantPath
		}
		if err != nil || u.Scheme != "file" || u.Host != "" || u.User != nil || u.Opaque != "" ||
			u.Path != wantPath || u.Fragment != "" || u.RawQuery != "mode=ro" || u.Query().Get("mode") != "ro" {
			t.Fatalf("read-only fixture URI changed local path or authority: %q -> %q (%v)", path, uri, err)
		}
	}
}
