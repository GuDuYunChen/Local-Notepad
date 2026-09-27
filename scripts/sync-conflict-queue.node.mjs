import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { indexConflictQueue, conflictQueuePage, CONFLICT_QUEUE_PAGE_SIZE, CONFLICT_QUEUE_MAX_ITEMS } from '../src/services/syncConflictQueue.mjs'
import { queueFixture, queueAttachment } from './fixtures/sync-conflict-queue.mjs'

test('all rows are reachable once in original server order over three pages', () => {
  const raw = queueFixture(), model = indexConflictQueue(raw), ids = []
  for (let page = 1; page <= 3; page++) {
    const result = conflictQueuePage(model, { page })
    assert.ok(result.rows.length <= CONFLICT_QUEUE_PAGE_SIZE)
    ids.push(...result.rows.map(entry => entry.id))
  }
  assert.equal(model.valid, true); assert.deepEqual(ids, raw.map(c => c.id)); assert.equal(new Set(ids).size, 25)
})
test('the small metadata index is immutable and never retains caller bodies or credentials', () => {
  const raw = queueFixture(1); raw[0].password = 'SECRET'; raw[0].local_record.file.content = 'PRIVATE-BODY'
  const original = JSON.stringify(raw), model = indexConflictQueue(raw)
  assert.equal(JSON.stringify(raw), original)
  assert.doesNotMatch(JSON.stringify(model), /SECRET|PRIVATE-BODY|local_hash|local_record/)
  raw[0].local_record.file.title = 'changed'
  assert.equal(model.entries[0].localLabel, '本机笔记 001')
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.entries) && Object.isFrozen(model.counts))
  assert.throws(() => { model.entries[0].localLabel = 'bad' }, TypeError)
})
test('both names, object ID and conflict ID are searchable, but body and hash are not', () => {
  const model = indexConflictQueue(queueFixture(2))
  for (const query of ['本机笔记 002', '远端笔记 002', 'note-002', 'conflict-002']) {
    assert.equal(conflictQueuePage(model, { query }).rows[0].index, 1)
  }
  for (const query of ['本机正文', 'a'.repeat(64)]) assert.equal(conflictQueuePage(model, { query }).matched, 0)
})
test('search is literal NFC/case-folded text, never a regular expression', () => {
  const raw = queueFixture(1); raw[0].local_record.file.title = 'CAFÉ [a]'
  const model = indexConflictQueue(raw)
  assert.equal(conflictQueuePage(model, { query: 'cafe\u0301' }).matched, 1)
  assert.equal(conflictQueuePage(model, { query: '[a]' }).matched, 1)
  assert.equal(conflictQueuePage(model, { query: '.*' }).matched, 0)
})
test('attachment name and tombstone label remain searchable with correct kind', () => {
  const model = indexConflictQueue([queueAttachment()])
  assert.equal(model.entries[0].kind, 'attachment')
  assert.equal(conflictQueuePage(model, { query: '资料😀', kind: 'attachment' }).matched, 1)
  assert.equal(conflictQueuePage(model, { query: '已永久删除' }).matched, 1)
  assert.equal(conflictQueuePage(model, { kind: 'file' }).matched, 0)
})
test('kind counts include files, tags, relations, attachments and unknown types', () => {
  const raw = queueFixture(5)
  for (const [i, kind] of ['file', 'tag', 'file-tag', 'attachment', 'future-kind'].entries()) {
    raw[i].local_record = { kind, state: 'purged' }; raw[i].remote_record = { kind, state: 'purged' }
  }
  const model = indexConflictQueue(raw)
  assert.deepEqual(model.counts, { file: 1, tag: 1, 'file-tag': 1, attachment: 1, other: 1 })
  for (const kind of Object.keys(model.counts)) assert.equal(conflictQueuePage(model, { kind }).matched, 1)
})
test('a folder and a purged file share the honest file/folder filter', () => {
  const raw = queueFixture(2); raw[0].local_record.file.is_folder = true
  raw[1].remote_record = { kind: 'file', state: 'purged' }
  assert.equal(indexConflictQueue(raw).counts.file, 2)
})
test('mixed or missing kinds do not get invented types or selectable empty records', () => {
  const raw = queueFixture(3)
  raw[0].local_record = null; raw[0].local_hash = ''
  raw[1].remote_record = { kind: 'tag', state: 'purged' }
  raw[2].local_record = null; raw[2].remote_record = null
  const model = indexConflictQueue(raw)
  assert.deepEqual(model.entries.map(e => e.kind), ['file', 'other', 'other'])
  assert.equal(model.entries[0].localLabel, '不存在')
})
test('status not explicitly open stays visible but is never labeled actionable', () => {
  const raw = queueFixture(3); delete raw[0].status; raw[1].status = 'resolved'
  const model = indexConflictQueue(raw)
  assert.deepEqual(model.entries.map(e => e.open), [false, false, true]); assert.equal(model.total, 3)
})
for (const value of [null, {}, 'invalid']) test('non-array input fails rather than becoming zero: ' + String(value), () => {
  const model = indexConflictQueue(value); assert.equal(model.valid, false); assert.equal(model.total, null)
})
test('duplicate lifecycle IDs fail the entire actionable list without hiding a duplicate', () => {
  const raw = queueFixture(2); raw[1].id = raw[0].id
  const model = indexConflictQueue(raw); assert.equal(model.valid, false); assert.equal(model.total, 2)
  assert.equal(model.entries.length, 0); assert.match(model.message, /重复/)
})
test('repeated object IDs are valid independent conflict lifecycles', () => {
  const raw = queueFixture(2); raw[1].item_id = raw[0].item_id
  assert.equal(indexConflictQueue(raw).valid, true)
})
test('invalid identities and oversized fields cannot produce partial actionable rows', () => {
  for (const change of [c => { c.id = '' }, c => { c.item_id = 3 }, c => { c.id = 'x'.repeat(4097) }, c => { c.local_record.file.title = 'x'.repeat(4097) }]) {
    const raw = queueFixture(2); change(raw[1])
    const model = indexConflictQueue(raw); assert.equal(model.valid, false); assert.equal(model.entries.length, 0)
  }
})
test('identifier property names and hostile-looking titles remain inert strings', () => {
  const raw = queueFixture(2); raw[0].id = '__proto__'; raw[1].id = 'constructor'
  raw[1].local_record.file.title = '<img src=x onerror=alert(1)>'
  const model = indexConflictQueue(raw)
  assert.equal(model.valid, true); assert.equal(conflictQueuePage(model, { query: '<img' }).matched, 1)
})
test('empty input, search miss, missing data and oversize input have distinct outcomes', () => {
  const empty = indexConflictQueue([]); assert.equal(empty.valid, true); assert.equal(empty.total, 0)
  assert.equal(conflictQueuePage(indexConflictQueue(queueFixture(2)), { query: 'missing' }).total, 2)
  const huge = indexConflictQueue(new Array(CONFLICT_QUEUE_MAX_ITEMS + 1))
  assert.equal(huge.valid, false); assert.match(huge.message, /50,000/)
})
test('index budget cannot silently discard a suffix of the list', () => {
  const raw = queueFixture(1200)
  for (const c of raw) { c.local_record.file.title = 'x'.repeat(4000); c.remote_record.file.title = 'y'.repeat(4000) }
  const model = indexConflictQueue(raw)
  assert.equal(model.valid, false); assert.equal(model.total, 1200); assert.equal(model.entries.length, 0)
})
test('page and kind inputs are clamped, never used as object prototype keys', () => {
  const model = indexConflictQueue(queueFixture())
  for (const page of [NaN, Infinity, '2', -1, 0, 1.5]) assert.equal(conflictQueuePage(model, { page }).page, 1)
  assert.equal(conflictQueuePage(model, { page: 999 }).page, 3)
  assert.equal(conflictQueuePage(model, { kind: '__proto__' }).kind, 'all')
})
test('filter and search compose without changing full-list type totals', () => {
  const model = indexConflictQueue([...queueFixture(2), queueAttachment()])
  const page = conflictQueuePage(model, { query: '资料', kind: 'attachment', page: 5 })
  assert.equal(page.total, 3); assert.equal(page.matched, 1); assert.equal(page.page, 1)
  assert.deepEqual(model.counts, { file: 2, tag: 0, 'file-tag': 0, attachment: 1, other: 0 })
})
test('returned positions always point back to the correct original record', () => {
  const raw = queueFixture(45).reverse(), model = indexConflictQueue(raw)
  for (let page = 1; page <= 5; page++) for (const entry of conflictQueuePage(model, { page }).rows) {
    assert.equal(raw[entry.index].id, entry.id)
  }
})
test('search takes at most 256 input units without unbounded regex or persistence', () => {
  const model = indexConflictQueue(queueFixture(1))
  assert.equal(conflictQueuePage(model, { query: 'x'.repeat(100000) }).matched, 0)
  const source = fs.readFileSync(new URL('../src/services/syncConflictQueue.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage|\bfetch\s*\(|\bapi\s*\(|\.content\b|JSON.stringify\(conflicts/)
})
