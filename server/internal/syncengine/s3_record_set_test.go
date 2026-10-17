package syncengine

import (
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
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

type recordSetFixture struct {
	manifest Manifest
	ref      S3ManifestReference
	raw      []byte
	objects  map[string][]byte
	records  map[string]Record
	ids      []string
	total    int64
}

func newRecordSetFixture(t *testing.T, records ...Record) recordSetFixture {
	t.Helper()
	f := recordSetFixture{manifest: pinnedManifest(), objects: map[string][]byte{}, records: map[string]Record{}}
	f.manifest.Items = map[string]string{}
	for _, r := range records {
		b, h, err := encodeRecord(r)
		if err != nil {
			t.Fatal(err)
		}
		f.manifest.Items[r.ID] = h
		f.objects["objects/"+h+".json"] = b
		f.records[r.ID] = r
		f.ids = append(f.ids, r.ID)
		f.total += int64(len(b))
	}
	sort.Strings(f.ids)
	f.raw = pinnedBytes(t, f.manifest)
	f.ref = pinnedReference(f.raw)
	return f
}
func (f recordSetFixture) body(path string) ([]byte, bool) {
	path = strings.TrimPrefix(path, "/synthetic-bucket/空间/")
	if path == fmt.Sprintf("manifests/%020d-%s.json", f.ref.Generation, f.ref.SHA256) {
		return f.raw, true
	}
	b, ok := f.objects[path]
	return b, ok
}
func setLimits() S3RecordSetReadLimits { return S3RecordSetReadLimits{32768, 32768, 65536, 32} }
func setFile(id, title, parent string, folder bool) Record {
	return presentRecord(FilePayload{ID: id, Title: title, ParentID: parent, IsFolder: folder, Content: "PRIVATE_CONTENT\n\x00原文"})
}
func rejectRecordSet(t *testing.T, set S3RecordSet, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(set, S3RecordSet{}) {
		t.Fatalf("expected zero rejected set: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		text := fmt.Sprintf(verb, err)
		for _, secret := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", pinnedManifest().StoreID, pinnedItemHash} {
			if strings.Contains(text, secret) {
				t.Fatal("private record-set detail in error")
			}
		}
	}
}
func serveRecordSet(t *testing.T, f recordSetFixture, count *atomic.Int32) *syncs3.ReadClient {
	t.Helper()
	return pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		if r.Method != "GET" || r.URL.RawQuery != "" || r.Header.Get("Range") != "" ||
			!strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") || r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" {
			t.Error("request contract changed")
		}
		b, ok := f.body(r.URL.Path)
		if !ok {
			t.Error("unlisted request")
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(b)
	})
}

func TestReadS3RecordSetExistingFormatsAndDeterministicSingleManifest(t *testing.T) {
	f := newRecordSetFixture(t, setFile("root", "根目录", "", true), setFile("e\u0301 %2F", "正文", "root", false),
		presentTagRecord(TagPayload{ID: "tag", Name: "标记", Color: "#aabbcc"}),
		presentFileTagRecord(FileTagPayload{FileID: "e\u0301 %2F", TagID: "tag"}),
		presentAttachmentRecord(AttachmentPayload{Name: "合成.txt", Size: 0, BlobHash: pinnedItemHash}), purgedRecordForKey("deleted"))
	// The unchanged directory format is the wire source, not a second schema.
	dir := &DirRemote{Root: t.TempDir()}
	for id, r := range f.records {
		b, h, err := encodeRecord(r)
		if err != nil {
			t.Fatal(err)
		}
		if err = dir.SaveObject(h, b); err != nil {
			t.Fatal(err)
		}
		b, err = os.ReadFile(filepath.Join(dir.Root, "objects", h+".json"))
		if err != nil {
			t.Fatal(err)
		}
		f.objects["objects/"+f.manifest.Items[id]+".json"] = b
	}
	stored, err := dir.SaveManifest(f.manifest)
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = os.ReadFile(filepath.Join(dir.Root, "manifests", fmt.Sprintf("%020d-%s.json", f.manifest.Generation, stored.Revision)))
	if err != nil {
		t.Fatal(err)
	}
	f.ref = pinnedReference(f.raw)
	var paths []string
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Method != "GET" || r.URL.RawQuery != "" || r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" || !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=") {
			t.Error("not an exact signed GET")
		}
		b, ok := f.body(r.URL.Path)
		if !ok {
			t.Error("unlisted object")
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(b)
	})
	limits := setLimits()
	limits.TotalRecordBytes = f.total
	limits.MaxRecords = len(f.ids)
	limits.ManifestBytes = int64(len(f.raw))
	got, err := ReadS3RecordSet(context.Background(), c, f.ref, limits)
	if err != nil || !reflect.DeepEqual(got.Records, f.records) || got.Manifest.Revision != f.ref.SHA256 {
		t.Fatalf("record set failed: %v", err)
	}
	if len(paths) != 1+len(f.ids) {
		t.Fatal("repeated manifest, blob read or missing record")
	}
	for i, id := range f.ids {
		if !strings.HasSuffix(paths[i+1], "/objects/"+f.manifest.Items[id]+".json") {
			t.Fatal("non-deterministic record order")
		}
	}
}

