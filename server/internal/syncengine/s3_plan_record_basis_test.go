package syncengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

func recordPlanBasis(t *testing.T, records ...Record) S3PlanRecordBasis {
	t.Helper()
	b := S3PlanRecordBasis{StoreID: pinnedManifest().StoreID, LocalRecords: map[string]string{}, BaseItems: map[string]string{}}
	for _, r := range records {
		b.LocalRecords[r.ID] = string(recordBytes(t, r))
	}
	return b
}
func recordPlanLimits() S3PlanRecordLimits {
	return S3PlanRecordLimits{LocalRecordBytes: 32768, TotalLocalRecordBytes: 65536, MaxLocalRecords: 32, Plan: planLimits()}
}
func rejectRecordOverview(t *testing.T, got S3PlanOverview, err, want error) {
	t.Helper()
	rejectOverview(t, got, err, want)
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		for _, private := range []string{"PRIVATE", "SYNTHETIC", pinnedManifest().StoreID, pinnedItemHash} {
			if strings.Contains(fmt.Sprintf(verb, err), private) {
				t.Fatal("local record diagnostic leaked")
			}
		}
	}
}

func TestReadS3PlanOverviewFromRecordsCanonicalKinds(t *testing.T) {
	records := []Record{setFile("root", "目录", "", true), setFile("e\u0301 %2F", "正文", "root", false),
		presentTagRecord(TagPayload{ID: "标签", Name: "合成标签", Color: "#aabbcc"}),
		presentFileTagRecord(FileTagPayload{FileID: "e\u0301 %2F", TagID: "标签"}),
		presentAttachmentRecord(AttachmentPayload{Name: "PRIVATE.bin", Size: 0, BlobHash: pinnedItemHash}),
		purgedRecordForKey("deleted")}
	f := newRecordSetFixture(t, records...)
	b := recordPlanBasis(t, records...)
	// Cosmetic JSON differences must not replace the existing canonical hash.
	for id, text := range b.LocalRecords {
		var pretty bytes.Buffer
		if json.Indent(&pretty, []byte(text), "", "  ") != nil {
			t.Fatal("invalid original record JSON")
		}
		b.LocalRecords[id] = pretty.String() + "\n"
	}
	before, _ := json.Marshal(b)
	var calls atomic.Int32
	got, err := ReadS3PlanOverviewFromRecords(context.Background(), serveRecordSet(t, f, &calls), f.ref, b, recordPlanLimits())
	if err != nil || got.Counts.Total != 6 || got.Counts.Noops != 6 || calls.Load() != 7 {
		t.Fatalf("canonical interoperability failed: %v", err)
	}
	for i, want := range []int{3, 1, 1, 1} {
		if got.Kinds[i].Counts.Noops != want {
			t.Fatal("existing record kind changed")
		}
	}
	after, _ := json.Marshal(b)
	if !bytes.Equal(before, after) {
		t.Fatal("input record snapshot changed")
	}
	raw, _ := json.Marshal(got)
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 5 || !got.ReadOnly {
		t.Fatal("overview representation changed")
	}
	for _, private := range []string{"PRIVATE", "SYNTHETIC", "store_id", "items", "hash", "content", "title", f.ref.StoreID, f.ref.SHA256} {
		if strings.Contains(string(raw), private) {
			t.Fatal("record data escaped count-only result")
		}
	}
}

func TestReadS3PlanOverviewFromRecordsExistingClassifications(t *testing.T) {
	remote := setFile("note", "远端", "", false)
	changed := setFile("note", "本地", "", false)
	f := newRecordSetFixture(t, remote)
	hash := f.manifest.Items[remote.ID]
	for _, tc := range []struct {
		name, base, want string
		local            []Record
		remoteMissing    bool
	}{
		{"equal", "", "noop", []Record{remote}, false},
		{"local changed", hash, "upload", []Record{changed}, false},
		{"both changed", strings.Repeat("a", 64), "conflict", []Record{changed}, false},
		{"remote only", "", "download", nil, false},
		{"missing local with base", hash, "upload", nil, false},
		{"local only", "", "upload", []Record{remote}, true},
		{"missing remote with base", hash, "conflict", []Record{remote}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := f
			if tc.remoteMissing {
				fixture = newRecordSetFixture(t)
			}
			b := recordPlanBasis(t, tc.local...)
			if tc.base != "" {
				b.BaseItems[remote.ID] = tc.base
			}
			var calls atomic.Int32
			got, err := ReadS3PlanOverviewFromRecords(context.Background(), serveRecordSet(t, fixture, &calls), fixture.ref, b, recordPlanLimits())
			want := S3PlanOverviewCounts{}
			want.add(tc.want)
			if err != nil || got.Counts != want || calls.Load() != int32(1+len(fixture.ids)) {
				t.Fatalf("original comparison policy changed: %v", err)
			}
		})
	}
}

