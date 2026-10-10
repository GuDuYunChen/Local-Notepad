import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { indexConflictQueue, conflictQueuePage, CONFLICT_QUEUE_ORDERS, formatConflictCreatedAt } from '../src/services/syncConflictQueue.mjs'
import { queueFixture, queueAttachment } from './fixtures/sync-conflict-queue.mjs'
import { tombstone } from './fixtures/sync-conflict-risk.mjs'
const ids = (model, options) => conflictQueuePage(model, options).rows.map(row => row.id)
const named = (...numbers) => numbers.map(n => 'conflict-' + String(n).padStart(3, '0'))
const timed = values => queueFixture(values.length).map((c, i) => ({ ...c, created_at: values[i] }))

test('default ordering preserves the exact server order rather than inferring newest first', () => {
  const raw = timed([10, 30, 20]), model = indexConflictQueue(raw)
  assert.deepEqual(ids(model), named(1, 2, 3))
  assert.equal(conflictQueuePage(model).order, 'server')
})
test('newest and oldest compare conflict creation times and preserve ties', () => {
  const model = indexConflictQueue(timed([10, 30, 20, 30, 10]))
  assert.deepEqual(ids(model, { order: 'newest' }), named(2, 4, 3, 1, 5))
  assert.deepEqual(ids(model, { order: 'oldest' }), named(1, 5, 3, 2, 4))
})
test('attention-first is a stable partition, not a severity or side-selection recommendation', () => {
  const raw = timed([90, 80, 70, 60, 50])
  raw[1].remote_record = tombstone(raw[1].remote_record)
  raw[3].local_record.file.is_deleted = true
  raw[4].local_record = null
  const model = indexConflictQueue(raw)
  assert.deepEqual(ids(model, { order: 'attention' }), named(2, 4, 5, 1, 3))
  assert.equal(model.riskCounts.attention, 3)
})
test('invalid or missing time is unknown and remains last in both time orders', () => {
  const invalid = [undefined, null, 0, -1, '10', NaN, Infinity, 1.1, 8640000000001, {}, []]
  for (const value of invalid) {
    const model = indexConflictQueue(timed([value, 20, 10, value]))
    assert.equal(model.entries[0].createdAt, null)
    assert.deepEqual(ids(model, { order: 'newest' }), named(2, 3, 1, 4))
    assert.deepEqual(ids(model, { order: 'oldest' }), named(3, 2, 1, 4))
  }
})
test('UTC display is explicit and does not substitute the current time for unknown metadata', () => {
  assert.equal(formatConflictCreatedAt(1), '1970-01-01 00:00:01 UTC')
  assert.equal(formatConflictCreatedAt(1704067200), '2024-01-01 00:00:00 UTC')
  for (const value of [null, 0, '1704067200', NaN, 8640000000001]) assert.equal(formatConflictCreatedAt(value), '时间未提供或无效')
  assert.equal(formatConflictCreatedAt(8640000000000), '+275760-09-13 00:00:00 UTC')
})
test('body and file creation/update time are never consulted when ordering', () => {
  const raw = timed([10, 20])
  for (const c of raw) for (const side of ['local_record', 'remote_record']) {
    for (const key of ['content', 'updated_at', 'created_at']) Object.defineProperty(c[side].file, key, { get() { throw new Error('body metadata read: ' + key) } })
  }
  for (const c of raw) for (const key of ['password', 'local_hash', 'remote_hash']) Object.defineProperty(c, key, { get() { throw new Error('secret/hash read') } })
  assert.deepEqual(ids(indexConflictQueue(raw), { order: 'newest' }), named(2, 1))
})
test('time and attention ordering never sort the source array or frozen metadata index in place', () => {
  const raw = timed([50, 10, 30]); raw[1].local_record.file.is_deleted = true
  const before = JSON.stringify(raw), model = indexConflictQueue(raw), beforeIndex = JSON.stringify(model)
  Object.freeze(raw)
  for (const [order] of CONFLICT_QUEUE_ORDERS) conflictQueuePage(model, { order })
  assert.equal(JSON.stringify(raw), before); assert.equal(JSON.stringify(model), beforeIndex)
  assert.ok(Object.isFrozen(model.entries[0])); assert.ok(Object.isFrozen(CONFLICT_QUEUE_ORDERS))
  assert.ok(CONFLICT_QUEUE_ORDERS.every(Object.isFrozen))
})
test('an older captured index is isolated from later source timestamp edits', () => {
  const raw = timed([10, 20]), before = indexConflictQueue(raw)
  raw[0].created_at = 30
  assert.deepEqual(ids(before, { order: 'newest' }), named(2, 1))
  assert.deepEqual(ids(indexConflictQueue(raw), { order: 'newest' }), named(1, 2))
})
test('all orderings keep row indices pointing at the original full conflict', () => {
  const raw = queueFixture(47).reverse()
  raw[12].local_record.file.is_deleted = true
  const model = indexConflictQueue(raw)
  for (const [order] of CONFLICT_QUEUE_ORDERS) for (let page = 1; page <= 5; page++) {
    for (const row of conflictQueuePage(model, { order, page }).rows) assert.equal(raw[row.index].id, row.id)
  }
})
test('all 47 filtered records are reachable exactly once in either time order', () => {
  const raw = queueFixture(47), model = indexConflictQueue(raw)
  for (const order of ['newest', 'oldest']) {
    const found = []
    for (let page = 1; page <= 5; page++) found.push(...ids(model, { order, page }))
    const expected = raw.map(c => c.id)
    assert.deepEqual(found, order === 'newest' ? expected : expected.reverse())
    assert.equal(new Set(found).size, raw.length)
  }
})
test('search, object type, concerns, ordering and last-page clamping compose', () => {
  const raw = [...queueFixture(3), queueAttachment('old-attachment'), queueAttachment('new-attachment')]
  raw[3].created_at = 10; raw[4].created_at = 20
  const model = indexConflictQueue(raw)
  const result = conflictQueuePage(model, { query: '资料😀', kind: 'attachment', risk: 'permanent', order: 'newest', page: 999 })
  assert.deepEqual(result.rows.map(row => row.id), ['new-attachment', 'old-attachment'])
  assert.equal(result.total, 5); assert.equal(result.matched, 2); assert.equal(result.page, 1)
  assert.equal(model.riskCounts.permanent, 2); assert.equal(model.counts.file, 3)
})
test('all-unknown times preserve service order rather than inventing a chronology', () => {
  const model = indexConflictQueue(timed([null, 0, undefined, NaN]))
  assert.deepEqual(ids(model, { order: 'oldest' }), named(1, 2, 3, 4))
  assert.deepEqual(ids(model, { order: 'newest' }), named(1, 2, 3, 4))
})
test('unknown ordering values fall back safely without indexing prototype properties', () => {
  const model = indexConflictQueue(timed([10, 30, 20]))
  for (const order of ['__proto__', 'constructor', null, {}, [], 1, '']) {
    const page = conflictQueuePage(model, { order }); assert.equal(page.order, 'server'); assert.deepEqual(page.rows.map(row => row.id), named(1, 2, 3))
  }
})
test('sorting never turns malformed input or a filter miss into a valid empty source', () => {
  assert.equal(indexConflictQueue(null).valid, false)
  const invalid = conflictQueuePage(indexConflictQueue(null), { order: 'newest' })
  assert.equal(invalid.total, null); assert.deepEqual(invalid.rows, [])
  const miss = conflictQueuePage(indexConflictQueue(queueFixture(2)), { order: 'oldest', query: 'absent' })
  assert.equal(miss.total, 2); assert.equal(miss.matched, 0); assert.equal(miss.pages, 1)
})
test('closed lifecycles keep their non-actionable flag after sorting to the first position', () => {
  const raw = timed([10, 30]); raw[1].status = 'resolved'
  for (const order of ['newest', 'attention']) {
    const row = conflictQueuePage(indexConflictQueue(raw), { order }).rows[0]
    assert.equal(row.id, 'conflict-002'); assert.equal(row.open, false)
  }
})
test('opaque identifiers and record ties are not replaced by display-order positions', () => {
  const raw = timed([10, 10, 10]); raw[0].id = '__proto__'; raw[1].item_id = raw[2].item_id
  const model = indexConflictQueue(raw)
  assert.equal(model.valid, true); assert.deepEqual(ids(model, { order: 'oldest' }), raw.map(c => c.id))
})
test('time ordering obeys all ties in a deterministic 1000-record model', () => {
  const raw = queueFixture(1000).map((c, i) => ({ ...c, created_at: i % 17 === 0 ? null : 100 + (i % 23) }))
  const model = indexConflictQueue(raw)
  for (const order of ['oldest', 'newest']) {
    const rows = []
    for (let page = 1; page <= 100; page++) rows.push(...conflictQueuePage(model, { order, page }).rows)
    assert.equal(new Set(rows.map(row => row.id)).size, 1000)
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      if (a.createdAt === null) assert.equal(b.createdAt, null)
      if (a.createdAt === b.createdAt) assert.ok(a.index < b.index)
      if (a.createdAt !== null && b.createdAt !== null) assert.ok(order === 'oldest' ? a.createdAt <= b.createdAt : a.createdAt >= b.createdAt)
    }
  }
})
test('read-only ordering retains no persistence, network, resolver or body capability', () => {
  const source = fs.readFileSync(new URL('../src/services/syncConflictQueue.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage|electronAPI|\.content\b|\bfetch\s*\(|\bapi\s*\(|applyReviewedConflict/)
})
