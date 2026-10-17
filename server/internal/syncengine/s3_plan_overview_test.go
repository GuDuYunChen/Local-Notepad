package syncengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func rejectOverview(t *testing.T, got S3PlanOverview, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(got, S3PlanOverview{}) {
		t.Fatalf("expected zero refused overview: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		if strings.Contains(fmt.Sprintf(verb, err), "PRIVATE") {
			t.Fatal("private failure detail escaped")
		}
	}
}
func validOverviewPlan() Plan {
	a, b := strings.Repeat("a", 64), strings.Repeat("b", 64)
	return Plan{StoreID: "PRIVATE_STORE", Generation: 7, Revision: a, Uploads: 1, Downloads: 1, Conflicts: 1, Noops: 1,
		Items: []PlanItem{
			{ID: attachmentItemKey("PRIVATE.bin"), Action: "conflict", BaseHash: a, LocalHash: b, RemoteHash: a},
			{ID: "filetag:PRIVATE_FILE:PRIVATE_TAG", Action: "upload", LocalHash: a},
			{ID: "note_PRIVATE", Action: "download", RemoteHash: b},
			{ID: "tag:PRIVATE_TAG", Action: "noop", LocalHash: a, RemoteHash: a},
		}}
}
func TestS3PlanOverviewFixedProjectionAndNoIdentity(t *testing.T) {
	p := validOverviewPlan()
	before := validOverviewPlan()
	got, err := s3PlanOverview(context.Background(), p)
	if err != nil || got.Format != S3PlanOverviewFormat || got.Version != 1 || !got.ReadOnly {
		t.Fatalf("projection: %v", err)
	}
	if got.Counts != (S3PlanOverviewCounts{4, 1, 1, 1, 1}) {
		t.Fatal("wrong candidate totals")
	}
	want := [4]S3PlanKindOverview{
		{"file", S3PlanOverviewCounts{Total: 1, DownloadCandidates: 1}},
		{"tag", S3PlanOverviewCounts{Total: 1, Noops: 1}},
		{"file-tag", S3PlanOverviewCounts{Total: 1, UploadCandidates: 1}},
		{"attachment", S3PlanOverviewCounts{Total: 1, Conflicts: 1}},
	}
	if got.Kinds != want || !reflect.DeepEqual(p, before) {
		t.Fatal("wrong kind grouping or mutated source")
	}
	raw, e := json.Marshal(got)
	if e != nil {
		t.Fatal(e)
	}
	for _, secret := range []string{"PRIVATE", p.Revision, "store_id", "generation", "revision", "items", "hash", "content", "title", "needs_init", "applied"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("non-statistical data escaped JSON")
		}
	}
	var fields map[string]json.RawMessage
	if e = json.Unmarshal(raw, &fields); e != nil || len(fields) != 5 {
		t.Fatal("unexpected public fields")
	}
	for _, key := range []string{"format", "version", "read_only", "counts", "kinds"} {
		if _, ok := fields[key]; !ok {
			t.Fatal("missing public field")
		}
	}
	if strings.Contains(fmt.Sprintf("%+v", got), "PRIVATE") {
		t.Fatal("formatting retained identity")
	}
}

func TestS3PlanOverviewRejectsMalformedCompletePlan(t *testing.T) {
	cases := []struct {
		name   string
		change func(*Plan)
	}{
		{"store", func(p *Plan) { p.StoreID = "" }}, {"generation", func(p *Plan) { p.Generation = 0 }},
		{"revision", func(p *Plan) { p.Revision = "PRIVATE" }}, {"init", func(p *Plan) { p.NeedsInit = true }},
		{"nil items", func(p *Plan) { p.Items = nil }}, {"oversize", func(p *Plan) { p.Items = make([]PlanItem, MaxS3PlanItems+1) }},
		{"negative counter", func(p *Plan) { p.Conflicts = -1 }}, {"hidden conflict", func(p *Plan) { p.Conflicts = 0 }},
		{"extra count", func(p *Plan) { p.Noops++ }}, {"duplicate", func(p *Plan) { p.Items[1] = p.Items[0] }},
		{"unsorted", func(p *Plan) { p.Items[0], p.Items[1] = p.Items[1], p.Items[0] }},
		{"invalid id", func(p *Plan) { p.Items[0].ID = "filetag:a:b:c" }},
		{"long id", func(p *Plan) { p.Items[0].ID = strings.Repeat("x", 1025) }},
		{"invalid hash", func(p *Plan) { p.Items[0].RemoteHash = "PRIVATE_HASH" }},
		{"uppercase hash", func(p *Plan) { p.Items[0].BaseHash = strings.Repeat("A", 64) }},
		{"invalid action", func(p *Plan) { p.Items[0].Action = "PRIVATE_ACTION" }},
		{"reclassified conflict", func(p *Plan) { p.Items[0].Action = "noop"; p.Conflicts--; p.Noops++ }},
		{"no evidence", func(p *Plan) { p.Items[0].BaseHash = ""; p.Items[0].LocalHash = ""; p.Items[0].RemoteHash = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := validOverviewPlan()
			tc.change(&p)
			v, e := s3PlanOverview(context.Background(), p)
			rejectOverview(t, v, e, ErrS3PlanOverview)
		})
	}
}

