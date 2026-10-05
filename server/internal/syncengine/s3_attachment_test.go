package syncengine

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"notepad-server/internal/syncs3"
)

// All objects, paths, credentials and directories here are synthetic. These
// tests use the existing pinnedClient/DirRemote and real loopback HTTP; no second
// fixed-port fixture, external bucket, user profile or new wire format.
type attachmentFixture struct {
	client   *syncs3.ReadClient
	ref      S3RecordReference
	metadata AttachmentPayload
	bodies   [3][]byte
	paths    [3]string
	mu       sync.Mutex
	seen     []string
	override func(int, http.ResponseWriter, *http.Request) bool
}

func attachmentRecord(blob []byte) Record {
	return presentAttachmentRecord(AttachmentPayload{Name: "PRIVATE 附件 e\u0301 %2F.bin", Size: int64(len(blob)), BlobHash: hashBytes(blob)})
}
func attachmentLimits() S3AttachmentReadLimits { return S3AttachmentReadLimits{4096, 4096, 4096} }
func attachmentFixtureFor(t *testing.T, record Record, blob []byte) *attachmentFixture {
	t.Helper()
	raw := recordBytes(t, record)
	manifest, ref := selection(t, raw, record.ID)
	f := &attachmentFixture{ref: ref, bodies: [3][]byte{manifest, raw, append([]byte{}, blob...)}}
	if record.Attachment != nil {
		f.metadata = *record.Attachment
	}
	f.paths = [3]string{"/synthetic-bucket/空间/" + fmt.Sprintf("manifests/%020d-%s.json", ref.Manifest.Generation, ref.Manifest.SHA256),
		"/synthetic-bucket/空间/objects/" + hashBytes(raw) + ".json", "/synthetic-bucket/空间/blobs/" + f.metadata.BlobHash}
	f.client = pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.seen = append(f.seen, r.URL.Path)
		f.mu.Unlock()
		if r.Method != "GET" || r.URL.RawQuery != "" || r.Header.Get("Range") != "" ||
			r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" || !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") {
			t.Error("not an exact complete signed GET")
		}
		for stage, path := range f.paths {
			if r.URL.Path == path {
				if f.override != nil && f.override(stage, w, r) {
					return
				}
				w.Header().Set("ETag", "PRIVATE_NOT_AUTHORITY")
				_, _ = w.Write(f.bodies[stage])
				return
			}
		}
		t.Error("unexpected object path or discovery")
		http.NotFound(w, r)
	})
	return f
}
func (f *attachmentFixture) calls() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.seen) }
func rejectAttachment(t *testing.T, got S3AttachmentObject, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(got, S3AttachmentObject{}) {
		t.Fatalf("expected zero rejected attachment: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		for _, private := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", "e\u0301 %2F.bin", pinnedItemHash} {
			if strings.Contains(fmt.Sprintf(verb, err), private) {
				t.Fatal("private attachment detail in error")
			}
		}
	}
}