func TestReadS3RecordSetEmptyManifestIsVerifiedNotInitialization(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
	if e != nil || got.Records == nil || len(got.Records) != 0 || got.Manifest.StoreID != f.ref.StoreID || calls.Load() != 1 {
		t.Fatalf("empty pin not verified: %v", e)
	}
}

func TestReadS3RecordSetInvalidInputsStayOffline(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	cases := []S3RecordSetReadLimits{}
	for _, n := range []int64{-1, 0, syncs3.MaxObjectBytes + 1} {
		l := setLimits()
		l.ManifestBytes = n
		cases = append(cases, l)
		l = setLimits()
		l.RecordBytes = n
		cases = append(cases, l)
	}
	for _, n := range []int64{-1, 0, MaxS3RecordSetBytes + 1} {
		l := setLimits()
		l.TotalRecordBytes = n
		cases = append(cases, l)
	}
	for _, n := range []int{-1, 0, MaxS3RecordSetItems + 1} {
		l := setLimits()
		l.MaxRecords = n
		cases = append(cases, l)
	}
	for i, l := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, l)
			rejectRecordSet(t, got, e, ErrS3RecordSetReference)
		})
	}
	got, e := ReadS3RecordSet(nil, c, f.ref, setLimits())
	rejectRecordSet(t, got, e, ErrS3RecordSetReference)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, e = ReadS3RecordSet(ctx, c, f.ref, setLimits())
	rejectRecordSet(t, got, e, context.Canceled)
	bad := f.ref
	bad.SHA256 = "PRIVATE_HASH"
	got, e = ReadS3RecordSet(context.Background(), c, bad, setLimits())
	rejectRecordSet(t, got, e, ErrS3ManifestReference)
	got, e = ReadS3RecordSet(context.Background(), nil, f.ref, setLimits())
	rejectRecordSet(t, got, e, syncs3.ErrConfig)
	if calls.Load() != 0 {
		t.Fatal("offline validation did network I/O")
	}
}

func TestReadS3RecordSetCountAndAllIdentitiesCheckedBeforeRecordIO(t *testing.T) {
	for _, badID := range []string{"", "tag:", "filetag:ambiguous:id:tag", "attachment:not-canonical"} {
		t.Run("id-"+badID, func(t *testing.T) {
			f := newRecordSetFixture(t, setFile("a", "ok", "", false), setFile("z", "other", "", false))
			limits := setLimits()
			if badID == "" {
				limits.MaxRecords = 1
			} else {
				f.manifest.Items[badID] = pinnedItemHash
				f.raw = pinnedBytes(t, f.manifest)
				f.ref = pinnedReference(f.raw)
			}
			var calls atomic.Int32
			c := serveRecordSet(t, f, &calls)
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, limits)
			want := ErrS3Record
			if badID == "" {
				want = ErrS3RecordSetLimit
			}
			rejectRecordSet(t, got, e, want)
			if calls.Load() != 1 {
				t.Fatal("record I/O occurred before complete preflight")
			}
		})
	}
}

