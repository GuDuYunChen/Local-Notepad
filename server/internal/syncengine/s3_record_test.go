package syncengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

func selectedRecord() Record {
	return presentRecord(FilePayload{ID: "目录/e\u0301 %2F", Title: "合成标题", Content: "PRIVATE_CONTENT\n\x00正文", CreatedAt: 1, UpdatedAt: 2,
		ParentID: "parent", SortOrder: -2, IsPinned: true})
}
func recordBytes(t *testing.T, r Record) []byte {
	t.Helper()
	b, e := json.Marshal(r)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func selection(t *testing.T, recordRaw []byte, itemID string) ([]byte, S3RecordReference) {
	t.Helper()
	m := pinnedManifest()
	m.Items = map[string]string{itemID: hashBytes(recordRaw)}
	raw := pinnedBytes(t, m)
	return raw, S3RecordReference{Manifest: pinnedReference(raw), ItemID: itemID}
}
func selectionLimits() S3RecordReadLimits { return S3RecordReadLimits{4096, 4096} }
func rejectRecord(t *testing.T, record Record, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(record, Record{}) {
		t.Fatalf("expected zero rejected record: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		text := fmt.Sprintf(verb, err)
		for _, secret := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", "目录", pinnedItemHash} {
			if strings.Contains(text, secret) {
				t.Fatal("private record detail in error")
			}
		}
	}
}

func TestReadS3RecordExistingKindsAndPurgedWireFormat(t *testing.T) {
	records := []Record{selectedRecord(), presentTagRecord(TagPayload{ID: "标签", Name: "合成标签", Color: "#abcdef"}),
		presentFileTagRecord(FileTagPayload{FileID: "note", TagID: "标签"}),
		presentAttachmentRecord(AttachmentPayload{Name: "附件 e\u0301.txt", Size: 0, BlobHash: pinnedItemHash})}
	for _, r := range append(append([]Record{}, records...), purgedRecordForKey(records[0].ID), purgedRecordForKey(records[1].ID), purgedRecordForKey(records[2].ID), purgedRecordForKey(records[3].ID)) {
		t.Run(r.Kind+"/"+r.State, func(t *testing.T) {
			b, hash, err := encodeRecord(r)
			if err != nil {
				t.Fatal(err)
			}
			dir := &DirRemote{Root: t.TempDir()}
			if err = dir.SaveObject(hash, b); err != nil {
				t.Fatal(err)
			}
			exact, err := os.ReadFile(filepath.Join(dir.Root, "objects", hash+".json"))
			if err != nil {
				t.Fatal(err)
			}
			m := pinnedManifest()
			m.Items = map[string]string{r.ID: hash}
			stored, err := dir.SaveManifest(m)
			if err != nil {
				t.Fatal(err)
			}
			manifestKey := fmt.Sprintf("manifests/%020d-%s.json", m.Generation, stored.Revision)
			manifestRaw, err := os.ReadFile(filepath.Join(dir.Root, filepath.FromSlash(manifestKey)))
			if err != nil {
				t.Fatal(err)
			}
			ref := S3RecordReference{pinnedReference(manifestRaw), r.ID}
			var calls atomic.Int32
			client := pinnedClient(t, func(w http.ResponseWriter, request *http.Request) {
				index := calls.Add(1)
				if request.Method != "GET" || request.URL.RawQuery != "" || request.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" || !strings.HasPrefix(request.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") {
					t.Error("request contract changed")
				}
				want := "/synthetic-bucket/%E7%A9%BA%E9%97%B4/" + manifestKey
				body := manifestRaw
				if index == 2 {
					want = "/synthetic-bucket/%E7%A9%BA%E9%97%B4/objects/" + hash + ".json"
					body = exact
				}
				if request.URL.EscapedPath() != want || index > 2 {
					t.Error("unexpected object or extra request")
				}
				w.Header().Set("ETag", "PRIVATE_UNTRUSTED")
				_, _ = w.Write(body)
			})
			got, err := ReadS3Record(context.Background(), client, ref, S3RecordReadLimits{int64(len(manifestRaw)), int64(len(exact))})
			if err != nil || !reflect.DeepEqual(got, r) || calls.Load() != 2 {
				t.Fatalf("existing record roundtrip failed: %v", err)
			}
			if got.Attachment != nil && calls.Load() != 2 {
				t.Fatal("attachment blob fetched")
			}
		})
	}
}

