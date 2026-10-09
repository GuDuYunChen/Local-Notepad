package syncengine

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrS3LocalDatabaseInput  = errors.New("本地预览数据库读取参数或预算无效")
	ErrS3LocalDatabaseRead   = errors.New("未能取得完整的本地预览数据库快照")
	ErrS3LocalDatabaseRecord = errors.New("本地预览数据库记录无效或字段超出预算")
	ErrS3LocalDatabaseLimit  = errors.New("本地预览数据库快照超过显式预算，未返回部分记录")
)

// S3LocalDatabaseLimits bound the DATABASE portion of a future preview input.
// Records includes files, tags and file-tag links together (1..128); BaseItems
// is independently 1..128. RecordBytes is 1..256KiB and TotalRecordBytes 1..1MiB.
// These are accepted-input budgets, not total SQLite/runtime memory bounds.
type S3LocalDatabaseLimits struct {
	Records          int
	BaseItems        int
	RecordBytes      int64
	TotalRecordBytes int64
}

// S3LocalDatabaseSnapshot contains private canonical Record JSON, NOT a safe
// IPC result or a complete S3PlanRecordBasis. Attachments are deliberately NOT
// read, and CompleteForPreview is always false. Even an empty database does
// not establish an empty attachment inventory. StoredRemote* belongs to the
// existing sync_base; it is not an independently trusted S3 pin, an activation
// decision, or evidence that this store is an S3 store. No implicit rebinding.
type S3LocalDatabaseSnapshot struct {
	DatabaseRecords      map[string]string
	BaseItems            map[string]string
	StoredRemoteStoreID  string
	StoredRemoteRevision string
	CompleteForPreview   bool
}

