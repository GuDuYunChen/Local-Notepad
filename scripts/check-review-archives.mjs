import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvidenceReviewSession } from '../src/services/evidenceReviewSession.js'
import { createReviewArchiveStore, REVIEW_ARCHIVE_PREFIX } from '../src/services/evidenceReviewArchives.js'
import { copyArchivedReviewData, readReviewArchive, planReviewArchiveRestore, MAX_REVIEW_ARCHIVE_LENGTH } from '../src/services/evidenceReviewArchiveData.js'

function dbFixture() {
  const values = new Map()
  return { values, get length() { return values.size }, key: n => [...values.keys()][n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
function fixture() {
  const review = createEvidenceReviewSession()
  const session = review.start({ projectId: 'p1', entityId: 'a', entityLabel: '关关',
    filters: { source: 'alias', query: '小关', volumeId: '', page: 3 } },
  Array.from({ length: 14 }, (_, i) => ({ id: 'c' + (i + 1), title: '第' + (i + 1) + '章', ordinal: i + 1 })), 'c13')
  review.commitStart(session.id)
  review.setAnnotation(session.id, 'c14', { text: '核对身份😀\n第二行', needsChanges: true })
  review.setReviewed(session.id, 'c1', true)
  const db = dbFixture()
  let serial = 0
  const store = createReviewArchiveStore({ storage: () => db, createId: () => 'test-' + (++serial), now: () => new Date('2026-09-23T10:00:00Z') })
  return { review, data: review.getSnapshot(), db, store }
}
const scope = data => ({ projectId: data.projectId, entityId: data.entityId, entityLabel: data.entityLabel, chapterQueue: data.chapters })

test('save and reopen with a fresh store preserves notes, range and historical progress', () => {
  const { data, db, store } = fixture()
  store.save(data)
  const fresh = createReviewArchiveStore({ storage: () => db }).list().entries[0].archive
  assert.equal(fresh.data.annotations.c14.text, '核对身份😀\n第二行')
  assert.equal(fresh.data.filters.volumeId, '')
  assert.equal(fresh.data.filters.page, 3)
  assert.equal(fresh.data.chapterId, 'c13')
  assert.deepEqual(fresh.data.reviewedIds, ['c1'])
})
test('only whitelisted metadata reaches storage', () => {
  const { data, db, store } = fixture()
  store.save({ ...data, content: 'SECRET', target: { snapshot: 'SECRET' }, chapters: data.chapters.map(c => ({ ...c, content: 'SECRET' })) })
  assert.equal([...db.values.values()].some(raw => raw.includes('SECRET')), false)
  const saved = JSON.parse([...db.values.values()][0]).data
  assert.equal(Object.hasOwn(saved, 'id'), false)
  assert.equal(Object.hasOwn(saved, 'returnToken'), false)
})
test('saving does not change active review or old snapshots', () => {
  const { data, review, store } = fixture()
  const first = store.save(data)
  review.setAnnotation(data.id, 'c14', { text: '新的备注' })
  const second = store.save(review.getSnapshot())
  assert.equal(store.list().entries.length, 2)
  assert.notEqual(first.id, second.id)
  assert.equal(first.data.annotations.c14.text, data.annotations.c14.text)
  assert.equal(review.getSnapshot().annotations.c14.text, '新的备注')
})
test('write failure preserves active data, prior archives and unrelated settings', () => {
  const { data, db, store, review } = fixture()
  store.save(data); db.setItem('theme', 'dark')
  const before = [...db.values]
  db.setItem = () => { throw new Error('quota') }
  assert.throws(() => store.save(data), /写入失败/)
  assert.deepEqual([...db.values], before)
  assert.equal(review.getSnapshot(), data)
})
test('unavailable or blocked storage is reported instead of claiming no records', () => {
  for (const storage of [() => undefined, () => { throw new Error('denied') }]) {
    const store = createReviewArchiveStore({ storage })
    assert.match(store.list().error, /无法读取/)
    assert.throws(() => store.save(fixture().data), /无法读取/)
  }
})
test('oversize archive fails without truncating notes or evicting data', () => {
  const { data, db, store } = fixture()
  const chapters = Array.from({ length: 400 }, (_, i) => ({ id: 'c' + i, title: '章', ordinal: i }))
  const big = { ...data, chapters, chapterId: 'c0', reviewedIds: [], annotations: Object.fromEntries(chapters.map(c => [c.id, { text: '长'.repeat(2000), needsChanges: true }])) }
  assert.throws(() => store.save(big), /记录过大/)
  assert.equal(db.length, 0)
})
test('archive capacity refuses the next save without silently pruning old entries', () => {
  const { data, store } = fixture()
  for (let i = 0; i < 40; i++) store.save(data)
  const before = store.list()
  assert.throws(() => store.save(data), /40/)
  assert.deepEqual(store.list(), before)
})
test('separate windows save independent keys without overwriting each other', () => {
  const { data, db, store } = fixture()
  const another = createReviewArchiveStore({ storage: () => db, createId: () => 'other-window' })
  store.save(data); another.save(data)
  assert.equal(store.list().entries.length, 2)
})
test('ID collision does not overwrite an existing archive', () => {
  const { data, db, store } = fixture()
  store.save(data)
  const collision = createReviewArchiveStore({ storage: () => db, createId: () => 'test-1' })
  assert.throws(() => collision.save(data), /标识冲突/)
  assert.equal(db.length, 1)
})
test('malformed records remain visible as unreadable, without blocking valid records', () => {
  const { data, db, store } = fixture()
  db.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', '{broken')
  store.save(data)
  const view = store.list()
  assert.equal(view.entries.length, 2)
  assert.match(view.entries.find(e => !e.archive).error, /损坏/)
  assert.equal(db.getItem(REVIEW_ARCHIVE_PREFIX + 'broken'), '{broken')
})
test('unsupported versions are rejected and preserved', () => {
  const { data, db, store } = fixture()
  const saved = store.save(data)
  const key = REVIEW_ARCHIVE_PREFIX + saved.id
  db.setItem(key, JSON.stringify({ ...saved, version: 2 }))
  assert.match(store.list().entries[0].error, /版本/)
  assert.throws(() => store.importFile(db.getItem(key)), /格式/)
  assert.equal(db.length, 1)
})
test('storage key and archive identity must match', () => {
  const { data, db, store } = fixture()
  const saved = store.save(data)
  db.setItem(REVIEW_ARCHIVE_PREFIX + 'spoof', JSON.stringify(saved))
  assert.equal(store.list().entries.filter(e => e.error).length, 1)
})
test('delete removes only the expected snapshot, including corrupt records', () => {
  const { db, store } = fixture()
  db.setItem('theme', 'dark'); db.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', 'bad')
  store.remove(store.list().entries[0])
  assert.equal(db.length, 1)
  assert.equal(db.getItem('theme'), 'dark')
})
test('stale delete and read cannot use a record modified by another window', () => {
  const { data, db, store } = fixture()
  store.save(data)
  const entry = store.list().entries[0]
  db.setItem(entry.key, entry.raw + ' ')
  assert.throws(() => store.remove(entry), /另一窗口/)
  assert.throws(() => store.readUnchanged(entry), /另一窗口/)
  assert.equal(db.length, 1)
})
test('non-archive keys cannot be deleted through the archive store', () => {
  const { db, store } = fixture()
  db.setItem('theme', 'dark')
  assert.throws(() => store.remove({ key: 'theme', raw: 'dark' }), /标识/)
  assert.equal(db.getItem('theme'), 'dark')
})
test('delete failure does not publish a fake success', () => {
  const { data, db, store } = fixture()
  store.save(data)
  let count = 0; store.subscribe(() => count++)
  db.removeItem = () => { throw new Error('denied') }
  assert.throws(() => store.remove(store.list().entries[0]), /删除失败/)
  assert.equal(db.length, 1); assert.equal(count, 0)
})
test('subscriptions publish successful saves and deletes only, and can unsubscribe', () => {
  const { data, store } = fixture()
  let count = 0; const remove = store.subscribe(() => count++)
  store.save(data); assert.equal(count, 1)
  store.remove(store.list().entries[0]); assert.equal(count, 2)
  remove(); store.save(data); assert.equal(count, 2)
})
test('JSON import creates an independent record, keeps historical time and strips hidden content', () => {
  const { data, store } = fixture()
  const saved = store.save(data)
  const imported = store.importFile(JSON.stringify({ ...saved, secret: 'SECRET', data: { ...saved.data, content: 'SECRET' } }))
  assert.notEqual(imported.id, saved.id)
  assert.equal(imported.savedAt, saved.savedAt)
  assert.equal(store.list().entries.length, 2)
  assert.equal(JSON.stringify(imported).includes('SECRET'), false)
})
test('invalid imports never modify saved records or active review', () => {
  const { data, store, review } = fixture()
  store.save(data)
  for (const raw of ['null', '{}', '[]', '{broken', 'x'.repeat(MAX_REVIEW_ARCHIVE_LENGTH + 1)]) assert.throws(() => store.importFile(raw))
  assert.equal(store.list().entries.length, 1)
  assert.equal(review.getSnapshot(), data)
})
test('copying makes deep immutable metadata detached from the caller', () => {
  const { data } = fixture()
  const copy = copyArchivedReviewData(data)
  assert.notEqual(copy.annotations, data.annotations)
  assert.throws(() => { copy.chapters[0].title = '改动' }, TypeError)
  assert.throws(() => { copy.annotations.c14.text = '改动' }, TypeError)
  assert.throws(() => { copy.filters.query = '改动' }, TypeError)
})
test('reserved annotation IDs are inert own properties', () => {
  const { data } = fixture()
  const safe = copyArchivedReviewData({ ...data, chapters: [{ id: '__proto__', title: '章', ordinal: 1 }], chapterId: '__proto__', reviewedIds: [],
    annotations: JSON.parse('{"__proto__":{"text":"备注","needsChanges":true}}') })
  assert.equal(Object.getPrototypeOf(safe.annotations), Object.prototype)
  assert.equal(Object.hasOwn(safe.annotations, '__proto__'), true)
  assert.equal(safe.annotations.__proto__.text, '备注')
})
test('invalid identities, missing current chapters, duplicate chapters and foreign notes are rejected', () => {
  const { data } = fixture()
  for (const patch of [{ projectId: '' }, { entityId: {} }, { chapterId: 'missing' },
    { chapters: [...data.chapters, data.chapters[0]] }, { annotations: { unknown: { text: 'x', needsChanges: false } } },
    { reviewedIds: ['missing'] }, { reviewedIds: ['c1', 'c1'] }, { reviewedIds: ['c14'] },
    { filters: { ...data.filters, page: Infinity } }, { filters: { ...data.filters, source: 'bad' } },
    { annotations: { c14: { text: 'x'.repeat(2001), needsChanges: false } } },
    { annotations: { c14: { text: 'x', needsChanges: 'true' } } }]) assert.throws(() => copyArchivedReviewData({ ...data, ...patch }))
})
test('a foreign project or entity cannot be restored', () => {
  const { data, store } = fixture(); const archive = store.save(data)
  for (const patch of [{ projectId: 'other' }, { entityId: 'other' }]) assert.throws(() => planReviewArchiveRestore(archive, { ...scope(data), ...patch }), /切换/)
})
test('deleted or no-longer-matching chapters block restore without losing their notes', () => {
  const { data, store } = fixture(); const archive = store.save(data)
  assert.throws(() => planReviewArchiveRestore(archive, { ...scope(data), chapterQueue: data.chapters.slice(0, -1) }), /1 个原证据章节/)
  assert.equal(store.list().entries[0].archive.data.annotations.c14.needsChanges, true)
})
test('restoration follows current chapter order and names and resets reviewed marks', () => {
  const { data, store } = fixture(); const archive = store.save(data)
  const next = [...data.chapters].reverse().map(c => ({ ...c, title: c.title + '新版' }))
  const result = planReviewArchiveRestore(archive, { ...scope(data), chapterQueue: next, entityLabel: '新名' })
  assert.equal(result.data.chapters[0].id, 'c14')
  assert.equal(result.data.chapters[0].title, '第14章新版')
  assert.equal(result.data.entityLabel, '新名')
  assert.deepEqual(result.data.reviewedIds, [])
  assert.equal(result.resetCount, 1)
  assert.deepEqual(result.data.annotations, data.annotations)
})
test('new matching chapters are counted explicitly for confirmation', () => {
  const { data, store } = fixture(); const archive = store.save(data)
  const result = planReviewArchiveRestore(archive, { ...scope(data), chapterQueue: [...data.chapters, { id: 'new', title: '新章', ordinal: 15 }] })
  assert.equal(result.addedCount, 1)
  assert.equal(result.data.chapters.length, 15)
})
test('restoring requires an empty round and never replaces active or staged work', () => {
  const { data, review } = fixture()
  assert.equal(review.restoreArchive(data), null)
  assert.equal(review.getSnapshot(), data)
  review.end(data.id, { discardAnnotations: true })
  const restored = review.restoreArchive(data)
  assert.ok(restored)
  assert.notEqual(restored.id, data.id)
  assert.deepEqual(restored.reviewedIds, [])
  assert.deepEqual(restored.annotations, data.annotations)
})
test('restored rounds get fresh identities and no return or navigation tokens', () => {
  const { data } = fixture(); const review = createEvidenceReviewSession()
  const restored = review.restoreArchive({ ...data, id: 777, returnToken: 77, target: { content: 'SECRET' } })
  assert.equal(restored.id, 1)
  assert.equal(restored.returnToken, null)
  assert.equal(Object.hasOwn(restored, 'target'), false)
  assert.equal(review.setAnnotation(777, 'c14', { text: 'late callback' }), false)
})
test('malformed restoration leaves the round empty and old archive intact', () => {
  const review = createEvidenceReviewSession()
  assert.equal(review.restoreArchive({}), null)
  assert.equal(review.getSnapshot(), null)
})
test('invalid JSON dates, formats and IDs are rejected', () => {
  const { data, store } = fixture(); const archive = store.save(data)
  for (const patch of [{ savedAt: 'bad' }, { savedAt: '2026-09-23' }, { id: '../a' }, { format: 'unknown' }, { version: '1' }]) {
    assert.throws(() => readReviewArchive(JSON.stringify({ ...archive, ...patch })))
  }
})
