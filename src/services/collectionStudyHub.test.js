import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createCollectionStudyHub, selectCollectionStudyHub } from './collectionStudyHub'
import { createCollectionStudyStore, COLLECTION_STUDY_PREFIX } from './collectionStudy'
import { createSearchCollectionStore, SEARCH_COLLECTION_PREFIX } from './searchCollections'
import { memoryStorage, collectionReport } from '../test/collectionFixtures'

let storage, source, study, hub, counter
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); storage = memoryStorage(); counter = 0
  source = createSearchCollectionStore({ storage: () => storage, createId: () => 'c' + (++counter) })
  study = createCollectionStudyStore({ storage: () => storage, locks: () => ({ request: (_name, _options, callback) => Promise.resolve().then(callback) }) })
  hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function add(name = '设定资料', count = 23) {
  const value = source.save(name, collectionReport(count))
  return source.list().entries.find(row => row.collection.id === value.id)
}
const save = async (entry, id = 'n22', status = 'revisit', note = '需要复看') => study.saveNote(await study.load(entry, source), id, status, note, { sourceStore: source })

it('empty storage is a complete empty view and does not create keys', async () => {
  const result = await hub.load(); expect(result.counts.total).toBe(0); expect(result.issues).toEqual([]); expect(storage.length).toBe(0)
})
it('aggregates untouched items without implying they were read', async () => {
  add(); const result = await hub.load()
  expect(result.counts).toEqual({ total: 23, unread: 23, read: 0, revisit: 0, notes: 0, bookmarks: 0 })
  expect(storage.length).toBe(1)
})
it('same note ID across collections retains separate provenance and annotations', async () => {
  const a = add('人物'), b = add('地点')
  await save(a, 'n22', 'read', '甲批注'); await save(b, 'n22', 'revisit', '乙批注')
  const result = await hub.load(), view = selectCollectionStudyHub(result, { notesOnly: true })
  expect(result.counts.total).toBe(46); expect(result.counts.read).toBe(1); expect(result.counts.revisit).toBe(1)
  expect(view.rows).toHaveLength(2); expect(new Set(view.rows.map(row => row.key)).size).toBe(2)
  expect(view.rows.map(row => row.note).sort()).toEqual(['乙批注', '甲批注'].sort())
})
it('bookmark-only records remain unread and do not count as annotations', async () => {
  const entry = add(); await study.bookmark(await study.load(entry, source), 'n5', { sourceStore: source })
  const result = await hub.load(); expect(result.counts.bookmarks).toBe(1); expect(result.counts.notes).toBe(0); expect(result.counts.read).toBe(0)
})
it('Unicode-normalized case-insensitive search preserves original annotation text', async () => {
  const entry = add(); await save(entry, 'n3', 'read', '  E\u0301LODIE\n😀  ')
  const view = selectCollectionStudyHub(await hub.load(), { query: 'élodie' })
  expect(view.total).toBe(1); expect(view.rows[0].note).toBe('  E\u0301LODIE\n😀  ')
})
it('search covers collection name, title, directory and note identity', async () => {
  add('关关材料'); const model = await hub.load()
  for (const query of ['关关', '旧卷']) expect(selectCollectionStudyHub(model, { query }).total).toBe(23)
  expect(selectCollectionStudyHub(model, { query: '章节 22' }).total).toBe(1)
  expect(selectCollectionStudyHub(model, { query: 'n22' }).rows[0].id).toBe('n22')
})
it('status, collection and notes-only filters compose', async () => {
  const a = add(), b = add(); await save(a); await save(b, 'n21', 'read', '已经读完')
  const model = await hub.load()
  expect(selectCollectionStudyHub(model, { notesOnly: true, status: 'revisit', collectionKey: a.key }).total).toBe(1)
  expect(selectCollectionStudyHub(model, { status: 'read', collectionKey: a.key }).total).toBe(0)
})
it('deleted filter scope never silently broadens to all collections', async () => {
  add(); expect(selectCollectionStudyHub(await hub.load(), { collectionKey: 'missing' }).total).toBe(0)
})
it('pagination reaches the end with bounded invalid page inputs', async () => {
  add('资料', 65); const model = await hub.load()
  const view = selectCollectionStudyHub(model, { page: 100, sort: 'collection' })
  expect(view.page).toBe(6); expect(view.rows.at(-1).id).toBe('n64'); expect(view.rows.length).toBe(5)
  expect(selectCollectionStudyHub(model, { page: NaN }).page).toBe(1)
  expect(selectCollectionStudyHub(model, { query: '没有' }).pages).toBe(1)
})
it('recent-note sort and original-order sort are independent', async () => {
  const entry = add(); await save(entry, 'n20'); const model = await hub.load()
  expect(selectCollectionStudyHub(model).rows[0].id).toBe('n20')
  expect(selectCollectionStudyHub(model, { sort: 'collection' }).rows[0].id).toBe('n0')
})
it('unreadable study data are visible diagnostics and kept byte-for-byte', async () => {
  const a = add(), b = add(); storage.setItem(COLLECTION_STUDY_PREFIX + a.collection.id, 'broken')
  const result = await hub.load()
  expect(result.sourceCount).toBe(2); expect(result.collections.length).toBe(1); expect(result.rows.length).toBe(23)
  expect(result.issues.length).toBe(1); expect(storage.getItem(COLLECTION_STUDY_PREFIX + a.collection.id)).toBe('broken')
  expect(b.collection.id).toBe(result.collections[0].id)
})
it('corrupt collection keys are counted but not falsely shown as empty collections', async () => {
  storage.setItem(SEARCH_COLLECTION_PREFIX + 'bad', '{}'); const model = await hub.load()
  expect(model.sourceCount).toBe(1); expect(model.collections).toEqual([]); expect(model.issues).toHaveLength(1)
})
it('orphan and interrupted restore keys are reported, never parsed as valid annotations or deleted', async () => {
  storage.setItem(COLLECTION_STUDY_PREFIX + 'orphan', '{"note":"私密"}'); const model = await hub.load()
  expect(model.rows).toEqual([]); expect(model.issues[0].reason).toContain('缺少来源'); expect(JSON.stringify(model)).not.toContain('私密')
  expect(storage.length).toBe(1)
})
it('unavailable storage rejects rather than claiming there are no annotations', async () => {
  const broken = createCollectionStudyHub({ storage: () => { throw new Error('denied') } })
  await expect(broken.load()).rejects.toThrow('denied')
})
it('shelf errors are surfaced rather than converted into a complete report', async () => {
  const broken = createCollectionStudyHub({ storage: () => storage, sourceStore: { list: () => ({ error: 'denied', entries: [] }) } })
  await expect(broken.load()).rejects.toThrow('denied')
})
it('a pre-cancelled load does not read storage', async () => {
  const read = vi.fn(), cancelled = createCollectionStudyHub({ storage: read }), controller = new AbortController(); controller.abort()
  await expect(cancelled.load({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(read).not.toHaveBeenCalled()
})
it('cancelling while a study record is loading discards the aggregate', async () => {
  add(); const controller = new AbortController(), real = study.load
  vi.spyOn(study, 'load').mockImplementation(async (...args) => { const value = await real(...args); controller.abort(); return value })
  await expect(hub.load({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
})
it('detects additions while asynchronous fingerprints are being computed', async () => {
  add(); const pending = hub.load(); add('后来加入'); await expect(pending).rejects.toThrow('发生变化')
})
it('detects changed record bytes without requiring a storage event', async () => {
  const entry = add(); await save(entry); const model = await hub.load(); await save(entry, 'n2')
  expect(() => hub.assertCurrent(model)).toThrow('变化'); expect(() => hub.locate(model, model.rows[0].key)).toThrow('变化')
})
it('ignores unrelated theme settings when checking staleness', async () => {
  add(); const model = await hub.load(); storage.setItem('theme', 'dark'); expect(hub.assertCurrent(model)).toBe(model)
})
it('refuses more than forty collection keys without silently truncating', async () => {
  for (let i = 0; i < 41; i++) storage.setItem(SEARCH_COLLECTION_PREFIX + i, 'bad')
  await expect(hub.load()).rejects.toThrow('40')
})
it('returns an immutable aggregate and selection does not change its ordering', async () => {
  add(); const model = await hub.load(), first = model.rows[0].key
  expect(Object.isFrozen(model.rows[0])).toBe(true); selectCollectionStudyHub(model, { sort: 'updated' }); expect(model.rows[0].key).toBe(first)
})
it('locates the exact source collection rather than another same-title note', async () => {
  const a = add(), b = add(); const model = await hub.load(), row = model.rows.find(item => item.collectionId === b.collection.id && item.id === 'n22')
  expect(hub.locate(model, row.key)).toEqual({ entry: { key: b.key, raw: b.raw }, documentId: 'n22' })
  expect(a.key).not.toBe(b.key)
})
it('forged or another-service snapshots cannot authorize a locate or export', async () => {
  add(); const model = await hub.load(); expect(() => hub.locate({ ...model }, model.rows[0].key)).toThrow()
  const other = createCollectionStudyHub({ storage: () => storage }); expect(() => other.assertCurrent(model)).toThrow()
})
it('full filtered JSON exports all pages with exact Unicode notes and no raw history payload', async () => {
  const entry = add('资料', 65); await save(entry, 'n64', 'revisit', '末页\n😀')
  const model = await hub.load(), output = hub.export(model, { page: 6, sort: 'collection' }, 'json'), report = JSON.parse(output.text)
  expect(report.count).toBe(65); expect(report.items.at(-1).note).toBe('末页\n😀'); expect(report.scope).not.toHaveProperty('page')
  for (const field of ['entry', 'raw', 'contentSHA256', 'report', 'snippets']) expect(report.items[0]).not.toHaveProperty(field)
})
it('filtered report does not accidentally export other collections or unselected statuses', async () => {
  const a = add(), b = add(); await save(a); await save(b, 'n20', 'read', '不导出')
  const report = JSON.parse(hub.export(await hub.load(), { collectionKey: a.key, notesOnly: true, status: 'revisit' }, 'json').text)
  expect(report.count).toBe(1); expect(report.items[0].note).toBe('需要复看'); expect(JSON.stringify(report)).not.toContain('不导出')
})
it('Markdown escapes hostile-looking markup and preserves explicit provenance', async () => {
  const entry = add('<img src=x>'); await save(entry, 'n22', 'read', '[点击](javascript:alert(1))\n# fake <script>')
  const output = hub.export(await hub.load(), { notesOnly: true }).text
  expect(output).not.toContain('<script>'); expect(output).not.toContain('[点击]('); expect(output).toContain('&lt;img'); expect(output).toContain('n22')
})
it('incomplete, stale, empty or unsupported exports fail without touching storage', async () => {
  const entry = add(), model = await hub.load(), before = storage.getItem(entry.key)
  expect(() => hub.export(model, { query: '没有' })).toThrow('没有'); expect(() => hub.export(model, {}, 'html')).toThrow('格式')
  storage.setItem(COLLECTION_STUDY_PREFIX + 'orphan', 'x'); expect(() => hub.export(model, {})).toThrow('变化')
  expect(() => hub.export(hub.assertCurrent, {})).toThrow()
  const partial = await hub.load(); expect(() => hub.export(partial, {})).toThrow('未关联'); expect(storage.getItem(entry.key)).toBe(before)
})
it('the forty-collection, eighty-thousand-entry boundary keeps exact counts', async () => {
  // Seed validated serialized collections directly to avoid quadratic fixture-save/list overhead.
  const seed = add('规模基准', 2000), template = JSON.parse(seed.raw)
  storage.removeItem(seed.key)
  for (let i = 0; i < 40; i++) storage.setItem(SEARCH_COLLECTION_PREFIX + 'scale-' + i, JSON.stringify({ ...template, id: 'scale-' + i, name: '资料' + i }))
  const model = await hub.load(); expect(model.counts.total).toBe(80000); expect(model.counts.unread).toBe(80000)
  expect(selectCollectionStudyHub(model, { page: 999999 }).page).toBe(6667)
  expect(() => hub.export(model, {}, 'json')).toThrow('8 MiB')
}, 30000)
