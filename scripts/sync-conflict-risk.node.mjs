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

// Identity regressions: classification checks metadata, not body/blob validity.
const identityRecord = (kind, id, payload = {}) => ({ format: 'local-notepad-sync-record', version: 1, kind, id, state: 'present', ...payload })
const identityConflict = record => ({ ...queueFixture(1)[0], item_id: record.id, local_record: record, remote_record: structuredClone(record) })
const attachmentKey = name => 'attachment:' + Buffer.from(name, 'utf8').toString('hex')
const presentAttachment = name => identityRecord('attachment', attachmentKey(name), { attachment: { name, size: 0, blob_hash: 'a'.repeat(64) } })

test('IDENTITY_TOMBSTONE: a deletion declaration with a conflicting kind and key stays unverified', () => {
  const ids = { file: 'note-001', tag: 'tag:a:b', 'file-tag': 'filetag:a:b:c:d', attachment: attachmentKey('资料.pdf') }
  for (const [correctKind, id] of Object.entries(ids)) for (const kind of Object.keys(ids)) {
    if (kind === correctKind) continue
    const c = identityConflict({ format: 'local-notepad-sync-record', version: 1, state: 'purged', kind, id })
    assert.deepEqual(conflictRiskSummary(c).flags, ['unknown'], `${kind} must not declare deletion of ${id}`)
  }
})
test('valid tombstones keep legacy colon-bearing IDs and type-specific deletion labels', () => {
  for (const [kind, id] of [['file', 'ordinary:legacy:id'], ['tag', 'tag:a:b'], ['file-tag', 'filetag:a:b:c:d'], ['attachment', attachmentKey('资料😀.pdf')]]) {
    const c = identityConflict({ format: 'local-notepad-sync-record', version: 1, state: 'purged', kind, id })
    assert.deepEqual(conflictRiskSummary(c).flags, ['permanent'])
  }
})
test('IDENTITY_ATTACHMENT: a filename that does not encode to the record key stays unverified', () => {
  const c = identityConflict(presentAttachment('original.txt'))
  c.local_record.attachment.name = 'different.txt'
  let summary = conflictRiskSummary(c)
  assert.deepEqual(summary.flags, ['unknown']); assert.equal(summary.notices[0].side, 'local')
  c.remote_record.attachment.name = 'also-different.txt'
  summary = conflictRiskSummary(c)
  assert.deepEqual(summary.flags, ['unknown']); assert.equal(summary.notices.length, 2)
})
test('attachment identity uses exact UTF-8, including Unicode, leading BOM and literal percent signs', () => {
  for (const name of ['资料😀.pdf', 'e\u0301.txt', 'é.txt', '\ufeffname.txt', 'report%2Fraw.txt', 'tag:name.txt', '__proto__']) {
    assert.deepEqual(conflictRiskSummary(identityConflict(presentAttachment(name))).flags, [], name)
  }
})
test('unsafe, ill-formed or oversized attachment names cannot evade the unverified filter', () => {
  for (const name of ['', '.', '..', '../secret', 'folder/file', 'folder\\file', 'bad\0name', '\ud800.txt', '\udfff', 'x'.repeat(4097)]) {
    const c = identityConflict(presentAttachment(name))
    assert.deepEqual(conflictRiskSummary(c).flags, ['unknown'])
  }
})
test('filename case, Unicode normalization and coercion cannot change an attachment identity', () => {
  const c = identityConflict(presentAttachment('é.txt'))
  for (const name of ['e\u0301.txt', 'É.txt', 1, { toString() { throw new Error('coercion') } }]) {
    c.local_record.attachment.name = name
    assert.deepEqual(conflictRiskSummary(c).flags, ['unknown'])
  }
})
test('identity checks read neither attachment bytes nor body, credential or hash getters', () => {
  const c = identityConflict(presentAttachment('\ufeff资料.pdf'))
  for (const r of [c.local_record, c.remote_record]) {
    for (const key of ['size', 'blob_hash', 'content']) Object.defineProperty(r.attachment, key, { get() { throw new Error('private ' + key) } })
  }
  for (const key of ['local_hash', 'remote_hash', 'base_hash', 'password']) Object.defineProperty(c, key, { get() { throw new Error('private ' + key) } })
  assert.deepEqual(conflictRiskSummary(c).flags, [])
  c.local_record.attachment.name = 'wrong.pdf'
  const result = conflictRiskSummary(c)
  assert.deepEqual(result.flags, ['unknown']); assert.doesNotMatch(JSON.stringify(result), /wrong.pdf|blob_hash|password/)
})
test('identity concerns compose with metadata search, type filtering and complete pagination', () => {
  const raw = Array.from({ length: 25 }, (_, i) => {
    const c = identityConflict(presentAttachment('object-' + i + '.txt'))
    c.id = 'identity-' + i; c.local_record.attachment.name = 'mismatch-' + i + '.txt'
    return c
  })
  const model = indexConflictQueue(raw), ids = []
  assert.equal(model.riskCounts.unknown, 25); assert.equal(model.riskCounts.permanent, 0)
  for (let page = 1; page <= 3; page++) ids.push(...conflictQueuePage(model, { risk: 'unknown', kind: 'attachment', page }).rows.map(c => c.id))
  assert.deepEqual(ids, raw.map(c => c.id))
  assert.equal(conflictQueuePage(model, { risk: 'unknown', query: 'mismatch-24.txt' }).rows[0].id, 'identity-24')
})
test('an invalid side does not hide a valid deletion on the other side or double-count the concern', () => {
  const c = identityConflict(presentAttachment('right.txt'))
  c.local_record.attachment.name = 'wrong.txt'; c.remote_record = tombstone(c.remote_record)
  const model = indexConflictQueue([c])
  assert.deepEqual(model.riskCounts, { attention: 1, permanent: 1, recycled: 0, missing: 0, unknown: 1 })
  assert.deepEqual(model.entries[0].risk.notices.map(n => n.side), ['local', 'remote'])
})
test('a corrected reread updates identity concerns without rewriting the earlier snapshot', () => {
  const c = identityConflict(presentAttachment('right.txt'))
  c.local_record.attachment.name = 'wrong.txt'
  const previous = indexConflictQueue([c])
  c.local_record.attachment.name = 'right.txt'
  const current = indexConflictQueue([c])
  assert.equal(previous.riskCounts.unknown, 1); assert.equal(current.riskCounts.unknown, 0)
  assert.deepEqual(previous.entries[0].risk.flags, ['unknown'])
})