func TestReadS3PlanOverviewFromRecordsStrictLocalJSONBeforeIO(t *testing.T) {
	r := setFile("note", "PRIVATE_TITLE", "", false)
	raw := string(recordBytes(t, r))
	cases := []string{"", "null", "{}", "[]", raw + "{}",
		strings.Replace(raw, `"version":1`, `"version":1,"version":1`, 1),
		strings.Replace(raw, `"version":1`, `"version":1,"\u0076ersion":1`, 1),
		strings.Replace(raw, `"version":1`, `"Version":1`, 1),
		strings.Replace(raw, `"version":1`, `"version":null`, 1),
		strings.Replace(raw, `"version":1`, `"version":1,"unknown":0`, 1),
		strings.Replace(raw, `"id":"note"`, `"id":"PRIVATE_OTHER"`, 1),
		strings.Replace(raw, `"kind":"file"`, `"kind":"tag"`, 1),
		strings.Replace(raw, `"PRIVATE_TITLE"`, `"\ud800"`, 1),
		strings.Replace(raw, `"PRIVATE_TITLE"`, "\"\xff\"", 1),
		strings.Replace(raw, `"title":"PRIVATE_TITLE"`, `"title":"PRIVATE_TITLE","title":"changed"`, 1),
		strings.Replace(raw, `"is_folder":false`, `"is_folder":"false"`, 1),
	}
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	for i, text := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			b := recordPlanBasis(t)
			b.LocalRecords[r.ID] = text
			v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, recordPlanLimits())
			rejectRecordOverview(t, v, e, ErrS3PlanRecordBasis)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid local JSON performed remote reads")
	}
}

func TestReadS3PlanOverviewFromRecordsBasisAndBoundsBeforeIO(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	for _, tc := range []struct {
		name   string
		change func(*S3PlanRecordBasis, *S3PlanRecordLimits)
		want   error
	}{
		{"nil records", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.LocalRecords = nil }, ErrS3PlanRecordBasis},
		{"nil base", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.BaseItems = nil }, ErrS3PlanRecordBasis},
		{"foreign store", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.StoreID = "PRIVATE_OTHER" }, ErrS3PlanRecordBasis},
		{"invalid base hash", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.BaseItems["note"] = "PRIVATE_HASH" }, ErrS3PlanRecordBasis},
		{"invalid key", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.LocalRecords["filetag:a:b:c"] = "{}" }, ErrS3PlanRecordBasis},
		{"long key", func(b *S3PlanRecordBasis, _ *S3PlanRecordLimits) { b.LocalRecords[strings.Repeat("x", 1025)] = "{}" }, ErrS3PlanRecordBasis},
		{"zero bytes", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.LocalRecordBytes = 0 }, ErrS3PlanRecordLimit},
		{"large bytes", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.LocalRecordBytes = syncs3.MaxObjectBytes + 1 }, ErrS3PlanRecordLimit},
		{"zero total", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.TotalLocalRecordBytes = 0 }, ErrS3PlanRecordLimit},
		{"large total", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.TotalLocalRecordBytes = MaxS3RecordSetBytes + 1 }, ErrS3PlanRecordLimit},
		{"zero count", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.MaxLocalRecords = 0 }, ErrS3PlanRecordLimit},
		{"large count", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.MaxLocalRecords = MaxS3RecordSetItems + 1 }, ErrS3PlanRecordLimit},
		{"zero remote limit", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.Plan.Records.RecordBytes = 0 }, ErrS3PlanOverviewRead},
		{"zero union limit", func(_ *S3PlanRecordBasis, l *S3PlanRecordLimits) { l.Plan.MaxItems = 0 }, ErrS3PlanOverviewRead},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b, l := recordPlanBasis(t), recordPlanLimits()
			tc.change(&b, &l)
			v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, l)
			rejectRecordOverview(t, v, e, tc.want)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid bounds or basis accessed remote")
	}
}

