package syncengine

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func planBasis() S3PlanLocalBasis {
	return S3PlanLocalBasis{StoreID: pinnedManifest().StoreID, LocalItems: map[string]string{}, BaseItems: map[string]string{}}
}
func planLimits() S3PlanReadLimits { return S3PlanReadLimits{Records: setLimits(), MaxItems: 64} }
func rejectS3Plan(t *testing.T, got Plan, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(got, Plan{}) {
		t.Fatalf("expected zero rejected preview: %v", err)
	}
	for _, format := range []string{"%v", "%+v", "%#v"} {
		text := fmt.Sprintf(format, err)
		for _, private := range []string{"PRIVATE", "SYNTHETIC", pinnedManifest().StoreID, pinnedItemHash} {
			if strings.Contains(text, private) {
				t.Fatal("preview error disclosed private input")
			}
		}
	}
}

func TestReadS3PlanExistingClassificationMatrix(t *testing.T) {
	r := setFile("note", "远端", "", false)
	f := newRecordSetFixture(t, r)
	rh := f.manifest.Items[r.ID]
	different, other := strings.Repeat("a", 64), strings.Repeat("b", 64)
	for _, tc := range []struct{ name, base, local, remote, want string }{
		{"remote only", "", "", rh, "download"}, {"local only", "", different, "", "upload"},
		{"equal no base", "", rh, rh, "noop"}, {"different no base", "", different, rh, "conflict"},
		{"unchanged", rh, rh, rh, "noop"}, {"remote changed", different, different, rh, "download"},
		{"local changed", rh, different, rh, "upload"}, {"both changed", other, different, rh, "conflict"},
		{"converged", other, rh, rh, "noop"}, {"remote missing", rh, rh, "", "conflict"},
		{"local missing base", rh, "", rh, "upload"}, {"both missing base", rh, "", "", "conflict"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := f
			if tc.remote == "" {
				fixture = newRecordSetFixture(t)
			}
			basis := planBasis()
			if tc.base != "" {
				basis.BaseItems[r.ID] = tc.base
			}
			if tc.local != "" {
				basis.LocalItems[r.ID] = tc.local
			}
			var calls atomic.Int32
			got, err := ReadS3Plan(context.Background(), serveRecordSet(t, fixture, &calls), fixture.ref, basis, planLimits())
			if err != nil || got.NeedsInit || len(got.Items) != 1 || got.Items[0].Action != tc.want {
				t.Fatalf("classification: %v / %#v", err, got)
			}
			if got.Uploads+got.Downloads+got.Conflicts+got.Noops != 1 || calls.Load() != int32(1+len(fixture.ids)) {
				t.Fatal("incorrect count or extra I/O")
			}
			if tc.base != "" && tc.local == "" {
				_, wantHash, exists, e := localRecordFor(r.ID, map[string]Record{}, basis.BaseItems)
				if e != nil || !exists || got.Items[0].LocalHash != wantHash {
					t.Fatal("purge inference diverged from engine")
				}
			}
		})
	}
}

func TestReadS3PlanAttachmentSlotsKeepExistingConflictPolicy(t *testing.T) {
	r := presentAttachmentRecord(AttachmentPayload{Name: "PRIVATE.bin", Size: 3, BlobHash: pinnedItemHash})
	f := newRecordSetFixture(t, r)
	hash := f.manifest.Items[r.ID]
	for _, local := range []string{hash, strings.Repeat("a", 64), ""} {
		t.Run(fmt.Sprint(len(local), local == hash), func(t *testing.T) {
			basis := planBasis()
			basis.BaseItems[r.ID] = hash
			if local != "" {
				basis.LocalItems[r.ID] = local
			}
			var calls atomic.Int32
			got, err := ReadS3Plan(context.Background(), serveRecordSet(t, f, &calls), f.ref, basis, planLimits())
			want := "conflict"
			if local == hash {
				want = "noop"
			}
			if err != nil || got.Items[0].Action != want || calls.Load() != 2 {
				t.Fatalf("attachment policy or blob fetch: %v", err)
			}
		})
	}
}

func TestReadS3PlanPurgedRemoteAndEmptyStoreAreNotInitialization(t *testing.T) {
	for _, records := range [][]Record{nil, {purgedRecordForKey("note")}} {
		f := newRecordSetFixture(t, records...)
		var calls atomic.Int32
		got, err := ReadS3Plan(context.Background(), serveRecordSet(t, f, &calls), f.ref, planBasis(), planLimits())
		if err != nil || got.NeedsInit || got.StoreID != f.ref.StoreID || got.Revision != f.ref.SHA256 || got.Items == nil {
			t.Fatalf("verified empty/purged meaning: %v", err)
		}
		if len(records) == 1 && (got.Downloads != 1 || got.Items[0].Action != "download") {
			t.Fatal("purged is an explicit object, not missing")
		}
		if calls.Load() != int32(1+len(records)) {
			t.Fatal("unexpected I/O")
		}
	}
}