func TestReadS3AttachmentExistingDirectoryAndBinaryRoundtrip(t *testing.T) {
	for _, tc := range []struct {
		name string
		blob []byte
	}{
		{"empty", []byte{}}, {"binary", []byte{0xff, 0x00, 0x80, '\r', '\n', 0xfe}}, {"utf8", []byte(" PRIVATE\x00正文 e\u0301\n ")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := attachmentRecord(tc.blob)
			f := attachmentFixtureFor(t, r, tc.blob)
			dir := &DirRemote{Root: t.TempDir()}
			input := filepath.Join(t.TempDir(), "synthetic-input")
			if err := os.WriteFile(input, tc.blob, 0600); err != nil {
				t.Fatal(err)
			}
			if err := dir.SaveBlobFile(r.Attachment.BlobHash, input, r.Attachment.Size); err != nil {
				t.Fatal(err)
			}
			recordRaw, recordHash, err := encodeRecord(r)
			if err != nil {
				t.Fatal(err)
			}
			if err = dir.SaveObject(recordHash, recordRaw); err != nil {
				t.Fatal(err)
			}
			m := pinnedManifest()
			m.Items = map[string]string{r.ID: recordHash}
			stored, err := dir.SaveManifest(m)
			if err != nil {
				t.Fatal(err)
			}
			keys := []string{fmt.Sprintf("manifests/%020d-%s.json", m.Generation, stored.Revision), "objects/" + recordHash + ".json", "blobs/" + r.Attachment.BlobHash}
			for i, key := range keys {
				b, e := os.ReadFile(filepath.Join(dir.Root, filepath.FromSlash(key)))
				if e != nil {
					t.Fatal(e)
				}
				if !bytes.Equal(b, f.bodies[i]) {
					t.Fatal("existing directory wire bytes changed")
				}
				f.bodies[i] = b
			}
			blobLimit := int64(len(tc.blob))
			if blobLimit == 0 {
				blobLimit = 1
			}
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, S3AttachmentReadLimits{int64(len(f.bodies[0])), int64(len(f.bodies[1])), blobLimit})
			if err != nil || got.Metadata != *r.Attachment || !bytes.Equal(got.Bytes, tc.blob) || got.Bytes == nil || f.calls() != 3 {
				t.Fatalf("existing attachment roundtrip failed: %v, calls=%d", err, f.calls())
			}
			for i, key := range keys {
				b, e := os.ReadFile(filepath.Join(dir.Root, filepath.FromSlash(key)))
				if e != nil || !bytes.Equal(b, f.bodies[i]) {
					t.Fatal("read changed stored bytes")
				}
			}
		})
	}
}

