import test from 'node:test'
import assert from 'node:assert/strict'
import {
  captureConflictReview, matchesConflictReview, conflictScope, conflictContentPreview,
  conflictVersionSummary, conflictChangedFields, applyReviewedConflict,
} from '../src/services/syncConflictReview.mjs'
import { conflictFixture, fileRecord, settingsFixture, statusFixture } from './fixtures/sync-conflict-review.mjs'
const scope = conflictScope(settingsFixture, statusFixture)
const snapshot = c => captureConflictReview(c, scope)
const record = (kind, id, payload) => ({ format: 'local-notepad-sync-record', version: 1, kind, id, state: 'present', ...payload })
function harness(c = conflictFixture()) {
  const calls = [], review = snapshot(c)
  return { c, review, calls, load: async () => { calls.push('read'); return { conflicts: [c], scope } },
    write: async (id, side) => { calls.push(['write', id, side]); return null } }
}

test('review is detached, deeply immutable, and does not mutate input', () => {
  const c = conflictFixture(), before = JSON.stringify(c), review = snapshot(c)
  assert.equal(JSON.stringify(c), before)
  c.local_record.file.content = 'newer local'
  assert.equal(review.local_record.file.content, '本机正文')
  assert.throws(() => { review.local_record.file.title = 'wrong' }, TypeError)
})
test('canonical review equality is independent of object property order', () => {
  const c = conflictFixture(), r = snapshot(c)
  const reordered = Object.fromEntries(Object.entries(c).reverse())
  reordered.local_record = Object.fromEntries(Object.entries(c.local_record).reverse())
  assert.equal(matchesConflictReview(r, reordered, scope), true)
})
for (const key of ['id', 'item_id', 'base_hash', 'local_hash', 'remote_hash', 'status']) {
  test('changed ' + key + ' invalidates captured consent', () => {
    const c = conflictFixture(), review = snapshot(c)
    c[key] = key.includes('hash') ? 'd'.repeat(64) : c[key] + '-changed'
    assert.equal(matchesConflictReview(review, c, scope), false)
  })
}
test('same hashes with changed displayed content still invalidate review', () => {
  const c = conflictFixture(), review = snapshot(c)
  c.remote_record.file.content = 'changed displayed value'
  assert.equal(matchesConflictReview(review, c, scope), false)
})
test('disabled sync, changed device/store/provider/endpoint/user invalidate target', () => {
  const c = conflictFixture(), review = snapshot(c)
  assert.equal(conflictScope({ ...settingsFixture, sync_enabled: false }, statusFixture), '')
  for (const settings of [
    { ...settingsFixture, sync_provider: 'webdav' }, { ...settingsFixture, sync_endpoint: 'https://example.test' },
    { ...settingsFixture, sync_username: 'bob' },
  ]) assert.equal(matchesConflictReview(review, c, conflictScope(settings, statusFixture)), false)
  for (const status of [{ ...statusFixture, device_id: 'b' }, { ...statusFixture, remote_store_id: 'new' }]) {
    assert.equal(matchesConflictReview(review, c, conflictScope(settingsFixture, status)), false)
  }
})
test('credentials and extra untrusted fields are excluded from captured review', () => {
  const c = conflictFixture(); c.password = 'SENSITIVE'; c.local_record.password = 'SENSITIVE'
  const review = snapshot(c)
  assert.equal(JSON.stringify(review).includes('SENSITIVE'), false)
  assert.equal(conflictScope({ ...settingsFixture, sync_password: 'SENSITIVE' }, statusFixture).includes('SENSITIVE'), false)
})
test('missing, unsupported or contradictory data never becomes a selectable empty version', () => {
  for (const patch of [
    { status: 'resolved' }, { local_hash: 'bad' }, { base_hash: undefined }, { local_record: null },
    { remote_record: { ...fileRecord(), version: 2 } }, { remote_record: { ...fileRecord(), id: 'other' } },
    { remote_record: { ...fileRecord(), state: 'purged' } },
    { remote_record: fileRecord('', { content: null }) }, { remote_record: fileRecord('', { is_deleted: 'false' }) },
    { remote_record: fileRecord('', { updated_at: Number.MAX_VALUE }) },
  ]) assert.throws(() => snapshot(conflictFixture(patch)))
})
test('missing local record is distinct from present blank text and from purged', () => {
  const review = snapshot(conflictFixture({ local_record: null, local_hash: '' }))
  assert.equal(review.local_record, null)
  assert.equal(conflictVersionSummary(null).state, '不可选择')
  assert.equal(conflictVersionSummary(fileRecord('')).content.text, '')
  const tombstone = { format: 'local-notepad-sync-record', version: 1, kind: 'file', id: 'n1', state: 'purged' }
  assert.equal(conflictVersionSummary(snapshot(conflictFixture({ local_record: tombstone })).local_record).destructive, true)
})
test('recycle-bin choice is visibly destructive without being permanent deletion', () => {
  const summary = conflictVersionSummary(fileRecord('kept body', { is_deleted: true }))
  assert.equal(summary.destructive, true); assert.equal(summary.state, '在回收站'); assert.equal(summary.content.text, 'kept body')
})
test('folder, tag and file-tag metadata can be compared without inventing prose', () => {
  assert.equal(conflictVersionSummary(fileRecord('', { is_folder: true })).kind, '文件夹')
  const tag = record('tag', 'tag:t1', { tag: { id: 't1', name: '研究', color: '#123456' } })
  const link = record('file-tag', 'filetag:n1:t1', { file_tag: { file_id: 'n1', tag_id: 't1' } })
  for (const value of [tag, link]) {
    const review = snapshot(conflictFixture({ item_id: value.id, local_record: value, remote_record: value }))
    assert.ok(conflictVersionSummary(review.local_record).fields.length)
    assert.equal(conflictVersionSummary(review.local_record).content, null)
  }
})
test('attachment comparison preserves Unicode filename, exact bytes and blob digest', () => {
  const name = '资料😀.pdf', id = 'attachment:' + Buffer.from(name).toString('hex')
  const value = record('attachment', id, { attachment: { name, size: 512, blob_hash: 'e'.repeat(64) } })
  const review = snapshot(conflictFixture({ item_id: id, local_record: value, remote_record: value }))
  assert.deepEqual(conflictVersionSummary(review.local_record).fields, [['文件名', name], ['大小', '512 字节'], ['内容 SHA-256', 'e'.repeat(64)]])
})
test('unsafe attachment path and wrong identity are rejected', () => {
  const value = record('attachment', 'attachment:00', { attachment: { name: '../secret', size: 1, blob_hash: 'e'.repeat(64) } })
  assert.throws(() => snapshot(conflictFixture({ item_id: value.id, local_record: value, remote_record: value })))
})
test('text projection preserves paragraph and table-cell boundaries', () => {
  const t = text => ({ type: 'text', text }), p = text => ({ type: 'paragraph', children: [t(text)] })
  const content = JSON.stringify({ root: { type: 'root', children: [p('甲'), p('乙'), { type: 'table', children: [{ type: 'tablerow', children: [{ type: 'tablecell', children: [p('左')] }, { type: 'tablecell', children: [p('右')] }] }] }] } })
  const preview = conflictContentPreview(content)
  assert.match(preview.text, /甲\n乙\n/); assert.match(preview.text, /左\n\t右/)
})
test('legacy plain strings, JSON scalar and unknown JSON are not shown as blank', () => {
  assert.equal(conflictContentPreview('plain').text, 'plain')
  assert.equal(conflictContentPreview('"中文"').text, '中文')
  assert.equal(conflictContentPreview('42').text, '42')
  assert.equal(conflictContentPreview('{"metadata":"not a document"}').text, '{"metadata":"not a document"}')
})
test('hostile markup is returned as inert text, with no HTML rendering', () => {
  const raw = '<img src=x onerror=alert(1)><script>bad()</script>'
  assert.equal(conflictContentPreview(raw).text, raw)
})
test('large previews and wide trees are bounded and explicitly incomplete', () => {
  const large = conflictContentPreview('😀'.repeat(300000))
  assert.equal(Array.from(large.text).length, 12000); assert.equal(large.limited, true)
  const wide = conflictContentPreview(JSON.stringify({ root: { children: Array(22000).fill(null) } }))
  assert.equal(wide.limited, true)
})
test('Unicode truncation never separates a surrogate pair', () => {
  const result = conflictContentPreview('A😀B😀C', 3)
  assert.equal(result.text, 'A😀B'); assert.equal(result.limited, true)
})
test('unknown embedded objects are disclosed instead of silently omitted', () => {
  const preview = conflictContentPreview(JSON.stringify({ root: { children: [{ type: 'video' }] } }))
  assert.match(preview.text, /未展示/); assert.equal(preview.limited, true)
})
test('format-only and metadata changes remain visible even with identical text projections', () => {
  const c = conflictFixture({ remote_record: fileRecord('本机正文', { title: '本机标题', parent_id: 'folder-b' }) })
  let review = snapshot(c); assert.deepEqual(conflictChangedFields(review), ['所属文件夹'])
  c.remote_record.file.content = JSON.stringify({ root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: '本机正文' }] }] } })
  review = snapshot(c); assert.ok(conflictChangedFields(review).includes('正文或格式'))
})
for (const choice of ['local', 'remote']) test('explicit ' + choice + ' rereads then submits exactly once', async () => {
  const h = harness(); await applyReviewedConflict(h.review, choice, h)
  assert.deepEqual(h.calls, ['read', ['write', 'c1', choice]])
})
test('no valid selection means no read and no mutation', async () => {
  const h = harness(); await assert.rejects(applyReviewedConflict(h.review, '', h)); assert.deepEqual(h.calls, [])
})
test('unavailable chosen side cannot be submitted', async () => {
  const h = harness(conflictFixture({ local_record: null, local_hash: '' }))
  await assert.rejects(applyReviewedConflict(h.review, 'local', h)); assert.deepEqual(h.calls, [])
})
for (const mode of ['missing', 'duplicate', 'changed', 'wrong-target', 'invalid-list']) test(mode + ' recheck refuses all writes', async () => {
  const h = harness()
  const conflicts = mode === 'missing' ? [] : mode === 'duplicate' ? [h.c, h.c] : mode === 'changed' ? [{ ...h.c, remote_hash: 'd'.repeat(64) }] : mode === 'invalid-list' ? null : [h.c]
  h.load = async () => ({ conflicts, scope: mode === 'wrong-target' ? 'other' : scope })
  await assert.rejects(applyReviewedConflict(h.review, 'remote', h)); assert.deepEqual(h.calls, [])
})
test('read failure is not retried and never reaches write', async () => {
  const h = harness(); let reads = 0
  h.load = async () => { reads++; throw new Error('offline') }
  await assert.rejects(applyReviewedConflict(h.review, 'local', h)); assert.equal(reads, 1); assert.deepEqual(h.calls, [])
})
test('disposed view before read or after read cannot send a new write', async () => {
  const h = harness(); let current = false; h.isCurrent = () => current
  await assert.rejects(applyReviewedConflict(h.review, 'local', h)); assert.deepEqual(h.calls, [])
  current = true; h.load = async () => { current = false; return { scope, conflicts: [h.c] } }
  await assert.rejects(applyReviewedConflict(h.review, 'local', h)); assert.deepEqual(h.calls, [])
})
test('a rejected mutation remains unconfirmed with no automatic replay', async () => {
  const h = harness(); let writes = 0
  h.write = async () => { writes++; throw new Error('connection lost after submission') }
  await assert.rejects(applyReviewedConflict(h.review, 'local', h)); assert.equal(writes, 1)
})
test('bounded recheck times out even if read ignores abort; late success cannot write', async () => {
  const h = harness(); let finish, signal
  h.load = s => { signal = s; return new Promise(r => { finish = r }) }
  await assert.rejects(applyReviewedConflict(h.review, 'local', { ...h, readTimeoutMs: 10 }), /超时/)
  assert.equal(signal.aborted, true); finish({ conflicts: [h.c], scope })
  await Promise.resolve(); assert.deepEqual(h.calls, [])
})
test('abort before or during recheck prevents mutation and releases ignored reads', async () => {
  const h = harness(), controller = new AbortController()
  controller.abort()
  await assert.rejects(applyReviewedConflict(h.review, 'local', { ...h, signal: controller.signal })); assert.deepEqual(h.calls, [])
  const next = new AbortController(); let signal
  h.load = s => { signal = s; next.abort(); return new Promise(() => {}) }
  await assert.rejects(applyReviewedConflict(h.review, 'local', { ...h, signal: next.signal }), /停止/)
  assert.equal(signal.aborted, true); assert.deepEqual(h.calls, [])
})
