package syncengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

const pinnedItemHash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

func pinnedManifest() Manifest {
	return Manifest{Format: ManifestFormat, Version: ManifestVersion, StoreID: "合成 store e\u0301", Generation: 7,
		UpdatedAt: "2026-01-02T03:04:05.123456789Z", DeviceID: "synthetic-device", Items: map[string]string{"目录/e\u0301 %2F": pinnedItemHash}}
}
func pinnedBytes(t *testing.T, m Manifest) []byte {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func pinnedReference(raw []byte) S3ManifestReference {
	sum := sha256.Sum256(raw)
	return S3ManifestReference{StoreID: pinnedManifest().StoreID, Generation: 7, SHA256: hex.EncodeToString(sum[:])}
}
func pinnedClient(t *testing.T, handler http.HandlerFunc) *syncs3.ReadClient {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := syncs3.NewReadClient(syncs3.Config{Endpoint: server.URL, Bucket: "synthetic-bucket", Region: "us-east-1", Prefix: "空间"},
		syncs3.Credentials{AccessKeyID: "AKIASYNTHETIC", SecretAccessKey: "SYNTHETIC_SECRET", SessionToken: "SYNTHETIC_TOKEN"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.CloseIdleConnections)
	return client
}
func rejectPinned(t *testing.T, manifest Manifest, err, want error) {
	t.Helper()
	if !errors.Is(err, want) || !reflect.DeepEqual(manifest, Manifest{}) {
		t.Fatalf("expected zero rejected manifest: %v", err)
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		message := fmt.Sprintf(verb, err)
		for _, secret := range []string{"PRIVATE", "SYNTHETIC", "synthetic-bucket", pinnedManifest().StoreID, pinnedItemHash} {
			if strings.Contains(message, secret) {
				t.Fatal("private identity or bytes in error")
			}
		}
	}
}

func TestReadS3ManifestUsesExistingSchemaAndSingleSignedGET(t *testing.T) {
	m := pinnedManifest()
	// Create bytes with the EXISTING directory provider, not a new wire format.
	dir := &DirRemote{Root: t.TempDir()}
	stored, err := dir.SaveManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("%020d-%s.json", m.Generation, stored.Revision)
	raw, err := os.ReadFile(filepath.Join(dir.Root, "manifests", name))
	if err != nil {
		t.Fatal(err)
	}
	ref := pinnedReference(raw)
	var calls atomic.Int32
	client := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.EscapedPath() != "/synthetic-bucket/%E7%A9%BA%E9%97%B4/manifests/"+name || r.URL.RawQuery != "" {
			t.Error("unexpected method, key or query")
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIASYNTHETIC/") || r.Header.Get("X-Amz-Security-Token") != "SYNTHETIC_TOKEN" {
			t.Error("signed request or temporary token missing")
		}
		w.Header().Set("ETag", "PRIVATE_ETAG")
		_, _ = w.Write(raw)
	})
	got, err := ReadS3Manifest(context.Background(), client, ref, int64(len(raw)))
	if err != nil || !reflect.DeepEqual(got, stored) || calls.Load() != 1 {
		t.Fatalf("exact pinned read failed: %v", err)
	}
	if got.Items["目录/e\u0301 %2F"] != pinnedItemHash || len(got.Items) != 1 {
		t.Fatal("identity was normalized")
	}
	files, err := os.ReadDir(filepath.Join(dir.Root, "manifests"))
	if err != nil || len(files) != 1 {
		t.Fatal("read changed local manifest files")
	}
}

func TestReadS3ManifestEmptyItemsIsNotMissingStore(t *testing.T) {
	m := pinnedManifest()
	m.Items = map[string]string{}
	raw := pinnedBytes(t, m)
	client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(raw) })
	got, err := ReadS3Manifest(context.Background(), client, pinnedReference(raw), 4096)
	if err != nil || got.Items == nil || len(got.Items) != 0 || got.Generation != 7 || got.Revision == "" {
		t.Fatal("valid empty manifest rejected")
	}
}