func TestReadS3AttachmentInvalidReferenceAndBudgetsStayOffline(t *testing.T) {
	f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
	for _, id := range []string{"", "file", "tag:x", "filetag:x:y", "attachment:", "attachment:2f", "attachment:2e2e", "attachment:FF", "attachment:c3", "attachment:" + strings.Repeat("61", 2048)} {
		t.Run("key/"+fmt.Sprint(len(id))+"/"+id[:min(len(id), 20)], func(t *testing.T) {
			ref := f.ref
			ref.ItemID = id
			got, err := ReadS3Attachment(context.Background(), f.client, ref, attachmentLimits())
			rejectAttachment(t, got, err, ErrS3AttachmentReference)
		})
	}
	for field := 0; field < 3; field++ {
		for _, value := range []int64{0, -1, syncs3.MaxObjectBytes + 1} {
			t.Run(fmt.Sprintf("budget/%d/%d", field, value), func(t *testing.T) {
				l := attachmentLimits()
				values := []*int64{&l.ManifestBytes, &l.RecordBytes, &l.BlobBytes}
				*values[field] = value
				got, err := ReadS3Attachment(context.Background(), f.client, f.ref, l)
				rejectAttachment(t, got, err, ErrS3AttachmentReference)
			})
		}
	}
	got, err := ReadS3Attachment(nil, f.client, f.ref, attachmentLimits())
	rejectAttachment(t, got, err, ErrS3AttachmentReference)
	for _, c := range []*syncs3.ReadClient{nil, {}} {
		got, err = ReadS3Attachment(context.Background(), c, f.ref, attachmentLimits())
		if err == nil || !reflect.DeepEqual(got, S3AttachmentObject{}) {
			t.Fatal("invalid client accepted")
		}
	}
	ref := f.ref
	ref.Manifest.SHA256 = "PRIVATE_BAD_HASH"
	got, err = ReadS3Attachment(context.Background(), f.client, ref, attachmentLimits())
	if err == nil || !reflect.DeepEqual(got, S3AttachmentObject{}) {
		t.Fatal("invalid pin accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err = ReadS3Attachment(ctx, f.client, f.ref, attachmentLimits())
	rejectAttachment(t, got, err, context.Canceled)
	ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	got, err = ReadS3Attachment(ctx, f.client, f.ref, attachmentLimits())
	rejectAttachment(t, got, err, context.DeadlineExceeded)
	if f.calls() != 0 {
		t.Fatal("invalid input or expired context accessed network")
	}
}

func TestReadS3AttachmentMissingOrPurgedDoesNotFetchBlob(t *testing.T) {
	for _, purged := range []bool{false, true} {
		t.Run(fmt.Sprint(purged), func(t *testing.T) {
			r := attachmentRecord(nil)
			want := ErrS3RecordMissing
			calls := 1
			if purged {
				r = purgedRecordForKey(r.ID)
				want = ErrS3AttachmentUnavailable
				calls = 2
			}
			f := attachmentFixtureFor(t, r, nil)
			if !purged {
				m := pinnedManifest()
				m.Items = map[string]string{}
				f.bodies[0] = pinnedBytes(t, m)
				f.ref.Manifest = pinnedReference(f.bodies[0])
				f.paths[0] = "/synthetic-bucket/空间/" + fmt.Sprintf("manifests/%020d-%s.json", f.ref.Manifest.Generation, f.ref.Manifest.SHA256)
			}
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
			rejectAttachment(t, got, err, want)
			if f.calls() != calls {
				t.Fatal("unavailable record caused blob request")
			}
		})
	}
}

func TestReadS3AttachmentRejectsMalformedMetadataBeforeBlob(t *testing.T) {
	for _, change := range []struct {
		name   string
		mutate func(*Record)
	}{
		{"negative size", func(r *Record) { r.Attachment.Size = -1 }},
		{"bad hash", func(r *Record) { r.Attachment.BlobHash = "PRIVATE_BAD_HASH" }},
		{"wrong name", func(r *Record) { r.Attachment.Name = "different" }},
		{"foreign ID", func(r *Record) { r.ID = attachmentItemKey("foreign") }},
		{"nonattachment", func(r *Record) { r.Kind = "file" }},
	} {
		t.Run(change.name, func(t *testing.T) {
			r := attachmentRecord([]byte("abc"))
			id := r.ID
			change.mutate(&r)
			f := attachmentFixtureFor(t, r, []byte("abc"))
			// The independently pinned manifest selects the original item identity.
			f.bodies[0], f.ref = selection(t, f.bodies[1], id)
			f.paths[0] = "/synthetic-bucket/空间/" + fmt.Sprintf("manifests/%020d-%s.json", f.ref.Manifest.Generation, f.ref.Manifest.SHA256)
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
			rejectAttachment(t, got, err, ErrS3Record)
			if f.calls() != 2 {
				t.Fatal("bad metadata fetched blob")
			}
		})
	}
}

func TestReadS3AttachmentEnforcesAllThreeDigests(t *testing.T) {
	for stage := 0; stage < 3; stage++ {
		t.Run(fmt.Sprint(stage), func(t *testing.T) {
			f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
			f.bodies[stage] = append([]byte{}, f.bodies[stage]...)
			f.bodies[stage][len(f.bodies[stage])-1] ^= 1 // Same length: no size check may substitute for the digest.
			f.override = func(i int, w http.ResponseWriter, _ *http.Request) bool {
				if i == stage {
					w.Header().Set("ETag", f.metadata.BlobHash)
					w.Header().Set("X-Amz-Checksum-Sha256", f.metadata.BlobHash)
				}
				return false
			}
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
			rejectAttachment(t, got, err, syncs3.ErrDigestMismatch)
			if f.calls() != stage+1 {
				t.Fatal("digest failure did not stop subsequent reads")
			}
		})
	}
}

func TestReadS3AttachmentSizeIsCheckedIndependentlyOfDigest(t *testing.T) {
	for _, declared := range []int64{0, 1, 2, 4} {
		t.Run(fmt.Sprint(declared), func(t *testing.T) {
			r := attachmentRecord([]byte("abc"))
			r.Attachment.Size = declared
			f := attachmentFixtureFor(t, r, []byte("abc"))
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
			rejectAttachment(t, got, err, ErrS3AttachmentSize)
			if f.calls() != 3 {
				t.Fatal("size check did not consume exactly one verified blob")
			}
		})
	}
	r := attachmentRecord(nil)
	r.Attachment.Size = 1
	f := attachmentFixtureFor(t, r, nil)
	got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
	rejectAttachment(t, got, err, ErrS3AttachmentSize)
}

func TestReadS3AttachmentEachBudgetAndDeclaredOversize(t *testing.T) {
	for stage := 0; stage < 3; stage++ {
		t.Run(fmt.Sprint(stage), func(t *testing.T) {
			f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
			l := attachmentLimits()
			values := []*int64{&l.ManifestBytes, &l.RecordBytes, &l.BlobBytes}
			*values[stage] = int64(len(f.bodies[stage]) - 1)
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, l)
			rejectAttachment(t, got, err, syncs3.ErrTooLarge)
			want := stage + 1
			if stage == 2 {
				want = 2
			} // Signed metadata is checked before blob GET.
			if f.calls() != want {
				t.Fatal("budget failure dispatched unnecessary requests")
			}
		})
	}
	for _, announced := range []bool{true, false} {
		t.Run("remote-overrun/"+fmt.Sprint(announced), func(t *testing.T) {
			f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
			f.override = func(stage int, w http.ResponseWriter, _ *http.Request) bool {
				if stage != 2 {
					return false
				}
				if announced {
					w.Header().Set("Content-Length", "4")
				} else {
					w.(http.Flusher).Flush()
				}
				_, _ = io.WriteString(w, "abcd")
				return true
			}
			l := attachmentLimits()
			l.BlobBytes = 3
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, l)
			rejectAttachment(t, got, err, syncs3.ErrTooLarge)
			if f.calls() != 3 {
				t.Fatal("overrun replayed")
			}
		})
	}
}

