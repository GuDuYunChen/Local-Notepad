import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createCollectionStudyBatch } from './collectionStudyBatch'
import { createCollectionStudyHub } from './collectionStudyHub'
import { createCollectionStudyStore, COLLECTION_STUDY_PREFIX } from './collectionStudy'
import { createSearchCollectionStore } from './searchCollections'
import { studyDraftKey } from './collectionStudyDrafts'
import { collectionReport, memoryStorage } from '../test/collectionFixtures'

let storage, source, study, hub, batch, drafts, clock, counter, locks
function add(name = '资料集', count = 23) {
  const c = source.save(name, collectionReport(count)); return source.list().entries.find(e => e.collection.id === c.id)
}
const save = async (entry, id, status = 'revisit', note = '原批注\n中文😀') =>
  study.saveNote(await study.load(entry, source), id, status, note, { sourceStore: source })
const load = entry => study.load(entry, source)
const statuses = snapshot => Object.fromEntries(snapshot.data.records.map(item => [item.id, item.status]))
async function prepare(keys, status = 'read') { const model = await hub.load(); return batch.prepare(model, keys ?? model.rows.map(row => row.key).sort(), status) }
beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_alg, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  storage = memoryStorage(); clock = 0; counter = 0; drafts = new Map()
  const tails = new Map()
  locks = { request: vi.fn((name, options, fn) => {
    const current = (tails.get(name) || Promise.resolve()).catch(() => {}).then(() => {
      if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return fn()
    })
    tails.set(name, current); return current
  }) }
  source = createSearchCollectionStore({ storage: () => storage, createId: () => 'c' + (++counter) })
  study = createCollectionStudyStore({ storage: () => storage, locks: () => locks, now: () => new Date(1700000000000 + clock++ * 1000) })
  hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study })
  batch = createCollectionStudyBatch({ hub, sourceStore: source, studyStore: study, drafts })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('previews every selected page without writes and preserves same-note provenance', async () => {
  const a = add('同名'), b = add('同名'); await save(a, 'n22'); await save(b, 'n22', 'unread', '另一批注')
  const model = await hub.load(), keys = model.rows.filter(row => row.id === 'n0' || row.id === 'n22').map(row => row.key)
  const spy = vi.spyOn(storage, 'setItem'), preview = await batch.prepare(model, keys, 'read')
  expect(preview.total).toBe(4); expect(preview.collectionCount).toBe(2); expect(preview.changed).toBe(4)
  expect(new Set(preview.items.map(row => row.key)).size).toBe(4); expect(spy).not.toHaveBeenCalled()
  expect(Object.isFrozen(preview.items[0])).toBe(true)
})
it('updates selected statuses only and preserves exact notes, bookmarks, sources and unrelated records', async () => {
  const a = add(), b = add(); await save(a, 'n0'); const prior = await save(a, 'n22', 'read', '未选批注')
  await save(b, 'n0', 'unread', '<script>数据</script>')
  const rawA = storage.getItem(a.key), rawB = storage.getItem(b.key)
  const model = await hub.load(), keys = model.rows.filter(r => r.id === 'n0').map(r => r.key)
  const result = await batch.apply(await batch.prepare(model, keys, 'read'))
  expect(result).toMatchObject({ changed: 2, remaining: 0, failures: [] })
  const after = await load(a)
  expect(after.data.bookmark).toEqual(prior.data.bookmark)
  expect(after.data.records.find(r => r.id === 'n0').note).toBe('原批注\n中文😀')
  expect(after.data.records.find(r => r.id === 'n22')).toEqual(prior.data.records.find(r => r.id === 'n22'))
  expect((await load(b)).data.records[0].note).toBe('<script>数据</script>')
  expect(storage.getItem(a.key)).toBe(rawA); expect(storage.getItem(b.key)).toBe(rawB)
})
it('each collection writes once even for many selected entries', async () => {
  add('A', 100); add('B', 100); const p = await prepare(), spy = vi.spyOn(storage, 'setItem')
  const result = await batch.apply(p); expect(result.changed).toBe(200); expect(spy).toHaveBeenCalledTimes(2)
})
it('no-op selections do not write, create an empty record or notify listeners', async () => {
  const a = add(); const listener = vi.fn(); study.subscribe(listener)
  const spy = vi.spyOn(storage, 'setItem'), snapshot = await load(a)
  expect(await study.setStatuses(snapshot, [{ id: 'n0', status: 'unread' }], { sourceStore: source })).toBe(snapshot)
  expect(await batch.apply(await prepare(null, 'unread'))).toMatchObject({ changed: 0, unchanged: 23 })
  expect(spy).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled(); expect(storage.getItem(snapshot.key)).toBeNull()
})
it('returning to unread keeps a note but removes an empty artificial marker', async () => {
  const a = add(); await save(a, 'n0', 'read', '保留'); await save(a, 'n1', 'read', '')
  await batch.apply(await prepare(null, 'unread')); const data = (await load(a)).data
  expect(data.records).toHaveLength(1); expect(data.records[0]).toMatchObject({ id: 'n0', note: '保留', status: 'unread' })
  expect(data.bookmark.id).toBe('n1')
})
it('full undo restores original statuses, preserves notes/bookmark, and cannot replay successful groups', async () => {
  const a = add('A', 2), b = add('B', 2); const beforeA = await save(a, 'n0'), beforeB = await save(b, 'n1', 'read', 'B')
  const result = await batch.apply(await prepare(null, 'read'))
  expect(result).toMatchObject({ changed: 3, unchanged: 1 })
  expect(await batch.undo(result)).toMatchObject({ restored: 3, remaining: 0, failures: [] })
  expect(statuses(await load(a))).toEqual(statuses(beforeA)); expect(statuses(await load(b))).toEqual(statuses(beforeB))
  expect((await load(a)).data.bookmark).toEqual(beforeA.data.bookmark)
  const spy = vi.spyOn(storage, 'setItem'); expect((await batch.undo(result)).restored).toBe(0); expect(spy).not.toHaveBeenCalled()
})
it('a subsequent note save blocks undo of that collection but not independent collections', async () => {
  const a = add('A', 2), b = add('B', 2); const result = await batch.apply(await prepare())
  await save(a, 'n0', 'read', '后来新批注'); const after = (await load(a)).raw
  const undo = await batch.undo(result)
  expect(undo).toMatchObject({ restored: 2, remaining: 2 }); expect(undo.failures[0].reason).toContain('更新')
  expect((await load(a)).raw).toBe(after); expect(statuses(await load(b))).toEqual({})
})
it('a bookmark saved after the batch also blocks stale undo', async () => {
  const a = add('A', 1); const result = await batch.apply(await prepare())
  await study.bookmark(await load(a), 'n0', { sourceStore: source })
  expect((await batch.undo(result)).remaining).toBe(1); expect(statuses(await load(a)).n0).toBe('read')
})
it('storage quota failure retains successful groups and exact remaining counts', async () => {
  const a = add('A', 2), b = add('B', 3), p = await prepare()
  const original = storage.setItem
  vi.spyOn(storage, 'setItem').mockImplementation((key, value) => { if (key.endsWith(b.collection.id)) throw new Error('quota'); original(key, value) })
  const result = await batch.apply(p)
  expect(result).toMatchObject({ changed: 2, remaining: 3 }); expect(result.failures.join()).toContain('保存失败')
  expect(Object.keys(statuses(await load(a)))).toHaveLength(2); expect((await load(b)).data.records).toHaveLength(0)
  expect((await batch.undo(result)).restored).toBe(2)
})
it('cancelling after the first committed group stops remaining writes but keeps undo', async () => {
  add('A', 2); add('B', 3); const p = await prepare(), controller = new AbortController()
  const result = await batch.apply(p, { signal: controller.signal, onProgress: () => controller.abort() })
  expect(result).toMatchObject({ changed: 2, remaining: 3, cancelled: true }); expect((await batch.undo(result)).restored).toBe(2)
})
it('cancelling before confirmation writes nothing', async () => {
  add(); const p = await prepare(), c = new AbortController(); c.abort(); const spy = vi.spyOn(storage, 'setItem')
  expect(await batch.apply(p, { signal: c.signal })).toMatchObject({ changed: 0, remaining: 23, cancelled: true }); expect(spy).not.toHaveBeenCalled()
})
it('cancelling while waiting for a lock prevents the eventual write', async () => {
  add('A', 1); const p = await prepare(), c = new AbortController(); let release
  locks.request.mockImplementationOnce((_name, _options, fn) => new Promise((resolve, reject) => { release = () => Promise.resolve().then(fn).then(resolve, reject) }))
  const pending = batch.apply(p, { signal: c.signal }); c.abort(); release()
  expect((await pending).changed).toBe(0)
})
it('stale preflight rejects all writes even when only the last selected collection changed', async () => {
  add('A', 1); const b = add('B', 1), p = await prepare(); await save(b, 'n0')
  const spy = vi.spyOn(storage, 'setItem'); expect((await batch.apply(p)).changed).toBe(0); expect(spy).not.toHaveBeenCalled()
})
it('a later selected collection changing mid-batch stops only the remaining groups', async () => {
  add('A', 1); const b = add('B', 1), p = await prepare()
  const result = await batch.apply(p, { onProgress: () => storage.removeItem(b.key) })
  expect(result).toMatchObject({ changed: 1, remaining: 1 }); expect((await batch.undo(result)).restored).toBe(1)
})
it('double confirmation synchronously consumes a preflight exactly once', async () => {
  add('A', 1); const p = await prepare(), first = batch.apply(p)
  await expect(batch.apply(p)).rejects.toThrow('已使用'); expect((await first).changed).toBe(1)
})
it('failed preflight receipts are not replayed without re-reading', async () => {
  const a = add('A', 1), p = await prepare(); await save(a, 'n0')
  expect((await batch.apply(p)).changed).toBe(0); await expect(batch.apply(p)).rejects.toThrow('已使用')
})
it('selected unsaved annotation drafts block preflight and leave the draft intact', async () => {
  const a = add(), snapshot = await load(a), key = studyDraftKey(snapshot, 'n0'), draft = { note: '未存文字', status: 'read' }
  drafts.set(key, draft); await expect(prepare()).rejects.toThrow('未保存'); expect(drafts.get(key)).toBe(draft)
})
it('a draft created after preflight or during lock wait blocks the write', async () => {
  const a = add('A', 1), p = await prepare(), snapshot = await load(a)
  locks.request.mockImplementationOnce((_name, _options, fn) => {
    drafts.set(studyDraftKey(snapshot, 'n0'), { note: '正在输入' }); return Promise.resolve().then(fn)
  })
  expect((await batch.apply(p)).failures.join()).toContain('未保存'); expect((await load(a)).data.records).toHaveLength(0)
})
it('an unrelated draft is never modified or removed by batch processing', async () => {
  const a = add(), snapshot = await load(a), draftKey = studyDraftKey(snapshot, 'n22')
  drafts.set(draftKey, { note: '未选草稿' }); const model = await hub.load()
  await batch.apply(await batch.prepare(model, [model.rows[0].key], 'read')); expect(drafts.get(draftKey).note).toBe('未选草稿')
})
it('undo refuses a new draft without clearing it', async () => {
  const a = add('A', 1), result = await batch.apply(await prepare()), key = studyDraftKey(await load(a), 'n0')
  drafts.set(key, { note: '撤销前草稿' }); expect((await batch.undo(result)).remaining).toBe(1); expect(drafts.get(key).note).toBe('撤销前草稿')
})
it('a deleted source blocks undo without recreating any collection', async () => {
  const a = add('A', 1), result = await batch.apply(await prepare()); storage.removeItem(a.key)
  expect((await batch.undo(result)).remaining).toBe(1); expect(storage.getItem(a.key)).toBeNull()
})
it('a cancelled undo can later resume without replaying completed groups', async () => {
  add('A', 1); const result = await batch.apply(await prepare()), c = new AbortController(); c.abort()
  expect((await batch.undo(result, { signal: c.signal })).remaining).toBe(1)
  expect((await batch.undo(result)).restored).toBe(1)
})
it('missing safe lock capability fails without writes', async () => {
  const a = add('A', 1), p = await prepare(); locks.request = null
  expect((await batch.apply(p)).failures.join()).toContain('安全'); expect((await load(a)).data.records).toHaveLength(0)
})
it('throwing view progress subscribers do not turn a successful write into failure', async () => {
  add('A', 2); add('B', 3); const result = await batch.apply(await prepare(), { onProgress: () => { throw new Error('view') } })
  expect(result).toMatchObject({ changed: 5, failures: [] })
})
it.each([[], ['missing'], ['same','same'], Array(201).fill('key')].map(keys => [keys]))('rejects invalid or oversized selections before writes %#', async keys => {
  add(); await expect(prepare(keys)).rejects.toThrow(); expect(storage.length).toBe(1)
})
it('rejects invalid statuses and preflights from another service', async () => {
  add('A', 1); await expect(prepare(null, '__proto__')).rejects.toThrow('状态')
  await expect(batch.apply({})).rejects.toThrow('预检'); await expect(batch.undo({})).rejects.toThrow('撤销')
})
it('incomplete workbench coverage blocks batch mutations', async () => {
  add('A', 1); storage.setItem(COLLECTION_STUDY_PREFIX + 'orphan', '{}')
  await expect(prepare()).rejects.toThrow('未关联')
})
it('preflight detects a source mutation during asynchronous fingerprinting', async () => {
  const a = add('A', 1), model = await hub.load(), original = study.load
  vi.spyOn(study, 'load').mockImplementationOnce(async (...args) => { const s = await original(...args); storage.removeItem(a.key); return s })
  await expect(batch.prepare(model, [model.rows[0].key], 'read')).rejects.toThrow()
})
it('low-level invalid mixed targets never partially write within a collection', async () => {
  const a = add('A', 1), s = await load(a)
  for (const targets of [[{ id: 'n0', status: 'read' }, { id: 'missing', status: 'read' }], [{ id: 'n0', status: 'read' }, { id: 'n0', status: 'unread' }], [{ id: 'n0', status: 'constructor' }]]) {
    await expect(study.setStatuses(s, targets, { sourceStore: source })).rejects.toThrow()
    expect(storage.getItem(s.key)).toBeNull()
  }
})
it('concurrent preflights for the same source cannot overwrite the winning save', async () => {
  const a = add('A', 1), p1 = await prepare(null, 'read'), p2 = await prepare(null, 'revisit')
  const results = await Promise.all([batch.apply(p1), batch.apply(p2)])
  expect(results.map(r => r.changed).sort()).toEqual([0, 1]); expect(statuses(await load(a)).n0).toBe('read')
})
it('cancellation is forwarded to the actual lock request instead of waiting for timeout', async () => {
  add('A', 1); const p = await prepare(), controller = new AbortController()
  locks.request.mockImplementationOnce((_name, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  }))
  const pending = batch.apply(p, { signal: controller.signal }); controller.abort()
  const result = await pending; expect(result).toMatchObject({ changed: 0, cancelled: true }); expect(result.failures.join()).toContain('取消')
})
