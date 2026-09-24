import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createCollectionPackageService, readCollectionPackage, MAX_COLLECTION_PACKAGE_BYTES } from './collectionPackage'
import { createCollectionStudyStore, COLLECTION_STUDY_PREFIX } from './collectionStudy'
import { createSearchCollectionStore, SEARCH_COLLECTION_PREFIX, MAX_SEARCH_COLLECTIONS } from './searchCollections'
import { collectionFixture, memoryStorage } from '../test/collectionFixtures'

// Separate queues for different lock names, matching the nested production contract.
function namedLocks() {
  const tails = new Map()
  return { request: (name, options, callback) => {
    const task = (tails.get(name) || Promise.resolve()).then(() => {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return callback()
    })
    tails.set(name, task.catch(() => {})); return task
  } }
}
function setup(storage = memoryStorage(), locks = namedLocks()) {
  const sourceStore = createSearchCollectionStore({ storage: () => storage })
  const studyStore = createCollectionStudyStore({ storage: () => storage, locks: () => locks })
  const service = createCollectionPackageService({ storage: () => storage, locks: () => locks, sourceStore, studyStore })
  return { storage, sourceStore, studyStore, service }
}
let source, target, raw
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fixture = collectionFixture(65)
  source = { ...setup(fixture.storage), entry: fixture.entry }
  await source.studyStore.saveNote(await source.studyStore.load(source.entry, source.sourceStore), 'n64', 'revisit', ' 原文不包含在此\n😀批注 ', { sourceStore: source.sourceStore })
  raw = await source.service.exportPackage(source.entry)
  target = setup()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const snapshot = store => Array.from({ length: store.length }, (_, i) => [store.key(i), store.getItem(store.key(i))]).sort()
const prepare = () => target.service.prepareImport(raw)
const restore = async () => { const preview = await prepare(); return target.service.confirmImport(preview) }
const loadRestored = async () => target.studyStore.load(target.sourceStore.list().entries[0], target.sourceStore)

