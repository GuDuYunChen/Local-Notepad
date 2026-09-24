import { createSearchCollectionStore, SEARCH_COLLECTION_PREFIX } from '../services/searchCollections'

export function memoryStorage() {
  const values = new Map()
  return { get length() { return values.size }, key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}
export function collectionReport(count = 23, patch = {}) {
  const items = Array.from({ length: count }, (_, i) => ({ id: 'n' + i, title: '章节 ' + i, folderPath: '旧卷', updatedAt: 1,
    pinned: false, titleMatch: false, bodyOccurrences: 0, contentSHA256: 'a'.repeat(64) }))
  return { format: 'local-notepad-search-results', version: 1, exportedAt: '2026-09-24T07:00:00.000Z', mode: 'all', includeSnippets: false,
    scope: { criteria: { query: '', source: 'all', folderId: '', since: 0, pinned: false, matchCase: false, sort: 'relevance' },
      revision: 'b'.repeat(64), total: count, pages: Math.max(1, Math.ceil(count / 20)), pageSize: 20,
      totalOccurrences: 0, scanned: count, unsupported: 0, folderLabel: '全部目录' }, count, exportedBodyOccurrences: 0, items, ...patch }
}
export function collectionFixture(count = 23) {
  const storage = memoryStorage()
  const store = createSearchCollectionStore({ storage: () => storage, createId: () => 'sample-collection', now: () => new Date('2026-09-24T07:01:00.000Z') })
  const collection = store.save('设定资料', collectionReport(count))
  return { store, storage, collection, entry: store.list().entries[0], key: SEARCH_COLLECTION_PREFIX + collection.id }
}