func TestReadS3RecordMissingSelectionDoesNotFetchOrInventDeletion(t *testing.T) {
	for _, empty := range []bool{false, true} {
		t.Run(fmt.Sprint(empty), func(t *testing.T) {
			m := pinnedManifest()
			if empty {
				m.Items = map[string]string{}
			}
			raw := pinnedBytes(t, m)
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = w.Write(raw) })
			r, e := ReadS3Record(context.Background(), c, S3RecordReference{pinnedReference(raw), "missing"}, selectionLimits())
			rejectRecord(t, r, e, ErrS3RecordMissing)
			if calls.Load() != 1 {
				t.Fatal("missing selection searched or fetched")
			}
		})
	}
}

func TestReadS3RecordInvalidInputStaysOffline(t *testing.T) {
	raw, ref := selection(t, recordBytes(t, selectedRecord()), selectedRecord().ID)
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = w.Write(raw) })
	for _, id := range []string{"", " \t ", "PRIVATE\n", "\xff", strings.Repeat("x", 1025)} {
		r := ref
		r.ItemID = id
		got, e := ReadS3Record(context.Background(), c, r, selectionLimits())
		rejectRecord(t, got, e, ErrS3RecordReference)
	}
	for _, limit := range []int64{0, -1, syncs3.MaxObjectBytes + 1} {
		for _, manifest := range []bool{false, true} {
			limits := selectionLimits()
			if manifest {
				limits.ManifestBytes = limit
			} else {
				limits.RecordBytes = limit
			}
			r, e := ReadS3Record(context.Background(), c, ref, limits)
			rejectRecord(t, r, e, ErrS3RecordReference)
		}
	}
	r, e := ReadS3Record(nil, c, ref, selectionLimits())
	rejectRecord(t, r, e, ErrS3RecordReference)
	invalid := ref
	invalid.Manifest.SHA256 = ""
	r, e = ReadS3Record(context.Background(), c, invalid, selectionLimits())
	rejectRecord(t, r, e, ErrS3ManifestReference)
	r, e = ReadS3Record(context.Background(), nil, ref, selectionLimits())
	rejectRecord(t, r, e, syncs3.ErrConfig)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, e = ReadS3Record(ctx, c, ref, selectionLimits())
	rejectRecord(t, r, e, context.Canceled)
	if calls.Load() != 0 {
		t.Fatal("invalid input accessed network")
	}
}

func TestReadS3RecordDigestChainAndIdentityCannotBeSubstituted(t *testing.T) {
	for _, mode := range []string{"manifest digest", "foreign store", "record digest", "record identity"} {
		t.Run(mode, func(t *testing.T) {
			b := recordBytes(t, selectedRecord())
			manifest, ref := selection(t, b, selectedRecord().ID)
			want := syncs3.ErrDigestMismatch
			wantCalls := int32(2)
			if mode == "foreign store" {
				ref.Manifest.StoreID = "foreign"
				want = ErrS3Manifest
				wantCalls = 1
			}
			if mode == "manifest digest" {
				wantCalls = 1
			}
			if mode == "record identity" {
				r := selectedRecord()
				r.ID = "other"
				r.File.ID = "other"
				b = recordBytes(t, r)
				manifest, ref = selection(t, b, selectedRecord().ID)
				want = ErrS3Record
			}
			var calls atomic.Int32
			c := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) {
				index := calls.Add(1)
				data := b
				if index == 1 {
					data = manifest
				}
				if (mode == "manifest digest" && index == 1) || (mode == "record digest" && index == 2) {
					data = []byte("PRIVATE_INVALID_JSON")
				}
				w.Header().Set("ETag", hashBytes(b))
				w.Header().Set("x-amz-checksum-sha256", hashBytes(b))
				_, _ = w.Write(data)
			})
			r, e := ReadS3Record(context.Background(), c, ref, selectionLimits())
			rejectRecord(t, r, e, want)
			if calls.Load() != wantCalls {
				t.Fatal("substitution caused replay or extra read")
			}
		})
	}
}

func TestReadS3RecordStrictPayloadAndStateIdentity(t *testing.T) {
	for name, change := range map[string]func(*Record){
		"format": func(r *Record) { r.Format = "PRIVATE" }, "version": func(r *Record) { r.Version = 2 }, "kind": func(r *Record) { r.Kind = "tag" },
		"state": func(r *Record) { r.State = "missing" }, "no payload": func(r *Record) { r.File = nil }, "extra payload": func(r *Record) { r.Tag = &TagPayload{} },
		"file ID": func(r *Record) { r.File.ID = "other" }, "blank title": func(r *Record) { r.File.Title = " " }, "bad parent": func(r *Record) { r.File.ParentID = "\n" },
		"purged payload": func(r *Record) { r.State = "purged" },
	} {
		t.Run(name, func(t *testing.T) {
			r := selectedRecord()
			change(&r)
			got, e := decodeS3Record(context.Background(), recordBytes(t, r), selectedRecord().ID)
			rejectRecord(t, got, e, ErrS3Record)
		})
	}
	for _, r := range []Record{
		presentTagRecord(TagPayload{ID: "\n", Name: "name"}), presentFileTagRecord(FileTagPayload{FileID: "a:b", TagID: "c"}),
		presentAttachmentRecord(AttachmentPayload{Name: "../escape", Size: 1, BlobHash: pinnedItemHash}),
		presentAttachmentRecord(AttachmentPayload{Name: "note", Size: -1, BlobHash: pinnedItemHash}),
		presentAttachmentRecord(AttachmentPayload{Name: "note", Size: 1, BlobHash: "bad"}),
		purgedRecordForKey("tag:"), purgedRecordForKey("filetag:a:b:c"), purgedRecordForKey("attachment:2E2E"),
	} {
		got, e := decodeS3Record(context.Background(), recordBytes(t, r), r.ID)
		rejectRecord(t, got, e, ErrS3Record)
	}
}