it('exports all 65 historical entries and saved last-page annotations with a checksum', async () => {
  const pack = await readCollectionPackage(raw)
  expect(pack.collection.report.count).toBe(65)
  expect(pack.study.records).toHaveLength(1)
  expect(pack.study.records[0].id).toBe('n64')
  expect(pack.study.records[0].note).toBe(' 原文不包含在此\n😀批注 ')
  expect(pack.integrity.digest).toMatch(/^[a-f0-9]{64}$/)
})
it('exports untouched progress as null, not a fabricated saved record', async () => {
  source.storage.removeItem(COLLECTION_STUDY_PREFIX + source.entry.collection.id)
  const pack = await readCollectionPackage(await source.service.exportPackage(source.entry))
  expect(pack.study).toBeNull()
})
it('backup and preview are read-only and omit source raw strings or runtime fields', async () => {
  const before = snapshot(source.storage), destination = snapshot(target.storage)
  const preview = await prepare()
  expect(snapshot(source.storage)).toEqual(before); expect(snapshot(target.storage)).toEqual(destination)
  expect(raw).not.toContain('sourceRaw'); expect(raw).not.toContain('snippets')
  expect(Object.isFrozen(preview.target)).toBe(true)
})
it('restores a new paired copy without modifying source identity or history', async () => {
  const before = snapshot(source.storage), result = await restore(), saved = await loadRestored()
  expect(result.action).toBe('create'); expect(target.storage.length).toBe(2)
  expect(saved.collection.id).not.toBe(source.entry.collection.id)
  expect(saved.data.collectionId).toBe(saved.collection.id)
  expect(saved.data.bookmark.id).toBe('n64')
  expect(saved.collection.report).toEqual(source.entry.collection.report)
  expect(snapshot(source.storage)).toEqual(before)
})
it('restores collection-only packages without inventing study storage', async () => {
  source.storage.removeItem(COLLECTION_STUDY_PREFIX + source.entry.collection.id)
  raw = await source.service.exportPackage(source.entry)
  await restore(); expect(target.storage.length).toBe(1)
  expect((await loadRestored()).data.records).toEqual([])
})
it('rejects corrupted package content rather than trusting caller totals', async () => {
  const value = JSON.parse(raw); value.collection.name = '更改'
  await expect(target.service.prepareImport(JSON.stringify(value))).rejects.toThrow('校验不一致')
  expect(target.storage.length).toBe(0)
})
it('rejects future versions, wrong format and missing checksum', async () => {
  for (const patch of [{ version: 9 }, { format: 'other' }, { integrity: null }]) {
    await expect(target.service.prepareImport(JSON.stringify({ ...JSON.parse(raw), ...patch }))).rejects.toThrow()
  }
})
it('rejects invalid export dates even when the payload checksum is correct', async () => {
  await expect(target.service.prepareImport(JSON.stringify({ ...JSON.parse(raw), exportedAt: 'yesterday' }))).rejects.toThrow('时间无效')
})
it('rejects malformed JSON, null and oversize UTF-8 before any writes', async () => {
  for (const input of ['{broken', 'null', '😀'.repeat(MAX_COLLECTION_PACKAGE_BYTES / 4 + 1)]) {
    await expect(target.service.prepareImport(input)).rejects.toThrow()
  }
  expect(target.storage.length).toBe(0)
})
it('accepts a UTF-8 BOM and strips unrecognized fields', async () => {
  const value = JSON.parse(raw); value.manuscript = 'do not retain'; value.collection.secret = 'ignore'
  const pack = await readCollectionPackage('\uFEFF' + JSON.stringify(value))
  expect(pack.manuscript).toBeUndefined(); expect(pack.collection.secret).toBeUndefined()
})
it('rejects mismatched paired identities and invalid annotation IDs', async () => {
  const a = JSON.parse(raw); a.study.collectionId = 'other'
  await expect(target.service.prepareImport(JSON.stringify(a))).rejects.toThrow('不配套')
  const b = JSON.parse(raw); b.study.records[0].id = 'missing'
  await expect(target.service.prepareImport(JSON.stringify(b))).rejects.toThrow('无效或重复')
})
it('rejects corrupt saved reading data on export instead of silently omitting it', async () => {
  source.storage.setItem(COLLECTION_STUDY_PREFIX + source.entry.collection.id, 'broken')
  await expect(source.service.exportPackage(source.entry)).rejects.toThrow()
})
it('export rechecks source history after asynchronous fingerprinting', async () => {
  const task = source.service.exportPackage(source.entry)
  source.storage.removeItem(source.entry.key)
  await expect(task).rejects.toThrow('更改或删除')
})
it('export rechecks newly created reading data even when it was initially absent', async () => {
  source.storage.removeItem(COLLECTION_STUDY_PREFIX + source.entry.collection.id)
  const realLoad = source.studyStore.load
  vi.spyOn(source.studyStore, 'load').mockImplementation(async (...args) => {
    const result = await realLoad(...args)
    source.storage.setItem(result.key, JSON.stringify(result.data))
    return result
  })
  await expect(source.service.exportPackage(source.entry)).rejects.toThrow('备份期间已变化')
})
it('same payload exported at another time maps to the same restoration identity', async () => {
  const first = await prepare(), other = JSON.parse(raw); other.exportedAt = '2026-09-25T00:00:00.000Z'
  expect((await target.service.prepareImport(JSON.stringify(other))).target).toEqual(first.target)
})
it('reimport skips existing copies without overwriting newer local annotations', async () => {
  await restore(); const saved = await loadRestored()
  await target.studyStore.saveNote(saved, 'n0', 'read', '本机新批注', { sourceStore: target.sourceStore })
  const before = snapshot(target.storage), preview = await prepare()
  expect(preview.action).toBe('existing')
  expect((await target.service.confirmImport(preview)).action).toBe('existing')
  expect(snapshot(target.storage)).toEqual(before)
})
it('reimport can explicitly fill missing reading records for an existing unmodified copy', async () => {
  await restore(); const saved = await loadRestored(); target.storage.removeItem(saved.key)
  const preview = await prepare(); expect(preview.action).toBe('complete')
  await target.service.confirmImport(preview)
  expect((await loadRestored()).data.records[0].id).toBe('n64')
})
it('target identity collisions never overwrite existing collection bytes', async () => {
  const preview = await prepare(); target.storage.setItem(preview.target.collectionKey, 'existing data')
  await expect(prepare()).rejects.toThrow('已被修改或标识冲突')
  expect(target.storage.getItem(preview.target.collectionKey)).toBe('existing data')
})
it('unrelated staged reading data is not overwritten', async () => {
  const preview = await prepare(); target.storage.setItem(preview.target.studyKey, 'different')
  await expect(prepare()).rejects.toThrow('不同的暂存')
  expect(target.storage.getItem(preview.target.studyKey)).toBe('different')
})
it('corrupt existing study data is not classified as safely restored', async () => {
  await restore(); const saved = await loadRestored(); target.storage.setItem(saved.key, 'bad')
  await expect(prepare()).rejects.toThrow(); expect(target.storage.getItem(saved.key)).toBe('bad')
})
it('first-write failure publishes neither reading nor collection data', async () => {
  const preview = await prepare()
  vi.spyOn(target.storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(target.service.confirmImport(preview)).rejects.toThrow('恢复未完成')
  expect(target.storage.length).toBe(0)
})
it('second-write failure retains only staged progress and retries without duplicate copies', async () => {
  const preview = await prepare(), write = target.storage.setItem
  const spy = vi.spyOn(target.storage, 'setItem').mockImplementation((key, value) => {
    if (key.startsWith(SEARCH_COLLECTION_PREFIX)) throw new Error('quota')
    write(key, value)
  })
  await expect(target.service.confirmImport(preview)).rejects.toThrow('已暂存')
  expect(target.sourceStore.list().entries).toHaveLength(0)
  expect(target.storage.getItem(preview.target.studyKey)).toBe(preview.target.studyRaw)
  spy.mockRestore()
  const retry = await prepare(); expect(retry.action).toBe('resume')
  await target.service.confirmImport(retry)
  expect(target.sourceStore.list().entries).toHaveLength(1); expect(target.storage.length).toBe(2)
})
it('detects a process-staged record and completes publication without rewriting it', async () => {
  const preview = await prepare(); target.storage.setItem(preview.target.studyKey, preview.target.studyRaw)
  const spy = vi.spyOn(target.storage, 'setItem'), retry = await prepare()
  await target.service.confirmImport(retry)
  expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0][0]).toBe(retry.target.collectionKey)
})
it('capacity includes unreadable records and does not automatically evict', async () => {
  for (let i = 0; i < MAX_SEARCH_COLLECTIONS; i++) target.storage.setItem(SEARCH_COLLECTION_PREFIX + i, 'bad')
  const before = snapshot(target.storage)
  await expect(prepare()).rejects.toThrow('40 份'); expect(snapshot(target.storage)).toEqual(before)
})
it('an existing copy can be recognized on a full shelf', async () => {
  await restore()
  for (let i = 1; i < MAX_SEARCH_COLLECTIONS; i++) target.storage.setItem(SEARCH_COLLECTION_PREFIX + i, 'bad')
  expect((await prepare()).action).toBe('existing')
})
it('shelf changes invalidate a preview before any paired write', async () => {
  const preview = await prepare(); target.storage.setItem(SEARCH_COLLECTION_PREFIX + 'other', 'bad')
  await expect(target.service.confirmImport(preview)).rejects.toThrow('已变化')
  expect(target.storage.getItem(preview.target.studyKey)).toBeNull()
})
it('reading updates invalidate an existing-copy preview', async () => {
  await restore(); const preview = await prepare(), saved = await loadRestored()
  await target.studyStore.bookmark(saved, 'n1', { sourceStore: target.sourceStore })
  await expect(target.service.confirmImport(preview)).rejects.toThrow('已变化')
  expect((await loadRestored()).data.bookmark.id).toBe('n1')
})
it('forged, cloned and foreign-service previews cannot control writes', async () => {
  const preview = await prepare()
  for (const value of [{ target: { collectionKey: 'theme' } }, structuredClone(preview), await source.service.prepareImport(raw)]) {
    await expect(target.service.confirmImport(value)).rejects.toThrow('预检无效')
  }
  expect(target.storage.length).toBe(0)
})
it('unavailable locks and rejected locks fail without unsafe fallback', async () => {
  for (const manager of [null, { request: () => Promise.reject(new DOMException('blocked', 'SecurityError')) }]) {
    const env = setup(memoryStorage(), manager), preview = await env.service.prepareImport(raw)
    await expect(env.service.confirmImport(preview)).rejects.toThrow(/锁/); expect(env.storage.length).toBe(0)
  }
})
it('cancellation before or after preview leaves all old records unchanged', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(target.service.prepareImport(raw, { signal: controller.signal })).rejects.toThrow('取消')
  await expect(target.service.confirmImport(await prepare(), { isCurrent: () => false })).rejects.toThrow('取消')
  expect(target.storage.length).toBe(0)
})
it('cancelled lock requests cannot publish a collection later', async () => {
  let callback, lockOptions
  const env = setup(memoryStorage(), { request: (_name, options, cb) => {
    callback = cb; lockOptions = options
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  } })
  const preview = await env.service.prepareImport(raw), controller = new AbortController()
  const pending = env.service.confirmImport(preview, { signal: controller.signal })
  controller.abort(); await expect(pending).rejects.toThrow('取消')
  expect(lockOptions.signal.aborted).toBe(true); expect(callback).toBeTypeOf('function'); expect(env.storage.length).toBe(0)
})
it('two concurrent confirmations serialize and the stale preview cannot duplicate data', async () => {
  const a = await prepare(), b = await prepare()
  const result = await Promise.allSettled([target.service.confirmImport(a), target.service.confirmImport(b)])
  expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
  expect(target.sourceStore.list().entries).toHaveLength(1)
})
it('throwing view notifications cannot turn a completed restore into failure', async () => {
  vi.spyOn(target.sourceStore, 'notifyImported').mockImplementation(() => { throw new Error('view failed') })
  await expect(restore()).resolves.toMatchObject({ action: 'create' })
  expect((await loadRestored()).data.bookmark.id).toBe('n64')
})
it('fresh service instances can read and reexport the complete restored pair', async () => {
  await restore(); const fresh = setup(target.storage), entry = fresh.sourceStore.list().entries[0]
  const pack = await readCollectionPackage(await fresh.service.exportPackage(entry))
  expect(pack.study.collectionId).toBe(entry.collection.id); expect(pack.study.records[0].note).toContain('😀')
})