func TestReadS3AttachmentHTTPAndBodyFailuresStayFailures(t *testing.T) {
	for stage := 0; stage < 3; stage++ {
		for _, status := range []int{302, 403, 404, 429, 500} {
			t.Run(fmt.Sprintf("%d/%d", stage, status), func(t *testing.T) {
				f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
				f.override = func(i int, w http.ResponseWriter, _ *http.Request) bool {
					if i != stage {
						return false
					}
					w.Header().Set("Location", "https://never-follow.invalid/PRIVATE")
					w.WriteHeader(status)
					_, _ = io.WriteString(w, "PRIVATE_ERROR")
					return true
				}
				got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
				var he *syncs3.HTTPError
				if !errors.As(err, &he) || he.StatusCode != status {
					t.Fatalf("HTTP classification changed: %v", err)
				}
				rejectAttachment(t, got, err, he)
				if f.calls() != stage+1 {
					t.Fatal("HTTP failure followed, retried or fetched dependency")
				}
			})
		}
	}
	for _, encoded := range []bool{true, false} {
		t.Run("body/"+fmt.Sprint(encoded), func(t *testing.T) {
			f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
			f.override = func(stage int, w http.ResponseWriter, _ *http.Request) bool {
				if stage != 2 {
					return false
				}
				if encoded {
					w.Header().Add("Content-Encoding", "identity")
					w.Header().Add("Content-Encoding", "gzip")
				} else {
					w.Header().Set("Content-Length", "100")
				}
				_, _ = io.WriteString(w, "abc")
				return true
			}
			got, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
			rejectAttachment(t, got, err, syncs3.ErrBody)
			if f.calls() != 3 {
				t.Fatal("body failure retried")
			}
		})
	}
}

