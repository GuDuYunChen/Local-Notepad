import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createCollectionStudyStore, summarizeCollectionStudy, nextUnreadCollectionItem, COLLECTION_STUDY_PREFIX, MAX_STUDY_BYTES } from './collectionStudy'
import { collectionFixture, collectionReport } from '../test/collectionFixtures'
import { createSearchCollectionStore, SEARCH_COLLECTION_PREFIX } from './searchCollections'

function locks() {
  let tail = Promise.resolve()
  return { request: (_name, _options, callback) => { const next = tail.then(callback); tail = next.catch(() => {}); return next } }
}
let f, study, options
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); f = collectionFixture()
  study = createCollectionStudyStore({ storage: () => f.storage, locks, now: () => new Date('2026-09-24T09:00:00.000Z') })
  options = { sourceStore: f.store }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const load = () => study.load(f.entry, f.store)
it('reading an untouched collection reports all unread and performs no write', async () => {
  const before = f.storage.length, snapshot = await load()
  expect(summarizeCollectionStudy(snapshot)).toEqual({ unread: 23, read: 0, revisit: 0, notes: 0 })
  expect(snapshot.data.bookmark).toBeNull(); expect(f.storage.length).toBe(before)
})
it('explicitly saves one annotation, manual state and bookmark without changing source history', async () => {
  const saved = await study.saveNote(await load(), 'n2', 'read', ' 保留空白\n😀正文疑问 ', options)
  expect(saved.data.records[0].note).toBe(' 保留空白\n😀正文疑问 ')
  expect(saved.data.bookmark.id).toBe('n2'); expect(f.storage.getItem(f.key)).toBe(f.entry.raw)
  expect(summarizeCollectionStudy(saved)).toEqual({ unread: 22, read: 1, revisit: 0, notes: 1 })
})
it('fresh store instances reopen the exact status, note and position', async () => {
  const saved = await study.saveNote(await load(), 'n22', 'revisit', '继续核对', options)
  const fresh = createCollectionStudyStore({ storage: () => f.storage })
  expect((await fresh.load(f.entry, f.store)).data).toEqual(saved.data)
})
it('bookmark-only saves do not infer reading completion', async () => {
  const saved = await study.bookmark(await load(), 'n7', options)
  expect(saved.data.records).toEqual([]); expect(saved.data.bookmark.id).toBe('n7')
})
it('updating one note preserves all other annotations and status totals', async () => {
  const a = await study.saveNote(await load(), 'n1', 'read', '旧', options)
  const b = await study.saveNote(a, 'n2', 'revisit', '保留', options)
  const c = await study.saveNote(b, 'n1', 'unread', '', options)
  expect(c.data.records.map(item => item.id)).toEqual(['n2'])
  expect(summarizeCollectionStudy(c)).toEqual({ unread: 22, read: 0, revisit: 1, notes: 1 })
})
it('whitelists fields and returns deep immutable independent snapshots', async () => {
  const saved = await study.saveNote(await load(), 'n1', 'read', '笔记', options)
  expect(Object.isFrozen(saved.data.records[0])).toBe(true)
  expect(Object.keys(JSON.parse(saved.raw))).toEqual(['format', 'version', 'collectionId', 'reportSHA256', 'updatedAt', 'bookmark', 'records'])
  expect(saved.raw).not.toContain('snippets'); expect(saved.raw).not.toContain('sourceRaw')
})
it('requires exact source bytes after hashing completes', async () => {
  const pending = load(); f.storage.setItem(f.key, f.entry.raw + ' ')
  await expect(pending).rejects.toThrow('更改或删除')
})
it('source deletion or replacement blocks a save without recreating the collection', async () => {
  const snapshot = await load(); f.storage.removeItem(f.key)
  await expect(study.saveNote(snapshot, 'n1', 'read', 'x', options)).rejects.toThrow()
  expect(f.storage.length).toBe(0)
})
it('malformed stored data remains intact and is not treated as an empty shelf', async () => {
  const key = COLLECTION_STUDY_PREFIX + f.collection.id
  f.storage.setItem(key, 'broken')
  await expect(load()).rejects.toThrow(); expect(f.storage.getItem(key)).toBe('broken')
})
it('rejects future storage versions and mismatched historical report fingerprints', async () => {
  const snapshot = await study.bookmark(await load(), 'n1', options)
  for (const patch of [{ version: 99 }, { reportSHA256: '0'.repeat(64) }, { collectionId: 'other' }]) {
    f.storage.setItem(snapshot.key, JSON.stringify({ ...snapshot.data, ...patch }))
    await expect(load()).rejects.toThrow('原记录保留')
  }
})
it('rejects duplicate or foreign annotation IDs and invalid timestamps', async () => {
  const snapshot = await study.saveNote(await load(), 'n1', 'read', '', options)
  const note = snapshot.data.records[0]
  for (const records of [[note, note], [{ ...note, id: 'foreign' }], [{ ...note, updatedAt: 'invalid' }]]) {
    f.storage.setItem(snapshot.key, JSON.stringify({ ...snapshot.data, records }))
    await expect(load()).rejects.toThrow()
  }
})
it('invalid status, nonexistent bookmark and overlong note never write', async () => {
  const snapshot = await load()
  for (const [id, status, note] of [['n1','invalid',''], ['foreign','read',''], ['n1','read','x'.repeat(2001)], ['n1','read','x\0']]) {
    await expect(study.saveNote(snapshot, id, status, note, options)).rejects.toThrow()
  }
  await expect(study.bookmark(snapshot, 'missing', options)).rejects.toThrow()
  expect(f.storage.length).toBe(1)
})
it('unavailable storage reports failure, not zero saved progress', async () => {
  const bad = createCollectionStudyStore({ storage: () => { throw new Error('blocked') } })
  await expect(bad.load(f.entry, f.store)).rejects.toThrow('blocked')
})
it('missing Web Locks fails closed instead of unsafe cross-window overwrites', async () => {
  const bad = createCollectionStudyStore({ storage: () => f.storage, locks: () => undefined })
  await expect(bad.saveNote(await load(), 'n1', 'read', '', options)).rejects.toThrow('多窗口保存')
  expect(f.storage.length).toBe(1)
})
it('storage quota failure preserves the previous exact bytes', async () => {
  const snapshot = await study.saveNote(await load(), 'n1', 'read', '旧批注', options)
  vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(study.saveNote(snapshot, 'n1', 'revisit', '新批注', options)).rejects.toThrow('保存失败')
  expect(f.storage.getItem(snapshot.key)).toBe(snapshot.raw)
})
it('cancellation while waiting for the write lock prevents a late save', async () => {
  let release, valid = true
  const waiting = createCollectionStudyStore({ storage: () => f.storage, locks: () => ({ request: (_name, _opts, fn) => new Promise((resolve, reject) => { release = () => { try { resolve(fn()) } catch (error) { reject(error) } } }) }) })
  const snapshot = await load(), result = waiting.bookmark(snapshot, 'n2', { ...options, isCurrent: () => valid })
  valid = false
  release(); await expect(result).rejects.toThrow('取消'); expect(f.storage.getItem(snapshot.key)).toBeNull()
})
it('stale saves cannot replace another window update, including an unrelated note', async () => {
  const snapshot = await load(); const saved = await study.saveNote(snapshot, 'n1', 'read', '第一窗口', options)
  await expect(study.saveNote(snapshot, 'n2', 'revisit', '第二窗口', options)).rejects.toThrow('其他操作')
  expect((await load()).data).toEqual(saved.data)
})
it('two stores sharing a lock do not lose concurrent edits silently', async () => {
  const manager = locks()
  const a = createCollectionStudyStore({ storage: () => f.storage, locks: () => manager })
  const b = createCollectionStudyStore({ storage: () => f.storage, locks: () => manager })
  const snapshot = await load()
  const results = await Promise.allSettled([a.saveNote(snapshot, 'n1', 'read', 'A', options), b.saveNote(snapshot, 'n2', 'read', 'B', options)])
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect((await load()).data.records).toHaveLength(1)
})
it('throwing subscribers cannot report a completed save as failed', async () => {
  const off = study.subscribe(() => { throw new Error('render') })
  await expect(study.bookmark(await load(), 'n1', options)).resolves.toBeTruthy(); off()
})
it('subscription removal stops further notifications', async () => {
  const listener = vi.fn(), off = study.subscribe(listener)
  const a = await study.bookmark(await load(), 'n1', options); off()
  await study.bookmark(a, 'n2', options); expect(listener).toHaveBeenCalledOnce()
})
it('next unread skips read notes, includes revisit, wraps once and excludes the current note', async () => {
  let snapshot = await study.saveNote(await load(), 'n8', 'read', '', options)
  snapshot = await study.saveNote(snapshot, 'n9', 'revisit', '', options)
  expect(nextUnreadCollectionItem(snapshot, 'n7').id).toBe('n9')
  expect(nextUnreadCollectionItem(snapshot, 'n22').id).toBe('n0')
  expect(nextUnreadCollectionItem(snapshot, 'n7', [{ id: 'n7' }, { id: 'n8' }])).toBeNull()
})
it('backup has only manual records and matches every saved annotation, not a UI page', async () => {
  let snapshot = await study.saveNote(await load(), 'n0', 'read', '首', options)
  snapshot = await study.saveNote(snapshot, 'n22', 'revisit', '末', options)
  const raw = study.export(snapshot, f.store), backup = JSON.parse(raw)
  expect(backup.records.map(item => item.id)).toEqual(['n0','n22'])
  expect(raw).not.toContain('folderPath'); expect(raw).not.toContain('contentSHA256'); expect(raw).not.toContain('entry')
})
it('backup refuses stale snapshots and never exports newly overwritten data as the old record', async () => {
  const snapshot = await load(); await study.bookmark(snapshot, 'n1', options)
  expect(() => study.export(snapshot, f.store)).toThrow('其他操作')
})
it('preflight never writes and confirmation replaces only study records', async () => {
  const first = await study.saveNote(await load(), 'n22', 'revisit', '回头看', options), backup = study.export(first, f.store)
  const current = await study.saveNote(first, 'n22', 'read', '已完成', options)
  const preview = study.prepareImport(current, backup, f.store)
  expect((await load()).raw).toBe(current.raw)
  const restored = await study.import(current, preview, options)
  expect(restored.data.records[0].note).toBe('回头看'); expect(f.storage.getItem(f.key)).toBe(f.entry.raw)
})
it('import accepts a separately imported copy of the same historical report, never just a same-named collection', async () => {
  const saved = await study.saveNote(await load(), 'n22', 'read', '完整历史', options)
  const backup = study.export(saved, f.store)
  const other = createSearchCollectionStore({ storage: () => f.storage, createId: () => 'copy-id' })
  const copied = other.importCopy(f.entry.raw), entry = other.list().entries.find(row => row.collection.id === copied.id)
  const target = await study.load(entry, other), preview = study.prepareImport(target, backup, other)
  expect((await study.import(target, preview, { sourceStore: other })).data.collectionId).toBe(copied.id)
  const different = createSearchCollectionStore({ storage: () => f.storage, createId: () => 'different' })
  different.save('设定资料', collectionReport(2)); const wrong = different.list().entries.find(row => row.collection.id === 'different')
  expect(() => study.prepareImport(target, '{}', other)).toThrow()
  const differentSnapshot = await study.load(wrong, different)
  expect(() => study.prepareImport(differentSnapshot, backup, different)).toThrow('同一份')
})
it('import strips arbitrary fields and rejects duplicate IDs, unknown states and unsupported versions', async () => {
  const saved = await study.saveNote(await load(), 'n1', 'read', 'ok', options)
  const input = JSON.parse(study.export(saved, f.store)); input.manuscript = 'hidden'
  expect(JSON.stringify(study.prepareImport(saved, JSON.stringify(input), f.store))).not.toContain('hidden')
  for (const patch of [{ version: 9 }, { records: [...input.records, ...input.records] }, { records: [{ ...input.records[0], status: '__proto__' }] }]) {
    expect(() => study.prepareImport(saved, JSON.stringify({ ...input, ...patch }), f.store)).toThrow()
  }
})
it('changed records between preflight and confirmation block replacement', async () => {
  const snapshot = await load(), raw = study.export(snapshot, f.store), preview = study.prepareImport(snapshot, raw, f.store)
  await study.bookmark(snapshot, 'n22', options)
  await expect(study.import(snapshot, preview, options)).rejects.toThrow('其他操作')
})
it('oversize backups and wrong file formats are rejected before mutation', async () => {
  const snapshot = await load()
  expect(() => study.prepareImport(snapshot, ' '.repeat(MAX_STUDY_BYTES + 1), f.store)).toThrow('1 MiB')
  expect(() => study.prepareImport(snapshot, f.entry.raw, f.store)).toThrow()
  expect(f.storage.length).toBe(1)
})
it('native lock rejection is explained without changing data', async () => {
  const rejected = createCollectionStudyStore({ storage: () => f.storage, locks: () => ({ request: () => Promise.reject(new DOMException('opaque origin', 'SecurityError')) }) })
  await expect(rejected.bookmark(await load(), 'n1', options)).rejects.toThrow('安全保存锁')
  expect(f.storage.length).toBe(1)
})
it('a blocked native lock times out instead of leaving the save form stuck', async () => {
  const snapshot = await load(); vi.useFakeTimers()
  try {
    const waiting = createCollectionStudyStore({ storage: () => f.storage, locks: () => ({ request: (_name, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })) }) })
    const result = waiting.bookmark(snapshot, 'n1', options)
    const assertion = expect(result).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5000); await assertion
    expect(f.storage.length).toBe(1)
  } finally { vi.useRealTimers() }
})
