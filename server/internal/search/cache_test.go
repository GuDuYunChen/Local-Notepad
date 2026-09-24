package search

import (
	"context"
	"crypto/sha256"
	"fmt"
	"notepad-server/internal/model"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func cached(c *DocumentCache, s string) (Document, bool) {
	return c.extract(sha256.Sum256([]byte(s)), s)
}
func cachedRun(t *testing.T, c *DocumentCache, files []model.File, bodies map[string]string, o Options) Response {
	t.Helper()
	e, err := NewWithCache(o, files, c)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if !f.IsFolder && !f.IsDeleted {
			if err = e.Add(context.Background(), f.ID, bodies[f.ID]); err != nil {
				t.Fatal(err)
			}
		}
	}
	r, err := e.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestDocumentCacheZeroValueAndHit(t *testing.T) {
	var c DocumentCache
	first, hit := cached(&c, "关关来了")
	if hit {
		t.Fatal("cold hit")
	}
	next, hit := cached(&c, "关关来了")
	if !hit || !reflect.DeepEqual(first, next) {
		t.Fatal(next, hit)
	}
}
func TestDocumentCacheSameSizeChangeUsesCurrentHash(t *testing.T) {
	var c DocumentCache
	cached(&c, "old text")
	doc, hit := cached(&c, "new text")
	if hit || doc.Prose != "new text" {
		t.Fatal(doc, hit)
	}
}
func TestDocumentCacheSharedContentsAreReusable(t *testing.T) {
	var c DocumentCache
	files := []model.File{{ID: "a", Title: "A"}, {ID: "b", Title: "B"}}
	r := cachedRun(t, &c, files, map[string]string{"a": "same", "b": "same"}, Options{Query: "same"})
	if r.Total != 2 || r.Parsed != 1 || r.CacheHits != 1 {
		t.Fatal(r)
	}
}
func TestDocumentCacheDoesNotAliasSlices(t *testing.T) {
	var c DocumentCache
	source := `{"root":{"type":"root","children":[{"type":"code-block","code":"safe"}]}}`
	doc, _ := cached(&c, source)
	doc.Extras[0].Text = "changed"
	doc, _ = cached(&c, source)
	if doc.Extras[0].Text != "safe" {
		t.Fatal(doc)
	}
	doc.Extras[0].Text = "changed again"
	doc, _ = cached(&c, source)
	if doc.Extras[0].Text != "safe" {
		t.Fatal(doc)
	}
}
func TestDocumentCacheEntryLRUEviction(t *testing.T) {
	c := DocumentCache{maxEntries: 2}
	cached(&c, "a")
	cached(&c, "b")
	cached(&c, "a")
	cached(&c, "c")
	if _, hit := cached(&c, "a"); !hit {
		t.Fatal("recent evicted")
	}
	if _, hit := cached(&c, "b"); hit {
		t.Fatal("old not evicted")
	}
	if c.order.Len() > 2 {
		t.Fatal(c.order.Len())
	}
}
func TestDocumentCacheByteBudgetAndOversizeBypass(t *testing.T) {
	c := DocumentCache{maxBytes: 600}
	cached(&c, strings.Repeat("a", 100))
	cached(&c, strings.Repeat("b", 100))
	if c.bytes > 600 || c.order.Len() != 1 {
		t.Fatal(c.bytes, c.order.Len())
	}
	cached(&c, strings.Repeat("c", 2000))
	if c.bytes > 600 || c.order.Len() != 1 {
		t.Fatal("oversize retained")
	}
	if _, hit := cached(&c, strings.Repeat("b", 100)); !hit {
		t.Fatal("oversize evicted valid entry")
	}
}
func TestDocumentCacheUnsupportedRemainsUnsupported(t *testing.T) {
	var c DocumentCache
	cached(&c, `{"root":`)
	doc, hit := cached(&c, `{"root":`)
	if !hit || !doc.Unsupported {
		t.Fatal(doc, hit)
	}
}
func TestDocumentCacheResultsEqualUncachedAcrossQueries(t *testing.T) {
	var c DocumentCache
	files := []model.File{{ID: "p", Title: "项目", IsFolder: true}, {ID: "a", Title: "关关", ParentID: "p"}, {ID: "b", Title: "Alice"}}
	bodies := map[string]string{"a": `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"关"},{"type":"text","text":"关 Alpha"}]}]}}`, "b": "Alpha A+B"}
	for _, q := range []string{"关关", "ALPHA", "A+B", "no match", ""} {
		for _, src := range []string{"all", "title", "body"} {
			o := Options{Query: q, Source: src, PageSize: 1}
			a := cachedRun(t, nil, files, bodies, o)
			b := cachedRun(t, &c, files, bodies, o)
			a.Parsed = 0
			b.Parsed = 0
			b.CacheHits = 0
			if !reflect.DeepEqual(a, b) {
				t.Fatal(q, src, a, b)
			}
		}
	}
}
func TestDocumentCacheNeverCachesResultsOrSkipsRevision(t *testing.T) {
	var c DocumentCache
	files := []model.File{{ID: "a", Title: "a"}}
	bodies := map[string]string{"a": "needle"}
	r := cachedRun(t, &c, files, bodies, Options{Query: "needle"})
	bodies["a"] = "absent"
	e, _ := NewWithCache(Options{Query: "needle", Revision: r.Revision}, files, &c)
	e.Add(context.Background(), "a", bodies["a"])
	if _, err := e.Finish(); err != ErrChanged {
		t.Fatal(err)
	}
	updated := cachedRun(t, &c, files, bodies, Options{Query: "needle"})
	if updated.Total != 0 {
		t.Fatal(updated)
	}
}
func TestDocumentCacheTitleOnlyAndEmptyQueryDoNotParse(t *testing.T) {
	var c DocumentCache
	files := []model.File{{ID: "a", Title: "name"}}
	for _, o := range []Options{{Query: "name", Source: "title"}, {}} {
		r := cachedRun(t, &c, files, map[string]string{"a": "anything"}, o)
		if r.Parsed != 0 || r.CacheHits != 0 {
			t.Fatal(r)
		}
	}
	if c.order.Len() != 0 {
		t.Fatal("unexpected parse")
	}
}
func TestDocumentCacheFilteredNotesDoNotEnterCache(t *testing.T) {
	var c DocumentCache
	files := []model.File{{ID: "a", Title: "a", IsPinned: true}, {ID: "b", Title: "b"}}
	r := cachedRun(t, &c, files, map[string]string{"a": "inside", "b": "outside"}, Options{Query: "inside", Pinned: true})
	if r.Scanned != 1 || c.order.Len() != 1 {
		t.Fatal(r, c.order.Len())
	}
}
func TestDocumentCacheCancellationDoesNotBecomeSuccess(t *testing.T) {
	var c DocumentCache
	cached(&c, "needle")
	e, _ := NewWithCache(Options{Query: "needle"}, []model.File{{ID: "a"}}, &c)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := e.Add(ctx, "a", "needle"); err != context.Canceled {
		t.Fatal(err)
	}
}
func TestDocumentCacheConcurrentAccess(t *testing.T) {
	c := DocumentCache{maxEntries: 8, maxBytes: 10000}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				value := fmt.Sprintf("content %d", (i+j)%16)
				doc, _ := cached(&c, value)
				if doc.Prose != value {
					t.Error("wrong content")
				}
			}
		}(i)
	}
	wg.Wait()
	if c.order.Len() > 8 || c.bytes > 10000 {
		t.Fatal(c.order.Len(), c.bytes)
	}
}
func TestDocumentCacheNewInstanceDoesNotRetainAnotherLibrary(t *testing.T) {
	var a, b DocumentCache
	cached(&a, "private")
	if _, hit := cached(&b, "private"); hit {
		t.Fatal("global cache leaked")
	}
}
func BenchmarkParsedSearch(b *testing.B) {
	source := `{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"` + strings.Repeat("青崖晨市里的来往行人。", 150) + `关关"}]}]}}`
	for _, warm := range []bool{false, true} {
		b.Run(fmt.Sprintf("cache=%v", warm), func(b *testing.B) {
			var c *DocumentCache
			if warm {
				c = &DocumentCache{}
				cached(c, source)
			}
			files := []model.File{{ID: "a", Title: "chapter"}}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				e, _ := NewWithCache(Options{Query: "关关"}, files, c)
				if err := e.Add(context.Background(), "a", source); err != nil {
					b.Fatal(err)
				}
				e.Finish()
			}
		})
	}
}
