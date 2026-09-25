package backup

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testDB(t *testing.T, dir string) (*sql.DB, string) {
	t.Helper()
	if dir == "" {
		dir = t.TempDir()
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "data.db")
	db, e := sql.Open("sqlite", p)
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{`PRAGMA journal_mode=WAL`, `CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT,content TEXT)`, `CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)`, `INSERT INTO schema_migrations VALUES(9)`, `INSERT INTO files VALUES('first','标题','正文')`} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	return db, p
}
func snapshot(t *testing.T, db *sql.DB, p string, manual bool) Info {
	t.Helper()
	info, e := Create(context.Background(), db, p, manual)
	if e != nil {
		t.Fatal(e)
	}
	return info
}
func bytesAt(t *testing.T, p string) string {
	t.Helper()
	b, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func TestSnapshotIncludesCommittedWAL(t *testing.T) {
	db, p := testDB(t, "")
	_, e := db.Exec(`INSERT INTO files VALUES('second','带格式','组合 é')`)
	if e != nil {
		t.Fatal(e)
	}
	info := snapshot(t, db, p, true)
	if info.Files != 2 || info.SchemaVersion != 9 || len(info.SHA256) != 64 || !strings.HasPrefix(info.Name, "backup-manual-") {
		t.Fatalf("bad receipt %#v", info)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&n)
	if n != 2 {
		t.Fatal("source changed")
	}
	if _, e = Inspect(context.Background(), filepath.Join(filepath.Dir(p), "backups", info.Name)); e != nil {
		t.Fatal(e)
	}
}
func TestFilenameBindingHandlesApostropheAndUnicode(t *testing.T) {
	db, p := testDB(t, filepath.Join(t.TempDir(), "用户 O'Brien # 笔记"))
	snapshot(t, db, p, true)
}
func TestRapidBackupsNeverOverwrite(t *testing.T) {
	db, p := testDB(t, "")
	a := snapshot(t, db, p, true)
	b := snapshot(t, db, p, true)
	if a.Name == b.Name {
		t.Fatal("collision")
	}
}
func TestInspectRejectsEmptyCorruptAndForeignFiles(t *testing.T) {
	for _, raw := range []string{"", "not sqlite", strings.Repeat("x", 4096)} {
		p := filepath.Join(t.TempDir(), "bad.db")
		os.WriteFile(p, []byte(raw), 0600)
		if _, e := Inspect(context.Background(), p); e == nil {
			t.Fatal("accepted corrupt")
		}
	}
	p := filepath.Join(t.TempDir(), "foreign.db")
	db, _ := sql.Open("sqlite", p)
	db.Exec("CREATE TABLE unrelated(value)")
	db.Close()
	if _, e := Inspect(context.Background(), p); e == nil {
		t.Fatal("accepted unrelated sqlite")
	}
}
func TestFutureSchemaRejectedWithoutRewriting(t *testing.T) {
	db, p := testDB(t, "")
	db.Exec("INSERT INTO schema_migrations VALUES(13)")
	db.Close()
	before := bytesAt(t, p)
	if _, e := Inspect(context.Background(), p); e == nil {
		t.Fatal("future accepted")
	}
	if bytesAt(t, p) != before {
		t.Fatal("rewritten")
	}
}
func TestInspectDoesNotCreateMissingFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "missing.db")
	if _, e := Inspect(context.Background(), p); e == nil {
		t.Fatal("accepted missing")
	}
	if _, e := os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("file created")
	}
}
func TestResolveRejectsPathsDirectoriesAndSymlinks(t *testing.T) {
	db, p := testDB(t, "")
	info := snapshot(t, db, p, true)
	for _, name := range []string{"../data.db", "data.db", "/etc/passwd", `backup-..\x.db`, "backup-.db", "backup-x.db?mode=rw"} {
		if _, e := ResolveName(p, name); e == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	dir := filepath.Join(filepath.Dir(p), "backups")
	os.Mkdir(filepath.Join(dir, "backup-folder.db"), 0700)
	if _, e := ResolveName(p, "backup-folder.db"); e == nil {
		t.Fatal("directory accepted")
	}
	link := filepath.Join(dir, "backup-link.db")
	if e := os.Symlink(filepath.Join(dir, info.Name), link); e == nil {
		if _, e = ResolveName(p, "backup-link.db"); e == nil {
			t.Fatal("symlink accepted")
		}
	}
}
func TestFailedSnapshotDoesNotPublishPartial(t *testing.T) {
	db, p := testDB(t, "")
	db.Close()
	if _, e := Create(context.Background(), db, p, true); e == nil {
		t.Fatal("closed DB succeeded")
	}
	entries, _ := os.ReadDir(filepath.Join(filepath.Dir(p), "backups"))
	if len(entries) != 0 {
		t.Fatalf("left partial: %v", entries)
	}
}
func TestCanceledSnapshotRetainsOriginal(t *testing.T) {
	db, p := testDB(t, "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := Create(ctx, db, p, true); e == nil {
		t.Fatal("canceled succeeded")
	}
	var n int
	if e := db.QueryRow("SELECT COUNT(*) FROM files").Scan(&n); e != nil || n != 1 {
		t.Fatal("source damaged")
	}
}
func TestAutomaticRecognizesLocalTimestampAndKeepsRecentSnapshot(t *testing.T) {
	db, p := testDB(t, "")
	snapshot(t, db, p, false)
	if e := Automatic(context.Background(), db, p); e != nil {
		t.Fatal(e)
	}
	a, _ := candidates(p, true)
	if len(a) != 1 {
		t.Fatalf("unexpected repeated automatic snapshots %d", len(a))
	}
}
func TestAutomaticDoesNotTreatManualAsAutomatic(t *testing.T) {
	db, p := testDB(t, "")
	snapshot(t, db, p, true)
	if e := Automatic(context.Background(), db, p); e != nil {
		t.Fatal(e)
	}
	a, _ := candidates(p, false)
	if len(a) != 2 {
		t.Fatal("manual suppressed automatic")
	}
}
func TestAutomaticRetentionPreservesAllManualAndPrunesOnlyAfterSuccess(t *testing.T) {
	db, p := testDB(t, "")
	manual := snapshot(t, db, p, true)
	dir := filepath.Join(filepath.Dir(p), "backups")
	raw := bytesAt(t, filepath.Join(dir, manual.Name))
	for i := 0; i < 102; i++ {
		at := time.Date(2020, 1, 1, 0, 0, 0, 0, time.Local).Add(time.Duration(i) * time.Second)
		os.WriteFile(filepath.Join(dir, "backup-"+at.Format("20060102-150405")+".db"), []byte(raw), 0600)
	}
	if e := Automatic(context.Background(), db, p); e != nil {
		t.Fatal(e)
	}
	a, _ := candidates(p, true)
	if len(a) != 100 {
		t.Fatal(len(a))
	}
	if _, e := os.Stat(filepath.Join(dir, manual.Name)); e != nil {
		t.Fatal("manual pruned")
	}
}
func TestFailedAutomaticDoesNotPruneOldSnapshots(t *testing.T) {
	db, p := testDB(t, "")
	dir := filepath.Join(filepath.Dir(p), "backups")
	os.MkdirAll(dir, 0700)
	for i := 0; i < 102; i++ {
		at := time.Date(2020, 1, 1, 0, 0, 0, 0, time.Local).Add(time.Duration(i) * time.Second)
		os.WriteFile(filepath.Join(dir, "backup-"+at.Format("20060102-150405")+".db"), []byte("bad"), 0600)
	}
	db.Close()
	if e := Automatic(context.Background(), db, p); e == nil {
		t.Fatal("closed db succeeded")
	}
	a, _ := candidates(p, true)
	if len(a) != 102 {
		t.Fatal("pruned after failure")
	}
}
func TestRecoveryPreservesOriginalAndWALBeforeReplacement(t *testing.T) {
	db, p := testDB(t, "")
	info := snapshot(t, db, p, true)
	db.Close()
	for _, suffix := range []string{"", "-wal", "-shm"} {
		os.WriteFile(p+suffix, []byte("original"+suffix), 0600)
	}
	result, e := Recover(context.Background(), p)
	if e != nil {
		t.Fatal(e)
	}
	if result.Source != info.Name {
		t.Fatal("wrong source")
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if bytesAt(t, filepath.Join(result.PreservedDir, "data.db"+suffix)) != "original"+suffix {
			t.Fatal("lost original")
		}
	}
	if _, e = Inspect(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	if e = CheckPending(p); e != nil {
		t.Fatal(e)
	}
}
func TestRecoverySkipsCorruptNewestCandidate(t *testing.T) {
	db, p := testDB(t, "")
	info := snapshot(t, db, p, true)
	db.Close()
	dir := filepath.Join(filepath.Dir(p), "backups")
	os.WriteFile(filepath.Join(dir, "backup-20990101-000000.db"), []byte("bad"), 0600)
	os.WriteFile(p, []byte("damaged"), 0600)
	got, e := Recover(context.Background(), p)
	if e != nil || got.Source != info.Name {
		t.Fatalf("%#v %v", got, e)
	}
}
func TestNoValidCandidateLeavesEveryOriginalByte(t *testing.T) {
	p := filepath.Join(t.TempDir(), "data.db")
	os.MkdirAll(filepath.Join(filepath.Dir(p), "backups"), 0700)
	for _, suffix := range []string{"", "-wal", "-shm"} {
		os.WriteFile(p+suffix, []byte("keep"+suffix), 0600)
	}
	os.WriteFile(filepath.Join(filepath.Dir(p), "backups", "backup-20990101-000000.db"), []byte("bad"), 0600)
	if _, e := Recover(context.Background(), p); e == nil {
		t.Fatal("no candidate succeeded")
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if bytesAt(t, p+suffix) != "keep"+suffix {
			t.Fatal("lost original")
		}
	}
}
func TestPendingMarkerBlocksBackupAndRecovery(t *testing.T) {
	db, p := testDB(t, "")
	snapshot(t, db, p, true)
	os.WriteFile(PendingPath(p), []byte("pending"), 0600)
	if e := CheckPending(p); e == nil {
		t.Fatal("pending ignored")
	}
	if _, e := Create(context.Background(), db, p, true); e == nil {
		t.Fatal("created during recovery")
	}
	db.Close()
	if _, e := Recover(context.Background(), p); e == nil {
		t.Fatal("reentered recovery")
	}
}
func TestRecoveryMoveFailureRollsBackAlreadyPreservedFiles(t *testing.T) {
	db, p := testDB(t, "")
	snapshot(t, db, p, true)
	db.Close()
	os.WriteFile(p, []byte("original"), 0600)
	os.WriteFile(p+"-wal", []byte("wal"), 0600)
	fail := func(a, b string) error {
		if a == p+"-wal" {
			return fmt.Errorf("simulated permission failure")
		}
		return os.Rename(a, b)
	}
	if _, e := recoverWithRename(context.Background(), p, fail); e == nil {
		t.Fatal("failure ignored")
	}
	if bytesAt(t, p) != "original" || bytesAt(t, p+"-wal") != "wal" {
		t.Fatal("rollback lost original")
	}
	if e := CheckPending(p); e != nil {
		t.Fatal("completed rollback left marker")
	}
}
func TestConcurrentNewTargetNeverOverwrittenAndRetainsMarker(t *testing.T) {
	db, p := testDB(t, "")
	snapshot(t, db, p, true)
	db.Close()
	os.WriteFile(p, []byte("original"), 0600)
	race := func(a, b string) error {
		e := os.Rename(a, b)
		if e == nil && a == p {
			os.WriteFile(p, []byte("external"), 0600)
		}
		return e
	}
	got, e := recoverWithRename(context.Background(), p, race)
	if e == nil {
		t.Fatal("race ignored")
	}
	if bytesAt(t, p) != "external" || bytesAt(t, filepath.Join(got.PreservedDir, "data.db")) != "original" {
		t.Fatal("overwrote external/original")
	}
	if e := CheckPending(p); e == nil {
		t.Fatal("missing safety marker")
	}
}
func TestUnsupportedBackupNeverReplacesOriginal(t *testing.T) {
	db, p := testDB(t, "")
	db.Exec("INSERT INTO schema_migrations VALUES(13)")
	db.Close()
	dir := filepath.Join(filepath.Dir(p), "backups")
	os.MkdirAll(dir, 0700)
	copyExclusive(p, filepath.Join(dir, "backup-20990101-000000.db"))
	os.WriteFile(p, []byte("original"), 0600)
	if _, e := Recover(context.Background(), p); e == nil {
		t.Fatal("future backup restored")
	}
	if bytesAt(t, p) != "original" {
		t.Fatal("original lost")
	}
}

func TestResearchSchemaRequiresReceiptTable(t *testing.T) {
	db, p := testDB(t, "")
	if _, err := db.Exec(`INSERT INTO schema_migrations VALUES(10)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if _, err := Inspect(context.Background(), p); err == nil {
		t.Fatal("accepted schema 10 without its receipt table")
	}
}


func TestWebDAVSchemaRequiresCredentialColumns(t *testing.T) {
	db,p:=testDB(t,"")
	for _,stmt:=range []string{
		`CREATE TABLE research_note_requests(request_id TEXT,payload_sha256 TEXT,file_id TEXT,title TEXT,parent_id TEXT,created_at INTEGER)`,
		`CREATE TABLE sync_state(id INTEGER PRIMARY KEY,device_id TEXT,remote_store_id TEXT,remote_revision TEXT,last_sync_at INTEGER,last_status TEXT,last_error TEXT)`,
		`CREATE TABLE sync_base(item_id TEXT PRIMARY KEY,object_hash TEXT,synced_at INTEGER)`,
		`CREATE TABLE sync_conflicts(id TEXT PRIMARY KEY,item_id TEXT,base_hash TEXT,local_hash TEXT,remote_hash TEXT,status TEXT,resolution TEXT)`,
		`ALTER TABLE settings ADD COLUMN sync_provider TEXT DEFAULT ''`,
		`INSERT INTO schema_migrations VALUES(12)`,
	}{if _,err:=db.Exec(stmt);err!=nil{t.Fatal(err)}}
	db.Close()
	if _,err:=Inspect(context.Background(),p);err==nil{
		t.Fatal("accepted schema 12 without WebDAV credential columns")
	}
}