func TestReadS3RecordRejectsAmbiguousJSONAtEveryLevel(t *testing.T) {
	original := string(recordBytes(t, selectedRecord()))
	cases := []string{"null", "[]", original + original, "\xef\xbb\xbf" + original,
		strings.Replace(original, `"version":1`, `"version":1,"version":1`, 1),
		strings.Replace(original, `"version":1`, `"version":1,"\u0076ersion":1`, 1),
		strings.Replace(original, `"version":1`, `"VERSION":1`, 1),
		strings.Replace(original, `"version":1`, `"version":1,"private":"PRIVATE"`, 1),
		strings.Replace(original, `"title":"合成标题"`, `"title":"合成标题","title":"other"`, 1),
		strings.Replace(original, `"title":"合成标题"`, `"title":"合成标题","\u0074itle":"other"`, 1),
		strings.Replace(original, `"title":"合成标题"`, `"TITLE":"合成标题"`, 1),
		strings.Replace(original, `"title":"合成标题"`, `"title":"\ud800"`, 1),
		strings.Replace(original, `"title":"合成标题"`, "\"title\":\"\xff\"", 1),
	}
	for i, raw := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			r, e := decodeS3Record(context.Background(), []byte(raw), selectedRecord().ID)
			rejectRecord(t, r, e, ErrS3Record)
		})
	}
	valid := strings.Replace(original, `"title":"合成标题"`, `"title":"\ud83d\ude00"`, 1)
	r, e := decodeS3Record(context.Background(), []byte(valid), selectedRecord().ID)
	if e != nil || r.File.Title != "😀" {
		t.Fatal("valid surrogate pair was rejected")
	}
}

func TestReadS3RecordRequiresEverySerializedPayloadField(t *testing.T) {
	records := []Record{selectedRecord(), presentTagRecord(TagPayload{ID: "tag", Name: "name"}), presentFileTagRecord(FileTagPayload{FileID: "file", TagID: "tag"}), presentAttachmentRecord(AttachmentPayload{Name: "note", BlobHash: pinnedItemHash})}
	for _, r := range records {
		name := r.Kind
		if name == "file-tag" {
			name = "file_tag"
		}
		var outer map[string]json.RawMessage
		_ = json.Unmarshal(recordBytes(t, r), &outer)
		var nested map[string]json.RawMessage
		_ = json.Unmarshal(outer[name], &nested)
		for key := range nested {
			for _, mode := range []string{"missing", "null", "wrong type"} {
				t.Run(r.Kind+"/"+key+"/"+mode, func(t *testing.T) {
					copy := map[string]json.RawMessage{}
					for k, v := range nested {
						copy[k] = v
					}
					if mode == "missing" {
						delete(copy, key)
					} else if mode == "null" {
						copy[key] = json.RawMessage("null")
					} else {
						copy[key] = json.RawMessage("[]")
					}
					payload, _ := json.Marshal(copy)
					top := map[string]json.RawMessage{}
					for k, v := range outer {
						top[k] = v
					}
					top[name] = payload
					raw, _ := json.Marshal(top)
					got, e := decodeS3Record(context.Background(), raw, r.ID)
					rejectRecord(t, got, e, ErrS3Record)
				})
			}
		}
	}
}