func TestReadS3PlanOverviewFromRecordsRelationsBeforeIO(t *testing.T) {
	cases := [][]Record{
		{setFile("note", "PRIVATE_ORPHAN", "missing", false)},
		{setFile("a", "a", "b", true), setFile("b", "b", "a", true)},
		{setFile("a", "PRIVATE_SAME", "", false), setFile("b", "private_same", "", false)},
		{presentTagRecord(TagPayload{ID: "a", Name: "PRIVATE_SAME"}), presentTagRecord(TagPayload{ID: "b", Name: "private_same"})},
		{presentFileTagRecord(FileTagPayload{FileID: "note", TagID: "missing"})},
		{purgedRecordForKey("root"), setFile("note", "PRIVATE_ORPHAN", "root", false)},
	}
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	for i, rs := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, recordPlanBasis(t, rs...), recordPlanLimits())
			rejectRecordOverview(t, v, e, ErrS3PlanRecordBasis)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid local relationships read the remote")
	}
}

func TestReadS3PlanOverviewFromRecordsRawAndCanonicalByteBudgets(t *testing.T) {
	a := setFile("a", "A", "", false)
	b := setFile("b", "B", "", false)
	a.File.Content, b.File.Content = "<&>", "<&>"
	basis := recordPlanBasis(t, a, b)
	canonical := int64(len(basis.LocalRecords["a"]))
	// An unescaped string uses fewer raw bytes but expands with the original encoder.
	for id, text := range basis.LocalRecords {
		basis.LocalRecords[id] = strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(text, `\u003c`, "<"), `\u003e`, ">"), `\u0026`, "&")
	}
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	for _, tc := range []struct {
		name       string
		per, total int64
		count      int
	}{
		{"raw per", 1, 65536, 32}, {"raw total", 32768, 1, 32},
		{"canonical per", canonical - 1, 65536, 32}, {"canonical total", canonical, canonical*2 - 1, 32},
		{"count", 32768, 65536, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l := recordPlanLimits()
			l.LocalRecordBytes, l.TotalLocalRecordBytes, l.MaxLocalRecords = tc.per, tc.total, tc.count
			v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, basis, l)
			rejectRecordOverview(t, v, e, ErrS3PlanRecordLimit)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("local budget rejection performed network reads")
	}
	l := recordPlanLimits()
	l.LocalRecordBytes, l.TotalLocalRecordBytes = canonical, canonical*2
	v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, basis, l)
	if e != nil || v.Counts.UploadCandidates != 2 || calls.Load() != 1 {
		t.Fatalf("exact canonical budget rejected: %v", e)
	}
}

func TestReadS3PlanOverviewFromRecordsMaximumCount(t *testing.T) {
	f := newRecordSetFixture(t)
	b, l := recordPlanBasis(t), recordPlanLimits()
	for i := 0; i < MaxS3RecordSetItems; i++ {
		r := purgedRecordForKey(fmt.Sprintf("private-%04d", i))
		b.LocalRecords[r.ID] = string(recordBytes(t, r))
	}
	l.MaxLocalRecords, l.TotalLocalRecordBytes, l.Plan.MaxItems = MaxS3RecordSetItems, MaxS3RecordSetBytes, MaxS3PlanItems
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, l)
	if e != nil || v.Counts.Total != MaxS3RecordSetItems || calls.Load() != 1 {
		t.Fatalf("exact count bound: %v", e)
	}
	b.LocalRecords["overflow"] = "{}"
	v, e = ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, l)
	rejectRecordOverview(t, v, e, ErrS3PlanRecordLimit)
	if calls.Load() != 1 {
		t.Fatal("overflow requested remote")
	}
}