func TestReadS3RecordSetAggregateRawByteBudget(t *testing.T) {
	f := newRecordSetFixture(t, setFile("a", "first", "", false), setFile("b", "second", "", false))
	first := int64(len(f.objects["objects/"+f.manifest.Items["a"]+".json"]))
	for _, tc := range []struct {
		name  string
		limit int64
		want  error
		calls int32
	}{{"exact", f.total, nil, 3}, {"one-short", f.total - 1, syncs3.ErrTooLarge, 3}, {"exhausted", first, ErrS3RecordSetLimit, 2}, {"first-short", first - 1, syncs3.ErrTooLarge, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			c := serveRecordSet(t, f, &calls)
			l := setLimits()
			l.TotalRecordBytes = tc.limit
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, l)
			if tc.want != nil {
				rejectRecordSet(t, got, e, tc.want)
			} else if e != nil || len(got.Records) != 2 {
				t.Fatalf("exact total rejected: %v", e)
			}
			if calls.Load() != tc.calls {
				t.Fatal("unexpected request count after budget exhaustion")
			}
		})
	}
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	l := setLimits()
	l.RecordBytes = first - 1
	got, e := ReadS3RecordSet(context.Background(), c, f.ref, l)
	rejectRecordSet(t, got, e, syncs3.ErrTooLarge)
}

func TestReadS3RecordSetLateFailureNeverDeliversEarlierRecords(t *testing.T) {
	for _, mode := range []string{"digest", "identity", "duplicate", "404", "403", "302", "500"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecordSetFixture(t, setFile("a", "first", "", false), setFile("b", "second", "", false), setFile("c", "third", "", false))
			if mode == "identity" || mode == "duplicate" {
				b := recordBytes(t, setFile("other", "second", "", false))
				if mode == "duplicate" {
					b = []byte(`{"format":"local-notepad-sync-record","format":"local-notepad-sync-record","version":1,"id":"b","kind":"file","state":"purged"}`)
				}
				h := hashBytes(b)
				f.objects["objects/"+h+".json"] = b
				f.manifest.Items["b"] = h
				f.raw = pinnedBytes(t, f.manifest)
				f.ref = pinnedReference(f.raw)
			}
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
				i := calls.Add(1)
				b, ok := f.body(r.URL.Path)
				if !ok {
					t.Error("extra request")
				}
				if i == 3 {
					switch mode {
					case "digest":
						b = append([]byte{}, b...)
						b[len(b)-1] ^= 1
					case "404":
						w.WriteHeader(404)
						return
					case "403":
						w.WriteHeader(403)
						return
					case "302":
						w.Header().Set("Location", "https://private.invalid/")
						w.WriteHeader(302)
						return
					case "500":
						w.WriteHeader(500)
						return
					}
				}
				_, _ = w.Write(b)
			})
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
			if mode == "digest" {
				rejectRecordSet(t, got, e, syncs3.ErrDigestMismatch)
			} else if mode == "identity" || mode == "duplicate" {
				rejectRecordSet(t, got, e, ErrS3Record)
			} else {
				var status *syncs3.HTTPError
				if !errors.As(e, &status) || fmt.Sprint(status.StatusCode) != mode || !reflect.DeepEqual(got, S3RecordSet{}) {
					t.Fatalf("wrong HTTP refusal: %v", e)
				}
			}
			if calls.Load() != 3 {
				t.Fatal("read continued, retried or re-fetched manifest after failure")
			}
		})
	}
}

func TestReadS3RecordSetReusesExistingRelationshipRefusals(t *testing.T) {
	root := setFile("root", "root", "", true)
	note := setFile("note", "note", "root", false)
	tag := presentTagRecord(TagPayload{ID: "tag", Name: "name"})
	link := presentFileTagRecord(FileTagPayload{FileID: "note", TagID: "tag"})
	cases := map[string][]Record{
		"missing-parent": {note}, "purged-parent": {note, purgedRecordForKey("root")}, "non-folder-parent": {note, setFile("root", "root", "", false)},
		"self": {setFile("root", "root", "root", true)}, "cycle": {setFile("a", "a", "b", true), setFile("b", "b", "a", true)},
		"duplicate-title": {setFile("a", "PRIVATE_TITLE", "", false), setFile("b", "private_title", "", false)},
		"duplicate-tag":   {tag, presentTagRecord(TagPayload{ID: "other", Name: "NAME"})},
		"missing-file":    {tag, link}, "missing-tag": {root, note, link}, "purged-tag": {root, note, link, purgedRecordForKey(tag.ID)},
	}
	for name, records := range cases {
		t.Run(name, func(t *testing.T) {
			f := newRecordSetFixture(t, records...)
			if validateRemoteStructure(f.manifest, nil, f.records) == nil {
				t.Fatal("test premise not refused by existing rules")
			}
			var calls atomic.Int32
			c := serveRecordSet(t, f, &calls)
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
			rejectRecordSet(t, got, e, ErrS3RecordSetStructure)
			if calls.Load() != int32(1+len(f.ids)) {
				t.Fatal("structure pass used fallback I/O")
			}
		})
	}
}

