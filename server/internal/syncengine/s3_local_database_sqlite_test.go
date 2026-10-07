package syncengine

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"modernc.org/sqlite"
)

// All databases here are owned testDB fixtures. The observing connection
// delegates queries/transactions to the project's REAL pinned SQLite driver;
// the callback commits a concurrent writer, it does not emulate row results.
type s3ObservedSQLiteConnector struct {
	dsn    string
	before func(string)
}

func (c s3ObservedSQLiteConnector) Connect(context.Context) (driver.Conn, error) {
	conn, err := (&sqlite.Driver{}).Open(c.dsn)
	if err != nil {
		return nil, err
	}
	return &s3ObservedSQLiteConn{Conn: conn, before: c.before}, nil
}
func (c s3ObservedSQLiteConnector) Driver() driver.Driver { return &sqlite.Driver{} }

type s3ObservedSQLiteConn struct {
	driver.Conn
	before func(string)
}

func (c *s3ObservedSQLiteConn) BeginTx(ctx context.Context, o driver.TxOptions) (driver.Tx, error) {
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, o)
}
func (c *s3ObservedSQLiteConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if c.before != nil {
		c.before(q)
	}
	return c.Conn.(driver.QueryerContext).QueryContext(ctx, q, args)
}
func s3SQLiteSeed(t *testing.T) (*sql.DB, string) {
	t.Helper()
	db, root := testDB(t)
	db.SetMaxOpenConns(1)
	for _, q := range []string{"PRAGMA user_version=14", "PRAGMA journal_mode=WAL"} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	addFile(t, db, "雪", "PRIVATE", "first<&>", 1)
	addTag(t, db, "t", "tag", "#abc")
	addFileTag(t, db, "雪", "t")
	if _, err := db.Exec(`UPDATE sync_state SET remote_store_id='captured-store',remote_revision=? WHERE id=1`, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO sync_base VALUES('attachment:782e62696e',?,1)`, strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	return db, root
}
func TestS3LocalDatabaseSQLiteReadOnlyAndCanonical(t *testing.T) {
	db, root := s3SQLiteSeed(t)
	// A real attachment exists, but the snapshot API has no DataDir/path parameter
	// and cannot scan or hash it. Database-only remains false for full preview.
	writeAttachment(t, root, "untouched.bin", "not database data")
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(filepath.Join(root, "data.db"))}
	params := url.Values{"mode": {"ro"}}
	u.RawQuery = params.Encode()
	ro, err := sql.Open("sqlite", u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	got, err := ReadS3LocalDatabaseSnapshot(context.Background(), ro, s3DBLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.DatabaseRecords) != 3 || got.CompleteForPreview || got.StoredRemoteStoreID != "captured-store" || len(got.BaseItems) != 1 {
		t.Fatal("scope or binding lost")
	}
	want := presentRecord(FilePayload{ID: "雪", Title: "PRIVATE", Content: "first<&>", CreatedAt: 1, UpdatedAt: 1, SortOrder: 1000})
	encoded, _, _ := encodeRecord(want)
	if got.DatabaseRecords["雪"] != string(encoded) {
		t.Fatal("not existing canonical encoding")
	}
	if _, err = ro.Exec(`UPDATE files SET title='write must fail'`); err == nil {
		t.Fatal("test DB was not read-only")
	}
	if fileContent(t, db, "雪") != "first<&>" {
		t.Fatal("reader altered file")
	}
	var version, base int
	if db.QueryRow("PRAGMA user_version").Scan(&version) != nil || db.QueryRow("SELECT count(*) FROM sync_base").Scan(&base) != nil || version != 14 || base != 1 {
		t.Fatal("schema/base changed")
	}
}
func TestS3LocalDatabaseSQLiteWALSingleSnapshot(t *testing.T) {
	writer, root := s3SQLiteSeed(t)
	changed := false
	reader := sql.OpenDB(s3ObservedSQLiteConnector{dsn: filepath.Join(root, "data.db"), before: func(q string) {
		if strings.Contains(q, " FROM tags LIMIT ?") && !changed {
			changed = true
			tx, err := writer.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			for _, query := range []string{`UPDATE files SET content='second' WHERE id='雪'`, `UPDATE tags SET name='second tag' WHERE id='t'`, `INSERT INTO tags VALUES('t2','new tag','#def')`, `UPDATE sync_base SET object_hash='` + strings.Repeat("c", 64) + `'`} {
				if _, err = tx.Exec(query); err != nil {
					t.Fatal(err)
				}
			}
			if err = tx.Commit(); err != nil {
				t.Fatal(err)
			}
		}
	}})
	defer reader.Close()
	got, err := ReadS3LocalDatabaseSnapshot(context.Background(), reader, s3DBLimits())
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(got.DatabaseRecords) != 3 || strings.Contains(got.DatabaseRecords["tag:t"], "second") || strings.Contains(got.DatabaseRecords["雪"], "second") || got.BaseItems["attachment:782e62696e"] != strings.Repeat("b", 64) {
		t.Fatal("mixed snapshot epochs")
	}
	next, err := ReadS3LocalDatabaseSnapshot(context.Background(), reader, s3DBLimits())
	if err != nil || len(next.DatabaseRecords) != 4 || !strings.Contains(next.DatabaseRecords["雪"], "second") || next.BaseItems["attachment:782e62696e"] != strings.Repeat("c", 64) {
		t.Fatal("new explicit read did not see committed writer", err)
	}
}
func TestS3LocalDatabaseSQLiteBoundsDoNotTruncate(t *testing.T) {
	for _, point := range []string{"records", "base", "field", "encoding", "total"} {
		t.Run(point, func(t *testing.T) {
			db, _ := s3SQLiteSeed(t)
			l := s3DBLimits()
			var mutation string
			switch point {
			case "records":
				l.Records = 2
			case "base":
				l.BaseItems = 1
				mutation = `INSERT INTO sync_base VALUES('other','` + strings.Repeat("c", 64) + `',1)`
			case "field":
				l.RecordBytes = 1024
				mutation = `UPDATE files SET content='` + strings.Repeat("雪", 1025) + `'`
			case "encoding":
				l.RecordBytes = 1024
				mutation = `UPDATE files SET content='` + strings.Repeat("<", 200) + `'`
			case "total":
				l.TotalRecordBytes = 100
			}
			if mutation != "" {
				if _, err := db.Exec(mutation); err != nil {
					t.Fatal(err)
				}
			}
			got, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, l)
			s3DBReject(t, got, err, nil)
			var n int
			if db.QueryRow("SELECT count(*) FROM files").Scan(&n) != nil || n != 1 {
				t.Fatal("read failure mutated source")
			}
		})
	}
}
func TestS3LocalDatabaseSQLiteInconsistentOrUnsupportedData(t *testing.T) {
	for _, point := range []string{"schema13", "uncommitted", "missing-state", "orphan", "invalid-utf8", "null-parent"} {
		t.Run(point, func(t *testing.T) {
			db, _ := s3SQLiteSeed(t)
			queries := map[string]string{"schema13": "PRAGMA user_version=13", "uncommitted": "PRAGMA read_uncommitted=1", "missing-state": "DELETE FROM sync_state", "orphan": "DELETE FROM tags", "invalid-utf8": "UPDATE files SET content=CAST(x'ff' AS TEXT)", "null-parent": "UPDATE files SET parent_id=NULL"}
			if _, err := db.Exec(queries[point]); err != nil {
				t.Fatal(err)
			}
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
			s3DBReject(t, out, err, nil)
		})
	}
}
func TestS3LocalDatabaseSQLiteNoImplicitSetupOrOwnershipChange(t *testing.T) {
	db, _ := testDB(t)
	// Existing schema without version14 is NOT migrated by a read.
	out, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
	s3DBReject(t, out, err, ErrS3LocalDatabaseRead)
	if _, err = db.Exec("PRAGMA user_version=14"); err != nil {
		t.Fatal(err)
	}
	first, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
	if err != nil || first.DatabaseRecords == nil || len(first.DatabaseRecords) != 0 || first.CompleteForPreview {
		t.Fatal(err)
	}
	second, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("read initialized state", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out, err = ReadS3LocalDatabaseSnapshot(ctx, db, s3DBLimits())
	s3DBReject(t, out, err, context.Canceled)
	if err = db.Ping(); err != nil || errors.Is(err, sql.ErrConnDone) {
		t.Fatal("borrowed DB was closed")
	}
}
