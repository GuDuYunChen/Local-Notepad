package syncengine

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolutionWitnessSkippedWrites(t *testing.T) {
	faults := map[string]string{
		"body-update-ignored":     `CREATE TRIGGER witness_fault BEFORE UPDATE ON files BEGIN SELECT RAISE(IGNORE); END`,
		"base-update-ignored":     `CREATE TRIGGER witness_fault BEFORE UPDATE ON sync_base BEGIN SELECT RAISE(IGNORE); END`,
		"base-insert-ignored":     `CREATE TRIGGER witness_fault BEFORE INSERT ON sync_base BEGIN SELECT RAISE(IGNORE); END`,
		"receipt-rewritten":       `CREATE TRIGGER witness_fault AFTER UPDATE ON sync_conflicts WHEN NEW.status='resolved' AND NEW.resolution='remote' BEGIN UPDATE sync_conflicts SET resolution='local' WHERE id=NEW.id; END`,
		"body-changed-by-receipt": `CREATE TRIGGER witness_fault AFTER UPDATE ON sync_conflicts WHEN NEW.status='resolved' BEGIN UPDATE files SET content='unexpected' WHERE id=NEW.item_id; END`,
		"base-changed-by-receipt": `CREATE TRIGGER witness_fault AFTER UPDATE ON sync_conflicts WHEN NEW.status='resolved' BEGIN UPDATE sync_base SET object_hash=NEW.base_hash WHERE item_id=NEW.item_id; END`,
	}
	for name, query := range faults {
		t.Run(name, func(t *testing.T) {
			e, c := lifecycleFixture(t)
			before, external := atomicDataImage(t, e), lifecycleData(t, e)
			atomicSQL(t, e.DB, query)
			if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil {
				t.Error("REGRESSION_WRITE_WITNESS: inconsistent target/base/receipt was reported as success")
			}
			if before != atomicDataImage(t, e) || !reflect.DeepEqual(external, lifecycleData(t, e)) {
				t.Error("REGRESSION_WRITE_WITNESS: inconsistent transaction was committed")
			}
			if t.Failed() {
				return
			}
			if atomicFTSCount(t, e.DB, "remote") != 0 || atomicFTSCount(t, e.DB, "local") != 1 {
				t.Fatal("rejected resolution changed the full-text index")
			}
			atomicSQL(t, e.DB, `DROP TRIGGER witness_fault`)
			if err := e.Resolve(context.Background(), c.ID, "remote"); err != nil {
				t.Fatal(err)
			}
			atomicResolved(t, e, c, "remote")
			if fileContent(t, e.DB, "n1") != "remote" {
				t.Fatal("explicit healthy retry did not save the selected version")
			}
		})
	}
}

func TestResolutionWitnessMissingBase(t *testing.T) {
	dbA, rootA := testDB(t)
	dbB, rootB := testDB(t)
	a, b := testEngine(dbA, rootA, "device-a"), testEngine(dbB, rootB, "device-b")
	a.RemoteRoot = filepath.Join(t.TempDir(), "remote")
	b.RemoteRoot = a.RemoteRoot
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
		t.Fatal("fixture must have no common base")
	}
	before := atomicDataImage(t, a)
	atomicSQL(t, dbA, `CREATE TRIGGER witness_missing_base BEFORE INSERT ON sync_base BEGIN SELECT RAISE(IGNORE); END`)
	if err := a.Resolve(context.Background(), c.ID, "remote"); err == nil {
		t.Error("REGRESSION_FIRST_BASE: resolved a conflict without saving its first base")
	}
	if before != atomicDataImage(t, a) {
		t.Error("REGRESSION_FIRST_BASE: unconfirmed first base did not roll back body and receipt")
	}
	if t.Failed() {
		return
	}
	atomicSQL(t, dbA, `DROP TRIGGER witness_missing_base`)
	if err := a.Resolve(context.Background(), c.ID, "remote"); err != nil {
		t.Fatal(err)
	}
	atomicResolved(t, a, c, "remote")
}