func TestReadS3ManifestRejectsReferenceBeforeNetwork(t *testing.T) {
	raw := pinnedBytes(t, pinnedManifest())
	original := pinnedReference(raw)
	var calls atomic.Int32
	client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = w.Write(raw) })
	for name, change := range map[string]func(*S3ManifestReference){
		"empty store": func(r *S3ManifestReference) { r.StoreID = "" }, "blank store": func(r *S3ManifestReference) { r.StoreID = " \t " },
		"store control": func(r *S3ManifestReference) { r.StoreID = "PRIVATE\n" }, "invalid UTF8": func(r *S3ManifestReference) { r.StoreID = "\xff" },
		"long identity":   func(r *S3ManifestReference) { r.StoreID = strings.Repeat("x", 1025) },
		"zero generation": func(r *S3ManifestReference) { r.Generation = 0 }, "negative generation": func(r *S3ManifestReference) { r.Generation = -1 },
		"empty digest": func(r *S3ManifestReference) { r.SHA256 = "" }, "uppercase digest": func(r *S3ManifestReference) { r.SHA256 = strings.ToUpper(r.SHA256) },
		"digest length": func(r *S3ManifestReference) { r.SHA256 += "0" }, "digest newline": func(r *S3ManifestReference) { r.SHA256 += "\n" },
	} {
		t.Run(name, func(t *testing.T) {
			ref := original
			change(&ref)
			m, e := ReadS3Manifest(context.Background(), client, ref, 4096)
			rejectPinned(t, m, e, ErrS3ManifestReference)
		})
	}
	for _, limit := range []int64{0, -1, syncs3.MaxObjectBytes + 1} {
		m, e := ReadS3Manifest(context.Background(), client, original, limit)
		rejectPinned(t, m, e, ErrS3ManifestReference)
	}
	m, e := ReadS3Manifest(nil, client, original, 4096)
	rejectPinned(t, m, e, ErrS3ManifestReference)
	m, e = ReadS3Manifest(context.Background(), nil, original, 4096)
	rejectPinned(t, m, e, syncs3.ErrConfig)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m, e = ReadS3Manifest(ctx, client, original, 4096)
	rejectPinned(t, m, e, context.Canceled)
	if calls.Load() != 0 {
		t.Fatal("invalid reference or cancellation accessed network")
	}
}

func TestReadS3ManifestRejectsTamperBeforeInterpretation(t *testing.T) {
	raw := pinnedBytes(t, pinnedManifest())
	ref := pinnedReference(raw)
	var calls atomic.Int32
	client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("ETag", ref.SHA256)
		w.Header().Set("x-amz-checksum-sha256", ref.SHA256)
		_, _ = io.WriteString(w, "PRIVATE_INVALID_JSON")
	})
	m, e := ReadS3Manifest(context.Background(), client, ref, 4096)
	rejectPinned(t, m, e, syncs3.ErrDigestMismatch)
	if calls.Load() != 1 {
		t.Fatal("digest mismatch replayed")
	}
}

func TestReadS3ManifestRejectsSchemaAndIdentity(t *testing.T) {
	original := pinnedBytes(t, pinnedManifest())
	var fields map[string]json.RawMessage
	if json.Unmarshal(original, &fields) != nil {
		t.Fatal("fixture")
	}
	cases := map[string]string{
		"format": `"unknown"`, "version": `2`, "store_id": `"other-store"`, "generation": `8`,
		"updated_at": `"not-a-date"`, "device_id": `""`, "items": `[]`,
	}
	for field, value := range cases {
		t.Run(field, func(t *testing.T) {
			copy := make(map[string]json.RawMessage)
			for k, v := range fields {
				copy[k] = v
			}
			copy[field] = json.RawMessage(value)
			raw, _ := json.Marshal(copy)
			var calls atomic.Int32
			client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = w.Write(raw) })
			m, e := ReadS3Manifest(context.Background(), client, pinnedReference(raw), 4096)
			rejectPinned(t, m, e, ErrS3Manifest)
			if calls.Load() != 1 {
				t.Fatal("schema failure replayed")
			}
		})
	}
	for _, field := range []string{"format", "version", "store_id", "generation", "updated_at", "device_id", "items"} {
		for _, replacement := range []string{"missing", "null", "wrong type"} {
			t.Run(field+"/"+replacement, func(t *testing.T) {
				copy := make(map[string]json.RawMessage)
				for k, v := range fields {
					copy[k] = v
				}
				if replacement == "missing" {
					delete(copy, field)
				} else if replacement == "null" {
					copy[field] = json.RawMessage(`null`)
				} else {
					copy[field] = json.RawMessage(`true`)
				}
				raw, _ := json.Marshal(copy)
				m, e := decodeS3Manifest(context.Background(), raw, pinnedReference(raw))
				rejectPinned(t, m, e, ErrS3Manifest)
			})
		}
	}
}

