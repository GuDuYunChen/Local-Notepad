import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makePlan, manyPlan } from './fixtures/sync-plan-view.mjs'
import { captureSyncPlan, invalidateSyncPlan, syncPlanObservation, syncPlanPage,
  SYNC_PLAN_PAGE_SIZE, SYNC_PLAN_MAX_ITEMS, SYNC_PLAN_MAX_ID_UNITS } from '../src/services/syncPlanView.mjs'
const at = 1790400000000
const capture = raw => captureSyncPlan(raw, 'preview', at)
const attachmentID = name => 'attachment:' + Buffer.from(name).toString('hex')

test('captures exact backend counts and action ordering without reclassification', () => {
  const raw = makePlan(['upload', 'conflict', 'download', 'noop'].map((action, i) => ({ id: 'n' + i, action })))
  const view = capture(raw)
  assert.equal(view.detailState, 'complete')
  assert.deepEqual(view.items.map(item => item.action), raw.items.map(item => item.action))
  assert.deepEqual(view.counts, { uploads: 1, downloads: 1, conflicts: 1, noops: 1 })
  assert.equal(view.capturedAt, at)
})
test('snapshots detach and deeply freeze without mutating server response', () => {
  const raw = makePlan(), before = structuredClone(raw), view = capture(raw)
  assert.deepEqual(raw, before)
  raw.items[0].id = 'changed'; raw.uploads = 9
  assert.equal(view.items[0].id, 'note-a'); assert.equal(view.counts.uploads, 1)
  for (const object of [view, view.counts, view.items, view.items[0]]) assert.equal(Object.isFrozen(object), true)
})
test('unknown body, credential, endpoint and hash fields never enter the view model', () => {
  const raw = makePlan(); raw.password = 'secret-marker'; raw.endpoint = 'secret-marker'
  Object.assign(raw.items[0], { content: 'secret-marker', filename: 'secret-marker', local_hash: 'secret-marker', secret: 'secret-marker' })
  assert.equal(JSON.stringify(capture(raw)).includes('secret-marker'), false)
})
for (const raw of [null, undefined, [], false, 1, 'plan']) test(`non-object response ${String(raw)} is not an empty plan`, () => {
  assert.equal(capture(raw).detailState, 'invalid')
})
for (const value of [undefined, null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid count ${String(value)} is not coerced to zero`, () => {
  assert.equal(capture({ ...makePlan(), downloads: value }).detailState, 'invalid')
})
test('unsafe aggregate sum is refused', () => {
  assert.equal(capture({ ...makePlan(), uploads: Number.MAX_SAFE_INTEGER, downloads: 1 }).detailState, 'invalid')
})
test('the actual Go empty nil slice is distinct from missing detail', () => {
  const raw = makePlan([])
  assert.equal(capture({ ...raw, items: null }).detailState, 'complete')
  delete raw.items
  assert.equal(capture(raw).detailState, 'unavailable')
  assert.equal(capture({ ...makePlan(), items: null }).detailState, 'unavailable')
})
test('missing legacy detail keeps labeled server summary, never invented rows', () => {
  const raw = makePlan(); delete raw.items
  const snapshot = capture(raw)
  assert.equal(snapshot.detailState, 'unavailable'); assert.equal(snapshot.counts.uploads, 1)
  assert.equal(snapshot.items, null)
})
test('item count and direction count mismatches refuse partial display', () => {
  assert.equal(capture({ ...makePlan(), items: [] }).detailState, 'invalid')
  assert.equal(capture({ ...makePlan(), uploads: 0, downloads: 1 }).detailState, 'invalid')
})
for (const action of ['delete', 'constructor', '__proto__', '', null]) test(`unknown action ${action} cannot index inherited properties`, () => {
  const raw = makePlan(); raw.items[0].action = action
  assert.equal(capture(raw).detailState, 'invalid')
})
for (const id of ['', '   ', null, 3, 'n'.repeat(SYNC_PLAN_MAX_ID_UNITS + 1)]) test(`invalid ID (${typeof id}, ${id?.length ?? 0}) is refused`, () => {
  assert.equal(capture(makePlan([{ id, action: 'upload' }])).detailState, 'invalid')
})
test('duplicates cannot inflate the plan or produce ambiguous React keys', () => {
  const raw = makePlan([{ id: 'same', action: 'upload' }, { id: 'same', action: 'download' }])
  assert.equal(capture(raw).detailState, 'invalid')
})
test('reserved property names remain valid inert object IDs', () => {
  const view = capture(makePlan(['__proto__', 'constructor', 'toString'].map(id => ({ id, action: 'upload' }))))
  assert.equal(view.detailState, 'complete'); assert.equal(view.items.length, 3)
})
test('Unicode attachment names are decoded without a file read or path action', () => {
  const name = '资料😀.pdf', id = attachmentID(name)
  const view = capture(makePlan([{ id, action: 'download' }]))
  assert.equal(view.items[0].label, name); assert.equal(view.items[0].id, id)
  assert.equal(view.items[0].kind, '附件')
})
test('malformed, unsafe, and invalid UTF-8 attachment names keep their raw IDs', () => {
  const ids = ['attachment:', 'attachment:00', 'attachment:f', 'attachment:zz', 'attachment:ff',
    attachmentID('../a'), attachmentID('a\\b'), attachmentID('.')]
  const view = capture(makePlan(ids.map(id => ({ id, action: 'conflict' }))))
  assert.equal(view.detailState, 'complete')
  for (const item of view.items) assert.equal(item.label, item.id)
})
test('file and folder cannot be distinguished by ID or hashes; relations are not reparsed', () => {
  const raw = makePlan([{ id: 'filetag:n:colon:t:colon', action: 'upload' }, { id: 'n1', action: 'download', title: 'Imagined title' }, { id: 'tag:t1', action: 'noop' }])
  const view = capture(raw)
  assert.equal(view.items[0].label, raw.items[0].id)
  assert.equal(view.items[1].kind, '笔记 / 文件夹'); assert.equal(view.items[1].label, 'n1')
  assert.equal(view.items[2].kind, '标签')
})
test('all 65 IDs are reachable exactly once over four bounded pages', () => {
  const snapshot = capture(manyPlan()), ids = []
  for (let page = 1; page <= 4; page++) {
    const view = syncPlanPage(snapshot, { page })
    assert.ok(view.rows.length <= SYNC_PLAN_PAGE_SIZE); ids.push(...view.rows.map(item => item.id))
  }
  assert.equal(new Set(ids).size, 65); assert.equal(ids[0], 'note-001'); assert.equal(ids.at(-1), 'note-065')
})
test('default changes hides only noops, with accurate matched versus whole counts', () => {
  const snapshot = capture(makePlan(['upload', 'download', 'conflict', 'noop'].map((action, i) => ({ id: 'n' + i, action }))))
  assert.equal(syncPlanPage(snapshot).matched, 3); assert.equal(syncPlanPage(snapshot).total, 4)
  assert.equal(syncPlanPage(snapshot, { filter: 'all' }).matched, 4)
  for (const filter of ['upload', 'download', 'conflict', 'noop']) assert.equal(syncPlanPage(snapshot, { filter }).matched, 1)
  assert.equal(syncPlanPage(snapshot, { filter: 'constructor' }).filter, 'changes')
})
test('search composes with direction, is NFC/case aware and not a regular expression', () => {
  const snapshot = capture(makePlan([{ id: 'CAFÉ-[a].md', action: 'upload' }, { id: 'café-copy', action: 'download' }]))
  assert.equal(syncPlanPage(snapshot, { query: 'cafe\u0301' }).matched, 2)
  assert.equal(syncPlanPage(snapshot, { query: '[a]', filter: 'upload' }).matched, 1)
  assert.equal(syncPlanPage(snapshot, { query: '.*' }).matched, 0)
  assert.equal(syncPlanPage(snapshot, { query: 'café', filter: 'download' }).matched, 1)
})
test('filename and raw attachment IDs both remain searchable', () => {
  const id = attachmentID('资料😀.pdf'), snapshot = capture(makePlan([{ id, action: 'upload' }]))
  assert.equal(syncPlanPage(snapshot, { query: '资料😀' }).matched, 1)
  assert.equal(syncPlanPage(snapshot, { query: id }).matched, 1)
})
test('bad pages clamp safely and search never creates a fake empty plan', () => {
  const snapshot = capture(manyPlan())
  for (const page of [-1, NaN, Infinity, '2', 1.5]) assert.equal(syncPlanPage(snapshot, { page }).page, 1)
  assert.equal(syncPlanPage(snapshot, { page: 999 }).page, 4)
  const view = syncPlanPage(snapshot, { page: 4, query: 'not-here' })
  assert.equal(view.page, 1); assert.equal(view.total, 65); assert.equal(view.matched, 0)
})
test('large plans refuse detail explicitly rather than truncating successful-looking rows', () => {
  const view = capture({ ...makePlan(), uploads: SYNC_PLAN_MAX_ITEMS + 1 })
  assert.equal(view.detailState, 'unavailable'); assert.equal(view.items, null)
  const heavy = makePlan(Array.from({ length: 3000 }, (_, i) => ({ id: String(i) + 'x'.repeat(3000), action: 'upload' })))
  assert.equal(capture(heavy).detailState, 'unavailable')
})
test('exact item-count display limit remains accessible', () => {
  const snapshot = capture(manyPlan(SYNC_PLAN_MAX_ITEMS))
  assert.equal(snapshot.detailState, 'complete')
  assert.equal(syncPlanPage(snapshot, { page: 999999 }).rows.at(-1).id, 'note-50000')
})
test('invalidation is monotonic and does not alter captured rows or time', () => {
  const snapshot = capture(makePlan()), stale = invalidateSyncPlan(snapshot)
  assert.equal(snapshot.stale, false); assert.equal(stale.stale, true)
  assert.equal(stale.items, snapshot.items); assert.equal(stale.capturedAt, at)
  assert.equal(invalidateSyncPlan(stale), stale); assert.equal(invalidateSyncPlan(null), null)
})
test('observed context ignores passwords and extra fields, but watches saved target and revisions', () => {
  const settings = { sync_enabled: true, sync_endpoint: 'https://a.test/dav', sync_username: 'a' }
  const status = { device_id: 'one', remote_revision: 'one' }
  const key = syncPlanObservation(settings, status)
  assert.equal(syncPlanObservation({ ...settings, sync_password: 'never-include', other: {} }, { ...status, content: 'secret' }), key)
  assert.notEqual(syncPlanObservation({ ...settings, sync_username: 'b' }, status), key)
  assert.notEqual(syncPlanObservation(settings, { ...status, remote_revision: 'two' }), key)
  assert.equal(syncPlanObservation(settings, status), key)
})
test('unknown timing is not fabricated; run plans remain historical', () => {
  for (const bad of [NaN, 0, -1, Infinity, 8640000000000001]) assert.equal(captureSyncPlan(makePlan(), 'run', bad).capturedAt, null)
  assert.equal(captureSyncPlan(makePlan(), 'run', at).source, 'run')
  assert.equal(captureSyncPlan(makePlan(), 'other', at).detailState, 'invalid')
})
test('presentation source has no API, persistence, unsafe HTML, file-open or sync-write capability', () => {
  for (const path of ['../src/services/syncPlanView.mjs', '../src/components/SyncPlanPanel.jsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|sessionStorage|electronAPI|fetch\s*\(|api\s*\(/)
  }
})