func TestReadS3PlanRejectsInvalidBasisBeforeNetwork(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*S3PlanLocalBasis)
	}{
		{"nil local", func(b *S3PlanLocalBasis) { b.LocalItems = nil }}, {"nil base", func(b *S3PlanLocalBasis) { b.BaseItems = nil }},
		{"empty store", func(b *S3PlanLocalBasis) { b.StoreID = "" }}, {"foreign store", func(b *S3PlanLocalBasis) { b.StoreID = "PRIVATE_OTHER" }},
		{"case changed store", func(b *S3PlanLocalBasis) { b.StoreID = strings.ToUpper(b.StoreID) }},
		{"empty hash", func(b *S3PlanLocalBasis) { b.LocalItems["note"] = "" }}, {"uppercase hash", func(b *S3PlanLocalBasis) { b.BaseItems["note"] = strings.ToUpper(pinnedItemHash) }},
		{"bad key", func(b *S3PlanLocalBasis) { b.LocalItems["filetag:a:b:c"] = pinnedItemHash }},
		{"control key", func(b *S3PlanLocalBasis) { b.LocalItems["a\x00b"] = pinnedItemHash }},
		{"long tag key", func(b *S3PlanLocalBasis) { b.LocalItems["tag:"+strings.Repeat("x", 1024)] = pinnedItemHash }},
		{"long relation key", func(b *S3PlanLocalBasis) {
			b.BaseItems["filetag:"+strings.Repeat("x", 600)+":"+strings.Repeat("y", 600)] = pinnedItemHash
		}},
		{"too many", func(b *S3PlanLocalBasis) {
			for i := 0; i < 1025; i++ {
				b.LocalItems[fmt.Sprint(i)] = pinnedItemHash
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newRecordSetFixture(t)
			b := planBasis()
			tc.change(&b)
			var calls atomic.Int32
			got, err := ReadS3Plan(context.Background(), serveRecordSet(t, f, &calls), f.ref, b, planLimits())
			rejectS3Plan(t, got, err, ErrS3PlanBasis)
			if calls.Load() != 0 {
				t.Fatal("invalid basis sent a request")
			}
		})
	}
}

func TestReadS3PlanPreflightAndCombinedUnionBudgets(t *testing.T) {
	f := newRecordSetFixture(t, setFile("remote", "远端", "", false))
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	for _, max := range []int{0, -1, MaxS3PlanItems + 1} {
		limits := planLimits()
		limits.MaxItems = max
		got, err := ReadS3Plan(context.Background(), c, f.ref, planBasis(), limits)
		rejectS3Plan(t, got, err, ErrS3PlanLimit)
	}
	b := planBasis()
	b.LocalItems["local"] = pinnedItemHash
	b.BaseItems["base"] = pinnedItemHash
	limits := planLimits()
	limits.MaxItems = 1
	got, err := ReadS3Plan(context.Background(), c, f.ref, b, limits)
	rejectS3Plan(t, got, err, ErrS3PlanLimit)
	if calls.Load() != 0 {
		t.Fatal("preflight limit dispatched")
	}
	limits.MaxItems = 2
	got, err = ReadS3Plan(context.Background(), c, f.ref, b, limits)
	rejectS3Plan(t, got, err, ErrS3PlanLimit)
	if calls.Load() != 2 {
		t.Fatal("union check re-read remote")
	}
	limits.MaxItems = 3
	got, err = ReadS3Plan(context.Background(), c, f.ref, b, limits)
	if err != nil || len(got.Items) != 3 || got.Items[0].ID != "base" || got.Items[1].ID != "local" || got.Items[2].ID != "remote" {
		t.Fatalf("union sorting: %v", err)
	}
}

func TestReadS3PlanAllKindsUseOriginalClassification(t *testing.T) {
	records := []Record{setFile("z", "文件", "", false), presentTagRecord(TagPayload{ID: "tag", Name: "标签"}),
		presentFileTagRecord(FileTagPayload{FileID: "z", TagID: "tag"}), presentAttachmentRecord(AttachmentPayload{Name: "a.bin", Size: 0, BlobHash: pinnedItemHash})}
	f := newRecordSetFixture(t, records...)
	b := planBasis()
	for id, hash := range f.manifest.Items {
		b.LocalItems[id] = hash
		b.BaseItems[id] = hash
	}
	var calls atomic.Int32
	got, err := ReadS3Plan(context.Background(), serveRecordSet(t, f, &calls), f.ref, b, planLimits())
	if err != nil || got.Noops != 4 || len(got.Items) != 4 || calls.Load() != 5 {
		t.Fatalf("kind interoperability: %v", err)
	}
	for i, id := range f.ids {
		if got.Items[i].ID != id || got.Items[i].Action != "noop" {
			t.Fatal("unstable order")
		}
	}
}

