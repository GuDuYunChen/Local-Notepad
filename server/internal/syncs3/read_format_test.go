package syncs3

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func formattingCredentials() Credentials {
	// Synthetic sentinels, not real account credentials. A failing assertion must
	// never print a formatted client, a signature or a sentinel's contents.
	return Credentials{AccessKeyID: "FORMATACCESS42", SecretAccessKey: "FORMATSECRET42", SessionToken: "FORMATTOKEN42"}
}
func formattingClient(t *testing.T) *ReadClient {
	t.Helper()
	c, err := NewReadClient(testConfig(), formattingCredentials())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.CloseIdleConnections)
	return c
}
func containsFormattingSecret(out string) bool {
	c := formattingCredentials()
	for _, marker := range []string{c.AccessKeyID, c.SecretAccessKey, c.SessionToken} {
		encoded := hex.EncodeToString([]byte(marker))
		if strings.Contains(out, marker) || strings.Contains(out, encoded) || strings.Contains(out, strings.ToUpper(encoded)) {
			return true
		}
	}
	return false
}
func requireFormattingRedacted(t *testing.T, out string) {
	t.Helper()
	if containsFormattingSecret(out) {
		t.Fatal("client formatting exposed a synthetic credential")
	}
}

func TestReadClientValueFormattingRedactsCredentials(t *testing.T) {
	c := formattingClient(t)
	for _, format := range []string{"%v", "%+v", "%#v"} {
		t.Run(format, func(t *testing.T) { requireFormattingRedacted(t, fmt.Sprintf(format, *c)) })
	}
}

func TestReadClientFormatterAppliesToValueAndPointer(t *testing.T) {
	c := formattingClient(t)
	for _, tc := range []struct {
		name  string
		value any
	}{{"value", *c}, {"pointer", c}} {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := tc.value.(fmt.Formatter); !ok {
				t.Fatal("client must implement fmt.Formatter in both method sets")
			}
			for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%X", "%d", "%f", "%40v", "%.8v", "%#40.8v"} {
				t.Run(verb, func(t *testing.T) {
					out := fmt.Sprintf(verb, tc.value)
					requireFormattingRedacted(t, out)
					if out != "[S3 read client redacted]" {
						t.Fatal("direct formatting did not return the fixed redaction")
					}
				})
			}
		})
	}
}

func TestReadClientFormattingShapesDoNotRevealCredentials(t *testing.T) {
	c := formattingClient(t)
	// fmt deliberately bypasses methods on unexported fields. Cover private
	// wrappers too; changing just Format's receiver is not sufficient for them.
	shapes := []struct {
		name  string
		value any
	}{
		{"interface-value", any(*c)}, {"interface-pointer", any(c)},
		{"slice-values", []ReadClient{*c}}, {"slice-pointers", []*ReadClient{c}},
		{"map-value", map[string]ReadClient{"client": *c}}, {"map-pointer", map[string]*ReadClient{"client": c}},
		{"public-field", struct{ Client ReadClient }{*c}}, {"public-pointer-field", struct{ Client *ReadClient }{c}},
		{"private-field", struct{ client ReadClient }{*c}}, {"private-pointer-field", struct{ client *ReadClient }{c}},
		{"private-array", struct{ clients [1]ReadClient }{[1]ReadClient{*c}}},
	}
	for _, tc := range shapes {
		t.Run(tc.name, func(t *testing.T) {
			for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%X"} {
				t.Run(verb, func(t *testing.T) { requireFormattingRedacted(t, fmt.Sprintf(verb, tc.value)) })
			}
		})
	}
}

func TestReadClientStandardLoggingAndJSONRemainRedacted(t *testing.T) {
	c := formattingClient(t)
	for _, tc := range []struct {
		name  string
		value any
	}{{"value", *c}, {"pointer", c}, {"private-field", struct{ client ReadClient }{*c}}} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			logger := log.New(&out, "", 0)
			logger.Print(tc.value)
			logger.Println(tc.value)
			logger.Printf("client=%#v", tc.value)
			requireFormattingRedacted(t, out.String())
			out.Reset()
			slog.New(slog.NewTextHandler(&out, nil)).Info("test", "client", tc.value)
			requireFormattingRedacted(t, out.String())
			out.Reset()
			slog.New(slog.NewJSONHandler(&out, nil)).Info("test", "client", tc.value)
			requireFormattingRedacted(t, out.String())
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal("JSON formatting failed")
			}
			requireFormattingRedacted(t, string(raw))
			requireFormattingRedacted(t, fmt.Sprint(tc.value))
			requireFormattingRedacted(t, fmt.Sprintln(tc.value))
			requireFormattingRedacted(t, fmt.Errorf("client=%#v", tc.value).Error())
			// Extra-argument diagnostics must not revert to printing private fields.
			pattern := "no-placeholders"
			requireFormattingRedacted(t, fmt.Sprintf(pattern, tc.value))
		})
	}
}