func TestReadS3RecordSetKeepsExistingRecycleAndPurgedSemantics(t *testing.T) {
	deleted := setFile("deleted", "same", "", false)
	deleted.File.IsDeleted = true
	deleted.File.DeletedAt = 3
	f := newRecordSetFixture(t, setFile("a", "same", "", false), deleted, purgedRecordForKey("old"), purgedRecordForKey("tag:old"), purgedRecordForKey("filetag:old:old"))
	if e := validateRemoteStructure(f.manifest, nil, f.records); e != nil {
		t.Fatal(e)
	}
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
	if e != nil || !reflect.DeepEqual(got.Records, f.records) {
		t.Fatalf("existing lifecycle semantics changed: %v", e)
	}
}

func TestReadS3RecordSetCancelledFinalGETReturnsZeroAndStops(t *testing.T) {
	f := newRecordSetFixture(t, setFile("a", "a", "", false), setFile("b", "b", "", false), setFile("c", "c", "", false))
	arrived := make(chan struct{})
	cancelled := make(chan struct{})
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 3 {
			close(arrived)
			<-r.Context().Done()
			close(cancelled)
			return
		}
		b, _ := f.body(r.URL.Path)
		_, _ = w.Write(b)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type answer struct {
		set S3RecordSet
		err error
	}
	done := make(chan answer, 1)
	go func() { set, e := ReadS3RecordSet(ctx, c, f.ref, setLimits()); done <- answer{set, e} }()
	select {
	case <-arrived:
	case <-time.After(2 * time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case a := <-done:
		rejectRecordSet(t, a.set, a.err, context.Canceled)
	case <-time.After(2 * time.Second):
		t.Fatal("request did not cancel")
	}
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not reach server")
	}
	if calls.Load() != 3 {
		t.Fatal("extra I/O after cancellation")
	}
}

func TestReadS3RecordSetDeadlineCoversAllRecords(t *testing.T) {
	f := newRecordSetFixture(t, setFile("a", "a", "", false), setFile("b", "b", "", false))
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 3 {
			<-r.Context().Done()
			return
		}
		b, _ := f.body(r.URL.Path)
		_, _ = w.Write(b)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	got, e := ReadS3RecordSet(ctx, c, f.ref, setLimits())
	rejectRecordSet(t, got, e, context.DeadlineExceeded)
	if calls.Load() != 3 {
		t.Fatal("deadline extended or missing earlier reads")
	}
}

func TestReadS3RecordSetReturnedMapsDoNotAuthorizeOrPolluteNextRead(t *testing.T) {
	f := newRecordSetFixture(t, setFile("a", "a", "", false))
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
	if e != nil {
		t.Fatal(e)
	}
	got.Records["a"].File.Content = "changed"
	delete(got.Manifest.Items, "a")
	got.Records["fake"] = purgedRecordForKey("fake")
	next, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
	if e != nil || !reflect.DeepEqual(next.Records, f.records) || len(next.Manifest.Items) != 1 || calls.Load() != 4 {
		t.Fatalf("previous result became authority: %v", e)
	}
}

func TestReadS3RecordSetConcurrentReadsKeepPrivateSetsIsolated(t *testing.T) {
	f := newRecordSetFixture(t, setFile("a", "a", "", false), setFile("b", "b", "", false))
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, e := ReadS3RecordSet(context.Background(), c, f.ref, setLimits())
			if e != nil || !reflect.DeepEqual(got.Records, f.records) {
				t.Errorf("concurrent set failed: %v", e)
				return
			}
			got.Records["a"].File.Content = "changed"
			delete(got.Manifest.Items, "a")
		}()
	}
	wg.Wait()
	if calls.Load() != 18 {
		t.Fatal("shared cache, duplicate or skipped reads")
	}
}
