package syncengine

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

// Reuse the real loopback server, record wire format and pinned set helpers.
// No fixed-port listener, real bucket, profile, provider or database is involved.
type snapshotFixture struct {
	set      recordSetFixture
	client   *syncs3.ReadClient
	blobs    map[string][]byte
	mu       sync.Mutex
	paths    []string
	override func(string, http.ResponseWriter, *http.Request) bool
}

func snapshotAttachment(name string, data []byte) Record {
	return presentAttachmentRecord(AttachmentPayload{Name: name, Size: int64(len(data)), BlobHash: hashBytes(data)})
}
func snapshotLimits() S3SnapshotReadLimits {
	return S3SnapshotReadLimits{Records: setLimits(), BlobBytes: 4096, TotalBlobBytes: 8192, MaxBlobs: 8}
}
func newSnapshotFixture(t *testing.T, records []Record, blobs map[string][]byte, override func(string, http.ResponseWriter, *http.Request) bool) *snapshotFixture {
	t.Helper()
	f := &snapshotFixture{set: newRecordSetFixture(t, records...), blobs: blobs, override: override}
	f.client = pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/synthetic-bucket/空间/")
		f.mu.Lock()
		f.paths = append(f.paths, key)
		f.mu.Unlock()
		if r.Method != "GET" || r.URL.RawQuery != "" || r.Header.Get("Range") != "" ||
			r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" ||
			!strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") {
			t.Error("not a complete signed GET")
		}
		if f.override != nil && f.override(key, w, r) {
			return
		}
		var body []byte
		var exists bool
		if strings.HasPrefix(key, "blobs/") {
			body, exists = f.blobs[strings.TrimPrefix(key, "blobs/")]
		} else {
			body, exists = f.set.body(r.URL.Path)
		}
		if !exists {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", "PRIVATE_NOT_AUTHORITY")
		_, _ = w.Write(body)
	})
	return f
}
func (f *snapshotFixture) requests() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.paths...)
}
func (f *snapshotFixture) blobCalls() int {
	n := 0
	for _, key := range f.requests() {
		if strings.HasPrefix(key, "blobs/") {
			n++
		}
	}
	return n
}
func rejectSnapshot(t *testing.T, got S3Snapshot, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(got, S3Snapshot{}) {
		t.Fatalf("expected zero rejected snapshot: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		for _, private := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", pinnedManifest().StoreID, pinnedItemHash} {
			if strings.Contains(fmt.Sprintf(verb, err), private) {
				t.Fatal("private snapshot detail in error")
			}
		}
	}
}

func TestReadS3SnapshotExistingWireAndDistinctBlobs(t *testing.T) {
	binary := []byte{0xff, 0x00, 0xfe, '\r', '\n'}
	r1 := snapshotAttachment("PRIVATE e\u0301 %2F.bin", binary)
	r2 := snapshotAttachment("PRIVATE alias.bin", binary)
	empty := snapshotAttachment("PRIVATE empty.bin", []byte{})
	blobs := map[string][]byte{hashBytes(binary): binary, hashBytes(nil): {}}
	f := newSnapshotFixture(t, []Record{setFile("root", "根目录", "", true), setFile("file", "正文", "root", false),
		presentTagRecord(TagPayload{ID: "tag", Name: "标签"}), presentFileTagRecord(FileTagPayload{FileID: "file", TagID: "tag"}),
		r1, r2, empty, purgedRecordForKey(attachmentItemKey("PRIVATE purged.bin"))}, blobs, nil)
	// Existing DirRemote writes are isolated fixtures, not product installation.
	dir := &DirRemote{Root: t.TempDir()}
	for hash, data := range blobs {
		path := filepath.Join(t.TempDir(), "synthetic-blob")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := dir.SaveBlobFile(hash, path, int64(len(data))); err != nil {
			t.Fatal(err)
		}
		stored, err := os.ReadFile(filepath.Join(dir.Root, "blobs", hash))
		if err != nil || !bytes.Equal(data, stored) {
			t.Fatal("existing blob format changed")
		}
		blobs[hash] = stored
	}
	l := snapshotLimits()
	l.TotalBlobBytes, l.BlobBytes, l.MaxBlobs = int64(len(binary)), int64(len(binary)), 2
	l.Records.TotalRecordBytes, l.Records.MaxRecords = f.set.total, len(f.set.ids)
	got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, l)
	if err != nil || !reflect.DeepEqual(got.RecordSet.Records, f.set.records) || !reflect.DeepEqual(got.Blobs, blobs) {
		t.Fatalf("snapshot roundtrip failed: %v", err)
	}
	paths := f.requests()
	if len(paths) != 1+len(f.set.ids)+2 || f.blobCalls() != 2 {
		t.Fatal("repeated manifest/record, per-name duplicate blob, or extra request")
	}
	for i, id := range f.set.ids {
		if paths[i+1] != "objects/"+f.set.manifest.Items[id]+".json" {
			t.Fatal("record request order changed")
		}
	}
	hashes := []string{r1.Attachment.BlobHash, empty.Attachment.BlobHash}
	sort.Strings(hashes)
	for i, hash := range hashes {
		if paths[1+len(f.set.ids)+i] != "blobs/"+hash {
			t.Fatal("blob hash order is not deterministic")
		}
	}
	if got.Blobs[hashBytes(nil)] == nil {
		t.Fatal("empty blob was not read and verified")
	}
}