func TestReadClientNilAndZeroFormattingIsSafe(t *testing.T) {
	var nilClient *ReadClient
	for _, tc := range []struct {
		name  string
		value any
	}{{"nil-pointer", nilClient}, {"zero-value", ReadClient{}}, {"zero-pointer", &ReadClient{}}} {
		t.Run(tc.name, func(t *testing.T) {
			for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%T", "%p"} {
				out := fmt.Sprintf(verb, tc.value)
				requireFormattingRedacted(t, out)
				if strings.Contains(out, "PANIC=") {
					t.Fatal("formatting raised a panic diagnostic")
				}
			}
		})
	}
}

func TestReadClientFormattingHasNoIOOrClockEffects(t *testing.T) {
	c := formattingClient(t)
	var requests, clocks atomic.Int32
	c.client.Transport = roundTripper(func(*http.Request) (*http.Response, error) { requests.Add(1); return response(200, "ok"), nil })
	c.now = func() time.Time { clocks.Add(1); return time.Unix(0, 0) }
	copyOfClient := *c
	var workers sync.WaitGroup
	var leaked atomic.Bool
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for j := 0; j < 40; j++ {
				for _, value := range []any{c, copyOfClient, struct{ client ReadClient }{copyOfClient}} {
					if containsFormattingSecret(fmt.Sprintf("%#v", value)) {
						leaked.Store(true)
					}
				}
			}
		}()
	}
	workers.Wait()
	if leaked.Load() {
		t.Fatal("concurrent formatting exposed a synthetic credential")
	}
	if requests.Load() != 0 || clocks.Load() != 0 {
		t.Fatal("formatting performed IO or signing work")
	}
	if c.client != copyOfClient.client || c.endpoint != copyOfClient.endpoint {
		t.Fatal("formatting mutated the client")
	}
}

func TestReadClientFormattedCopyKeepsSignedReadAndCallerIsolation(t *testing.T) {
	var calls atomic.Int32
	var unexpected atomic.Bool
	var wantedAuthorization string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		if req.Method != "GET" || req.URL.Path != "/examplebucket/key" || req.Header.Get("Authorization") != wantedAuthorization ||
			req.Header.Get("X-Amz-Security-Token") != formattingCredentials().SessionToken {
			unexpected.Store(true)
		}
		w.Header().Set("ETag", `"opaque"`)
		_, _ = io.WriteString(w, "ok")
	}))
	defer srv.Close()
	cfg := testConfig()
	cfg.Endpoint = srv.URL
	input := formattingCredentials()
	c, err := NewReadClient(cfg, input)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseIdleConnections()
	at := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return at }
	request, _ := http.NewRequest("GET", srv.URL+"/examplebucket/key", nil)
	signRead(request, formattingCredentials(), cfg.Region, at)
	wantedAuthorization = request.Header.Get("Authorization")
	// NewReadClient must own the input value; neither caller reassignment nor
	// formatting may change the credentials subsequently used for signing.
	input.AccessKeyID = "CHANGED"
	input.SecretAccessKey = "CHANGED"
	input.SessionToken = "CHANGED"
	copyOfClient := *c
	requireFormattingRedacted(t, fmt.Sprintf("%#v", copyOfClient))
	for _, client := range []*ReadClient{c, &copyOfClient} {
		object, err := client.GetObject(context.Background(), "key", 2)
		if err != nil || string(object.Bytes) != "ok" || object.ETag != `"opaque"` {
			t.Fatal("formatted client changed explicit read behavior")
		}
	}
	if calls.Load() != 2 || unexpected.Load() {
		t.Fatal("wrong request, signature or credential ownership")
	}
}

func TestReadClientMissingCredentialStorageFailsBeforeIO(t *testing.T) {
	var calls atomic.Int32
	c := ReadClient{client: &http.Client{Transport: roundTripper(func(*http.Request) (*http.Response, error) { calls.Add(1); return response(200, ""), nil })}, now: time.Now}
	object, err := c.GetObject(context.Background(), "key", 2)
	if !errors.Is(err, ErrConfig) || object.Bytes != nil || object.ETag != "" || calls.Load() != 0 {
		t.Fatal("uninitialized credential storage was not rejected before IO")
	}
}