func TestReadS3AttachmentCancellationReachesEachSyntheticGET(t *testing.T) {
	for stage := 0; stage < 3; stage++ {
		t.Run(fmt.Sprint(stage), func(t *testing.T) {
			f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
			arrived := make(chan struct{})
			stopped := make(chan struct{})
			f.override = func(i int, w http.ResponseWriter, r *http.Request) bool {
				if i != stage {
					return false
				}
				close(arrived)
				<-r.Context().Done()
				close(stopped)
				return true
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan struct{})
			var got S3AttachmentObject
			var err error
			go func() { got, err = ReadS3Attachment(ctx, f.client, f.ref, attachmentLimits()); close(done) }()
			select {
			case <-arrived:
			case <-time.After(3 * time.Second):
				t.Fatal("owned request never arrived")
			}
			cancel()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("owned request never cancelled")
			}
			rejectAttachment(t, got, err, context.Canceled)
			select {
			case <-stopped:
			case <-time.After(3 * time.Second):
				t.Fatal("cancellation did not reach server")
			}
			if f.calls() != stage+1 {
				t.Fatal("cancelled read continued or retried")
			}
		})
	}
}

func TestReadS3AttachmentCallerDeadlineCoversBlobRead(t *testing.T) {
	f := attachmentFixtureFor(t, attachmentRecord([]byte("abc")), []byte("abc"))
	f.override = func(stage int, _ http.ResponseWriter, r *http.Request) bool {
		if stage != 2 {
			return false
		}
		<-r.Context().Done()
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := ReadS3Attachment(ctx, f.client, f.ref, attachmentLimits())
	rejectAttachment(t, got, err, context.DeadlineExceeded)
	if f.calls() != 3 {
		t.Fatal("deadline probe did not cover the third read")
	}
}

func TestReadS3AttachmentConcurrentSelectionsAreIndependent(t *testing.T) {
	objects := map[string][]byte{}
	refs := []S3RecordReference{}
	blobs := [][]byte{[]byte("PRIVATE_first"), []byte("PRIVATE_second")}
	for i, b := range blobs {
		r := attachmentRecord(b)
		r.Attachment.Name = fmt.Sprintf("合成%d.bin", i)
		r.ID = attachmentItemKey(r.Attachment.Name)
		raw := recordBytes(t, r)
		m, ref := selection(t, raw, r.ID)
		refs = append(refs, ref)
		objects["/synthetic-bucket/空间/"+fmt.Sprintf("manifests/%020d-%s.json", ref.Manifest.Generation, ref.Manifest.SHA256)] = m
		objects["/synthetic-bucket/空间/objects/"+hashBytes(raw)+".json"] = raw
		objects["/synthetic-bucket/空间/blobs/"+hashBytes(b)] = b
	}
	var mu sync.Mutex
	calls := 0
	c := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		b, ok := objects[r.URL.Path]
		if !ok {
			t.Error("unexpected concurrent path")
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(b)
	})
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got, err := ReadS3Attachment(context.Background(), c, refs[i], attachmentLimits())
			if err != nil || !bytes.Equal(got.Bytes, blobs[i]) || got.Metadata.Name != fmt.Sprintf("合成%d.bin", i) {
				t.Error("crossed selection or failure")
			}
		}(n % 2)
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	if calls != 24 {
		t.Fatal("shared cache, extra reads or replay")
	}
}

func TestReadS3AttachmentReturnedBytesAndMetadataAreDetached(t *testing.T) {
	b := []byte("abc")
	f := attachmentFixtureFor(t, attachmentRecord(b), b)
	first, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
	if err != nil {
		t.Fatal(err)
	}
	first.Metadata.Name = "changed"
	first.Metadata.BlobHash = strings.Repeat("0", 64)
	first.Metadata.Size = 0
	first.Bytes[0] = 0
	second, err := ReadS3Attachment(context.Background(), f.client, f.ref, attachmentLimits())
	if err != nil || second.Metadata != f.metadata || !bytes.Equal(second.Bytes, b) || f.calls() != 6 {
		t.Fatalf("returned value became authority or cache: %v", err)
	}
	// The original single-record API remains metadata-only and never fetches a blob.
	r, err := ReadS3Record(context.Background(), f.client, f.ref, selectionLimits())
	if err != nil || r.Attachment == nil || *r.Attachment != f.metadata || f.calls() != 8 {
		t.Fatal("record-only contract changed")
	}
}