func TestReadS3SnapshotEmptyAndPurgedAreNotMissingBlobs(t *testing.T) {
	for _, records := range [][]Record{nil, {purgedRecordForKey(attachmentItemKey("PRIVATE gone.bin"))}, {setFile("file", "正文", "", false)}} {
		f := newSnapshotFixture(t, records, nil, nil)
		got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
		if err != nil || got.Blobs == nil || len(got.Blobs) != 0 || got.RecordSet.Manifest.Revision != f.set.ref.SHA256 ||
			len(f.requests()) != 1+len(records) || f.blobCalls() != 0 {
			t.Fatalf("no-blob snapshot was not verified: %v", err)
		}
	}
	// A present zero-byte blob that returns 404 cannot become an empty success.
	f := newSnapshotFixture(t, []Record{snapshotAttachment("PRIVATE empty", nil)}, nil, nil)
	got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
	var status *syncs3.HTTPError
	if !errors.As(err, &status) || status.StatusCode != 404 || !reflect.DeepEqual(got, S3Snapshot{}) || f.blobCalls() != 1 {
		t.Fatal("missing empty blob became success")
	}
}

func TestReadS3SnapshotInvalidBudgetsAndContextStayOffline(t *testing.T) {
	f := newSnapshotFixture(t, nil, nil, nil)
	for field := 0; field < 3; field++ {
		for _, value := range []int64{-1, 0, 1 << 62} {
			t.Run(fmt.Sprintf("%d/%d", field, value), func(t *testing.T) {
				l := snapshotLimits()
				switch field {
				case 0:
					l.BlobBytes = value
				case 1:
					l.TotalBlobBytes = value
				case 2:
					l.MaxBlobs = int(value)
				}
				got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, l)
				rejectSnapshot(t, got, err, ErrS3SnapshotReference)
			})
		}
	}
	for _, l := range []S3SnapshotReadLimits{
		{Records: setLimits(), BlobBytes: syncs3.MaxObjectBytes + 1, TotalBlobBytes: 1, MaxBlobs: 1},
		{Records: setLimits(), BlobBytes: 1, TotalBlobBytes: MaxS3SnapshotBlobBytes + 1, MaxBlobs: 1},
		{Records: setLimits(), BlobBytes: 1, TotalBlobBytes: 1, MaxBlobs: MaxS3SnapshotBlobs + 1},
	} {
		got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, l)
		rejectSnapshot(t, got, err, ErrS3SnapshotReference)
	}
	l := snapshotLimits()
	l.Records.RecordBytes = 0
	got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, l)
	rejectSnapshot(t, got, err, ErrS3RecordSetReference)
	got, err = ReadS3Snapshot(nil, f.client, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, ErrS3SnapshotReference)
	got, err = ReadS3Snapshot(context.Background(), nil, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, syncs3.ErrConfig)
	bad := f.set.ref
	bad.SHA256 = "PRIVATE_HASH"
	got, err = ReadS3Snapshot(context.Background(), f.client, bad, snapshotLimits())
	rejectSnapshot(t, got, err, ErrS3ManifestReference)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err = ReadS3Snapshot(ctx, f.client, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, context.Canceled)
	ctx, done := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer done()
	got, err = ReadS3Snapshot(ctx, f.client, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, context.DeadlineExceeded)
	if len(f.requests()) != 0 {
		t.Fatal("invalid inputs performed I/O")
	}
}

