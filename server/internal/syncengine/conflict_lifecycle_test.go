package syncengine

import (
	"context"
	"database/sql"
	"reflect"
	"strings"
	"testing"
	"time"
)

func lifecycleRemoteRecord(t *testing.T, e *Engine, record Record) {
	t.Helper()
	remote, err := e.remote(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	lock, err := remote.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	manifest, err := remote.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	data, hash, err := encodeRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if err = remote.SaveObject(hash, data); err != nil {
		t.Fatal(err)
	}
	manifest.Items[record.ID] = hash
	manifest.Generation++
	manifest.UpdatedAt = e.now().UTC().Format(time.RFC3339Nano)
	manifest.DeviceID = "device-b"
	if _, err = remote.SaveManifest(manifest); err != nil {
		t.Fatal(err)
	}
}

func lifecycleOpen(t *testing.T, e *Engine) Conflict {
	t.Helper()
	conflicts, err := e.Conflicts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 1 {
		t.Fatalf("expected one actionable conflict, got %d: %+v", len(conflicts), conflicts)
	}
	state, err := e.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.OpenConflicts != 1 {
		t.Fatalf("status disagrees with conflict list: %+v", state)
	}
	return conflicts[0]
}

func lifecycleFixture(t *testing.T) (*Engine, Conflict) {
	t.Helper()
	db, root := testDB(t)
	addFile(t, db, "n1", "One", "base", 10)
	e := testEngine(db, root, "device-a") // fixed clock: no timestamp-based identity assumptions
	if _, err := e.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE files SET content='local',updated_at=20 WHERE id='n1'`); err != nil {
		t.Fatal(err)
	}
	lifecycleRemoteRecord(t, e, presentRecord(FilePayload{ID: "n1", Title: "One", Content: "remote", CreatedAt: 10, UpdatedAt: 30, SortOrder: 1000}))
	result, err := e.Run(context.Background())
	if err != nil || result.Conflicts != 1 {
		t.Fatalf("initial conflict: %+v %v", result, err)
	}
	return e, lifecycleOpen(t, e)
}

func lifecycleStored(t *testing.T, db *sql.DB, id string) []interface{} {
	t.Helper()
	var status, resolution, local, remote string
	var created, resolved int64
	err := db.QueryRow(`SELECT status,resolution,local_record,remote_record,created_at,resolved_at FROM sync_conflicts WHERE id=?`, id).
		Scan(&status, &resolution, &local, &remote, &created, &resolved)
	if err != nil {
		t.Fatal(err)
	}
	return []interface{}{status, resolution, local, remote, created, resolved}
}

func lifecycleData(t *testing.T, e *Engine) []string {
	t.Helper()
	ctx := context.Background()
	base, err := e.base(ctx)
	if err != nil {
		t.Fatal(err)
	}
	local, err := e.localRecords(ctx)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := recordHash(local["n1"])
	if err != nil {
		t.Fatal(err)
	}
	remote, err := e.remote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := remote.LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	return []string{base["n1"], hash, manifest.Revision, manifest.Items["n1"]}
}

func TestConflictLifecycleRevisitedVersionsRemainActionable(t *testing.T) {
	for _, choice := range []string{"local", "remote"} {
		t.Run(choice, func(t *testing.T) {
			ctx := context.Background()
			e, first := lifecycleFixture(t)
			if _, err := e.DB.Exec(`UPDATE files SET content='changed-again',updated_at=21 WHERE id='n1'`); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Run(ctx); err != nil {
				t.Fatal(err)
			}
			second := lifecycleOpen(t, e)
			firstHistory := lifecycleStored(t, e.DB, first.ID)
			if _, err := e.DB.Exec(`UPDATE files SET content='local',updated_at=20 WHERE id='n1'`); err != nil {
				t.Fatal(err)
			}
			result, err := e.Run(ctx)
			if err != nil || result.Conflicts != 1 {
				t.Fatalf("revisited conflict: %+v %v", result, err)
			}
			current := lifecycleOpen(t, e)
			if current.ID == first.ID || current.ID == second.ID {
				t.Fatal("closed conflict ID was recycled")
			}
			if current.BaseHash != first.BaseHash || current.LocalHash != first.LocalHash || current.RemoteHash != first.RemoteHash {
				t.Fatal("test did not restore the exact A version tuple")
			}
			if !reflect.DeepEqual(firstHistory, lifecycleStored(t, e.DB, first.ID)) {
				t.Fatal("superseded history was overwritten")
			}
			before := lifecycleData(t, e)
			for _, old := range []Conflict{first, second} {
				if err := e.Resolve(ctx, old.ID, choice); err == nil {
					t.Fatal("stale review ID was accepted")
				}
				if !reflect.DeepEqual(before, lifecycleData(t, e)) {
					t.Fatal("stale request mutated data or base")
				}
			}
			if _, err := e.Run(ctx); err != nil {
				t.Fatal(err)
			}
			if lifecycleOpen(t, e).ID != current.ID {
				t.Fatal("unchanged open conflict got a new ID")
			}
			if err := e.Resolve(ctx, current.ID, choice); err != nil {
				t.Fatal(err)
			}
			remaining, err := e.Conflicts(ctx)
			if err != nil || len(remaining) != 0 {
				t.Fatalf("resolution incomplete: %+v %v", remaining, err)
			}
			if got := fileContent(t, e.DB, "n1"); got != choice {
				t.Fatalf("unexpected chosen body %q", got)
			}
			remote, err := e.remote(ctx)
			if err != nil {
				t.Fatal(err)
			}
			manifest, err := remote.LoadManifest()
			if err != nil {
				t.Fatal(err)
			}
			record, err := remote.LoadRecord(manifest.Items["n1"])
			if err != nil || record.File.Content != choice {
				t.Fatalf("remote did not converge: %+v %v", record, err)
			}
		})
	}
}

func TestConflictLifecycleUnchangedLegacyIDSurvivesUpgrade(t *testing.T) {
	e, first := lifecycleFixture(t)
	legacy := conflictID(PlanItem{ID: first.ItemID, BaseHash: first.BaseHash, LocalHash: first.LocalHash, RemoteHash: first.RemoteHash})
	if _, err := e.DB.Exec(`UPDATE sync_conflicts SET id=? WHERE id=?`, legacy, first.ID); err != nil {
		t.Fatal(err)
	}
	before := lifecycleStored(t, e.DB, legacy)
	for i := 0; i < 5; i++ {
		if _, err := e.Run(context.Background()); err != nil {
			t.Fatal(err)
		}
		if got := lifecycleOpen(t, e); got.ID != legacy {
			t.Fatalf("valid legacy ID replaced: %+v", got)
		}
		if !reflect.DeepEqual(before, lifecycleStored(t, e.DB, legacy)) {
			t.Fatal("ordinary refresh rewrote the captured snapshot")
		}
	}
	var count int
	if err := e.DB.QueryRow(`SELECT COUNT(*) FROM sync_conflicts`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate rows: %d %v", count, err)
	}
}

func TestConflictLifecycleClosedHistoryIsNeverReopened(t *testing.T) {
	for _, status := range []string{"resolved", "superseded"} {
		t.Run(status, func(t *testing.T) {
			e, first := lifecycleFixture(t)
			if _, err := e.DB.Exec(`UPDATE sync_conflicts SET status=?,resolution='remote',resolved_at=123 WHERE id=?`, status, first.ID); err != nil {
				t.Fatal(err)
			}
			before := lifecycleStored(t, e.DB, first.ID)
			if _, err := e.Run(context.Background()); err != nil {
				t.Fatal(err)
			}
			if lifecycleOpen(t, e).ID == first.ID {
				t.Fatal("historical ID revived")
			}
			if !reflect.DeepEqual(before, lifecycleStored(t, e.DB, first.ID)) {
				t.Fatal("historical receipt changed")
			}
		})
	}
}

func prepareLifecycleConvergence(t *testing.T, e *Engine, first Conflict, action string) {
	t.Helper()
	remote, err := e.remote(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	base, err := remote.LoadRecord(first.BaseHash)
	if err != nil {
		t.Fatal(err)
	}
	switch action {
	case "noop":
		if err := e.applyRemote(context.Background(), *first.RemoteRecord); err != nil {
			t.Fatal(err)
		}
	case "upload":
		lifecycleRemoteRecord(t, e, base)
	case "download":
		if err := e.applyRemote(context.Background(), base); err != nil {
			t.Fatal(err)
		}
	}
	plan, err := e.Plan(context.Background())
	if err != nil || len(plan.Items) != 1 || plan.Items[0].Action != action {
		t.Fatalf("incorrect convergence fixture: %+v %v", plan, err)
	}
	if lifecycleOpen(t, e).ID != first.ID {
		t.Fatal("read-only preview retired a conflict")
	}
}

func TestConflictLifecycleConvergedPlanRetiresObsoleteSnapshots(t *testing.T) {
	for _, action := range []string{"noop", "upload", "download"} {
		t.Run(action, func(t *testing.T) {
			e, first := lifecycleFixture(t)
			prepareLifecycleConvergence(t, e, first, action)
			result, err := e.Run(context.Background())
			if err != nil || result.Conflicts != 0 {
				t.Fatalf("convergence failed: %+v %v", result, err)
			}
			conflicts, err := e.Conflicts(context.Background())
			if err != nil || len(conflicts) != 0 {
				t.Fatalf("obsolete conflict still actionable: %+v %v", conflicts, err)
			}
			state, err := e.Status(context.Background())
			if err != nil || state.OpenConflicts != 0 || state.LastStatus != "ok" {
				t.Fatalf("incorrect status: %+v %v", state, err)
			}
			history := lifecycleStored(t, e.DB, first.ID)
			if history[0] != "superseded" || history[1] != "" {
				t.Fatalf("convergence fabricated a side selection: %v", history[:2])
			}
		})
	}
}

func TestConflictLifecycleRetirementFailureRollsBackAppliedPlan(t *testing.T) {
	for _, action := range []string{"noop", "upload", "download"} {
		t.Run(action, func(t *testing.T) {
			e, first := lifecycleFixture(t)
			prepareLifecycleConvergence(t, e, first, action)
			before, history := lifecycleData(t, e), lifecycleStored(t, e.DB, first.ID)
			_, err := e.DB.Exec(`CREATE TRIGGER reject_conflict_retirement BEFORE UPDATE OF status ON sync_conflicts
				WHEN OLD.status='open' AND NEW.status='superseded' BEGIN SELECT RAISE(ABORT,'injected retirement failure'); END`)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = e.Run(context.Background()); err == nil || !strings.Contains(err.Error(), "injected retirement failure") {
				t.Fatalf("expected rollback: %v", err)
			}
			if !reflect.DeepEqual(before, lifecycleData(t, e)) {
				t.Fatal("failed retirement changed local body, base or remote manifest")
			}
			if !reflect.DeepEqual(history, lifecycleStored(t, e.DB, first.ID)) {
				t.Fatal("failed retirement lost the open conflict")
			}
		})
	}
}

func TestConflictLifecycleInsertFailureKeepsPreviousOpenSnapshot(t *testing.T) {
	e, first := lifecycleFixture(t)
	before := lifecycleStored(t, e.DB, first.ID)
	_, err := e.DB.Exec(`CREATE TRIGGER reject_conflict_insert BEFORE INSERT ON sync_conflicts BEGIN SELECT RAISE(ABORT,'injected insert failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	item := PlanItem{ID: first.ItemID, BaseHash: first.BaseHash, LocalHash: hashBytes([]byte("changed")), RemoteHash: first.RemoteHash}
	if err = e.storeConflict(context.Background(), item, *first.LocalRecord, true, *first.RemoteRecord, true); err == nil {
		t.Fatal("expected insertion failure")
	}
	if !reflect.DeepEqual(before, lifecycleStored(t, e.DB, first.ID)) {
		t.Fatal("standalone store superseded the old row without inserting a replacement")
	}
}

func TestConflictLifecycleOuterTransactionRollbackKeepsHistory(t *testing.T) {
	e, first := lifecycleFixture(t)
	before := lifecycleStored(t, e.DB, first.ID)
	tx, err := e.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	item := PlanItem{ID: first.ItemID, BaseHash: first.BaseHash, LocalHash: hashBytes([]byte("changed")), RemoteHash: first.RemoteHash}
	if err = e.storeConflictWith(tx, context.Background(), item, *first.LocalRecord, true, *first.RemoteRecord, true); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, lifecycleStored(t, e.DB, first.ID)) {
		t.Fatal("outer rollback lost historical state")
	}
	if lifecycleOpen(t, e).ID != first.ID {
		t.Fatal("new ID escaped a rolled-back transaction")
	}
}

func TestConflictLifecycleStorageIsPerItemAndSupportsAllKinds(t *testing.T) {
	ctx := context.Background()
	// Storage lifecycle tests, including a missing remote version; transport
	// classification/attachment materialization have their existing own tests.
	for _, key := range []string{"n1", "folder1", "tag:t1", "filetag:n1:t1", attachmentItemKey("资料.pdf")} {
		t.Run(key, func(t *testing.T) {
			db, root := testDB(t)
			e := testEngine(db, root, "device-a")
			record := purgedRecordForKey(key)
			a := PlanItem{ID: key, BaseHash: hashBytes([]byte("base")), LocalHash: hashRecordForTest(t, record)}
			b := a
			b.BaseHash = hashBytes([]byte("other-base"))
			store := func(item PlanItem) Conflict {
				t.Helper()
				if err := e.storeConflict(ctx, item, record, true, Record{}, false); err != nil {
					t.Fatal(err)
				}
				return lifecycleOpen(t, e)
			}
			first := store(a)
			_ = store(b)
			current := store(a)
			if current.ID == first.ID {
				t.Fatal("reused closed identity")
			}
			if current.RemoteRecord != nil || current.LocalRecord.Kind != record.Kind {
				t.Fatal("changed missing-side/kind metadata")
			}
			other := a
			other.ID = "unrelated"
			unrelated := purgedRecordForKey(other.ID)
			if err := e.storeConflict(ctx, other, unrelated, true, Record{}, false); err != nil {
				t.Fatal(err)
			}
			list, err := e.Conflicts(ctx)
			if err != nil || len(list) != 2 {
				t.Fatalf("one item's lifecycle affected another: %+v %v", list, err)
			}
		})
	}
}