func TestReadS3RecordBothBudgetsAndHTTPRefusals(t *testing.T) {
	b := recordBytes(t, selectedRecord())
	manifest, ref := selection(t, b, selectedRecord().ID)
	for _, at := range []int32{1, 2} {
		for _, status := range []int{200, 302, 403, 404, 500} {
			t.Run(fmt.Sprintf("%d/%d", at, status), func(t *testing.T) {
				var calls atomic.Int32
				c := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) {
					index := calls.Add(1)
					data := manifest
					if index == 2 {
						data = b
					}
					if index == at {
						w.Header().Set("Location", "http://127.0.0.1:1/PRIVATE")
						w.WriteHeader(status)
					}
					_, _ = w.Write(data)
				})
				limits := selectionLimits()
				if status == 200 {
					if at == 1 {
						limits.ManifestBytes = int64(len(manifest) - 1)
					} else {
						limits.RecordBytes = int64(len(b) - 1)
					}
				}
				r, e := ReadS3Record(context.Background(), c, ref, limits)
				if status == 200 {
					rejectRecord(t, r, e, syncs3.ErrTooLarge)
				} else {
					var h *syncs3.HTTPError
					if !errors.As(e, &h) || h.StatusCode != status || !reflect.DeepEqual(r, Record{}) {
						t.Fatalf("wrong HTTP refusal: %v", e)
					}
				}
				if calls.Load() != at {
					t.Fatal("HTTP or budget refusal caused extra requests")
				}
			})
		}
	}
}

func TestReadS3RecordCancellationReachesActualSelectedGET(t *testing.T) {
	b := recordBytes(t, selectedRecord())
	manifest, ref := selection(t, b, selectedRecord().ID)
	arrived := make(chan struct{})
	cancelled := make(chan struct{})
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			_, _ = w.Write(manifest)
			return
		}
		close(arrived)
		<-r.Context().Done()
		close(cancelled)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		r, e := ReadS3Record(ctx, c, ref, selectionLimits())
		if !reflect.DeepEqual(r, Record{}) {
			done <- errors.New("unexpected partial record")
			return
		}
		done <- e
	}()
	select {
	case <-arrived:
	case <-time.After(2 * time.Second):
		t.Fatal("owned record did not start")
	}
	cancel()
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatalf("wrong cancellation: %v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("owned read did not cancel")
	}
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("cancel did not reach owned server")
	}
	if calls.Load() != 2 {
		t.Fatal("cancellation replayed")
	}
}

func TestReadS3RecordConcurrentSelectionsDoNotCross(t *testing.T) {
	first := selectedRecord()
	second := presentTagRecord(TagPayload{ID: "tag", Name: "second"})
	b1 := recordBytes(t, first)
	b2 := recordBytes(t, second)
	m := pinnedManifest()
	m.Items = map[string]string{first.ID: hashBytes(b1), second.ID: hashBytes(b2)}
	manifest := pinnedBytes(t, m)
	pin := pinnedReference(manifest)
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		data := manifest
		if strings.HasSuffix(r.URL.Path, hashBytes(b1)+".json") {
			data = b1
		} else if strings.HasSuffix(r.URL.Path, hashBytes(b2)+".json") {
			data = b2
		}
		_, _ = w.Write(data)
	})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			want := first
			if i%2 == 1 {
				want = second
			}
			got, e := ReadS3Record(context.Background(), c, S3RecordReference{pin, want.ID}, selectionLimits())
			if e != nil || !reflect.DeepEqual(got, want) {
				t.Errorf("concurrent identity failed: %v", e)
			}
		}(i)
	}
	wg.Wait()
	if calls.Load() != 16 {
		t.Fatal("cross-call caching or replay")
	}
}

func TestReadS3RecordResultMutationCannotAlterNextRead(t *testing.T) {
	b := recordBytes(t, selectedRecord())
	manifest, ref := selection(t, b, selectedRecord().ID)
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if strings.Contains(r.URL.Path, "/manifests/") {
			_, _ = w.Write(manifest)
		} else {
			_, _ = w.Write(b)
		}
	})
	one, e := ReadS3Record(context.Background(), c, ref, selectionLimits())
	if e != nil {
		t.Fatal(e)
	}
	one.File.Content = "MUTATED"
	two, e := ReadS3Record(context.Background(), c, ref, selectionLimits())
	if e != nil || two.File.Content != selectedRecord().File.Content || calls.Load() != 4 {
		t.Fatal("caller mutation or hidden cache affected another read")
	}
}

func TestReadS3RecordExpiredDeadlineAndDecoderCancellation(t *testing.T) {
	b := recordBytes(t, selectedRecord())
	_, ref := selection(t, b, selectedRecord().ID)
	var calls atomic.Int32
	c := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = io.WriteString(w, "PRIVATE") })
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	r, e := ReadS3Record(ctx, c, ref, selectionLimits())
	rejectRecord(t, r, e, context.DeadlineExceeded)
	r, e = decodeS3Record(ctx, b, ref.ItemID)
	rejectRecord(t, r, e, context.DeadlineExceeded)
	if calls.Load() != 0 {
		t.Fatal("expired deadline sent a request")
	}
}
