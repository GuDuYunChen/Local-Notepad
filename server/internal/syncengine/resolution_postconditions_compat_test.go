package syncengine

import (
	"context"
	"testing"
)

func TestResolutionWitnessRelationIDsRemainCompatible(t *testing.T) {
	db, root := testDB(t)
	e := testEngine(db, root, "device-a")
	addFile(t, db, "n:1", "Note", "text", 10)
	addTag(t, db, "t:1", "Tag", "#112233")
	chosen := presentFileTagRecord(FileTagPayload{FileID: "n:1", TagID: "t:1"})
	item := PlanItem{ID: chosen.ID, RemoteHash: hashRecordForTest(t, chosen)}
	if err := e.storeConflict(context.Background(), item, Record{}, false, chosen, true); err != nil {
		t.Fatal(err)
	}
	c := lifecycleOpen(t, e)
	if err := e.applyResolutionRecord(context.Background(), c, chosen); err != nil {
		t.Fatal(err)
	}
	atomicResolved(t, e, c, "remote")
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM file_tags WHERE file_id='n:1' AND tag_id='t:1'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("present payload IDs were incorrectly split: %d %v", count, err)
	}
}
