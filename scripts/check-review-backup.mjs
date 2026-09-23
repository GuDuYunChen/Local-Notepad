import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReviewArchiveStore, REVIEW_ARCHIVE_PREFIX } from '../src/services/evidenceReviewArchives.js'
import { REVIEW_ARCHIVE_FORMAT, MAX_REVIEW_ARCHIVE_LENGTH } from '../src/services/evidenceReviewArchiveData.js'
import { createEvidenceReviewSession } from '../src/services/evidenceReviewSession.js'
import { REVIEW_BACKUP_FORMAT, MAX_REVIEW_BACKUP_LENGTH, readReviewBackup, buildReviewBackup,
  planReviewBackupImport, importReviewBackup, reviewArchiveIdentity } from '../src/services/evidenceReviewBackup.js'

const time = '2026-09-23T00:00:00.000Z'
function archive(id = 'original', patch = {}) {
  return { format: REVIEW_ARCHIVE_FORMAT, version: 1, id, savedAt: time, data: {
    projectId: 'p1', entityId: 'entity1', entityLabel: '关关',
    filters: { source: 'all', query: '', volumeId: null, page: 1 },
    chapters: [{ id: 'c1', title: '第一章', ordinal: 1 }, { id: 'c2', title: '第二章', ordinal: 2 }],
    chapterId: 'c1', reviewedIds: ['c1'], annotations: { c2: { text: '称呼需核对 😀\nÉlodie', needsChanges: true } },
    ...patch,
  } }
}
const bundle = archives => JSON.stringify({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt: time, archives })
function fixture() {
  const map = new Map([['theme', 'dark']])
  let serial = 0, writes = 0, failAt = Infinity
  const db = {
    get length() { return map.size }, key(i) { return [...map.keys()][i] ?? null },
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { if (++writes === failAt) throw new Error('quota'); map.set(key, value) },
    removeItem(key) { map.delete(key) },
  }
  const store = createReviewArchiveStore({ storage: () => db, createId: () => 'local-' + ++serial, now: () => new Date(time) })
  return { db, store, map, failNext(offset = 1) { failAt = writes + offset }, allowWrites() { failAt = Infinity } }
}
const distinct = (count = 3) => Array.from({ length: count }, (_, i) => archive('a' + i, { entityLabel: '实体' + i }))