func TestS3PlanOverviewProjectsMaximumBoundWithoutTruncation(t *testing.T) {
	p := validOverviewPlan()
	p.Items = []PlanItem{}
	p.Uploads = 0
	p.Downloads = MaxS3PlanItems
	p.Conflicts = 0
	p.Noops = 0
	for i := 0; i < MaxS3PlanItems; i++ {
		p.Items = append(p.Items, PlanItem{ID: fmt.Sprintf("note-%04d", i), Action: "download", RemoteHash: p.Revision})
	}
	got, err := s3PlanOverview(context.Background(), p)
	if err != nil || got.Counts.Total != MaxS3PlanItems || got.Kinds[0].Counts.DownloadCandidates != MaxS3PlanItems {
		t.Fatalf("limit projection: %v", err)
	}
}

func TestReadS3PlanOverviewRealComparisonOnlyOneReadSet(t *testing.T) {
	f := newRecordSetFixture(t, setFile("note_PRIVATE", "PRIVATE_TITLE", "", false), presentTagRecord(TagPayload{ID: "PRIVATE_TAG", Name: "PRIVATE_NAME"}))
	b := planBasis()
	b.LocalItems["note_PRIVATE"] = strings.Repeat("a", 64)
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	got, err := ReadS3PlanOverview(context.Background(), c, f.ref, b, planLimits())
	if err != nil || got.Counts.Total != 2 || got.Counts.Conflicts != 1 || got.Counts.DownloadCandidates != 1 || calls.Load() != 3 {
		t.Fatalf("real comparison: %v", err)
	}
	raw, _ := json.Marshal(got)
	for _, secret := range []string{"PRIVATE", f.ref.StoreID, f.ref.SHA256, "SYNTHETIC_TOKEN"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("private field retained")
		}
	}
	// Modify the returned value: a subsequent explicit call must recompute, not cache.
	got.Kinds[0].Kind = "PRIVATE_MUTATED"
	got.Counts.Conflicts = 999
	fresh, e := ReadS3PlanOverview(context.Background(), c, f.ref, b, planLimits())
	if e != nil || fresh.Kinds[0].Kind != "file" || fresh.Counts.Conflicts != 1 || calls.Load() != 6 {
		t.Fatal("overview was cached or reused")
	}
}

func TestReadS3PlanOverviewEmptyAndPurgedAreOnlyComparisons(t *testing.T) {
	for _, records := range [][]Record{nil, {purgedRecordForKey("note_PRIVATE")}} {
		f := newRecordSetFixture(t, records...)
		var calls atomic.Int32
		got, e := ReadS3PlanOverview(context.Background(), serveRecordSet(t, f, &calls), f.ref, planBasis(), planLimits())
		if e != nil || !got.ReadOnly || got.Counts.Total != len(records) || calls.Load() != int32(1+len(records)) {
			t.Fatalf("empty/purged comparison: %v", e)
		}
		for i, kind := range []string{"file", "tag", "file-tag", "attachment"} {
			if got.Kinds[i].Kind != kind {
				t.Fatal("missing fixed empty kind")
			}
		}
	}
}

func TestReadS3PlanOverviewOfflineRefusals(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	b := planBasis()
	b.StoreID = "PRIVATE_OTHER"
	v, e := ReadS3PlanOverview(context.Background(), c, f.ref, b, planLimits())
	rejectOverview(t, v, e, ErrS3PlanOverviewRead)
	limits := planLimits()
	limits.MaxItems = 0
	v, e = ReadS3PlanOverview(context.Background(), c, f.ref, planBasis(), limits)
	rejectOverview(t, v, e, ErrS3PlanOverviewRead)
	v, e = ReadS3PlanOverview(nil, c, f.ref, planBasis(), planLimits())
	rejectOverview(t, v, e, ErrS3PlanOverviewRead)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	v, e = ReadS3PlanOverview(ctx, c, f.ref, planBasis(), planLimits())
	rejectOverview(t, v, e, context.Canceled)
	expired, done := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer done()
	v, e = ReadS3PlanOverview(expired, c, f.ref, planBasis(), planLimits())
	rejectOverview(t, v, e, context.DeadlineExceeded)
	if calls.Load() != 0 {
		t.Fatal("invalid basis/budget dispatched")
	}
}

