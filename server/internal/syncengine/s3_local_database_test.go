package syncengine

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type s3DBFixture struct {
	data                                map[string][][]driver.Value
	beginErr, rollbackErr               bool
	failQuery, failNext, failClose      string
	before                              func(string)
	begins, rollbacks, commits, queries atomic.Int32
}

func s3DBFixtureNew() *s3DBFixture {
	return &s3DBFixture{data: map[string][][]driver.Value{
		"schema": {{int64(14)}}, "isolation": {{int64(0)}}, "state": {{"store", strings.Repeat("a", 64)}},
		"files": {{"root", "目录", "", int64(1), int64(2), int64(1), "", int64(3), int64(0), int64(0), int64(0)},
			{"雪e\u0301", "PRIVATE_NOTE", "雪<&>正文", int64(4), int64(5), int64(0), "root", int64(6), int64(1), int64(7), int64(1)}},
		"tags": {{"t", "标签", "#abc"}}, "links": {{"雪e\u0301", "t"}}, "base": {{"gone", strings.Repeat("b", 64)}},
	}}
}
func s3DBLimits() S3LocalDatabaseLimits {
	return S3LocalDatabaseLimits{Records: 8, BaseItems: 8, RecordBytes: 4096, TotalRecordBytes: 16384}
}
func s3DBOpen(t *testing.T, f *s3DBFixture) *sql.DB {
	t.Helper()
	db := sql.OpenDB(s3DBConnector{f})
	t.Cleanup(func() { db.Close() })
	return db
}

type s3DBConnector struct{ f *s3DBFixture }

func (c s3DBConnector) Connect(context.Context) (driver.Conn, error) { return &s3DBConn{f: c.f}, nil }
func (c s3DBConnector) Driver() driver.Driver                        { return s3DBDriver{} }

type s3DBDriver struct{}

func (s3DBDriver) Open(string) (driver.Conn, error) { return nil, errors.New("not used") }

type s3DBConn struct {
	f        *s3DBFixture
	snapshot map[string][][]driver.Value
	active   atomic.Bool
}

func (c *s3DBConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("PRIVATE_PREPARE") }
func (c *s3DBConn) Close() error                        { return nil }
func (c *s3DBConn) Begin() (driver.Tx, error)           { return nil, errors.New("must use BeginTx") }
func (c *s3DBConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	c.f.begins.Add(1)
	if !opts.ReadOnly || opts.Isolation != driver.IsolationLevel(sql.LevelSerializable) || c.f.beginErr {
		return nil, errors.New("PRIVATE_BEGIN")
	}
	c.snapshot = map[string][][]driver.Value{}
	for k, rows := range c.f.data {
		for _, r := range rows {
			c.snapshot[k] = append(c.snapshot[k], append([]driver.Value{}, r...))
		}
	}
	c.active.Store(true)
	return c, nil
}
func (c *s3DBConn) Commit() error { c.f.commits.Add(1); return errors.New("PRIVATE_COMMIT") }
func (c *s3DBConn) Rollback() error {
	c.active.Store(false)
	c.f.rollbacks.Add(1)
	if c.f.rollbackErr {
		return errors.New("PRIVATE_ROLLBACK")
	}
	return nil
}
func (c *s3DBConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	c.f.queries.Add(1)
	if !c.active.Load() {
		return nil, errors.New("query escaped transaction")
	}
	key := ""
	switch {
	case q == "PRAGMA user_version":
		key = "schema"
	case q == "PRAGMA read_uncommitted":
		key = "isolation"
	case strings.Contains(q, " FROM sync_state WHERE id=1"):
		key = "state"
	case strings.Contains(q, " FROM file_tags LIMIT ?"):
		key = "links"
	case strings.Contains(q, " FROM files LIMIT ?"):
		key = "files"
	case strings.Contains(q, " FROM tags LIMIT ?"):
		key = "tags"
	case strings.Contains(q, " FROM sync_base LIMIT ?"):
		key = "base"
	default:
		return nil, errors.New("unexpected or writable query")
	}
	if c.f.before != nil {
		c.f.before(key)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if key == c.f.failQuery {
		return nil, errors.New("PRIVATE_QUERY")
	}
	rows := c.snapshot[key]
	widths := map[string]int{"schema": 1, "isolation": 1, "state": 2, "files": 11, "tags": 3, "links": 2, "base": 2}
	cols := make([]string, widths[key])
	for i := range cols {
		cols[i] = fmt.Sprint(i)
	}
	if key != "schema" && key != "isolation" {
		count := map[string]int{"state": 2, "files": 4, "tags": 3, "links": 2, "base": 2}[key]
		if strings.Count(q, "CASE WHEN length(CAST(") != count {
			return nil, errors.New("unbounded string column")
		}
	}
	if key != "state" && key != "schema" && key != "isolation" {
		n, ok := args[len(args)-1].Value.(int64)
		if !ok || n < 1 {
			return nil, errors.New("missing overflow sentinel")
		}
		if int64(len(rows)) > n {
			rows = rows[:n]
		}
	}
	return &s3DBRows{columns: cols, rows: rows, errNext: key == c.f.failNext, errClose: key == c.f.failClose}, nil
}

type s3DBRows struct {
	columns           []string
	rows              [][]driver.Value
	offset            int
	errNext, errClose bool
}

func (r *s3DBRows) Columns() []string { return r.columns }
func (r *s3DBRows) Close() error {
	if r.errClose {
		return errors.New("PRIVATE_CLOSE")
	}
	return nil
}
func (r *s3DBRows) Next(out []driver.Value) error {
	if r.offset == len(r.rows) {
		if r.errNext {
			return errors.New("PRIVATE_ROWS")
		}
		return io.EOF
	}
	copy(out, r.rows[r.offset])
	r.offset++
	return nil
}
func s3DBReject(t *testing.T, got S3LocalDatabaseSnapshot, err, want error) {
	t.Helper()
	if err == nil || !reflect.DeepEqual(got, S3LocalDatabaseSnapshot{}) {
		t.Fatalf("partial snapshot or absent failure: %v", err)
	}
	if want != nil && !errors.Is(err, want) {
		t.Fatalf("wrong fixed error: %v want %v", err, want)
	}
	if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "PRIVATE") {
		t.Fatal("private diagnostics leaked")
	}
}

