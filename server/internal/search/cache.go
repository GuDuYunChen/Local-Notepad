package search

import (
	"container/list"
	"strings"
	"sync"
)

// DocumentCache is an optional, process-local LRU of parsed, immutable text.
// It is NOT a result cache or a persistent index: each request still reads and
// hashes current rows in its database read transaction. Never copy after use.
// Zero value is ready to use. Limits bound estimated retained data, not Go's heap.
type DocumentCache struct {
	mu                   sync.Mutex
	entries              map[[32]byte]*list.Element
	order                list.List
	bytes                int
	maxBytes, maxEntries int
}
type cachedDocument struct {
	key      [32]byte
	document Document
	size     int
}

const DefaultCacheBytes = 32 * 1024 * 1024
const DefaultCacheEntries = 2048

func (c *DocumentCache) limits() (int, int) {
	size, count := c.maxBytes, c.maxEntries
	if size <= 0 {
		size = DefaultCacheBytes
	}
	if count <= 0 {
		count = DefaultCacheEntries
	}
	return size, count
}
func cloneDocument(doc Document) Document {
	result := Document{Prose: strings.Clone(doc.Prose), Unsupported: doc.Unsupported}
	if doc.Extras != nil {
		result.Extras = make([]Field, len(doc.Extras))
		for i, field := range doc.Extras {
			result.Extras[i] = Field{strings.Clone(field.Kind), strings.Clone(field.Text)}
		}
	}
	return result
}
func copyDocument(doc Document) Document {
	// Strings are immutable, but callers must not mutate the cached slice.
	if doc.Extras != nil {
		doc.Extras = append([]Field{}, doc.Extras...)
	}
	return doc
}
func documentSize(doc Document) int {
	size := 256 + len(doc.Prose)
	for _, field := range doc.Extras {
		size += 64 + len(field.Kind) + len(field.Text)
	}
	return size
}
func (c *DocumentCache) extract(key [32]byte, content string) (Document, bool) {
	if c == nil {
		return Extract(content), false
	}
	c.mu.Lock()
	if entry := c.entries[key]; entry != nil {
		c.order.MoveToFront(entry)
		doc := copyDocument(entry.Value.(cachedDocument).document)
		c.mu.Unlock()
		return doc, true
	}
	c.mu.Unlock()
	doc := Extract(content)
	size := documentSize(doc)
	c.mu.Lock()
	defer c.mu.Unlock()
	maxBytes, maxEntries := c.limits()
	if size > maxBytes {
		return doc, false
	}
	// Concurrent misses may parse twice, but never keep duplicate cache entries.
	if entry := c.entries[key]; entry != nil {
		c.order.MoveToFront(entry)
		return doc, false
	}
	if c.entries == nil {
		c.entries = make(map[[32]byte]*list.Element)
	}
	for c.order.Len() > 0 && (c.bytes+size > maxBytes || c.order.Len() >= maxEntries) {
		oldest := c.order.Back()
		old := oldest.Value.(cachedDocument)
		c.bytes -= old.size
		delete(c.entries, old.key)
		c.order.Remove(oldest)
	}
	entry := cachedDocument{key, cloneDocument(doc), size}
	c.entries[key] = c.order.PushFront(entry)
	c.bytes += size
	return doc, false
}