func TestReadS3PlanOverviewFailureNeverBecomesEmptySuccess(t *testing.T) {
	for _, status := range []int{302, 403, 404, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", "https://PRIVATE.invalid")
				w.WriteHeader(status)
			})
			f := newRecordSetFixture(t)
			v, e := ReadS3PlanOverview(context.Background(), c, f.ref, planBasis(), planLimits())
			rejectOverview(t, v, e, ErrS3PlanOverviewRead)
			if calls.Load() != 1 {
				t.Fatal("refusal retried")
			}
		})
	}
	for _, broken := range []string{"digest", "structure"} {
		t.Run(broken, func(t *testing.T) {
			r := setFile("note", "PRIVATE_TITLE", "", false)
			if broken == "structure" {
				r.File.ParentID = "PRIVATE_MISSING"
			}
			f := newRecordSetFixture(t, r)
			if broken == "digest" {
				for k := range f.objects {
					f.objects[k] = []byte("PRIVATE_BAD")
				}
			}
			var calls atomic.Int32
			v, e := ReadS3PlanOverview(context.Background(), serveRecordSet(t, f, &calls), f.ref, planBasis(), planLimits())
			rejectOverview(t, v, e, ErrS3PlanOverviewRead)
			if calls.Load() != 2 {
				t.Fatal("late failure repeated remote request")
			}
		})
	}
}

func TestReadS3PlanOverviewCancellationReachesActualGET(t *testing.T) {
	arrived, stopped := make(chan struct{}), make(chan struct{})
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) { close(arrived); <-r.Context().Done(); close(stopped) })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	f := newRecordSetFixture(t)
	done := make(chan error, 1)
	go func() {
		v, e := ReadS3PlanOverview(ctx, c, f.ref, planBasis(), planLimits())
		if !reflect.DeepEqual(v, S3PlanOverview{}) {
			done <- errors.New("partial overview")
			return
		}
		done <- e
	}()
	select {
	case <-arrived:
	case <-ctx.Done():
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatal("cancellation replaced")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("request did not stop")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("remote did not observe cancellation")
	}
}

func TestS3PlanOverviewErrorsAreFixedAndProjectionHonorsCancellation(t *testing.T) {
	for _, err := range []error{errors.New("PRIVATE_ERROR"), fmt.Errorf("PRIVATE: %w", context.Canceled), fmt.Errorf("PRIVATE: %w", context.DeadlineExceeded)} {
		safe := s3OverviewReadError(err)
		if strings.Contains(fmt.Sprintf("%+v", safe), "PRIVATE") {
			t.Fatal("wrapped diagnostic escaped")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	v, e := s3PlanOverview(ctx, validOverviewPlan())
	rejectOverview(t, v, e, context.Canceled)
	v, e = s3PlanOverview(nil, validOverviewPlan())
	rejectOverview(t, v, e, ErrS3PlanOverview)
	p := validOverviewPlan()
	sort.Slice(p.Items, func(i, j int) bool { return p.Items[i].ID < p.Items[j].ID })
	if _, e = s3PlanOverview(context.Background(), p); e != nil {
		t.Fatal(e)
	}
}

func TestReadS3PlanOverviewAllExistingKindsUseCanonicalIdentity(t *testing.T) {
	records := []Record{setFile("note", "正文", "", false), presentTagRecord(TagPayload{ID: "tag", Name: "标记"}),
		presentFileTagRecord(FileTagPayload{FileID: "note", TagID: "tag"}), presentAttachmentRecord(AttachmentPayload{Name: "PRIVATE.bin", Size: 0, BlobHash: pinnedItemHash})}
	f := newRecordSetFixture(t, records...)
	b := planBasis()
	for id, hash := range f.manifest.Items {
		b.LocalItems[id] = hash
	}
	var calls atomic.Int32
	got, err := ReadS3PlanOverview(context.Background(), serveRecordSet(t, f, &calls), f.ref, b, planLimits())
	if err != nil || got.Counts.Noops != 4 || got.Counts.Total != 4 || calls.Load() != 5 {
		t.Fatalf("canonical kinds: %v", err)
	}
	for i, kind := range []string{"file", "tag", "file-tag", "attachment"} {
		if got.Kinds[i].Kind != kind || got.Kinds[i].Counts.Noops != 1 {
			t.Fatal("kind lost or remapped")
		}
	}
}
