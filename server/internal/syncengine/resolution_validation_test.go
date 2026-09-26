package syncengine

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

type resolutionReadOnlyRemote struct {
	SyncRemote
	records map[string]Record
	reads   int
}

func (r *resolutionReadOnlyRemote) LoadRecord(hash string) (Record, error) {
	r.reads++
	value, ok := r.records[hash]
	if !ok {
		return Record{}, fmt.Errorf("unknown record")
	}
	return value, nil
}

func resolutionFile(id, title, parent string, folder bool) Record {
	return presentRecord(FilePayload{ID: id, Title: title, ParentID: parent, IsFolder: folder, Content: "body"})
}

func resolutionManifest(t *testing.T, records ...Record) (Manifest, *resolutionReadOnlyRemote) {
	t.Helper()
	m := Manifest{Items: map[string]string{}}
	r := &resolutionReadOnlyRemote{records: map[string]Record{}}
	for _, record := range records {
		hash, err := recordHash(record)
		if err != nil {
			t.Fatal(err)
		}
		m.Items[record.ID], r.records[hash] = hash, record
	}
	return m, r
}

func TestResolutionGuardRemoteCandidatesAreReadOnly(t *testing.T) {
	cases := []struct {
		name    string
		records []Record
		chosen  Record
	}{
		{"duplicate-title", []Record{resolutionFile("n1", "One", "", false), resolutionFile("n2", "shared", "", false)}, resolutionFile("n1", "Shared", "", false)},
		{"folder-cycle", []Record{resolutionFile("f1", "One", "f2", true), resolutionFile("f2", "Two", "", true)}, resolutionFile("f2", "Two", "f1", true)},
		{"missing-parent", []Record{resolutionFile("n1", "One", "", false)}, resolutionFile("n1", "One", "missing", false)},
		{"delete-parent", []Record{resolutionFile("f1", "Folder", "", true), resolutionFile("n1", "One", "f1", false)}, purgedRecordForKey("f1")},
		{"duplicate-tag", []Record{presentTagRecord(TagPayload{ID: "t1", Name: "One"}), presentTagRecord(TagPayload{ID: "t2", Name: "shared"})}, presentTagRecord(TagPayload{ID: "t1", Name: "Shared"})},
		{"dangling-link", []Record{resolutionFile("n1", "One", "", false)}, presentFileTagRecord(FileTagPayload{FileID: "n1", TagID: "missing"})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, r := resolutionManifest(t, tc.records...)
			before := copyItems(m.Items)
			if err := validateRemoteStructure(m, r, nil); err != nil {
				t.Fatalf("invalid starting fixture: %v", err)
			}
			if err := validateRemoteResolution(context.Background(), m, r, tc.chosen); err == nil {
				t.Fatal("accepted invalid destination")
			}
			if !reflect.DeepEqual(before, m.Items) || len(r.records) != len(tc.records) {
				t.Fatal("validation mutated the source manifest or uploaded an object")
			}
		})
	}
}

func TestResolutionGuardLocalCandidatesDoNotChangeSnapshots(t *testing.T) {
	locals := map[string]Record{"n1": resolutionFile("n1", "One", "", false), "n2": resolutionFile("n2", "shared", "", false)}
	before := locals["n1"]
	if err := validateLocalResolution(context.Background(), locals, resolutionFile("n1", "Shared", "", false)); err == nil {
		t.Fatal("accepted duplicate local title")
	}
	if !reflect.DeepEqual(before, locals["n1"]) || len(locals) != 2 {
		t.Fatal("validation mutated the captured local snapshot")
	}
	if err := validateLocalResolution(context.Background(), locals, resolutionFile("n1", "New valid name", "", false)); err != nil {
		t.Fatal(err)
	}
}

func TestResolutionGuardLocalCascadeMatchesExistingRelationDeletion(t *testing.T) {
	for _, item := range []string{"n1", "tag:t1"} {
		t.Run(item, func(t *testing.T) {
			locals := map[string]Record{
				"n1":            resolutionFile("n1", "One", "", false),
				"tag:t1":        presentTagRecord(TagPayload{ID: "t1", Name: "Tag"}),
				"filetag:n1:t1": presentFileTagRecord(FileTagPayload{FileID: "n1", TagID: "t1"}),
			}
			if err := validateLocalResolution(context.Background(), locals, purgedRecordForKey(item)); err != nil {
				t.Fatalf("existing file/tag relation cascade was blocked: %v", err)
			}
			if len(locals) != 3 || locals["filetag:n1:t1"].State != "present" {
				t.Fatal("validation applied a deletion")
			}
		})
	}
}

func TestResolutionGuardLocalFolderDeletionDoesNotCascadeChildren(t *testing.T) {
	locals := map[string]Record{"f1": resolutionFile("f1", "Folder", "", true), "n1": resolutionFile("n1", "One", "f1", false)}
	if err := validateLocalResolution(context.Background(), locals, purgedRecordForKey("f1")); err == nil {
		t.Fatal("folder deletion orphaned its remaining child")
	}
	delete(locals, "n1")
	if err := validateLocalResolution(context.Background(), locals, purgedRecordForKey("f1")); err != nil {
		t.Fatal(err)
	}
}

func TestResolutionGuardInvalidPayloadAndMismatchedKeysFailClosed(t *testing.T) {
	for _, chosen := range []Record{{}, {Format: RecordFormat, Version: 1, ID: "n1", Kind: "file", State: "present"}} {
		if err := validateLocalResolution(context.Background(), nil, chosen); err == nil {
			t.Fatal("accepted invalid chosen record")
		}
	}
	locals := map[string]Record{"wrong-key": resolutionFile("n1", "One", "", false)}
	if err := validateLocalResolution(context.Background(), locals, resolutionFile("n2", "Two", "", false)); err == nil {
		t.Fatal("accepted mismatched local object key")
	}
}

func TestResolutionGuardCancellationPreventsValidationReads(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	chosen := resolutionFile("n1", "One", "", false)
	m, r := resolutionManifest(t, chosen)
	if err := validateRemoteResolution(ctx, m, r, chosen); !errors.Is(err, context.Canceled) {
		t.Fatalf("remote cancellation lost: %v", err)
	}
	if err := validateLocalResolution(ctx, map[string]Record{chosen.ID: chosen}, chosen); !errors.Is(err, context.Canceled) {
		t.Fatalf("local cancellation lost: %v", err)
	}
	if r.reads != 0 {
		t.Fatal("cancelled validation fetched records")
	}
}