func TestReadS3PlanOverviewFromRecordsDetachedSnapshot(t *testing.T) {
	r := setFile("note", "PRIVATE_TITLE", "", false)
	f := newRecordSetFixture(t, r)
	b := recordPlanBasis(t, r)
	var calls atomic.Int32
	client := pinnedClient(t, func(w http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		// Local copying/validation is over before the first GET. No simultaneous map writer.
		b.LocalRecords["note"] = "invalid"
		b.BaseItems["PRIVATE_NEW"] = pinnedItemHash
		raw, ok := f.body(request.URL.Path)
		if !ok {
			t.Error("unexpected object request")
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(raw)
	})
	v, e := ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, recordPlanLimits())
	if e != nil || v.Counts.Noops != 1 || v.Counts.Total != 1 || calls.Load() != 2 {
		t.Fatalf("caller changed in-flight basis: %v", e)
	}
	v, e = ReadS3PlanOverviewFromRecords(context.Background(), client, f.ref, b, recordPlanLimits())
	rejectRecordOverview(t, v, e, ErrS3PlanRecordBasis)
	if calls.Load() != 2 {
		t.Fatal("a later call reused old local validity")
	}
}

func TestReadS3PlanOverviewFromRecordsCancellationAndDeadline(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	client := serveRecordSet(t, f, &calls)
	b := recordPlanBasis(t)
	v, e := ReadS3PlanOverviewFromRecords(nil, client, f.ref, b, recordPlanLimits())
	rejectRecordOverview(t, v, e, ErrS3PlanRecordBasis)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	v, e = ReadS3PlanOverviewFromRecords(ctx, client, f.ref, b, recordPlanLimits())
	rejectRecordOverview(t, v, e, context.Canceled)
	ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	v, e = ReadS3PlanOverviewFromRecords(ctx, client, f.ref, b, recordPlanLimits())
	rejectRecordOverview(t, v, e, context.DeadlineExceeded)
	if calls.Load() != 0 {
		t.Fatal("cancelled local validation went online")
	}
	arrived, stopped := make(chan struct{}), make(chan struct{})
	client = pinnedClient(t, func(w http.ResponseWriter, request *http.Request) {
		close(arrived)
		select {
		case <-request.Context().Done():
			close(stopped)
		case <-time.After(2 * time.Second):
			t.Error("owned GET did not stop")
		}
	})
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		got, err := ReadS3PlanOverviewFromRecords(ctx, client, f.ref, b, recordPlanLimits())
		if !reflect.DeepEqual(got, S3PlanOverview{}) {
			done <- errors.New("partial overview")
			return
		}
		done <- err
	}()
	select {
	case <-arrived:
	case <-time.After(2 * time.Second):
		t.Fatal("owned GET did not arrive")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("cancellation sentinel lost")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("call did not end")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation not passed to GET")
	}
}

func TestReadS3PlanOverviewFromRecordsRemoteFailureIsNotEmptySuccess(t *testing.T) {
	f := newRecordSetFixture(t)
	for _, status := range []int{302, 403, 404, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", "https://PRIVATE.invalid/")
				w.WriteHeader(status)
				_, _ = w.Write([]byte("PRIVATE_BODY"))
			})
			v, e := ReadS3PlanOverviewFromRecords(context.Background(), c, f.ref, recordPlanBasis(t), recordPlanLimits())
			rejectRecordOverview(t, v, e, ErrS3PlanOverviewRead)
			if calls.Load() != 1 {
				t.Fatal("remote error retried or followed")
			}
		})
	}
}

func TestReadS3PlanOverviewFromRecordsRecycleAndPurgedRemainExistingSemantics(t *testing.T) {
	active, deleted := setFile("a", "Same", "", false), setFile("b", "Same", "", false)
	deleted.File.IsDeleted = true
	records := []Record{active, deleted, purgedRecordForKey("old")}
	f := newRecordSetFixture(t, records...)
	var calls atomic.Int32
	v, e := ReadS3PlanOverviewFromRecords(context.Background(), serveRecordSet(t, f, &calls), f.ref, recordPlanBasis(t, records...), recordPlanLimits())
	if e != nil || v.Counts.Noops != 3 || calls.Load() != 4 {
		t.Fatalf("recycle/purge semantics changed: %v", e)
	}
	f = newRecordSetFixture(t)
	calls.Store(0)
	v, e = ReadS3PlanOverviewFromRecords(context.Background(), serveRecordSet(t, f, &calls), f.ref, recordPlanBasis(t), recordPlanLimits())
	if e != nil || !v.ReadOnly || v.Counts.Total != 0 || calls.Load() != 1 {
		t.Fatalf("verified empty preview: %v", e)
	}
}