// These typed cases test the actual SQLite apply transaction, not a fabricated
// HTTP/provider response. Engine.Resolve end-to-end is covered above and below.
func witnessTypedFixture(t *testing.T, kind string) (*Engine, Conflict, Record) {
	t.Helper()
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	addFile(t, db, "n1", "Original", "original", 10)
	addTag(t, db, "t1", "Original tag", "#112233")
	if kind != "link-insert" {
		addFileTag(t, db, "n1", "t1")
	}
	if kind == "folder" {
		atomicSQL(t, db, `UPDATE files SET is_folder=1 WHERE id='n1'`)
	}
	atomicSQL(t, db, `INSERT INTO file_versions(file_id,content,title,created_at) VALUES('n1','older','Older',1)`)
	atomicSQL(t, db, `INSERT INTO links(source_id,target_id,created_at) VALUES('n1','target',1)`)
	locals, err := e.localRecords(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var chosen Record
	switch kind {
	case "file", "folder":
		p := *locals["n1"].File
		p.Title = "Selected"
		p.Content = "selected"
		chosen = presentRecord(p)
	case "tag":
		chosen = presentTagRecord(TagPayload{ID: "t1", Name: "Selected tag", Color: "#445566"})
	case "link-insert":
		chosen = presentFileTagRecord(FileTagPayload{FileID: "n1", TagID: "t1"})
	case "link-delete":
		chosen = purgedRecordForKey(fileTagItemKey("n1", "t1"))
	case "file-delete":
		chosen = purgedRecordForKey("n1")
	case "tag-delete":
		chosen = purgedRecordForKey(tagItemKey("t1"))
	default:
		t.Fatal("unknown typed fixture")
	}
	local, hash, exists, err := localRecordFor(chosen.ID, locals, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	item := PlanItem{ID: chosen.ID, LocalHash: hash, RemoteHash: hashRecordForTest(t, chosen)}
	if err = e.storeConflict(context.Background(), item, local, exists, chosen, true); err != nil {
		t.Fatal(err)
	}
	return e, lifecycleOpen(t, e), chosen
}

func TestResolutionWitnessTypedTargetWrites(t *testing.T) {
	for kind, target := range map[string]string{
		"file": "UPDATE ON files", "folder": "UPDATE ON files", "tag": "UPDATE ON tags",
		"link-insert": "INSERT ON file_tags", "link-delete": "DELETE ON file_tags",
		"file-delete": "DELETE ON files", "tag-delete": "DELETE ON tags",
	} {
		t.Run(kind, func(t *testing.T) {
			e, c, chosen := witnessTypedFixture(t, kind)
			before := atomicDataImage(t, e)
			atomicSQL(t, e.DB, `CREATE TRIGGER witness_target BEFORE `+target+` BEGIN SELECT RAISE(IGNORE); END`)
			if err := e.applyResolutionRecord(context.Background(), c, chosen); err == nil {
				t.Fatal("ignored target write was accepted")
			}
			if before != atomicDataImage(t, e) {
				t.Fatal("target mismatch did not roll back its transaction")
			}
			atomicSQL(t, e.DB, `DROP TRIGGER witness_target`)
			if err := e.applyResolutionRecord(context.Background(), c, chosen); err != nil {
				t.Fatal(err)
			}
			atomicResolved(t, e, c, "remote")
		})
	}
}

func TestResolutionWitnessPurgeDependents(t *testing.T) {
	for _, kind := range []string{"file-delete", "tag-delete"} {
		for _, table := range []string{"file_tags", "file_versions", "links"} {
			if kind == "tag-delete" && table != "file_tags" {
				continue
			}
			t.Run(kind+"/"+table, func(t *testing.T) {
				e, c, chosen := witnessTypedFixture(t, kind)
				before := atomicDataImage(t, e)
				atomicSQL(t, e.DB, `CREATE TRIGGER witness_cascade BEFORE DELETE ON `+table+` BEGIN SELECT RAISE(IGNORE); END`)
				if err := e.applyResolutionRecord(context.Background(), c, chosen); err == nil {
					t.Fatal("incomplete existing cascade was accepted")
				}
				if before != atomicDataImage(t, e) {
					t.Fatal("incomplete cascade lost protected data")
				}
			})
		}
	}
}

func TestResolutionWitnessExternalEffects(t *testing.T) {
	for _, kind := range []string{"local-publication", "remote-attachment"} {
		t.Run(kind, func(t *testing.T) {
			var e *Engine
			var c Conflict
			side := "local"
			if kind == "local-publication" {
				e, c = lifecycleFixture(t)
			} else {
				e, c = atomicAttachmentFixture(t)
				side = "remote"
			}
			before := atomicDataImage(t, e)
			atomicSQL(t, e.DB, `CREATE TRIGGER witness_external BEFORE UPDATE ON sync_base BEGIN SELECT RAISE(IGNORE); END`)
			runner := NewRecoveryRunner(e)
			if err := runner.Resolve(context.Background(), c.ID, side); err == nil {
				t.Fatal("external effect with missing metadata was reported as success")
			}
			if before != atomicDataImage(t, e) {
				t.Fatal("base/receipt metadata did not roll back together")
			}
			state, err := runner.Status(context.Background())
			if err != nil || state.Recovery.Mode != "review_required" {
				t.Fatalf("lost uncertainty protection: %+v %v", state, err)
			}
			if kind == "local-publication" {
				remote, err := e.remote(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				manifest, err := remote.LoadManifest()
				if err != nil {
					t.Fatal(err)
				}
				if manifest.Items[c.ItemID] != c.LocalHash {
					t.Fatal("fixture did not reach the external publication")
				}
			} else {
				data, err := os.ReadFile(filepath.Join(e.DataDir, "uploads", "资料.txt"))
				if err != nil || string(data) != "remote" {
					t.Fatalf("fixture did not reach attachment publication: %v", err)
				}
				preserved, err := os.ReadDir(filepath.Join(e.DataDir, "sync-preserved"))
				if err != nil || len(preserved) != 1 {
					t.Fatalf("original attachment missing: %v", err)
				}
				data, err = os.ReadFile(filepath.Join(e.DataDir, "sync-preserved", preserved[0].Name()))
				if err != nil || string(data) != "local" {
					t.Fatal("preserved attachment bytes changed")
				}
			}
			after := resolutionDataImage(t, e)
			if err := runner.Resolve(context.Background(), c.ID, side); err == nil {
				t.Fatal("uncertain write automatically replayed")
			}
			if after != resolutionDataImage(t, e) || before != atomicDataImage(t, e) {
				t.Fatal("blocked replay mutated state")
			}
		})
	}
}

func TestResolutionWitnessHealthyChoices(t *testing.T) {
	for _, side := range []string{"local", "remote"} {
		t.Run(side, func(t *testing.T) {
			e, c := lifecycleFixture(t)
			if err := e.Resolve(context.Background(), c.ID, side); err != nil {
				t.Fatal(err)
			}
			atomicResolved(t, e, c, side)
			if got := fileContent(t, e.DB, "n1"); got != side {
				t.Fatalf("unexpected chosen body %q", got)
			}
		})
	}
}

func TestResolutionWitnessCancellationAndPreview(t *testing.T) {
	e, c := lifecycleFixture(t)
	before := atomicDataImage(t, e)
	if _, err := e.Plan(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.applyResolutionRecord(ctx, c, *c.RemoteRecord); err == nil {
		t.Fatal("cancelled operation committed")
	}
	if before != atomicDataImage(t, e) {
		t.Fatal("preview or cancellation wrote data")
	}
}