func TestS3LocalDatabaseSnapshotDetachedAndScoped(t *testing.T) {
	f := s3DBFixtureNew()
	db := s3DBOpen(t, f)
	out, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.DatabaseRecords) != 4 || len(out.BaseItems) != 1 || out.CompleteForPreview || out.StoredRemoteStoreID != "store" {
		t.Fatal("wrong database scope")
	}
	for id, text := range out.DatabaseRecords {
		if _, err := decodeS3Record(context.Background(), []byte(text), id); err != nil {
			t.Fatal(err)
		}
	}
	expected := presentRecord(FilePayload{ID: "雪e\u0301", Title: "PRIVATE_NOTE", Content: "雪<&>正文", CreatedAt: 4, UpdatedAt: 5, ParentID: "root", SortOrder: 6, IsDeleted: true, DeletedAt: 7, IsPinned: true})
	b, _, _ := encodeRecord(expected)
	if out.DatabaseRecords[expected.ID] != string(b) {
		t.Fatal("canonical content/flags changed")
	}
	if f.begins.Load() != 1 || f.rollbacks.Load() != 1 || f.commits.Load() != 0 || f.queries.Load() != 7 {
		t.Fatal("owned read transaction lifecycle")
	}
	out.DatabaseRecords[expected.ID] = "changed"
	out.BaseItems["gone"] = "changed"
	next, err := ReadS3LocalDatabaseSnapshot(context.Background(), db, s3DBLimits())
	if err != nil || next.DatabaseRecords[expected.ID] != string(b) || len(next.BaseItems["gone"]) != 64 {
		t.Fatal("result aliases live data")
	}
}
func TestS3LocalDatabaseSnapshotEmptyIsNotFullPreview(t *testing.T) {
	f := s3DBFixtureNew()
	for _, k := range []string{"files", "tags", "links", "base"} {
		f.data[k] = nil
	}
	f.data["state"] = [][]driver.Value{{"", ""}}
	out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), s3DBLimits())
	if err != nil || out.DatabaseRecords == nil || out.BaseItems == nil || len(out.DatabaseRecords) != 0 || out.CompleteForPreview {
		t.Fatal("explicit database empty scope failed", err)
	}
}
func TestS3LocalDatabaseSnapshotInvalidInputBeforeSQL(t *testing.T) {
	cases := map[string]func(*S3LocalDatabaseLimits){"records0": func(l *S3LocalDatabaseLimits) { l.Records = 0 }, "records129": func(l *S3LocalDatabaseLimits) { l.Records = 129 }, "base0": func(l *S3LocalDatabaseLimits) { l.BaseItems = 0 }, "base129": func(l *S3LocalDatabaseLimits) { l.BaseItems = 129 }, "bytes0": func(l *S3LocalDatabaseLimits) { l.RecordBytes = 0 }, "bytesMax": func(l *S3LocalDatabaseLimits) { l.RecordBytes = 256*1024 + 1 }, "total0": func(l *S3LocalDatabaseLimits) { l.TotalRecordBytes = 0 }, "totalMax": func(l *S3LocalDatabaseLimits) { l.TotalRecordBytes = 1024*1024 + 1 }}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f := s3DBFixtureNew()
			l := s3DBLimits()
			mutate(&l)
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), l)
			s3DBReject(t, out, err, ErrS3LocalDatabaseInput)
			if f.begins.Load() != 0 {
				t.Fatal("unexpected begin")
			}
		})
	}
	t.Run("nil-db", func(t *testing.T) {
		out, err := ReadS3LocalDatabaseSnapshot(context.Background(), nil, s3DBLimits())
		s3DBReject(t, out, err, ErrS3LocalDatabaseInput)
	})
	t.Run("nil-context", func(t *testing.T) {
		out, err := ReadS3LocalDatabaseSnapshot(nil, s3DBOpen(t, s3DBFixtureNew()), s3DBLimits())
		s3DBReject(t, out, err, ErrS3LocalDatabaseInput)
	})
}
func TestS3LocalDatabaseSnapshotOneTransaction(t *testing.T) {
	f := s3DBFixtureNew()
	f.before = func(table string) {
		if table == "tags" {
			f.data["files"][1][2] = "new"
			f.data["tags"][0][1] = "new tag"
			f.data["base"][0][1] = strings.Repeat("c", 64)
		}
	}
	out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), s3DBLimits())
	if err != nil || strings.Contains(out.DatabaseRecords["tag:t"], "new tag") || out.BaseItems["gone"] != strings.Repeat("b", 64) {
		t.Fatal("mixed database epochs", err)
	}
}
func TestS3LocalDatabaseSnapshotResourceFailures(t *testing.T) {
	for _, point := range []string{"begin", "rollback", "schema", "isolation", "missing-state", "bad-revision", "base-without-identity", "query-files", "query-tags", "query-links", "query-base", "next-files", "next-base", "close-files", "close-base"} {
		t.Run(point, func(t *testing.T) {
			f := s3DBFixtureNew()
			switch point {
			case "begin":
				f.beginErr = true
			case "rollback":
				f.rollbackErr = true
			case "schema":
				f.data["schema"][0][0] = int64(13)
			case "isolation":
				f.data["isolation"][0][0] = int64(1)
			case "missing-state":
				f.data["state"] = nil
			case "bad-revision":
				f.data["state"][0][1] = "PRIVATE_BAD"
			case "base-without-identity":
				f.data["state"][0][0] = ""
				f.data["state"][0][1] = ""
			default:
				p := strings.Split(point, "-")
				switch p[0] {
				case "query":
					f.failQuery = p[1]
				case "next":
					f.failNext = p[1]
				case "close":
					f.failClose = p[1]
				}
			}
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), s3DBLimits())
			s3DBReject(t, out, err, ErrS3LocalDatabaseRead)
			if f.commits.Load() != 0 || (point != "begin" && f.rollbacks.Load() != 1) {
				t.Fatal("cleanup not completed")
			}
		})
	}
}
func TestS3LocalDatabaseSnapshotStrictRecords(t *testing.T) {
	cases := map[string]func(*s3DBFixture){
		"null-content": func(f *s3DBFixture) { f.data["files"][1][2] = nil }, "invalid-utf8": func(f *s3DBFixture) { f.data["files"][1][2] = string([]byte{255}) },
		"unknown-flag": func(f *s3DBFixture) { f.data["files"][1][8] = int64(2) }, "bad-time": func(f *s3DBFixture) { f.data["files"][1][3] = "PRIVATE_TIME" },
		"empty-title": func(f *s3DBFixture) { f.data["files"][1][1] = " " }, "reserved-id": func(f *s3DBFixture) { f.data["files"][1][0] = "tag:t" },
		"duplicate-record": func(f *s3DBFixture) { f.data["files"] = append(f.data["files"], f.data["files"][0]) }, "tag-utf8": func(f *s3DBFixture) { f.data["tags"][0][1] = string([]byte{255}) },
		"duplicate-base": func(f *s3DBFixture) { f.data["base"] = append(f.data["base"], f.data["base"][0]) }, "bad-base-hash": func(f *s3DBFixture) { f.data["base"][0][1] = "PRIVATE_HASH" },
		"bad-base-key": func(f *s3DBFixture) { f.data["base"][0][0] = "attachment:../PRIVATE" }, "link-delimiter": func(f *s3DBFixture) { f.data["links"][0][0] = "a:b" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f := s3DBFixtureNew()
			mutate(f)
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), s3DBLimits())
			s3DBReject(t, out, err, ErrS3LocalDatabaseRecord)
		})
	}
}
func TestS3LocalDatabaseSnapshotBudgets(t *testing.T) {
	for _, point := range []string{"records", "base", "record-bytes", "total-bytes", "canonical-expansion"} {
		t.Run(point, func(t *testing.T) {
			f := s3DBFixtureNew()
			l := s3DBLimits()
			switch point {
			case "records":
				l.Records = 3
			case "base":
				l.BaseItems = 1
				f.data["base"] = append(f.data["base"], []driver.Value{"gone2", strings.Repeat("c", 64)})
			case "record-bytes":
				l.RecordBytes = 16
			case "total-bytes":
				l.TotalRecordBytes = 100
			case "canonical-expansion":
				l.RecordBytes = 1024
				f.data["files"][1][2] = strings.Repeat("<", 200)
			}
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), l)
			s3DBReject(t, out, err, ErrS3LocalDatabaseLimit)
		})
	}
	t.Run("exact-count", func(t *testing.T) {
		f := s3DBFixtureNew()
		l := s3DBLimits()
		l.Records = 4
		l.BaseItems = 1
		out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), l)
		if err != nil || len(out.DatabaseRecords) != 4 {
			t.Fatal(err)
		}
	})
}
func TestS3LocalDatabaseSnapshotCancellation(t *testing.T) {
	for _, point := range []string{"before", "tags", "base", "deadline"} {
		t.Run(point, func(t *testing.T) {
			f := s3DBFixtureNew()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			want := context.Canceled
			if point == "before" {
				cancel()
			} else if point == "deadline" {
				ctx, cancel = context.WithDeadline(context.Background(), time.Unix(0, 0))
				defer cancel()
				want = context.DeadlineExceeded
			} else {
				f.before = func(table string) {
					if table == point {
						cancel()
					}
				}
			}
			out, err := ReadS3LocalDatabaseSnapshot(ctx, s3DBOpen(t, f), s3DBLimits())
			s3DBReject(t, out, err, want)
		})
	}
}
func TestS3LocalDatabaseSnapshotRelationships(t *testing.T) {
	for _, point := range []string{"orphan-folder", "not-folder", "orphan-tag", "self-cycle", "duplicate-name"} {
		t.Run(point, func(t *testing.T) {
			f := s3DBFixtureNew()
			switch point {
			case "orphan-folder":
				f.data["files"][1][6] = "missing"
			case "not-folder":
				f.data["files"][0][5] = int64(0)
			case "orphan-tag":
				f.data["tags"] = nil
			case "self-cycle":
				f.data["files"][0][6] = "root"
			case "duplicate-name":
				f.data["files"][1][6] = ""
				f.data["files"][1][1] = "目录"
				f.data["files"][1][8] = int64(0)
			}
			out, err := ReadS3LocalDatabaseSnapshot(context.Background(), s3DBOpen(t, f), s3DBLimits())
			s3DBReject(t, out, err, ErrS3LocalDatabaseRecord)
		})
	}
}
