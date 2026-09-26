package syncengine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Each initial side is valid. Combining a single choice with OTHER destination
// records can nevertheless be invalid; a per-item hash check cannot catch it.
func resolutionPairFixture(t *testing.T, kind string) (*Engine, map[string]Conflict) {
	t.Helper()
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	var local, remote []Record
	switch kind {
	case "titles":
		addFile(t, db, "n1", "One", "base1", 10)
		addFile(t, db, "n2", "Two", "base2", 10)
		local = []Record{resolutionFile("n1", "Shared", "", false), resolutionFile("n2", "Local2", "", false)}
		remote = []Record{resolutionFile("n1", "Remote1", "", false), resolutionFile("n2", "Shared", "", false)}
	case "cycle":
		addFile(t, db, "f1", "One", "base1", 10)
		addFile(t, db, "f2", "Two", "base2", 10)
		if _, err := db.Exec(`UPDATE files SET is_folder=1`); err != nil {
			t.Fatal(err)
		}
		local = []Record{resolutionFile("f1", "One", "", true), resolutionFile("f2", "Two", "f1", true)}
		remote = []Record{resolutionFile("f1", "One", "f2", true), resolutionFile("f2", "Two", "", true)}
	case "tags":
		addTag(t, db, "t1", "One", "#111111")
		addTag(t, db, "t2", "Two", "#111111")
		local = []Record{presentTagRecord(TagPayload{ID: "t1", Name: "Shared", Color: "#222222"}), presentTagRecord(TagPayload{ID: "t2", Name: "Local2", Color: "#222222"})}
		remote = []Record{presentTagRecord(TagPayload{ID: "t1", Name: "Remote1", Color: "#333333"}), presentTagRecord(TagPayload{ID: "t2", Name: "shared", Color: "#333333"})}
	case "delete-parent":
		addFile(t, db, "f1", "Folder", "base", 10)
		addFile(t, db, "n1", "Child", "base", 10)
		if _, err := db.Exec(`UPDATE files SET is_folder=1 WHERE id='f1'`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE files SET parent_id='f1' WHERE id='n1'`); err != nil {
			t.Fatal(err)
		}
		local = []Record{resolutionFile("f1", "Folder", "", true), resolutionFile("n1", "Child", "f1", false)}
		remote = []Record{purgedRecordForKey("f1"), purgedRecordForKey("n1")}
	default:
		t.Fatal("unknown fixture")
	}
	ctx := context.Background()
	if _, err := e.Run(ctx); err != nil {
		t.Fatal(err)
	}
	for _, record := range local {
		if record.File != nil {
			record.File.UpdatedAt = 20
		}
		if err := e.applyRemote(ctx, record); err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range remote {
		if record.File != nil {
			record.File.UpdatedAt = 30
		}
		lifecycleRemoteRecord(t, e, record)
	}
	result, err := e.Run(ctx)
	if err != nil || result.Conflicts != 2 {
		t.Fatalf("fixture must retain two conflicts: %+v %v", result, err)
	}
	values, err := e.Conflicts(ctx)
	if err != nil || len(values) != 2 {
		t.Fatalf("fixture conflict list: %+v %v", values, err)
	}
	byItem := map[string]Conflict{}
	for _, c := range values {
		byItem[c.ItemID] = c
	}
	return e, byItem
}

// Excludes locks, which are acquired/released even for a rejected resolution.
// Verifies no body/base/history/conflict/manifest or orphan object was written.
func resolutionDataImage(t *testing.T, e *Engine) string {
	t.Helper()
	ctx := context.Background()
	locals, err := e.localRecords(ctx)
	if err != nil {
		t.Fatal(err)
	}
	base, err := e.base(ctx)
	if err != nil {
		t.Fatal(err)
	}
	conflicts, err := e.Conflicts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var versions int
	if err := e.DB.QueryRow(`SELECT COUNT(*) FROM file_versions`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, sub := range []string{"objects", "manifests"} {
		dir := filepath.Join(e.DataDir, "sync-lab-remote", sub)
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				t.Fatal(err)
			}
			files[sub+"/"+entry.Name()] = hashBytes(data)
		}
	}
	data, err := json.Marshal([]interface{}{locals, base, conflicts, versions, files})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestResolutionGuardRejectsInvalidCombinedDestination(t *testing.T) {
	for _, tc := range []struct{ kind, choice, id, detail string }{
		{"titles", "local", "n1", "远端结构无效"},
		{"titles", "remote", "n2", "本机结构无效"},
		{"cycle", "local", "f2", "远端结构无效"},
		{"cycle", "remote", "f1", "本机结构无效"},
		{"tags", "local", "tag:t1", "远端结构无效"},
		{"tags", "remote", "tag:t2", "本机结构无效"},
		{"delete-parent", "remote", "f1", "本机结构无效"},
	} {
		t.Run(tc.kind+"/"+tc.choice, func(t *testing.T) {
			e, conflicts := resolutionPairFixture(t, tc.kind)
			before := resolutionDataImage(t, e)
			err := e.Resolve(context.Background(), conflicts[tc.id].ID, tc.choice)
			if err == nil || !strings.Contains(err.Error(), tc.detail) {
				t.Fatalf("expected destination rejection, got %v", err)
			}
			if resolutionDataImage(t, e) != before {
				t.Fatal("rejected selection changed bodies, base, history, conflicts or remote objects")
			}
		})
	}
}

func TestResolutionGuardRelatedConflictsCanBeResolvedInSafeOrder(t *testing.T) {
	for _, choice := range []string{"local", "remote"} {
		t.Run(choice, func(t *testing.T) {
			e, conflicts := resolutionPairFixture(t, "titles")
			order := []string{"n2", "n1"}
			if choice == "remote" {
				order = []string{"n1", "n2"}
			}
			for _, id := range order {
				if err := e.Resolve(context.Background(), conflicts[id].ID, choice); err != nil {
					t.Fatal(err)
				}
			}
			remaining, err := e.Conflicts(context.Background())
			if err != nil || len(remaining) != 0 {
				t.Fatalf("valid choices did not finish: %+v %v", remaining, err)
			}
			if _, err := e.CheckRemote(context.Background()); err != nil {
				t.Fatalf("resolved remote became invalid: %v", err)
			}
		})
	}
}

func TestResolutionGuardDeleteChildrenBeforeParent(t *testing.T) {
	e, conflicts := resolutionPairFixture(t, "delete-parent")
	for _, id := range []string{"n1", "f1"} {
		if err := e.Resolve(context.Background(), conflicts[id].ID, "remote"); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := e.DB.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("explicit child/parent deletion failed: %d %v", count, err)
	}
}

func TestResolutionGuardRechecksStoreIdentityInsideRemoteLock(t *testing.T) {
	e, c := lifecycleFixture(t)
	remote, err := e.remote(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	lock, err := remote.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := remote.LoadManifest()
	if err != nil {
		lock.Release()
		t.Fatal(err)
	}
	manifest.StoreID = "another-store-with-the-same-object-hashes"
	manifest.Generation++
	_, err = remote.SaveManifest(manifest)
	lock.Release()
	if err != nil {
		t.Fatal(err)
	}
	before := resolutionDataImage(t, e)
	for _, choice := range []string{"local", "remote"} {
		if err := e.Resolve(context.Background(), c.ID, choice); err == nil || !strings.Contains(err.Error(), "身份发生变化") {
			t.Fatalf("accepted replacement store: %v", err)
		}
		if resolutionDataImage(t, e) != before {
			t.Fatal("replacement store was mutated")
		}
	}
}

func TestResolutionGuardDatabaseApplyAndBaseRollBackTogether(t *testing.T) {
	e, c := lifecycleFixture(t)
	before := resolutionDataImage(t, e)
	_, err := e.DB.Exec(`CREATE TRIGGER reject_resolution_base BEFORE UPDATE ON sync_base BEGIN SELECT RAISE(ABORT,'injected resolution base failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Resolve(context.Background(), c.ID, "remote"); err == nil || !strings.Contains(err.Error(), "injected resolution base failure") {
		t.Fatalf("expected rollback: %v", err)
	}
	if resolutionDataImage(t, e) != before {
		t.Fatal("failed base update left a committed body or file version")
	}
}

func TestResolutionGuardTransactionRejectsChangedLocalContent(t *testing.T) {
	e, c := lifecycleFixture(t)
	if _, err := e.DB.Exec(`UPDATE files SET content='new unsynchronized local edit' WHERE id='n1'`); err != nil {
		t.Fatal(err)
	}
	before := resolutionDataImage(t, e)
	if err := e.applyResolutionRecord(context.Background(), c, *c.RemoteRecord); err == nil || !strings.Contains(err.Error(), "本机内容") {
		t.Fatalf("did not recheck local data in the apply transaction: %v", err)
	}
	if resolutionDataImage(t, e) != before {
		t.Fatal("stale transaction input overwrote a new local edit")
	}
}

func TestResolutionGuardRunnerRetainsConservativeRecoveryOnRejection(t *testing.T) {
	e, conflicts := resolutionPairFixture(t, "titles")
	before := resolutionDataImage(t, e)
	r := NewRecoveryRunner(e)
	if err := r.Resolve(context.Background(), conflicts["n1"].ID, "local"); err == nil {
		t.Fatal("managed resolution bypassed destination validation")
	}
	if resolutionDataImage(t, e) != before {
		t.Fatal("managed rejection changed protected content")
	}
	state, err := r.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// Existing conservative boundary: acquiring the remote lock is already in
	// the possible-write stage. We do NOT silently clear an uncertain journal.
	if !reflect.DeepEqual(string(state.Recovery.Mode), "review_required") {
		t.Fatalf("unexpected recovery mode: %+v", state.Recovery)
	}
}

func TestResolutionGuardRejectsMismatchedManifestRecordKey(t *testing.T) {
	e, c := lifecycleFixture(t)
	ctx := context.Background()
	remote, err := e.remote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	other := resolutionFile("unexpected", "Unexpected", "", false)
	data, hash, err := encodeRecord(other)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := remote.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := remote.LoadManifest()
	if err == nil {
		err = remote.SaveObject(hash, data)
	}
	if err == nil {
		manifest.Items[c.ItemID] = hash
		manifest.Generation++
		_, err = remote.SaveManifest(manifest)
	}
	lock.Release()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.DB.Exec(`UPDATE sync_conflicts SET remote_hash=?,remote_record=? WHERE id=?`, hash, string(data), c.ID); err != nil {
		t.Fatal(err)
	}
	before := resolutionDataImage(t, e)
	if err = e.Resolve(ctx, c.ID, "remote"); err == nil || !strings.Contains(err.Error(), "对象键与清单不一致") {
		t.Fatalf("accepted a record stored under a different item key: %v", err)
	}
	if resolutionDataImage(t, e) != before {
		t.Fatal("mismatched object changed local data")
	}
}