func TestReadS3ManifestRejectsAmbiguousJSON(t *testing.T) {
	base := string(pinnedBytes(t, pinnedManifest()))
	prefix := base[:len(base)-1]
	cases := map[string]string{
		"top duplicate":          prefix + `,"generation":7}`,
		"escaped duplicate":      prefix + `,"gener\u0061tion":7}`,
		"case-insensitive field": strings.Replace(base, `"generation":`, `"Generation":`, 1),
		"unknown":                prefix + `,"PRIVATE_EXTRA":"secret"}`,
		"json revision":          prefix + `,"revision":"PRIVATE_REVISION"}`,
		"trailing value":         base + ` {}`, "trailing junk": base + ` PRIVATE`, "empty": "", "root array": "[]", "root null": "null",
		"invalid UTF8":            strings.Replace(base, "synthetic-device", "\xff", 1),
		"unpaired high surrogate": strings.Replace(base, `"synthetic-device"`, `"\ud800"`, 1),
		"unpaired low surrogate":  strings.Replace(base, `"synthetic-device"`, `"\udc00"`, 1),
		"reversed surrogate":      strings.Replace(base, `"synthetic-device"`, `"\udc00\ud800"`, 1),
		"bad surrogate partner":   strings.Replace(base, `"synthetic-device"`, `"\ud800\u0041"`, 1),
		"fractional generation":   strings.Replace(base, `"generation":7`, `"generation":7.0`, 1),
		"exponent version":        strings.Replace(base, `"version":1`, `"version":1e0`, 1),
		"overflow":                strings.Replace(base, `"generation":7`, `"generation":9223372036854775808`, 1),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			m, e := decodeS3Manifest(context.Background(), []byte(raw), pinnedReference([]byte(raw)))
			rejectPinned(t, m, e, ErrS3Manifest)
		})
	}
}

func TestReadS3ManifestRejectsItemsWithoutPartialManifest(t *testing.T) {
	m := pinnedManifest()
	m.Items = map[string]string{}
	base := string(pinnedBytes(t, m))
	for name, items := range map[string]string{
		"duplicate":         `{"one":"` + pinnedItemHash + `","one":"` + pinnedItemHash + `"}`,
		"escaped duplicate": `{"one":"` + pinnedItemHash + `","\u006fne":"` + pinnedItemHash + `"}`,
		"null hash":         `{"one":null}`, "hash type": `{"one":[]}`, "uppercase": `{"one":"` + strings.ToUpper(pinnedItemHash) + `"}`,
		"short hash": `{"one":"abc"}`, "blank key": `{" ":"` + pinnedItemHash + `"}`, "control key": `{"a\u0000":"` + pinnedItemHash + `"}`,
		"long key": `{"` + strings.Repeat("x", 1025) + `":"` + pinnedItemHash + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			raw := []byte(strings.Replace(base, `"items":{}`, `"items":`+items, 1))
			got, e := decodeS3Manifest(context.Background(), raw, pinnedReference(raw))
			rejectPinned(t, got, e, ErrS3Manifest)
		})
	}
}