test('backs up all selected pages and preserves exact notes without changing storage', () => {
  const { store, map } = fixture()
  for (const a of distinct(13)) store.importFile(JSON.stringify(a))
  const before = [...map]
  const saved = readReviewBackup(buildReviewBackup(store.list().entries, store, new Date(time)))
  assert.equal(saved.archives.length, 13)
  assert.ok(saved.archives.some(a => a.data.entityLabel === '实体12'))
  assert.equal(saved.archives[0].data.annotations.c2.text, '称呼需核对 😀\nÉlodie')
  assert.deepEqual([...map], before)
})
test('backs up only the explicitly selected range', () => {
  const { store } = fixture()
  for (const a of distinct()) store.importFile(JSON.stringify(a))
  const entries = store.list().entries.slice(1)
  assert.equal(readReviewBackup(buildReviewBackup(entries, store)).archives.length, 2)
})
test('does not silently omit unreadable selected archives', () => {
  const { store, map } = fixture(); store.importFile(JSON.stringify(archive()))
  map.set(REVIEW_ARCHIVE_PREFIX + 'broken', '{broken')
  assert.throws(() => buildReviewBackup(store.list().entries, store), /不可读取/)
  assert.equal(map.get(REVIEW_ARCHIVE_PREFIX + 'broken'), '{broken')
})
test('refuses empty, repeated or oversized backup selections', () => {
  const { store } = fixture(); store.importFile(JSON.stringify(archive())); const e = store.list().entries[0]
  for (const entries of [[], [e, e], Array(41).fill(e)]) assert.throws(() => buildReviewBackup(entries, store))
})
test('refuses a changed archive even without storage events', () => {
  const { store, map } = fixture(); store.importFile(JSON.stringify(archive())); const entries = store.list().entries
  map.delete(entries[0].key)
  assert.throws(() => buildReviewBackup(entries, store), /修改或删除/)
})
test('checks selected archives again before returning backup bytes', () => {
  const { store } = fixture(); store.importFile(JSON.stringify(archive())); const entries = store.list().entries
  let calls = 0
  const reader = { ...store, readUnchanged(entry) { if (++calls === 2) throw new Error('changed after serialization'); return store.readUnchanged(entry) } }
  assert.throws(() => buildReviewBackup(entries, reader), /changed after/)
})
test('accepts legacy single JSON and a UTF-8 BOM without rewriting notes', () => {
  for (const raw of [JSON.stringify(archive()), '\ufeff' + JSON.stringify(archive()), bundle([archive()])]) {
    const value = readReviewBackup(raw)
    assert.equal(value.archives.length, 1); assert.equal(value.archives[0].data.annotations.c2.text, archive().data.annotations.c2.text)
  }
})
test('strips manuscript and navigation fields from both import and export schemas', () => {
  const a = archive(); a.data.content = 'SECRET BODY'; a.data.navigation = { text: 'SECRET' }; a.content = 'BODY'
  const value = readReviewBackup(bundle([a])); assert.equal(JSON.stringify(value).includes('SECRET'), false)
  const { store } = fixture(); store.importFile(JSON.stringify(a))
  assert.equal(buildReviewBackup(store.list().entries, store).includes('SECRET'), false)
})
test('rejects malformed files and unsupported bundle or archive versions', () => {
  const invalid = [null, '[]', 'null', '{', '{}', bundle([]), bundle(Array(41).fill(archive())),
    JSON.stringify({ format: REVIEW_BACKUP_FORMAT, version: 2, exportedAt: time, archives: [archive()] }),
    bundle([{ ...archive(), version: 2 }]), bundle([{ ...archive(), id: '../bad' }])]
  for (const raw of invalid) assert.throws(() => readReviewBackup(raw))
})
test('validates every member before allowing any write, including the final member', () => {
  const { store, map } = fixture(); const before = [...map]
  assert.throws(() => planReviewBackupImport(bundle([...distinct(12), { ...archive(), data: null }]), store))
  assert.deepEqual([...map], before)
})
test('rejects overlong files before parsing and oversized individual archives', () => {
  assert.throws(() => readReviewBackup(' '.repeat(MAX_REVIEW_BACKUP_LENGTH + 1)))
  const a = archive(); a.unknown = 'x'.repeat(MAX_REVIEW_ARCHIVE_LENGTH)
  assert.throws(() => readReviewBackup(bundle([a])))
})
test('requires canonical valid backup export timestamps', () => {
  for (const exportedAt of ['bad', '2026-09-23', 123, null]) {
    assert.throws(() => readReviewBackup(JSON.stringify({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt, archives: [archive()] })))
  }
})
test('parsed backup and preview are detached deeply immutable records', () => {
  const { store } = fixture(); const a = archive(); const p = planReviewBackupImport(bundle([a]), store)
  a.data.annotations.c2.text = 'modified'
  assert.throws(() => { p.backup.archives[0].data.annotations.c2.text = 'mutate' }, TypeError)
  assert.throws(() => { p.items.push({}) }, TypeError)
  assert.notEqual(p.backup.archives[0].data.annotations.c2.text, 'modified')
})
test('deduplicates imported copies with new IDs against existing content', () => {
  const { store } = fixture(); store.importFile(JSON.stringify(archive()))
  const p = planReviewBackupImport(bundle([archive('new-id')]), store)
  assert.equal(p.newCount, 0); assert.equal(p.items[0].status, 'existing')
})
test('deduplicates identical snapshots within a file but not different content with the same ID', () => {
  const { store } = fixture()
  const p = planReviewBackupImport(bundle([archive(), archive('copy'), archive('original', { entityLabel: '不同记录' })]), store)
  assert.deepEqual(p.items.map(i => i.status), ['new', 'duplicate', 'new'])
})
test('property order and reviewed-ID order do not create false duplicates', () => {
  const left = archive('a', { annotations: { c1: { text: '甲', needsChanges: false }, c2: { text: '乙', needsChanges: false } }, reviewedIds: ['c1', 'c2'] })
  const right = structuredClone(left)
  right.data.annotations = { c2: { needsChanges: false, text: '乙' }, c1: { needsChanges: false, text: '甲' } }; right.data.reviewedIds.reverse()
  assert.equal(reviewArchiveIdentity(left), reviewArchiveIdentity(right))
})
test('absent and empty unflagged notes deduplicate but whitespace notes remain exact', () => {
  const left = archive('a', { annotations: {} }); const empty = archive('b', { annotations: { c2: { text: '', needsChanges: false } } })
  assert.equal(reviewArchiveIdentity(left), reviewArchiveIdentity(empty))
  empty.data.annotations.c2.text = ' '
  assert.notEqual(reviewArchiveIdentity(left), reviewArchiveIdentity(empty))
})
test('changes in save time, notes, chapter order or scope remain distinct', () => {
  const { store } = fixture(); const a = archive(); store.importFile(JSON.stringify(a))
  const changedTime = { ...a, savedAt: '2026-09-24T00:00:00.000Z' }
  const changedNote = archive('b', { annotations: { c2: { text: '新备注', needsChanges: true } } })
  const changedOrder = archive('c', { chapters: [...a.data.chapters].reverse() })
  const changedScope = archive('d', { filters: { ...a.data.filters, volumeId: '' } })
  assert.equal(planReviewBackupImport(bundle([changedTime, changedNote, changedOrder, changedScope]), store).newCount, 4)
})
test('same IDs from different projects never deduplicate', () => {
  const { store } = fixture()
  const p = planReviewBackupImport(bundle([archive(), archive('b', { projectId: 'p2' })]), store)
  assert.equal(p.newCount, 2)
})
test('capacity includes unreadable records and refuses the full import before any writes', () => {
  const { store, map } = fixture()
  for (let i = 0; i < 39; i++) map.set(REVIEW_ARCHIVE_PREFIX + 'broken' + i, '{bad')
  const p = planReviewBackupImport(bundle(distinct(2)), store)
  assert.equal(p.available, 1); assert.equal(p.fits, false)
  const before = [...map]; assert.throws(() => importReviewBackup(p, store), /容量不足/); assert.deepEqual([...map], before)
})
test('a full shelf can accept an all-duplicate no-op without eviction', () => {
  const { store, map } = fixture(); for (const a of distinct(40)) store.importFile(JSON.stringify(a))
  const p = planReviewBackupImport(bundle(distinct(40)), store); const before = [...map]
  const result = importReviewBackup(p, store)
  assert.equal(result.complete, true); assert.equal(result.importedCount, 0); assert.equal(result.skippedCount, 40)
  assert.deepEqual([...map], before)
})
test('preflight and import report unavailable storage rather than empty data', () => {
  const { store } = fixture(); const p = planReviewBackupImport(bundle([archive()]), store)
  const failed = { ...store, list() { return { entries: [], error: 'storage blocked' } } }
  assert.throws(() => planReviewBackupImport(bundle([archive()]), failed), /storage blocked/)
  assert.throws(() => importReviewBackup(p, failed), /storage blocked/)
})
test('confirms against the exact shelf, refusing added, changed or removed records', () => {
  for (const mode of ['add', 'change', 'delete']) {
    const { store, map } = fixture(); store.importFile(JSON.stringify(archive('local', { entityLabel: '已有' })))
    const p = planReviewBackupImport(bundle([archive()]), store); const key = store.list().entries[0].key
    if (mode === 'add') store.importFile(JSON.stringify(archive('added', { entityLabel: '额外' })))
    else if (mode === 'change') map.set(key, '{changed'); else map.delete(key)
    const before = [...map]; assert.throws(() => importReviewBackup(p, store), /重新预检/); assert.deepEqual([...map], before)
  }
})
test('successful import keeps old snapshots and unrelated settings, preserves save times and creates fresh IDs', () => {
  const { store, map } = fixture(); const a = archive(); const p = planReviewBackupImport(bundle([a]), store)
  const result = importReviewBackup(p, store)
  assert.equal(result.importedCount, 1); assert.equal(result.remainingCount, 0)
  const saved = store.list().entries[0].archive
  assert.notEqual(saved.id, a.id); assert.equal(saved.savedAt, a.savedAt); assert.deepEqual(saved.data, a.data)
  assert.equal(map.get('theme'), 'dark')
})
test('quota failure stops the batch with exact counts and preserves completed writes', () => {
  const f = fixture(); const p = planReviewBackupImport(bundle(distinct()), f.store); f.failNext(2)
  const r = importReviewBackup(p, f.store)
  assert.equal(r.importedCount, 1); assert.equal(r.remainingCount, 2); assert.equal(r.complete, false); assert.ok(r.error)
  assert.equal(f.store.list().entries.length, 1); assert.equal(f.map.get('theme'), 'dark')
})
test('repreview after partial failure skips successes and imports only the remainder', () => {
  const f = fixture(); const raw = bundle(distinct()); f.failNext(2)
  importReviewBackup(planReviewBackupImport(raw, f.store), f.store); f.allowWrites()
  const p = planReviewBackupImport(raw, f.store)
  assert.equal(p.newCount, 2); assert.equal(p.skippedCount, 1)
  const r = importReviewBackup(p, f.store); assert.equal(r.importedCount, 2); assert.equal(r.complete, true)
  assert.equal(f.store.list().entries.length, 3)
})
test('first-write failure leaves everything intact and retryable', () => {
  const f = fixture(); f.failNext(); const before = [...f.map]
  const r = importReviewBackup(planReviewBackupImport(bundle(distinct()), f.store), f.store)
  assert.equal(r.importedCount, 0); assert.equal(r.remainingCount, 3); assert.deepEqual([...f.map], before)
})
test('a concurrent shelf change after a success stops remaining writes without rolling anything back', () => {
  const f = fixture(); const p = planReviewBackupImport(bundle(distinct()), f.store)
  const wrapped = { ...f.store, importFile(raw) { const result = f.store.importFile(raw); f.map.set(REVIEW_ARCHIVE_PREFIX + 'other-window', '{unknown'); return result } }
  const r = importReviewBackup(p, wrapped)
  assert.equal(r.importedCount, 1); assert.equal(r.remainingCount, 2); assert.ok(r.error)
  assert.equal(f.store.list().entries.length, 2)
})
test('a throwing subscriber cannot turn a completed save into a reported write failure', () => {
  const f = fixture(); let notifications = 0; const original = console.error
  console.error = () => {}
  try {
    f.store.subscribe(() => { throw new Error('bad UI listener') }); f.store.subscribe(() => notifications++)
    const r = importReviewBackup(planReviewBackupImport(bundle(distinct(2)), f.store), f.store)
    assert.equal(r.complete, true); assert.equal(r.importedCount, 2); assert.equal(notifications, 2)
  } finally { console.error = original }
})
test('backup import never starts, ends or modifies an active evidence review', () => {
  const review = createEvidenceReviewSession(); review.restoreArchive(archive().data); const original = review.getSnapshot()
  const { store } = fixture(); importReviewBackup(planReviewBackupImport(bundle(distinct()), store), store)
  assert.equal(review.getSnapshot(), original)
})
test('special annotation IDs survive as own data properties without prototype mutation', () => {
  const a = archive('proto', { chapters: [{ id: '__proto__', title: '章节', ordinal: 1 }], chapterId: '__proto__', reviewedIds: [],
    annotations: JSON.parse('{"__proto__":{"text":"安全备注","needsChanges":true}}') })
  const { store } = fixture(); importReviewBackup(planReviewBackupImport(bundle([a]), store), store)
  const data = store.list().entries[0].archive.data
  assert.equal(Object.hasOwn(data.annotations, '__proto__'), true)
  assert.equal(data.annotations.__proto__.text, '安全备注'); assert.equal({}.text, undefined)
})
test('reordered shelf enumeration does not invalidate a preview', () => {
  const f = fixture(); f.store.importFile(JSON.stringify(archive('a', { entityLabel: '已有' })))
  const p = planReviewBackupImport(bundle(distinct()), f.store)
  const wrapped = { ...f.store, list() { const r = f.store.list(); return { ...r, entries: [...r.entries].reverse() } } }
  assert.equal(importReviewBackup(p, wrapped).complete, true)
})