// ReadS3LocalDatabaseSnapshot reads all three database record kinds plus the
// existing common-base identity in ONE owned SQLite transaction. It does not
// call localRecordsWith (which creates/scans uploads), initialize sync state,
// write settings, execute DML, commit, open a path, or issue network requests.
// Only schema14 and read_uncommitted=0 are accepted. The borrowed DB is not
// closed or reconfigured; the transaction is always rolled back before return.
// SQLite read transactions give a point-in-time view, not "latest forever".
// Drivers must honor context and transaction semantics. No driver downgrade or
// retry occurs if BeginTx rejects read-only/serializable options.
//
// LIMIT remaining+1 detects overflow, never quietly truncates. Individual text
// columns are bounded inside the SELECT before Scan; all canonical encodings
// share a cumulative budget. Invalid UTF-8 is refused before json.Marshal can
// replace it. Original record and relationship validators remain authoritative.
// Any query/scan/row-close/rollback/validation/cancellation failure returns a
// ZERO snapshot with a fixed error (or context sentinel), never partial maps.
func ReadS3LocalDatabaseSnapshot(ctx context.Context, db *sql.DB, limits S3LocalDatabaseLimits) (out S3LocalDatabaseSnapshot, err error) {
	if ctx == nil || db == nil || limits.Records < 1 || limits.Records > 128 ||
		limits.BaseItems < 1 || limits.BaseItems > 128 || limits.RecordBytes < 1 || limits.RecordBytes > 256*1024 ||
		limits.TotalRecordBytes < 1 || limits.TotalRecordBytes > 1024*1024 {
		return out, ErrS3LocalDatabaseInput
	}
	call, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if call.Err() != nil {
		return out, call.Err()
	}
	tx, e := db.BeginTx(call, &sql.TxOptions{Isolation: sql.LevelSerializable, ReadOnly: true})
	if e != nil {
		if call.Err() != nil {
			return out, call.Err()
		}
		return out, ErrS3LocalDatabaseRead
	}
	defer func() {
		closeErr := tx.Rollback()
		if call.Err() != nil {
			err = call.Err()
		} else if closeErr != nil {
			err = ErrS3LocalDatabaseRead
		}
		if err != nil {
			out = S3LocalDatabaseSnapshot{}
		}
	}()
	var schema, uncommitted int
	if tx.QueryRowContext(call, "PRAGMA user_version").Scan(&schema) != nil {
		return out, ErrS3LocalDatabaseRead
	}
	// Production migrations use schema_migrations and leave user_version at 0.
	// Preserve explicit nonzero version refusal and verify within this same
	// read-only transaction. Never migrate or set a PRAGMA from a read request.
	if schema == 0 {
		if tx.QueryRowContext(call, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&schema) != nil {
			return out, ErrS3LocalDatabaseRead
		}
	}
	if schema != 14 || tx.QueryRowContext(call, "PRAGMA read_uncommitted").Scan(&uncommitted) != nil || uncommitted != 0 {
		return out, ErrS3LocalDatabaseRead
	}
	var store, revision sql.NullString
	e = tx.QueryRowContext(call, "SELECT "+s3BoundedColumn("remote_store_id")+","+s3BoundedColumn("remote_revision")+" FROM sync_state WHERE id=1", 1024, 64).Scan(&store, &revision)
	if e != nil || !s3DatabaseText(store, revision) || (store.String != "" && !s3ManifestID(store.String)) ||
		(revision.String != "" && !objectHashPattern.MatchString(revision.String)) || (store.String == "" && revision.String != "") {
		return out, ErrS3LocalDatabaseRead
	}
	out = S3LocalDatabaseSnapshot{DatabaseRecords: map[string]string{}, BaseItems: map[string]string{},
		StoredRemoteStoreID: store.String, StoredRemoteRevision: revision.String}
	records := map[string]Record{}
	hashes := map[string]string{}
	charged := int64(0)
	add := func(r Record) error {
		if call.Err() != nil {
			return call.Err()
		}
		if len(records) >= limits.Records {
			return ErrS3LocalDatabaseLimit
		}
		if _, exists := records[r.ID]; exists {
			return ErrS3LocalDatabaseRecord
		}
		b, hash, e := encodeRecord(r)
		if e != nil {
			return ErrS3LocalDatabaseRecord
		}
		if int64(len(b)) > limits.RecordBytes || int64(len(b)) > limits.TotalRecordBytes-charged {
			return ErrS3LocalDatabaseLimit
		}
		if _, e = decodeS3Record(call, b, r.ID); e != nil {
			return ErrS3LocalDatabaseRecord
		}
		charged += int64(len(b))
		out.DatabaseRecords[r.ID] = string(b)
		records[r.ID] = r
		hashes[r.ID] = hash
		return nil
	}
	// The identifiers and query shapes below are fixed, not caller input.
	fileSQL := "SELECT " + strings.Join([]string{s3BoundedColumn("id"), s3BoundedColumn("title"), s3BoundedColumn("content"),
		"created_at", "updated_at", "is_folder", s3BoundedColumn("parent_id"), "sort_order", "is_deleted", "deleted_at", "is_pinned"}, ",") + " FROM files LIMIT ?"
	e = s3DatabaseRows(call, tx, fileSQL, []any{limits.RecordBytes, limits.RecordBytes, limits.RecordBytes, limits.RecordBytes, limits.Records + 1}, func(rows *sql.Rows) error {
		var f FilePayload
		var id, title, content, parent sql.NullString
		var folder, deleted, pinned int64
		if rows.Scan(&id, &title, &content, &f.CreatedAt, &f.UpdatedAt, &folder, &parent, &f.SortOrder, &deleted, &f.DeletedAt, &pinned) != nil ||
			!s3DatabaseText(id, title, content, parent) || folder < 0 || folder > 1 || deleted < 0 || deleted > 1 || pinned < 0 || pinned > 1 {
			return ErrS3LocalDatabaseRecord
		}
		f.ID, f.Title, f.Content, f.ParentID = id.String, title.String, content.String, parent.String
		f.IsFolder, f.IsDeleted, f.IsPinned = folder == 1, deleted == 1, pinned == 1
		return add(presentRecord(f))
	})
	if e != nil {
		return out, e
	}
	e = s3DatabaseRows(call, tx, "SELECT "+s3BoundedColumn("id")+","+s3BoundedColumn("name")+","+s3BoundedColumn("color")+" FROM tags LIMIT ?",
		[]any{limits.RecordBytes, limits.RecordBytes, limits.RecordBytes, limits.Records - len(records) + 1}, func(rows *sql.Rows) error {
			var id, name, color sql.NullString
			if rows.Scan(&id, &name, &color) != nil || !s3DatabaseText(id, name, color) {
				return ErrS3LocalDatabaseRecord
			}
			return add(presentTagRecord(TagPayload{ID: id.String, Name: name.String, Color: color.String}))
		})
	if e != nil {
		return out, e
	}
	e = s3DatabaseRows(call, tx, "SELECT "+s3BoundedColumn("file_id")+","+s3BoundedColumn("tag_id")+" FROM file_tags LIMIT ?",
		[]any{limits.RecordBytes, limits.RecordBytes, limits.Records - len(records) + 1}, func(rows *sql.Rows) error {
			var file, tag sql.NullString
			if rows.Scan(&file, &tag) != nil || !s3DatabaseText(file, tag) {
				return ErrS3LocalDatabaseRecord
			}
			return add(presentFileTagRecord(FileTagPayload{FileID: file.String, TagID: tag.String}))
		})
	if e != nil {
		return out, e
	}
	e = s3DatabaseRows(call, tx, "SELECT "+s3BoundedColumn("item_id")+","+s3BoundedColumn("object_hash")+" FROM sync_base LIMIT ?",
		[]any{1024, 64, limits.BaseItems + 1}, func(rows *sql.Rows) error {
			if len(out.BaseItems) >= limits.BaseItems {
				return ErrS3LocalDatabaseLimit
			}
			var id, hash sql.NullString
			if rows.Scan(&id, &hash) != nil || !s3DatabaseText(id, hash) || !s3ManifestID(id.String) ||
				!s3RecordKey(kindForItemKey(id.String), id.String) || !objectHashPattern.MatchString(hash.String) {
				return ErrS3LocalDatabaseRecord
			}
			if _, exists := out.BaseItems[id.String]; exists {
				return ErrS3LocalDatabaseRecord
			}
			out.BaseItems[id.String] = hash.String
			return nil
		})
	if e != nil {
		return out, e
	}
	if len(out.BaseItems) > 0 && (store.String == "" || revision.String == "") {
		return out, ErrS3LocalDatabaseRead
	}
	if call.Err() != nil {
		return out, call.Err()
	}
	// Three-kind database graph is closed under folder and tag/link relations.
	// This says nothing about external attachment files or a future remote pin.
	if validateRemoteStructure(Manifest{Items: hashes}, nil, records) != nil {
		return out, ErrS3LocalDatabaseRecord
	}
	if call.Err() != nil {
		return out, call.Err()
	}
	return out, nil
}

func s3BoundedColumn(column string) string {
	return "CASE WHEN length(CAST(" + column + " AS BLOB)) <= ? THEN " + column + " ELSE NULL END"
}
func s3DatabaseText(values ...sql.NullString) bool {
	for _, v := range values {
		if !v.Valid || !utf8.ValidString(v.String) {
			return false
		}
	}
	return true
}
func s3DatabaseRows(ctx context.Context, tx *sql.Tx, query string, args []any, visit func(*sql.Rows) error) (err error) {
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return ErrS3LocalDatabaseRead
	}
	defer func() {
		if rows.Close() != nil {
			err = ErrS3LocalDatabaseRead
		}
	}()
	for rows.Next() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if e := visit(rows); e != nil {
			return e
		}
	}
	if rows.Err() != nil {
		return ErrS3LocalDatabaseRead
	}
	return nil
}