func TestReadS3ManifestPreservesValidEscapesAndExactIDs(t *testing.T) {
	m := pinnedManifest()
	m.DeviceID = "设备😀"
	m.Items = map[string]string{"é": pinnedItemHash, "e\u0301": pinnedItemHash, "a\\b": pinnedItemHash, " quote\" ": pinnedItemHash, "literal\\uD800": pinnedItemHash}
	raw := pinnedBytes(t, m)
	raw = []byte(strings.Replace(string(raw), "😀", `\ud83d\ude00`, 1))
	got, e := decodeS3Manifest(context.Background(), raw, pinnedReference(raw))
	if e != nil {
		t.Fatal(e)
	}
	m.Revision = pinnedReference(raw).SHA256
	if !reflect.DeepEqual(got, m) {
		t.Fatal("valid identities changed")
	}
}

func TestReadS3ManifestLimitsAndContext(t *testing.T) {
	m := pinnedManifest()
	m.Items = make(map[string]string, MaxS3ManifestItems)
	for i := 0; i < MaxS3ManifestItems; i++ {
		m.Items[fmt.Sprint(i)] = pinnedItemHash
	}
	raw := pinnedBytes(t, m)
	got, e := decodeS3Manifest(context.Background(), raw, pinnedReference(raw))
	if e != nil || len(got.Items) != MaxS3ManifestItems {
		t.Fatal("exact item budget rejected")
	}
	m.Items["one-too-many"] = pinnedItemHash
	raw = pinnedBytes(t, m)
	got, e = decodeS3Manifest(context.Background(), raw, pinnedReference(raw))
	rejectPinned(t, got, e, ErrS3Manifest)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, e = decodeS3Manifest(ctx, []byte(`{}`), pinnedReference([]byte(`{}`)))
	rejectPinned(t, got, e, context.Canceled)
	// A caller's short byte budget is still enforced by the original network reader.
	small := pinnedBytes(t, pinnedManifest())
	client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(small) })
	got, e = ReadS3Manifest(context.Background(), client, pinnedReference(small), int64(len(small)-1))
	rejectPinned(t, got, e, syncs3.ErrTooLarge)
}

func TestReadS3ManifestHTTPFailuresDoNotInitializeStoreOrReplay(t *testing.T) {
	raw := pinnedBytes(t, pinnedManifest())
	for _, status := range []int{302, 401, 403, 404, 429, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", "/another-object")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, "PRIVATE_ERROR")
			})
			m, e := ReadS3Manifest(context.Background(), client, pinnedReference(raw), 4096)
			var httpError *syncs3.HTTPError
			if !errors.As(e, &httpError) || httpError.StatusCode != status || !reflect.DeepEqual(m, Manifest{}) || calls.Load() != 1 {
				t.Fatalf("unexpected error/initialization/replay: %v", e)
			}
		})
	}
}

func TestReadS3ManifestConcurrentPinsDoNotShareResults(t *testing.T) {
	raw := pinnedBytes(t, pinnedManifest())
	ref := pinnedReference(raw)
	var calls atomic.Int32
	client := pinnedClient(t, func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = w.Write(raw) })
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			pin := ref
			if i%2 == 1 {
				pin.StoreID = "different"
			}
			m, e := ReadS3Manifest(context.Background(), client, pin, 4096)
			if i%2 == 0 {
				if e != nil || m.Revision != ref.SHA256 {
					t.Error("correct pin rejected")
				}
				m.Items["local-mutation"] = pinnedItemHash
			} else if !errors.Is(e, ErrS3Manifest) || !reflect.DeepEqual(m, Manifest{}) {
				t.Error("foreign identity accepted")
			}
		}(i)
	}
	wg.Wait()
	if calls.Load() != 8 {
		t.Fatal("unexpected replay or shared cache")
	}
}

func TestReadS3ManifestCancellationReachesOwnedGET(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	client := pinnedClient(t, func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
			close(stopped)
		case <-time.After(3 * time.Second):
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	raw := pinnedBytes(t, pinnedManifest())
	go func() {
		m, e := ReadS3Manifest(ctx, client, pinnedReference(raw), 4096)
		if !reflect.DeepEqual(m, Manifest{}) {
			done <- errors.New("nonzero manifest")
			return
		}
		done <- e
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("request not started")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("wrong cancellation")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("read not cancelled")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("server request not cancelled")
	}
}