func TestReadS3PlanCopiesCallerMapsBeforeNetwork(t *testing.T) {
	f := newRecordSetFixture(t, setFile("note", "远端", "", false))
	b := planBasis()
	b.LocalItems["note"] = f.manifest.Items["note"]
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		// This happens AFTER the synchronous copy and before remote completion;
		// the production method must never consult the caller maps again.
		b.LocalItems["note"] = strings.Repeat("a", 64)
		b.BaseItems["PRIVATE_NEW"] = pinnedItemHash
		raw, ok := f.body(r.URL.Path)
		if !ok {
			t.Error("unlisted request")
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(raw)
	})
	got, err := ReadS3Plan(context.Background(), c, f.ref, b, planLimits())
	if err != nil || got.Noops != 1 || len(got.Items) != 1 {
		t.Fatalf("caller mutation affected active preview: %v", err)
	}
}

func TestReadS3PlanRefusesRemoteStructureAndDigestWithNoPartialPlan(t *testing.T) {
	for _, broken := range []string{"structure", "digest"} {
		t.Run(broken, func(t *testing.T) {
			r := setFile("note", "PRIVATE_TITLE", "", false)
			if broken == "structure" {
				r.File.ParentID = "PRIVATE_MISSING"
			}
			f := newRecordSetFixture(t, r)
			if broken == "digest" {
				for key := range f.objects {
					f.objects[key] = []byte("PRIVATE_WRONG")
				}
			}
			var calls atomic.Int32
			b := planBasis()
			b.LocalItems["local"] = pinnedItemHash
			got, err := ReadS3Plan(context.Background(), serveRecordSet(t, f, &calls), f.ref, b, planLimits())
			if err == nil || !reflect.DeepEqual(got, Plan{}) {
				t.Fatal("invalid remote allowed partial preview")
			}
			if calls.Load() != 2 {
				t.Fatal("failure retried")
			}
		})
	}
}

func TestReadS3PlanHTTPFailuresRemainErrorsNotEmptyPlans(t *testing.T) {
	for _, status := range []int{302, 403, 404, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", "https://PRIVATE.invalid")
				w.WriteHeader(status)
			})
			f := newRecordSetFixture(t)
			got, err := ReadS3Plan(context.Background(), c, f.ref, planBasis(), planLimits())
			if err == nil || !reflect.DeepEqual(got, Plan{}) || calls.Load() != 1 {
				t.Fatal("HTTP failure became plan or retried")
			}
		})
	}
}

func TestReadS3PlanNilCancelledAndInvalidRemoteBudgetStayOffline(t *testing.T) {
	f := newRecordSetFixture(t)
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	got, err := ReadS3Plan(nil, c, f.ref, planBasis(), planLimits())
	rejectS3Plan(t, got, err, ErrS3PlanBasis)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err = ReadS3Plan(ctx, c, f.ref, planBasis(), planLimits())
	rejectS3Plan(t, got, err, context.Canceled)
	limits := planLimits()
	limits.Records.RecordBytes = 0
	got, err = ReadS3Plan(context.Background(), c, f.ref, planBasis(), limits)
	rejectS3Plan(t, got, err, ErrS3RecordSetReference)
	if calls.Load() != 0 {
		t.Fatal("offline refusal performed I/O")
	}
}

func TestReadS3PlanActualCancellationReachesRemoteGET(t *testing.T) {
	arrived, stopped := make(chan struct{}), make(chan struct{})
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) { close(arrived); <-r.Context().Done(); close(stopped) })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	f := newRecordSetFixture(t)
	go func() {
		got, e := ReadS3Plan(ctx, c, f.ref, planBasis(), planLimits())
		if !reflect.DeepEqual(got, Plan{}) {
			done <- errors.New("partial plan")
			return
		}
		done <- e
	}()
	select {
	case <-arrived:
	case <-ctx.Done():
		t.Fatal("request did not arrive")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("call did not stop")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("outbound GET did not cancel")
	}
}

func TestReadS3PlanReturnedMutationDoesNotAuthorizeOrCacheFutureCalls(t *testing.T) {
	f := newRecordSetFixture(t, setFile("note", "远端", "", false))
	var calls atomic.Int32
	c := serveRecordSet(t, f, &calls)
	b := planBasis()
	got, err := ReadS3Plan(context.Background(), c, f.ref, b, planLimits())
	if err != nil {
		t.Fatal(err)
	}
	got.Items[0].Action = "upload"
	got.Items[0].RemoteHash = "PRIVATE_WRONG"
	got.NeedsInit = true
	again, err := ReadS3Plan(context.Background(), c, f.ref, b, planLimits())
	if err != nil || again.Items[0].Action != "download" || again.Items[0].RemoteHash != f.manifest.Items["note"] || again.NeedsInit || calls.Load() != 4 {
		t.Fatalf("mutable plan cached or used as authority: %v", err)
	}
}
