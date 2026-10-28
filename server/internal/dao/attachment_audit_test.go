package dao

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func auditFixture(t *testing.T) (*FileDAO, string) {
	t.Helper()
	d := statisticsFixture(t)
	dir := t.TempDir()
	return d, dir
}
func auditRead(t *testing.T, d *FileDAO, dir string) *AttachmentAuditSnapshot {
	t.Helper()
	s, e := d.AttachmentAudit(context.Background(), dir)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func auditWrite(t *testing.T, dir, name, body string) {
	t.Helper()
	if e := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); e != nil {
		t.Fatal(e)
	}
}
func TestAttachmentAuditCompleteReadOnlyInventoryAndSources(t *testing.T) {
	d, dir := auditFixture(t)
	auditWrite(t, dir, "a.png", "binary-not-opened")
	auditWrite(t, dir, "unused.txt", "")
	d.DB.Exec(`UPDATE files SET content=? WHERE id='note-a'`, `{"root":{"children":[{"type":"image","src":"/uploads/a.png"},{"type":"attachment","src":"/uploads/missing.pdf"},{"type":"text","text":"/uploads/a.png"}]}}`)
	d.DB.Exec(`UPDATE files SET content='ordinary secret body' WHERE id='note-b'`)
	d.DB.Exec(`INSERT INTO files(id,title,content,is_deleted) VALUES('trash','trash','![a](/uploads/a.png)',1)`)
	d.DB.Exec(`INSERT INTO files(id,title,content) VALUES('template',?,'![a](/uploads/a.png)')`, TemplatePrefix+"template")
	if e := os.Mkdir(filepath.Join(dir, "subdir"), 0700); e != nil {
		t.Fatal(e)
	}
	s := auditRead(t, d, dir)
	if !s.Complete || s.Totals.Files != 2 || s.Totals.Missing != 1 || s.Totals.Unreferenced != 1 || s.Totals.Blocked != 1 || s.Totals.References != 4 || s.Totals.Notes != 4 || len(s.Items) != 4 {
		t.Fatalf("%+v", s)
	}
	if s.Items[0].Name != "a.png" || len(s.Items[0].Notes) != 3 || s.Items[1].State != "missing" || s.Items[2].State != "blocked" {
		t.Fatal(s.Items)
	}
	raw, _ := json.Marshal(s)
	if strings.Contains(string(raw), "ordinary secret body") || strings.Contains(string(raw), dir) || strings.Contains(string(raw), "binary-not-opened") {
		t.Fatal("private body/path leaked")
	}
	var body string
	d.DB.QueryRow(`SELECT content FROM files WHERE id='note-b'`).Scan(&body)
	if body != "ordinary secret body" {
		t.Fatal("body changed")
	}
	if b, e := os.ReadFile(filepath.Join(dir, "a.png")); e != nil || string(b) != "binary-not-opened" {
		t.Fatal("file changed")
	}
	if auditRead(t, d, dir).Revision != s.Revision {
		t.Fatal("unstable revision")
	}
	d.DB.Exec(`UPDATE files SET content='changed' WHERE id='note-b'`)
	if auditRead(t, d, dir).Revision == s.Revision {
		t.Fatal("body ignored by revision")
	}
}
func TestAttachmentAuditURLBoundary(t *testing.T) {
	cases := []struct {
		raw, name string
		ok, bad   bool
	}{
		{"/uploads/雪%20图.png?download=1#x", "雪 图.png", true, false},
		{"http://127.0.0.1:27121/uploads/a.png", "a.png", true, false},
		{"http://localhost:123/uploads/a.png", "a.png", true, false},
		{"https://[::1]/uploads/a.png", "a.png", true, false},
		{"https://example.com/uploads/a.png", "", false, false}, {"//example.com/uploads/a.png", "", false, false},
		{"file:///uploads/a.png", "", false, false}, {"http://user@localhost/uploads/a.png", "", false, false},
		{"/uploads/../secret", "", false, true}, {"/uploads/%2e%2e", "", false, true},
		{"/uploads/%2fsecret", "", false, true}, {"/uploads/a%5cb", "", false, true},
		{"/uploads/%252e%252e", "", false, true}, {"/uploads/sub/a.png", "", false, true}, {"/uploads/C:drive", "", false, true},
		{"/uploads/a%00.png", "", false, true}, {"/uploads/a%ZZ", "", false, true},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			n, ok, bad := auditURL(c.raw)
			if n != c.name || ok != c.ok || bad != c.bad {
				t.Fatalf("%q %v %v", n, ok, bad)
			}
		})
	}
}
func TestAttachmentAuditConservativeReferencesAndGaps(t *testing.T) {
	body := `{"root":{"children":[{"type":"image-grid","images":[{"src":"/uploads/a%20b.png"}]},{"type":"link","url":"https://example.com/uploads/foreign.png"},{"type":"text","text":"![候选](/uploads/x.png) /uploads/x.png"}]}}`
	names, parsed, rejected := auditBodyReferences(body)
	if strings.Join(names, ",") != "a b.png,x.png" || !parsed || rejected != 0 {
		t.Fatal(names, parsed, rejected)
	}
	for _, body := range []string{`{"root":`, `{"root":{}}`, `[]`, `{"unfamiliar":"value"}`} {
		_, parsed, _ := auditBodyReferences(body)
		if parsed {
			t.Fatal("unparsed accepted", body)
		}
	}
	names, parsed, rejected = auditBodyReferences("plain /uploads/../bad https://foreign.example/uploads/x.png /uploads/good.pdf")
	if strings.Join(names, ",") != "good.pdf" || !parsed || rejected != 1 {
		t.Fatal(names, parsed, rejected)
	}
}
func TestAttachmentAuditMissingRootDoesNotCreateOrFetch(t *testing.T) {
	d, parent := auditFixture(t)
	dir := filepath.Join(parent, "absent")
	d.DB.Exec(`UPDATE files SET content='/uploads/missing.png' WHERE id='note-a'`)
	s := auditRead(t, d, dir)
	if s.Totals.Missing != 1 || s.Totals.Files != 0 {
		t.Fatal(s)
	}
	if _, e := os.Stat(dir); !os.IsNotExist(e) {
		t.Fatal("directory created")
	}
}
func TestAttachmentAuditRefusesCancellationLimitsAndBadMetadata(t *testing.T) {
	d, dir := auditFixture(t)
	auditWrite(t, dir, "a", "a")
	auditWrite(t, dir, "b", "b")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s, e := d.AttachmentAudit(ctx, dir); e == nil || s != nil {
		t.Fatal("cancelled read accepted")
	}
	for _, limits := range [][3]int64{{1, 20000, 67108864}, {10000, 1, 67108864}, {10000, 20000, 0}} {
		d.DB.Exec(`UPDATE files SET content='hello' WHERE id='note-a'`)
		s, e := d.attachmentAudit(context.Background(), dir, int(limits[0]), int(limits[1]), limits[2], nil)
		if e == nil || s != nil {
			t.Fatal("partial limit", limits)
		}
	}
	d.DB.Exec(`UPDATE files SET title=? WHERE id='note-a'`, strings.Repeat("a", 4001))
	if s, e := d.AttachmentAudit(context.Background(), dir); e == nil || s != nil {
		t.Fatal("metadata bound ignored")
	}
	if s, e := d.AttachmentAudit(context.Background(), ""); e == nil || s != nil {
		t.Fatal("unconfigured root")
	}
}
func TestAttachmentAuditRejectsDriftInsteadOfMixingInventories(t *testing.T) {
	for _, change := range []string{"add", "delete", "resize", "rename", "root"} {
		t.Run(change, func(t *testing.T) {
			d, dir := auditFixture(t)
			auditWrite(t, dir, "a", "original")
			s, e := d.attachmentAudit(context.Background(), dir, 10000, 20000, 67108864, func() {
				switch change {
				case "add":
					auditWrite(t, dir, "b", "")
				case "delete":
					os.Remove(filepath.Join(dir, "a"))
				case "resize":
					auditWrite(t, dir, "a", "different length")
				case "rename":
					os.Rename(filepath.Join(dir, "a"), filepath.Join(dir, "b"))
				case "root":
					os.Rename(dir, dir+"-moved")
					t.Cleanup(func() { os.RemoveAll(dir + "-moved") })
				}
			})
			if e == nil || s != nil {
				t.Fatal("drift accepted")
			}
		})
	}
}
func TestAttachmentAuditDoesNotFollowLinkedEntriesOrRoot(t *testing.T) {
	d, dir := auditFixture(t)
	outside := filepath.Join(t.TempDir(), "private")
	os.WriteFile(outside, []byte("PRIVATE"), 0600)
	if e := os.Symlink(outside, filepath.Join(dir, "linked")); e == nil {
		s := auditRead(t, d, dir)
		if s.Totals.Blocked != 1 || s.Totals.Files != 0 {
			t.Fatal("link followed")
		}
		link := filepath.Join(t.TempDir(), "root-link")
		if e = os.Symlink(dir, link); e != nil {
			t.Fatal(e)
		}
		if s, e := d.AttachmentAudit(context.Background(), link); e == nil || s != nil {
			t.Fatal("linked root accepted")
		}
	} else {
		t.Log("OS denied symlink creation; regular-file-root refusal still verified")
	}
	if s, e := d.AttachmentAudit(context.Background(), outside); e == nil || s != nil {
		t.Fatal("non-directory root accepted")
	}
	b, _ := os.ReadFile(outside)
	if string(b) != "PRIVATE" {
		t.Fatal("outside changed")
	}
}
func TestAttachmentAuditUnparsedAndRejectedReferencesVisible(t *testing.T) {
	d, dir := auditFixture(t)
	d.DB.Exec(`UPDATE files SET content='{"root":' WHERE id='note-a'`)
	d.DB.Exec(`UPDATE files SET content='/uploads/../outside' WHERE id='note-b'`)
	s := auditRead(t, d, dir)
	if s.Totals.Unparsed != 1 || s.Totals.RejectedURLs != 1 || s.Totals.Missing != 0 {
		t.Fatal(s.Totals)
	}
}

func TestAttachmentAuditExternalAndNestedPathsAreNotLocalCandidates(t *testing.T) {
	for _, body := range []string{"//foreign.example/uploads/private.png", "ftp://host/uploads/private.png", "/other/uploads/private.png", "https://remote.example/uploads/private.png", "https://127.0.0.1.evil/uploads/private.png"} {
		names, _, _ := auditBodyReferences(body)
		if len(names) != 0 {
			t.Fatalf("external/path classified as local: %q %v", body, names)
		}
	}
	names, _, _ := auditBodyReferences("[local](http://127.0.0.1:27121/uploads/local.png)")
	if strings.Join(names, ",") != "local.png" {
		t.Fatal(names)
	}
}
