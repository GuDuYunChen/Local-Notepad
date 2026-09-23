import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEvidenceReviewSession, normalizeEvidenceReviewFilters, MAX_REVIEW_CHAPTERS } from '../src/services/evidenceReviewSession.js'
import { selectProjectEntityEvidence } from '../src/components/projectEntityEvidenceUtils.js'
const context = { projectId: 'p1', entityId: 'a', entityLabel: '关关', filters: { query: '早市', source: 'alias', volumeId: '', page: 3 } }
const chapters = Array.from({ length: 15 }, (_, i) => ({ id: 'c' + i, title: '章' + i, ordinal: i + 1, content: 'MUST NOT RETAIN' }))
const start = store => store.start(context, chapters, 'c12')

test('keeps only metadata, not manuscript or arbitrary context fields', () => {
  const store = createEvidenceReviewSession(); start(store)
  assert.equal(JSON.stringify(store.getSnapshot()).includes('MUST NOT RETAIN'), false)
  assert.equal(store.getSnapshot().chapters.length, 15)
})
test('snapshots are immutable and stable between reads', () => {
  const store = createEvidenceReviewSession(); start(store)
  const value = store.getSnapshot()
  assert.equal(store.getSnapshot(), value)
  assert.throws(() => value.chapters.push({ id: 'injected' }))
  assert.throws(() => value.filters.page = 20)
  assert.throws(() => value.chapters[0].title = 'changed')
})
test('rejects missing identities and invalid queues without replacing an active session', () => {
  const store = createEvidenceReviewSession(); const previous = start(store)
  for (const args of [[{}, chapters, 'c1'], [context, {}, 'c1'], [context, chapters, 'missing'], [context, [], 'c1']]) {
    assert.equal(store.start(...args), null)
    assert.equal(store.getSnapshot(), previous)
  }
})
test('rejects oversized queues rather than silently truncating the review scope', () => {
  assert.equal(createEvidenceReviewSession().start(context, Array(MAX_REVIEW_CHAPTERS + 1), 'c1'), null)
})
test('deduplicates chapters without reordering or retaining mutable caller objects', () => {
  const store = createEvidenceReviewSession()
  const input = [chapters[2], chapters[1], chapters[2], null]
  const value = store.start(context, input, 'c1')
  assert.deepEqual(value.chapters.map(x => x.id), ['c2', 'c1'])
  assert.notEqual(value.chapters[0], input[0])
})
test('return requests are scoped to both project and entity', () => {
  const store = createEvidenceReviewSession(); const value = start(store)
  assert.equal(store.getReturn(), null)
  store.requestReturn(value.id)
  assert.equal(store.getReturn('p1', 'a').chapterId, 'c12')
  assert.equal(store.getReturn('p2', 'a'), null)
  assert.equal(store.getReturn('p1', 'other'), null)
})
test('return tokens are consumed only once and cannot consume a newer return', () => {
  const store = createEvidenceReviewSession(); const value = start(store)
  store.requestReturn(value.id); const first = store.getReturn()
  store.requestReturn(value.id); const second = store.getReturn()
  assert.equal(store.finishReturn(value.id, first.returnToken), false)
  assert.equal(store.finishReturn(value.id, second.returnToken), true)
  assert.equal(store.finishReturn(value.id, second.returnToken), false)
})
test('stale callbacks cannot close or mutate a newer session', () => {
  const store = createEvidenceReviewSession(); const first = start(store); const second = start(store)
  assert.equal(store.end(first.id), false)
  assert.equal(store.visit(first.id, 'c1'), false)
  assert.equal(store.setReviewed(first.id, 'c1', true), false)
  assert.equal(store.requestReturn(first.id), false)
  assert.equal(store.getSnapshot().id, second.id)
})
test('visiting a chapter does not automatically mark it reviewed', () => {
  const store = createEvidenceReviewSession(); const value = start(store)
  assert.equal(store.visit(value.id, 'c14'), true)
  assert.equal(store.getSnapshot().chapterId, 'c14')
  assert.deepEqual(store.getSnapshot().reviewedIds, [])
  assert.equal(store.visit(value.id, 'outside'), false)
})
test('manual review toggles are idempotent and preserve unrelated progress', () => {
  const store = createEvidenceReviewSession(); const value = start(store)
  store.setReviewed(value.id, 'c1', true); store.setReviewed(value.id, 'c2', true)
  const prior = store.getSnapshot(); store.setReviewed(value.id, 'c2', true)
  assert.equal(store.getSnapshot(), prior)
  store.setReviewed(value.id, 'c1', false)
  assert.deepEqual(store.getSnapshot().reviewedIds, ['c2'])
})
test('re-entering the same filter preserves only still-present reviewed chapters', () => {
  const store = createEvidenceReviewSession(); const value = start(store)
  store.setReviewed(value.id, 'c1', true); store.setReviewed(value.id, 'c2', true)
  store.start(context, chapters.slice(2), 'c12')
  assert.deepEqual(store.getSnapshot().reviewedIds, ['c2'])
})
test('changing project entity or filter starts separate progress', () => {
  for (const patch of [{ projectId: 'p2' }, { entityId: 'b' }, { filters: { source: 'canonical' } }]) {
    const store = createEvidenceReviewSession(); const value = start(store)
    store.setReviewed(value.id, 'c1', true)
    store.start({ ...context, ...patch }, chapters, 'c1')
    assert.deepEqual(store.getSnapshot().reviewedIds, [])
  }
})
test('ending a session removes both queue and return state', () => {
  const store = createEvidenceReviewSession(); const value = start(store); store.requestReturn(value.id)
  store.end(value.id)
  assert.equal(store.getSnapshot(), null); assert.equal(store.getReturn(), null)
})
test('subscriptions unsubscribe cleanly and no-op updates do not notify', () => {
  const store = createEvidenceReviewSession(); let calls = 0
  const off = store.subscribe(() => calls++)
  const value = start(store); store.visit(value.id, 'c12')
  assert.equal(calls, 1)
  off(); store.end(value.id); assert.equal(calls, 1)
})
test('normalizes invalid filters and preserves the ungrouped-volume identity', () => {
  assert.deepEqual(normalizeEvidenceReviewFilters({ source: 'bad', page: Infinity, volumeId: '' }), {
    query: '', source: 'all', volumeId: '', page: 1,
  })
  assert.equal(normalizeEvidenceReviewFilters({ page: 2.9 }).page, 2)
  assert.equal(normalizeEvidenceReviewFilters(null).volumeId, null)
})
function model(count = 15) {
  return { entityById: new Map([['a', { evidence: chapters.slice(0, count).map(c => ({ chapterId: c.id, chapterTitle: c.title, ordinal: c.ordinal })) }]]),
    chapterEntities: Object.fromEntries(chapters.map(c => [c.id, [{ node: { id: 'a' }, canonicalCount: 1 }]])) }
}
test('review queues include all filtered chapters, not only visible rows', () => {
  const view = selectProjectEntityEvidence(model(), 'a', { page: 2 })
  assert.equal(view.chapterQueue.length, 15); assert.equal(view.rows.length, 6)
})
test('returning follows the chapter identity after reordering', () => {
  const data = model(); data.entityById.get('a').evidence[12].ordinal = 0
  const view = selectProjectEntityEvidence(data, 'a', { page: 3, focusChapterId: 'c12' })
  assert.equal(view.page, 1); assert.equal(view.rows[0].chapterId, 'c12')
})
test('removed return targets use bounded pagination without claiming a match', () => {
  const view = selectProjectEntityEvidence(model(2), 'a', { page: 3, focusChapterId: 'removed' })
  assert.equal(view.page, 1); assert.equal(view.chapterQueue.some(c => c.id === 'removed'), false)
})
