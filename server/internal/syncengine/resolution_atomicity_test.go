package syncengine

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Compare every protected row, not just counts. Status/error telemetry and SQL
// trigger definitions are deliberately excluded: reporting a failed run is valid.
func atomicDataImage(t *testing.T, e *Engine) string {
	t.Helper()
	queries := []string{
		`SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files ORDER BY id`,
		`SELECT id,name,color FROM tags ORDER BY id`,
		`SELECT file_id,tag_id FROM file_tags ORDER BY file_id,tag_id`,
		`SELECT id,file_id,content,title,created_at FROM file_versions ORDER BY id`,
		`SELECT id,source_id,target_id,created_at FROM links ORDER BY id`,
		`SELECT item_id,object_hash,synced_at FROM sync_base ORDER BY item_id`,
		`SELECT id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution,resolved_at FROM sync_conflicts ORDER BY id`,
	}
	image := make([][][]interface{}, 0, len(queries))
	for _, query := range queries {
		rows, err := e.DB.Query(query)
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			t.Fatal(err)
		}
		values := [][]interface{}{}
		for rows.Next() {
			row := make([]interface{}, len(columns))
			args := make([]interface{}, len(row))
			for i := range row {
				args[i] = &row[i]
			}
			if err = rows.Scan(args...); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			values = append(values, row)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		if err = rows.Close(); err != nil {
			t.Fatal(err)
		}
		image = append(image, values)
	}
	data, err := json.Marshal(image)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func atomicSQL(t *testing.T, db *sql.DB, query string, args ...interface{}) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func atomicFTSCount(t *testing.T, db *sql.DB, term string) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM files_fts WHERE files_fts MATCH ?`, term).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func atomicResolved(t *testing.T, e *Engine, c Conflict, side string) {
	t.Helper()
	row := lifecycleStored(t, e.DB, c.ID)
	if row[0] != "resolved" || row[1] != side {
		t.Fatalf("missing explicit resolution receipt: %v", row)
	}
	base, err := e.base(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := c.LocalHash
	if side == "remote" {
		want = c.RemoteHash
	}
	if base[c.ItemID] != want {
		t.Fatalf("base does not match completed choice: %s != %s", base[c.ItemID], want)
	}
}

func TestResolutionAtomicHistoryFailure(t *testing.T) {
	for _, route := range []string{"resolve", "download"} {
		for _, fault := range []string{"ABORT,'injected history failure'", "IGNORE"} {
			t.Run(route+"/"+fault, func(t *testing.T) {
				e, c := lifecycleFixture(t)
				if route == "download" {
					atomicSQL(t, e.DB, `UPDATE files SET content='base',updated_at=10 WHERE id='n1'`)
				}
				before := atomicDataImage(t, e)
				remoteBefore := lifecycleData(t, e)
				atomicSQL(t, e.DB, `CREATE TRIGGER reject_atomic_history BEFORE INSERT ON file_versions BEGIN SELECT RAISE(`+fault+`); END`)
				var err error
				if route == "resolve" {
					err = e.Resolve(context.Background(), c.ID, "remote")
				} else {
					_, err = e.Run(context.Background())
				}
				if err == nil {
					t.Error("REGRESSION_HISTORY: history failure was reported as a successful apply")
				}
				if atomicDataImage(t, e) != before || !reflect.DeepEqual(remoteBefore, lifecycleData(t, e)) {
					t.Error("REGRESSION_HISTORY: missing historical copy did not protect body/base/receipt")
				}
				if atomicFTSCount(t, e.DB, "remote") != 0 {
					t.Error("failed apply changed the full-text index")
				}
			})
		}
	}
}

func TestResolutionAtomicReceiptFailure(t *testing.T) {
	for _, fault := range []string{"ABORT,'injected receipt failure'", "IGNORE"} {
		t.Run(fault, func(t *testing.T) {
			e, c := lifecycleFixture(t)
			before := atomicDataImage(t, e)
			remoteBefore := lifecycleData(t, e)
			atomicSQL(t, e.DB, `CREATE TRIGGER reject_atomic_receipt BEFORE UPDATE OF status ON sync_conflicts WHEN NEW.status='resolved' BEGIN SELECT RAISE(`+fault+`); END`)
			if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
				t.Error("REGRESSION_RECEIPT: unrecorded resolution was reported as success")
			}
			if atomicDataImage(t, e) != before || !reflect.DeepEqual(remoteBefore, lifecycleData(t, e)) {
				t.Error("REGRESSION_RECEIPT: failed receipt left committed body/history/base")
			}
			if t.Failed() {
				return
			}
			atomicSQL(t, e.DB, `DROP TRIGGER reject_atomic_receipt`)
			// Explicit retry after removing the injected fault, never an auto-retry.
			if err := e.Resolve(context.Background(), c.ID, "remote"); err != nil {
				t.Fatal(err)
			}
			atomicResolved(t, e, c, "remote")
			var count int
			if err := e.DB.QueryRow(`SELECT COUNT(*) FROM file_versions WHERE file_id='n1' AND content='local'`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("retry lost or duplicated the historical body: %d %v", count, err)
			}
			after := atomicDataImage(t, e)
			if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
				t.Fatal("completed lifecycle replayed")
			}
			if after != atomicDataImage(t, e) {
				t.Fatal("replay changed a completed transaction")
			}
		})
	}
}

func TestResolutionAtomicBatchFailureRollsBackEarlierDownloads(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	for _, id := range []string{"n0", "n1"} {
		addFile(t, db, id, id, "before", 10)
	}
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"n0", "n1"} {
		lifecycleRemoteRecord(t, e, presentRecord(FilePayload{ID: id, Title: id, Content: "after", CreatedAt: 10, UpdatedAt: 20, SortOrder: 1000}))
	}
	before := atomicDataImage(t, e)
	atomicSQL(t, db, `CREATE TRIGGER reject_second_history BEFORE INSERT ON file_versions WHEN NEW.file_id='n1' BEGIN SELECT RAISE(ABORT,'second history failure'); END`)
	if _, err := e.Run(context.Background()); err == nil || !strings.Contains(err.Error(), "second history failure") {
		t.Fatalf("expected second download failure: %v", err)
	}
	if before != atomicDataImage(t, e) || atomicFTSCount(t, db, "after") != 0 || atomicFTSCount(t, db, "before") != 2 {
		t.Fatal("earlier download/history/base/FTS changes escaped rollback")
	}
	atomicSQL(t, db, `DROP TRIGGER reject_second_history`)
	result, err := e.Run(context.Background())
	if err != nil || result.AppliedDown != 2 || atomicFTSCount(t, db, "after") != 2 {
		t.Fatalf("explicit healthy rerun failed: %+v %v", result, err)
	}
}

func TestResolutionAtomicDeletedOrChangedLifecycleCannotCommit(t *testing.T) {
	for _, query := range []string{
		`DELETE FROM sync_conflicts WHERE id=?`,
		`UPDATE sync_conflicts SET status='superseded' WHERE id=?`,
		`UPDATE sync_conflicts SET status='resolved',resolution='local' WHERE id=?`,
		`UPDATE sync_conflicts SET remote_hash='changed' WHERE id=?`,
	} {
		t.Run(query, func(t *testing.T) {
			e, c := lifecycleFixture(t)
			atomicSQL(t, e.DB, query, c.ID)
			before := atomicDataImage(t, e)
			if err := e.applyResolutionRecord(context.Background(), c, *c.RemoteRecord); err == nil {
				t.Fatal("stale lifecycle authorized an apply transaction")
			}
			if atomicDataImage(t, e) != before {
				t.Fatal("stale lifecycle changed protected data")
			}
		})
	}
}

func TestResolutionAtomicLateRetirementRollsBack(t *testing.T) {
	e, c := lifecycleFixture(t)
	before := atomicDataImage(t, e)
	atomicSQL(t, e.DB, `CREATE TRIGGER retire_during_apply AFTER UPDATE ON files BEGIN UPDATE sync_conflicts SET status='superseded' WHERE item_id=NEW.id; END`)
	if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
		t.Fatal("a zero-row terminal receipt counted as a completed choice")
	}
	if atomicDataImage(t, e) != before {
		t.Fatal("late retirement, body, history or base escaped rollback")
	}
}

func TestResolutionAtomicPurgeReceiptFailureRestoresRelations(t *testing.T) {
	e, _ := lifecycleFixture(t)
	lifecycleRemoteRecord(t, e, purgedRecordForKey("n1"))
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	c := lifecycleOpen(t, e)
	// Locally added relations are not on the remote manifest. Existing cascade
	// rules must remove them only if the selected deletion actually commits.
	addTag(t, e.DB, "t1", "Research", "#123456")
	addFileTag(t, e.DB, "n1", "t1")
	atomicSQL(t, e.DB, `INSERT INTO file_versions(file_id,content,title,created_at) VALUES('n1','older','Old',1)`)
	atomicSQL(t, e.DB, `INSERT INTO links(source_id,target_id,created_at) VALUES('n1','target',1)`)
	before := atomicDataImage(t, e)
	atomicSQL(t, e.DB, `CREATE TRIGGER reject_purge_receipt BEFORE UPDATE OF status ON sync_conflicts WHEN NEW.status='resolved' BEGIN SELECT RAISE(ABORT,'purge receipt failure'); END`)
	if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
		t.Fatal("purge with missing receipt counted as success")
	}
	if before != atomicDataImage(t, e) {
		t.Fatal("failed purge lost original note/history/tags/links")
	}
	atomicSQL(t, e.DB, `DROP TRIGGER reject_purge_receipt`)
	if err := e.Resolve(context.Background(), c.ID, "remote"); err != nil {
		t.Fatal(err)
	}
	atomicResolved(t, e, c, "remote")
}

func TestResolutionAtomicTagReceiptFailure(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	addTag(t, db, "t1", "Original", "#111111")
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	atomicSQL(t, db, `UPDATE tags SET name='Local' WHERE id='t1'`)
	lifecycleRemoteRecord(t, e, presentTagRecord(TagPayload{ID: "t1", Name: "Remote", Color: "#222222"}))
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	c := lifecycleOpen(t, e)
	before := atomicDataImage(t, e)
	atomicSQL(t, db, `CREATE TRIGGER reject_tag_receipt BEFORE UPDATE OF status ON sync_conflicts WHEN NEW.status='resolved' BEGIN SELECT RAISE(ABORT,'tag receipt failure'); END`)
	if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
		t.Fatal("tag choice without a receipt succeeded")
	}
	if before != atomicDataImage(t, e) {
		t.Fatal("failed tag resolution committed a partial state")
	}
}

func atomicAttachmentFixture(t *testing.T) (*Engine, Conflict) {
	t.Helper()
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	writeAttachment(t, root, "资料.txt", "base")
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	writeAttachment(t, root, "资料.txt", "local")
	source := filepath.Join(t.TempDir(), "remote.txt")
	if err := os.WriteFile(source, []byte("remote"), 0600); err != nil {
		t.Fatal(err)
	}
	remote, err := e.remote(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	hash := hashBytes([]byte("remote"))
	if err = remote.SaveBlobFile(hash, source, 6); err != nil {
		t.Fatal(err)
	}
	lifecycleRemoteRecord(t, e, presentAttachmentRecord(AttachmentPayload{Name: "资料.txt", Size: 6, BlobHash: hash}))
	if _, err = e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	return e, lifecycleOpen(t, e)
}

func TestResolutionAtomicExternalEffectRetainsRecovery(t *testing.T) {
	for _, kind := range []string{"published-local", "remote-attachment"} {
		t.Run(kind, func(t *testing.T) {
			var e *Engine
			var c Conflict
			side := "local"
			if kind == "published-local" {
				e, c = lifecycleFixture(t)
			} else {
				e, c = atomicAttachmentFixture(t)
				side = "remote"
			}
			before := atomicDataImage(t, e)
			atomicSQL(t, e.DB, `CREATE TRIGGER reject_external_receipt BEFORE UPDATE OF status ON sync_conflicts WHEN NEW.status='resolved' BEGIN SELECT RAISE(ABORT,'external receipt failure'); END`)
			runner := NewRecoveryRunner(e)
			if err := runner.Resolve(context.Background(), c.ID, side); err == nil {
				t.Fatal("failed external-effect receipt reported success")
			}
			if before != atomicDataImage(t, e) {
				t.Fatal("base/receipt metadata did not roll back together")
			}
			state, err := runner.Status(context.Background())
			if err != nil || state.Recovery.Mode != "review_required" {
				t.Fatalf("uncertain external effect lost its recovery boundary: %+v %v", state, err)
			}
			if kind == "published-local" {
				remote, err := e.remote(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				manifest, err := remote.LoadManifest()
				if err != nil || manifest.Items[c.ItemID] != c.LocalHash {
					t.Fatalf("test did not reach the published-remote boundary: %+v %v", manifest, err)
				}
			} else {
				data, err := os.ReadFile(filepath.Join(e.DataDir, "uploads", "资料.txt"))
				if err != nil || string(data) != "remote" {
					t.Fatalf("test did not reach the filesystem effect: %q %v", data, err)
				}
				preserved, err := os.ReadDir(filepath.Join(e.DataDir, "sync-preserved"))
				if err != nil || len(preserved) != 1 {
					t.Fatalf("original attachment not preserved: %+v %v", preserved, err)
				}
				data, err = os.ReadFile(filepath.Join(e.DataDir, "sync-preserved", preserved[0].Name()))
				if err != nil || string(data) != "local" {
					t.Fatalf("preserved original bytes changed: %q %v", data, err)
				}
			}
			// Recovery must refuse another automatic/ordinary write. A failed
			// receipt is NOT evidence that the external effect was rolled back.
			after := resolutionDataImage(t, e)
			if err := runner.Resolve(context.Background(), c.ID, side); err == nil {
				t.Fatal("uncertain selection was replayed without recovery acknowledgement")
			}
			if before != atomicDataImage(t, e) || after != resolutionDataImage(t, e) {
				t.Fatal("blocked retry issued another write")
			}
		})
	}
}

func TestResolutionAtomicHealthyChoicesRemainUsable(t *testing.T) {
	for _, kind := range []string{"note", "attachment"} {
		for _, side := range []string{"local", "remote"} {
			t.Run(kind+"/"+side, func(t *testing.T) {
				var e *Engine
				var c Conflict
				if kind == "note" {
					e, c = lifecycleFixture(t)
				} else {
					e, c = atomicAttachmentFixture(t)
				}
				if err := e.Resolve(context.Background(), c.ID, side); err != nil {
					t.Fatal(err)
				}
				atomicResolved(t, e, c, side)
			})
		}
	}
}

func TestResolutionAtomicReadAndCancellationDoNotWrite(t *testing.T) {
	e, c := lifecycleFixture(t)
	before := atomicDataImage(t, e)
	if _, err := e.Plan(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CheckRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.applyResolutionRecord(ctx, c, *c.RemoteRecord); err == nil {
		t.Fatal("cancelled apply succeeded")
	}
	if before != atomicDataImage(t, e) {
		t.Fatal("read-only inspection or cancelled apply changed protected data")
	}
}

func TestResolutionAtomicMetadataOnlyDoesNotInventHistory(t *testing.T) {
	e, c := lifecycleFixture(t)
	remote := *c.RemoteRecord
	payload := *remote.File
	payload.Content = "local"
	remote.File = &payload
	lifecycleRemoteRecord(t, e, remote)
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	c = lifecycleOpen(t, e)
	atomicSQL(t, e.DB, `CREATE TRIGGER reject_unnecessary_history BEFORE INSERT ON file_versions BEGIN SELECT RAISE(ABORT,'unnecessary history'); END`)
	if err := e.Resolve(context.Background(), c.ID, "remote"); err != nil {
		t.Fatal(err)
	}
	atomicResolved(t, e, c, "remote")
	var count int
	if err := e.DB.QueryRow(`SELECT COUNT(*) FROM file_versions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("metadata-only apply unexpectedly created history: %d %v", count, err)
	}
}

func TestResolutionAtomicFirstSyncConflictWithoutBase(t *testing.T) {
	dbA, rootA := testDB(t)
	dbB, rootB := testDB(t)
	remoteRoot := filepath.Join(t.TempDir(), "shared-remote")
	a, b := testEngine(dbA, rootA, "device-a"), testEngine(dbB, rootB, "device-b")
	a.RemoteRoot, b.RemoteRoot = remoteRoot, remoteRoot
	addFile(t, dbA, "n1", "Local", "local", 10)
	addFile(t, dbB, "n1", "Remote", "remote", 20)
	if _, err := b.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	c := lifecycleOpen(t, a)
	if c.BaseHash != "" {
		t.Fatal("fixture already had a common base")
	}
	if err := a.Resolve(context.Background(), c.ID, "remote"); err != nil {
		t.Fatal(err)
	}
	atomicResolved(t, a, c, "remote")
}