func TestReadS3SnapshotAllBlobBudgetsCheckedBeforeBlobIO(t *testing.T) {
	dataA, dataB := []byte("abc"), []byte("defg")
	for _, kind := range []string{"single", "total", "count", "huge-declaration"} {
		t.Run(kind, func(t *testing.T) {
			records := []Record{snapshotAttachment("PRIVATE a", dataA), snapshotAttachment("PRIVATE b", dataB)}
			l := snapshotLimits()
			switch kind {
			case "single":
				l.BlobBytes = 3
			case "total":
				l.TotalBlobBytes = 6
			case "count":
				l.MaxBlobs = 1
			case "huge-declaration":
				records[1].Attachment.Size = 1<<63 - 1
			}
			f := newSnapshotFixture(t, records, map[string][]byte{hashBytes(dataA): dataA, hashBytes(dataB): dataB}, nil)
			got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, l)
			rejectSnapshot(t, got, err, ErrS3SnapshotLimit)
			if f.blobCalls() != 0 || len(f.requests()) != 3 {
				t.Fatal("incomplete blob plan was executed")
			}
		})
	}
}

func TestReadS3SnapshotConflictingSharedSizeRefusedBeforeAnyBlob(t *testing.T) {
	data := []byte("abc")
	a, b := snapshotAttachment("PRIVATE a", data), snapshotAttachment("PRIVATE b", data)
	b.Attachment.Size++
	f := newSnapshotFixture(t, []Record{a, b}, map[string][]byte{hashBytes(data): data}, nil)
	got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, ErrS3SnapshotMetadata)
	if f.blobCalls() != 0 {
		t.Fatal("one conflicting metadata claim was trusted")
	}
}

func TestReadS3SnapshotRecordAndRelationshipFailureStopsBlobPhase(t *testing.T) {
	for _, mode := range []string{"relation", "record-hash", "record-404"} {
		t.Run(mode, func(t *testing.T) {
			records := []Record{setFile("file", "正文", "", false), snapshotAttachment("PRIVATE a", []byte("abc"))}
			if mode == "relation" {
				records[0].File.ParentID = "PRIVATE_MISSING"
			}
			f := newSnapshotFixture(t, records, nil, func(key string, w http.ResponseWriter, r *http.Request) bool {
				if mode != "relation" && strings.HasPrefix(key, "objects/") {
					if mode == "record-404" {
						w.WriteHeader(404)
					} else {
						_, _ = w.Write([]byte("PRIVATE_BAD_RECORD"))
					}
					return true
				}
				return false
			})
			got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
			if err == nil || !reflect.DeepEqual(got, S3Snapshot{}) || f.blobCalls() != 0 {
				t.Fatal("unverified or invalid relationship set reached blob phase")
			}
			if mode == "relation" {
				rejectSnapshot(t, got, err, ErrS3RecordSetStructure)
			}
		})
	}
}

func TestReadS3SnapshotLateBlobFailureReturnsNoRecordsOrEarlierBlobs(t *testing.T) {
	a, b := []byte("abc"), []byte("def")
	hashes := []string{hashBytes(a), hashBytes(b)}
	sort.Strings(hashes)
	for _, mode := range []string{"digest", "size", "204", "206", "302", "403", "404", "500", "encoding", "truncated"} {
		t.Run(mode, func(t *testing.T) {
			records := []Record{snapshotAttachment("PRIVATE a", a), snapshotAttachment("PRIVATE b", b)}
			if mode == "size" {
				for _, r := range records {
					if r.Attachment.BlobHash == hashes[1] {
						r.Attachment.Size++
					}
				}
			}
			f := newSnapshotFixture(t, records, map[string][]byte{hashBytes(a): a, hashBytes(b): b},
				func(key string, w http.ResponseWriter, r *http.Request) bool {
					if key != "blobs/"+hashes[1] || mode == "size" {
						return false
					}
					switch mode {
					case "digest":
						w.Header().Set("ETag", hashes[1])
						w.Header().Set("X-Amz-Checksum-Sha256", hashes[1])
						_, _ = w.Write([]byte("bad"))
					case "encoding":
						w.Header().Add("Content-Encoding", "identity")
						w.Header().Add("Content-Encoding", "gzip")
						_, _ = w.Write([]byte("bad"))
					case "truncated":
						w.Header().Set("Content-Length", "3")
						_, _ = w.Write([]byte("x"))
					default:
						status := map[string]int{"204": 204, "206": 206, "302": 302, "403": 403, "404": 404, "500": 500}[mode]
						w.Header().Set("Location", "/PRIVATE_REDIRECT")
						w.WriteHeader(status)
					}
					return true
				})
			got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
			if err == nil || !reflect.DeepEqual(got, S3Snapshot{}) || f.blobCalls() != 2 || len(f.requests()) != 5 {
				t.Fatal("late failure returned earlier data or caused retry/fallback")
			}
			switch mode {
			case "digest":
				rejectSnapshot(t, got, err, syncs3.ErrDigestMismatch)
			case "size":
				rejectSnapshot(t, got, err, ErrS3AttachmentSize)
			case "encoding", "truncated":
				rejectSnapshot(t, got, err, syncs3.ErrBody)
			}
		})
	}
}

