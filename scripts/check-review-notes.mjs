import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvidenceReviewSession } from '../src/services/evidenceReviewSession.js'
import {
  MAX_REVIEW_NOTE_LENGTH, buildEvidenceReviewReport, getReviewAnnotation,
  hasReviewAnnotations, nextUnreviewedChapter, reviewRows, reviewTotals, selectReviewRows,
} from '../src/services/evidenceReviewReport.js'
const context = { projectId: 'p', entityId: 'a', entityLabel: '关关', filters: { source: 'alias', volumeId: '', query: '小关', page: 2 } }
const chapters = Array.from({ length: 19 }, (_, i) => ({ id: 'c' + i, title: `第${i + 1}章.md`, ordinal: i + 1, content: 'PRIVATE_MANUSCRIPT' }))
function fixture() { const store = createEvidenceReviewSession(); const s = store.start(context, chapters, 'c0'); store.commitStart(s.id); return { store, id: s.id } }

test('stores only typed note metadata, not caller fields or manuscript', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: '核对称呼', needsChanges: true, content: 'SECRET', other: {} })
  assert.deepEqual(getReviewAnnotation(store.getSnapshot(), 'c0'), { text: '核对称呼', needsChanges: true })
  assert(!JSON.stringify(store.getSnapshot()).includes('SECRET')); assert(!JSON.stringify(store.getSnapshot()).includes('PRIVATE_MANUSCRIPT'))
})
test('note snapshots are immutable, stable and detached from caller objects', () => {
  const { store, id } = fixture(); const patch = { text: '疑点' }; store.setAnnotation(id, 'c0', patch); patch.text = 'changed'
  const snapshot = store.getSnapshot(); assert.equal(snapshot, store.getSnapshot())
  assert.throws(() => { snapshot.annotations.c0.text = 'overwritten' }); assert.throws(() => { snapshot.annotations.c1 = {} })
  assert.equal(snapshot.annotations.c0.text, '疑点')
})
test('rejects oversized or malformed notes without truncation or mutation', () => {
  const { store, id } = fixture(); const old = store.getSnapshot()
  for (const patch of [null, [], 'x', { text: 4 }, { text: 'a'.repeat(MAX_REVIEW_NOTE_LENGTH + 1) }, { needsChanges: 'true' }]) {
    assert.equal(store.setAnnotation(id, 'c0', patch), false); assert.equal(store.getSnapshot(), old)
  }
})
test('accepts the exact text limit and preserves Unicode and line breaks', () => {
  const { store, id } = fixture(); const text = '😀'.repeat(1000)
  assert(store.setAnnotation(id, 'c0', { text })); assert.equal(store.getSnapshot().annotations.c0.text, text)
  store.setAnnotation(id, 'c0', { text: 'E\u0301lodie\n二段\t空格' }); assert.equal(store.getSnapshot().annotations.c0.text, 'E\u0301lodie\n二段\t空格')
})
test('unrelated chapters and obsolete callbacks cannot change notes', () => {
  const { store, id } = fixture(); assert.equal(store.setAnnotation(id, 'outside', { text: 'no' }), false)
  const next = store.start(context, chapters, 'c1'); assert.equal(store.setAnnotation(id, 'c1', { text: 'late' }), false)
  assert.equal(hasReviewAnnotations(store.getSnapshot()), false); assert.equal(store.getSnapshot().id, next.id)
})
test('reserved property IDs cannot change object prototypes', () => {
  const store = createEvidenceReviewSession(); const s = store.start(context, [{ id: '__proto__' }, { id: 'constructor' }], '__proto__')
  assert.equal(getReviewAnnotation(s, '__proto__'), null)
  store.setAnnotation(s.id, '__proto__', { text: '原型名称', needsChanges: true })
  store.setAnnotation(s.id, 'constructor', { text: '构造名称' })
  assert.equal(Object.getPrototypeOf(store.getSnapshot().annotations), Object.prototype)
  assert.equal(store.getSnapshot().annotations.__proto__.text, '原型名称')
  assert.equal({}.text, undefined); assert.equal(reviewRows(store.getSnapshot())[0].state, 'changes')
})
test('flagging a reviewed chapter removes only its reviewed mark', () => {
  const { store, id } = fixture(); store.setReviewed(id, 'c0', true); store.setReviewed(id, 'c1', true)
  store.setAnnotation(id, 'c0', { needsChanges: true }); assert.deepEqual(store.getSnapshot().reviewedIds, ['c1'])
  assert.equal(store.setReviewed(id, 'c0', true), false)
})
test('resolving an issue does not infer review completion or delete its note', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: '已修订称呼', needsChanges: true }); store.setAnnotation(id, 'c0', { needsChanges: false })
  assert.equal(reviewRows(store.getSnapshot())[0].state, 'pending'); assert.equal(store.getSnapshot().annotations.c0.text, '已修订称呼')
  assert(store.setReviewed(id, 'c0', true)); assert.equal(reviewRows(store.getSnapshot())[0].state, 'reviewed')
})
test('invalidating review after manuscript editing keeps the user note', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: '保留' }); store.setReviewed(id, 'c0', true); store.setReviewed(id, 'c0', false)
  assert.equal(store.getSnapshot().annotations.c0.text, '保留')
})
test('emptying a note removes its record only when it has no issue flag', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: 'xx', needsChanges: true }); store.setAnnotation(id, 'c0', { text: '' })
  assert(hasReviewAnnotations(store.getSnapshot())); store.setAnnotation(id, 'c0', { needsChanges: false }); assert(!hasReviewAnnotations(store.getSnapshot()))
})
test('no-op edits do not trigger new snapshots or notifications', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: 'same' }); const snapshot = store.getSnapshot(); let calls = 0
  store.subscribe(() => calls++); store.setAnnotation(id, 'c0', { text: 'same' }); assert.equal(calls, 0); assert.equal(store.getSnapshot(), snapshot)
})
test('retains annotations on the same scope and follows chapter identity after reorder', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: '疑点' }); const next = store.start({ ...context, filters: { ...context.filters, page: 1 } }, [...chapters].reverse(), 'c18')
  assert(next); assert.equal(next.annotations.c0.text, '疑点'); assert.equal(reviewRows(next)[18].note, '疑点')
})
test('blocks scope replacement or shrinking that would erase annotations', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { text: '不能丢失' }); const snapshot = store.getSnapshot()
  for (const patch of [{ projectId: 'other' }, { entityId: 'other' }, { filters: { source: 'all' } }]) assert.equal(store.start({ ...context, ...patch }, chapters, 'c0'), null)
  assert.equal(store.start(context, chapters.slice(1), 'c1'), null); assert.equal(store.getSnapshot(), snapshot)
})
test('refused end protects notes and clears a dead project return token', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c0', { needsChanges: true }); store.requestReturn(id)
  assert.equal(store.end(id), false); assert.equal(store.getReturn(), null); assert.equal(store.getSnapshot().annotations.c0.needsChanges, true)
  assert(store.end(id, { discardAnnotations: true })); assert.equal(store.getSnapshot(), null)
})
test('old confirm cannot discard a newer session', () => {
  const { store, id } = fixture(); const next = store.start(context, chapters, 'c1'); store.setAnnotation(next.id, 'c1', { text: '新记录' })
  assert.equal(store.end(id, { discardAnnotations: true }), false); assert.equal(store.getSnapshot().id, next.id)
})
test('cancelled reopen rolls back previous notes, progress and chapter', () => {
  const { store, id } = fixture(); store.setReviewed(id, 'c2', true); store.setAnnotation(id, 'c0', { text: '保留' }); const previous = store.getSnapshot()
  const next = store.start(context, chapters, 'c1'); assert(store.cancelStart(next.id)); assert.equal(store.getSnapshot(), previous)
})
test('late cancellation cannot roll back a newer or committed open', () => {
  const { store } = fixture(); const a = store.start(context, chapters, 'c1'); const b = store.start(context, chapters, 'c2')
  assert.equal(store.cancelStart(a.id), false); assert(store.commitStart(b.id)); assert.equal(store.cancelStart(b.id), false)
})
test('user annotation during staged open is not discarded by late failure', () => {
  const { store } = fixture(); const s = store.start(context, chapters, 'c1'); store.setAnnotation(s.id, 'c1', { text: '新输入' })
  assert.equal(store.cancelStart(s.id), false); assert.equal(store.getSnapshot().annotations.c1.text, '新输入')
})
test('next incomplete chapter skips reviewed entries and wraps at most once', () => {
  const { store, id } = fixture(); for (let i = 1; i < 18; i++) store.setReviewed(id, 'c' + i, true)
  assert.equal(nextUnreviewedChapter(store.getSnapshot(), 'c0').id, 'c18')
  assert.equal(nextUnreviewedChapter(store.getSnapshot(), 'c18').id, 'c0')
  store.setReviewed(id, 'c0', true); assert.equal(nextUnreviewedChapter(store.getSnapshot(), 'c18'), null)
  assert.equal(nextUnreviewedChapter(store.getSnapshot(), 'outside'), null)
})
test('next incomplete chapter includes unresolved issues', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c1', { needsChanges: true }); assert.equal(nextUnreviewedChapter(store.getSnapshot(), 'c0').id, 'c1')
})
test('totals partition reviewed, pending and needs changes without double counting notes', () => {
  const { store, id } = fixture(); store.setReviewed(id, 'c0', true); store.setAnnotation(id, 'c1', { text: '疑点', needsChanges: true }); store.setAnnotation(id, 'c0', { text: '已看' })
  assert.deepEqual(reviewTotals(reviewRows(store.getSnapshot())), { total: 19, reviewed: 1, pending: 17, changes: 1, noted: 2 })
})
test('status and search filters compose and pagination is bounded', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c18', { text: 'Élodie疑点', needsChanges: true }); const rows = reviewRows(store.getSnapshot())
  assert.equal(selectReviewRows(rows, { state: 'changes', query: 'E\u0301LODIE' }).rows[0].id, 'c18')
  assert.equal(selectReviewRows(rows, { page: 3 }).rows.length, 3); assert.equal(selectReviewRows(rows, { page: 999 }).page, 3)
  assert.equal(selectReviewRows(rows, { page: Infinity }).page, 1); assert.equal(selectReviewRows(rows, { query: '不存在' }).total, 0)
})
test('reports export all scope chapters, notes and explicit provenance without body text', () => {
  const { store, id } = fixture(); store.setAnnotation(id, 'c18', { text: '第十九章疑点', needsChanges: true })
  const snapshot = store.getSnapshot(); const report = buildEvidenceReviewReport(snapshot, new Date('2026-09-23T00:00:00Z'))
  assert.equal((report.match(/^## /gm) || []).length, 19); assert(report.includes('第十九章疑点')); assert(report.includes('进入时来源：别名')); assert(report.includes('进入时卷范围：未分卷'))
  assert(!report.includes('PRIVATE_MANUSCRIPT')); assert.equal(store.getSnapshot(), snapshot)
})
test('Markdown escaping prevents notes or titles from becoming active markup', () => {
  const store = createEvidenceReviewSession(); const s = store.start(context, [{ id: '<id>', title: '# X\n[bad](https://bad) | title', ordinal: 1 }], '<id>')
  store.setAnnotation(s.id, '<id>', { text: '<script>alert(1)</script>\n# fake\n[x](javascript:alert(1))\n```' })
  const report = buildEvidenceReviewReport(store.getSnapshot()); assert(!report.includes('<script>')); assert(!report.includes('\n# fake')); assert(!report.includes('[x](javascript:')); assert.equal((report.match(/^## /gm)||[]).length, 1)
})
test('empty sessions cannot claim an exported review', () => {
  assert.throws(() => buildEvidenceReviewReport(null), /没有/); assert.deepEqual(reviewRows(null), []); assert.equal(nextUnreviewedChapter(null, 'c0'), null)
})
