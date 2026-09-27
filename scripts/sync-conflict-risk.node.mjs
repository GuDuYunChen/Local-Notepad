import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { conflictRiskSummary } from '../src/services/syncConflictRisk.mjs'
import { indexConflictQueue, conflictQueuePage } from '../src/services/syncConflictQueue.mjs'
import { queueFixture, queueAttachment } from './fixtures/sync-conflict-queue.mjs'
import { riskFixture, tombstone } from './fixtures/sync-conflict-risk.mjs'

test('ordinary snapshots remain unmarked, never labeled safe or automatically actionable', () => {
  const summary = conflictRiskSummary(queueFixture(1)[0])
  assert.equal(summary.attention, false); assert.deepEqual(summary.flags, []); assert.deepEqual(summary.notices, [])
  assert.doesNotMatch(JSON.stringify(summary), /safe|安全|open|resolution/)
})
for (const side of ['local', 'remote']) test(side + ' deletion declaration identifies the correct side', () => {
  const c = queueFixture(1)[0]; c[side + '_record'] = tombstone(c[side + '_record'])
  const summary = conflictRiskSummary(c)
  assert.deepEqual(summary.flags, ['permanent']); assert.equal(summary.notices[0].side, side)
  assert.match(summary.notices[0].label, /永久删除/)
})
test('recycle-bin and permanent deletion are distinct and can coexist', () => {
  const summary = conflictRiskSummary(riskFixture()[5])
  assert.deepEqual(summary.flags, ['recycled', 'permanent'])
  assert.deepEqual(summary.notices.map(n => n.label), ['本机：在回收站', '远端：永久删除'])
})
test('two deleted sides count once per category, without dropping either label', () => {
  const c = queueFixture(1)[0]
  c.local_record = tombstone(c.local_record); c.remote_record = tombstone(c.remote_record)
  const model = indexConflictQueue([c])
  assert.equal(model.riskCounts.permanent, 1); assert.equal(model.riskCounts.attention, 1)
  assert.equal(model.entries[0].risk.notices.length, 2)
})
for (const hash of ['', 'd'.repeat(64)]) test('missing snapshot is not a tombstone, including hash ' + (hash ? 'present' : 'absent'), () => {
  const c = queueFixture(1)[0]; c.remote_record = null; c.remote_hash = hash
  const summary = conflictRiskSummary(c)
  assert.deepEqual(summary.flags, ['missing']); assert.match(summary.notices[0].label, /不等于删除/)
})
test('invalid deletion flag types remain unknown instead of being coerced', () => {
  for (const flag of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
    const c = queueFixture(1)[0]; c.local_record.file.is_deleted = flag
    assert.deepEqual(conflictRiskSummary(c).flags, ['unknown'])
  }
})
test('malformed header, identity, state, or payload never claims a valid deletion state', () => {
  for (const change of [r => { r.version = 2 }, r => { r.format = 'other' }, r => { r.id = 'wrong' },
    r => { r.state = 'future' }, r => { r.kind = '__proto__' }, r => { r.file = null },
    r => { r.state = 'purged' }, r => { r.file.is_folder = 0 }, r => { r.tag = {} }]) {
    const c = queueFixture(1)[0]; change(c.local_record)
    assert.deepEqual(conflictRiskSummary(c).flags, ['unknown'])
  }
})
test('closed or missing lifecycle status stays visible as unverified, never reopened by risk classification', () => {
  for (const status of ['resolved', 'superseded', undefined]) {
    const c = queueFixture(1)[0]; c.status = status
    const model = indexConflictQueue([c]); assert.equal(model.entries[0].open, false)
    assert.equal(model.riskCounts.unknown, 1); assert.equal(c.status, status)
  }
})
test('folder recycling and attachment deletion use actual metadata, never names or hashes', () => {
  const c = queueFixture(1)[0]; c.local_record.file.is_folder = true; c.local_record.file.is_deleted = true
  assert.deepEqual(conflictRiskSummary(c).flags, ['recycled'])
  assert.deepEqual(conflictRiskSummary(queueAttachment()).flags, ['permanent'])
  const ordinary = queueFixture(1)[0]; ordinary.local_record.file.title = '永久删除 / 在回收站'
  assert.deepEqual(conflictRiskSummary(ordinary).flags, [])
})
test('tag and relation IDs with colons remain opaque compatible metadata', () => {
  for (const r of [
    { kind: 'tag', id: 'tag:a:b', tag: { id: 'a:b', name: 'tag' } },
    { kind: 'file-tag', id: 'filetag:a:b:c:d', file_tag: { file_id: 'a:b', tag_id: 'c:d' } },
  ]) {
    const record = { format: 'local-notepad-sync-record', version: 1, state: 'present', ...r }
    const c = { status: 'open', item_id: r.id, local_record: record, remote_record: record }
    assert.deepEqual(conflictRiskSummary(c).flags, [])
    c.remote_record = tombstone(record)
    assert.deepEqual(conflictRiskSummary(c).flags, ['permanent'])
  }
})
test('risk summaries never read body, credentials, or hashes and detach from the input', () => {
  const c = queueFixture(1)[0]
  Object.defineProperty(c.local_record.file, 'content', { get() { throw new Error('body was read') } })
  for (const key of ['password', 'local_hash', 'remote_hash']) Object.defineProperty(c, key, { get() { throw new Error(key + ' was read') } })
  c.local_record.file.is_deleted = true
  const result = conflictRiskSummary(c), model = indexConflictQueue([c])
  c.local_record.file.is_deleted = false
  assert.deepEqual(result.flags, ['recycled']); assert.equal(model.riskCounts.recycled, 1)
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.flags) && Object.isFrozen(result.notices) && Object.isFrozen(result.notices[0]))
})
test('overlapping full-list counts do not add up falsely; filters compose with kind and query', () => {
  const model = indexConflictQueue(riskFixture())
  assert.deepEqual(model.riskCounts, { attention: 6, permanent: 3, recycled: 2, missing: 1, unknown: 1 })
  const page = conflictQueuePage(model, { risk: 'permanent', kind: 'attachment', query: '资料😀' })
  assert.equal(page.matched, 1); assert.equal(page.rows[0].id, 'attachment-conflict')
  assert.equal(page.total, 7); assert.equal(model.riskCounts.permanent, 3)
})
test('all filtered records remain reachable once, in the existing server order', () => {
  const raw = queueFixture(45)
  raw.forEach(c => { c.remote_record = tombstone(c.remote_record) })
  const model = indexConflictQueue(raw), ids = []
  for (let page = 1; page <= 5; page++) ids.push(...conflictQueuePage(model, { risk: 'permanent', page }).rows.map(e => e.id))
  assert.deepEqual(ids, raw.map(c => c.id))
})
test('filter miss, empty list and invalid input remain separate and do not resolve anything', () => {
  assert.equal(conflictQueuePage(indexConflictQueue(queueFixture(1)), { risk: 'missing' }).matched, 0)
  assert.equal(conflictQueuePage(indexConflictQueue(queueFixture(1)), { risk: 'missing' }).total, 1)
  assert.equal(indexConflictQueue([]).riskCounts.attention, 0)
  assert.equal(indexConflictQueue(null).riskCounts, null)
  const c = queueFixture(1)[0]; assert.equal(indexConflictQueue([c, c]).riskCounts, null)
})
test('unknown risk filter values are not prototype lookups and reset to all', () => {
  const model = indexConflictQueue(riskFixture())
  for (const risk of ['__proto__', 'constructor', '', undefined, null, {}]) {
    const page = conflictQueuePage(model, { risk }); assert.equal(page.risk, 'all'); assert.equal(page.matched, 7)
  }
})
test('new snapshots recompute counts without mutating earlier index evidence', () => {
  const raw = queueFixture(1), previous = indexConflictQueue(raw)
  raw[0].remote_record = tombstone(raw[0].remote_record)
  const current = indexConflictQueue([...raw])
  assert.equal(previous.riskCounts.permanent, 0); assert.equal(current.riskCounts.permanent, 1)
})
test('non-object input is explicitly unverified, not a false empty or safe record', () => {
  for (const raw of [null, [], 'invalid']) assert.deepEqual(conflictRiskSummary(raw).flags, ['unknown'])
})
test('risk presentation has no write, full-content, persistence or network capability', () => {
  const source = fs.readFileSync(new URL('../src/services/syncConflictRisk.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.content\b|localStorage|sessionStorage|electronAPI|\bapi\s*\(|\bfetch\s*\(|onResolve|applyReviewedConflict/)
})