func TestReadS3SnapshotZeroDeclarationCannotAcceptNonemptyBlob(t *testing.T) {
	r := snapshotAttachment("PRIVATE empty", []byte("x"))
	r.Attachment.Size = 0
	f := newSnapshotFixture(t, []Record{r}, map[string][]byte{hashBytes([]byte("x")): []byte("x")}, nil)
	got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
	rejectSnapshot(t, got, err, ErrS3AttachmentSize)
	if f.blobCalls() != 1 {
		t.Fatal("zero declaration skipped verification")
	}
}

func TestReadS3SnapshotRealBlobCancellationAndDeadline(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		t.Run(fmt.Sprint(deadline), func(t *testing.T) {
			arrived, departed := make(chan struct{}), make(chan struct{})
			f := newSnapshotFixture(t, []Record{snapshotAttachment("PRIVATE a", []byte("abc"))}, nil,
				func(key string, w http.ResponseWriter, r *http.Request) bool {
					if !strings.HasPrefix(key, "blobs/") {
						return false
					}
					close(arrived)
					<-r.Context().Done()
					close(departed)
					return true
				})
			ctx, cancel := context.WithCancel(context.Background())
			if deadline {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 1500*time.Millisecond)
			}
			defer cancel()
			type result struct {
				value S3Snapshot
				err   error
			}
			done := make(chan result, 1)
			go func() {
				v, e := ReadS3Snapshot(ctx, f.client, f.set.ref, snapshotLimits())
				done <- result{v, e}
			}()
			select {
			case <-arrived:
			case <-time.After(3 * time.Second):
				t.Fatal("owned blob GET did not arrive")
			}
			want := context.DeadlineExceeded
			if !deadline {
				want = context.Canceled
				cancel()
			}
			select {
			case got := <-done:
				rejectSnapshot(t, got.value, got.err, want)
			case <-time.After(3 * time.Second):
				t.Fatal("snapshot did not honor caller cancellation/deadline")
			}
			select {
			case <-departed:
			case <-time.After(3 * time.Second):
				t.Fatal("cancellation did not reach the real synthetic blob request")
			}
			if len(f.requests()) != 3 {
				t.Fatal("cancellation retried")
			}
		})
	}
}

func TestReadS3SnapshotReturnedMutationCannotAuthorizeNextRead(t *testing.T) {
	data := []byte("abc")
	r := snapshotAttachment("PRIVATE original", data)
	f := newSnapshotFixture(t, []Record{r}, map[string][]byte{hashBytes(data): data}, nil)
	first, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
	if err != nil {
		t.Fatal(err)
	}
	first.Blobs[hashBytes(data)][0] = 'X'
	first.RecordSet.Records[r.ID].Attachment.BlobHash = strings.Repeat("a", 64)
	delete(first.RecordSet.Manifest.Items, r.ID)
	second, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, snapshotLimits())
	if err != nil || !bytes.Equal(second.Blobs[hashBytes(data)], data) || second.RecordSet.Manifest.Items[r.ID] == "" || len(f.requests()) != 6 {
		t.Fatalf("returned mutable data contaminated another call: %v", err)
	}
}

func TestReadS3SnapshotConcurrentCallsRemainIndependent(t *testing.T) {
	data := []byte("abc")
	f := newSnapshotFixture(t, []Record{snapshotAttachment("PRIVATE a", data)}, map[string][]byte{hashBytes(data): data}, nil)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			limits := snapshotLimits()
			if i%2 != 0 {
				limits.TotalBlobBytes = 2
			}
			got, err := ReadS3Snapshot(context.Background(), f.client, f.set.ref, limits)
			if i%2 == 0 {
				if err != nil || !bytes.Equal(got.Blobs[hashBytes(data)], data) {
					t.Error("valid concurrent snapshot rejected")
				}
			} else if !errors.Is(err, ErrS3SnapshotLimit) || !reflect.DeepEqual(got, S3Snapshot{}) {
				t.Error("concurrent budget crossed calls")
			}
		}(i)
	}
	wg.Wait()
	if f.blobCalls() != 3 || len(f.requests()) != 15 {
		t.Fatal("cross-call cache, replay or invalid call reached blob")
	}
}
