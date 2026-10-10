import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSyncOverview, focusSyncOverviewRegion, SYNC_OVERVIEW_DESTINATIONS } from '../src/services/syncOverview.mjs'
import { overviewFixture } from './fixtures/sync-overview.mjs'

test('normal snapshot suggests preview, never declares devices equal', () => {
  const view = buildSyncOverview(overviewFixture())
  assert.equal(view.state, 'preview'); assert.equal(view.target, 'execution')
  assert.match(view.detail, /不代表两端现在完全一致/); assert.equal(view.reportedConflicts, '0')
  assert.equal(view.lastSuccess, new Date(1790499900000).toISOString())
})
for (const input of [null, undefined, false, 3, [], {}, 'private']) test(`unread input ${String(input)} remains unknown`, () => {
  const view = buildSyncOverview(input)
  assert.equal(view.state, 'unavailable'); assert.equal(view.reportedConflicts, '未知')
  assert.equal(view.listedConflicts, '未知'); assert.equal(view.lastSuccess, '尚无记录')
})
for (const [label, change, state, target] of [
  ['busy', x => { x.busy = true }, 'waiting', 'health'],
  ['stale', x => { x.health.error = 'private'; x.health.failures = 1 }, 'stale', 'health'],
  ['refreshing', x => { x.health.loading = true }, 'stale', 'health'],
  ['draft', x => { x.draftChanged = true }, 'draft', 'connection'],
  ['disabled', x => { x.settings.sync_enabled = false }, 'disabled', 'connection'],
  ['conflicts', x => { x.status.open_conflicts = x.conflictCount = 4 }, 'conflicts', 'conflicts'],
  ['mismatch', x => { x.status.open_conflicts = 4; x.conflictCount = 2 }, 'mismatch', 'health'],
  ['error', x => { x.status.last_status = 'error' }, 'error', 'health'],
  ['action-failed', x => { x.actionFailed = true }, 'error', 'health'],
  ['unknown-mode', x => { x.status.recovery = null }, 'unknown', 'health'],
  ['unknown-counter', x => { x.status.open_conflicts = '0' }, 'unknown', 'health'],
  ['inconsistent-last-status', x => { x.status.last_status = 'conflicts' }, 'unknown', 'health'],
]) test(`${label} routes to a read-only region`, () => {
  const x = overviewFixture(); change(x); const view = buildSyncOverview(x)
  assert.equal(view.state, state); assert.equal(view.target, target)
})
for (const [last, mode, state] of [
  ['review_required', null, 'uncertain'], ['ok', 'applying', 'uncertain'],
  ['retry_wait', null, 'backoff'], ['ok', 'backoff', 'backoff'],
  ['recovery_blocked', null, 'blocked'], ['ok', 'blocked', 'blocked'],
]) test(`${last}/${mode} preserves recovery evidence`, () => {
  const x = overviewFixture(); x.status.last_status = last; x.status.recovery = mode ? { mode } : null
  const v = buildSyncOverview(x); assert.equal(v.state, state); assert.equal(v.target, 'health')
  assert.ok(v.recoveryNotice); assert.equal(v.lastSuccess, '尚无记录')
})
test('uncertainty survives stale data, drafts, conflicts, disabled config and conflicting fields', () => {
  const x = overviewFixture(); x.status.last_status = 'review_required'; x.status.recovery.mode = 'backoff'
  x.busy = true; x.draftChanged = true; x.health.error = 'stale'; x.settings.sync_enabled = false; x.conflictCount = 4
  const v = buildSyncOverview(x)
  assert.equal(v.state, 'uncertain'); assert.match(v.detail, /不要反复执行或重新绑定/); assert.match(v.recoveryNotice, /不一致/)
})
test('counters remain separate and cannot create an invisible conflict destination', () => {
  const x = overviewFixture(); x.status.open_conflicts = 5; x.conflictCount = 0
  const v = buildSyncOverview(x)
  assert.equal(v.reportedConflicts, '5'); assert.equal(v.listedConflicts, '0')
  assert.equal(v.destinations.find(d => d.key === 'conflicts').available, false)
})
test('destination visibility follows rendered region conditions, independent of stale labels', () => {
  const x = overviewFixture(); x.health.lastReadAt = 0; x.conflictCount = 3
  const v = buildSyncOverview(x)
  assert.equal(v.reportedConflicts, '未知')
  assert.equal(v.destinations.find(d => d.key === 'execution').available, true)
  assert.equal(v.destinations.find(d => d.key === 'conflicts').available, true)
  x.settings.sync_enabled = false
  assert.equal(buildSyncOverview(x).destinations.find(d => d.key === 'conflicts').available, false)
})
test('only five fixed destinations, with immutable view and no input mutation', () => {
  const x = overviewFixture(), before = structuredClone(x), view = buildSyncOverview(x)
  assert.deepEqual(x, before); assert.equal(view.destinations.length, 5)
  assert.equal(Object.isFrozen(view), true); assert.ok(view.destinations.every(Object.isFrozen))
  assert.deepEqual(view.destinations.map(d => d.key), SYNC_OVERVIEW_DESTINATIONS.map(d => d.key))
})
test('private strings and prototype enum names do not appear in the overview', () => {
  const x = overviewFixture(), privateValue = 'PRIVATE_SENTINEL_<script>😀'
  Object.assign(x.settings, { sync_endpoint: privateValue, sync_username: privateValue, sync_password: privateValue })
  Object.assign(x.status, { title: privateValue, content: privateValue, device_id: privateValue, last_error: privateValue })
  assert.ok(!JSON.stringify(buildSyncOverview(x)).includes(privateValue))
  for (const value of ['constructor', '__proto__', privateValue]) {
    x.settings.sync_provider = value; x.status.last_status = value; x.status.recovery.mode = value
    assert.equal(buildSyncOverview(x).state, 'unknown')
  }
})
function focusFixture() {
  const calls = [], doc = { activeElement: null }
  const root = { isConnected: true, matches: value => value === '[data-sync-center]', querySelector: value => { calls.push(['query', value]); return target } }
  const target = { isConnected: true, ownerDocument: doc, getAttribute: () => '-1',
    closest: selector => selector === '[data-sync-center]' ? root : null,
    focus: options => { calls.push(['focus', options]); doc.activeElement = target },
    scrollIntoView: options => calls.push(['scroll', options]) }
  return { calls, root, target, doc }
}
test('focus changes only region focus and scroll, not clicks or input values', () => {
  const f = focusFixture(); assert.equal(focusSyncOverviewRegion(f.root, 'connection'), true)
  assert.deepEqual(f.calls.map(call => call[0]), ['query', 'focus', 'scroll'])
  assert.deepEqual(f.calls[2][1], { block: 'start', behavior: 'instant' })
})
test('invalid keys cannot select arbitrary DOM nodes or selectors', () => {
  for (const key of ['constructor', '__proto__', 'body', 'health"] button', null, 0, {}]) {
    const f = focusFixture(); assert.equal(focusSyncOverviewRegion(f.root, key), false); assert.equal(f.calls.length, 0)
  }
})
test('detached, nested, hidden and missing targets are refused', () => {
  for (const change of [
    f => { f.root.isConnected = false }, f => { f.target.isConnected = false },
    f => { f.target.closest = () => ({}) }, f => { f.target.getAttribute = () => '0' },
    f => { f.root.querySelector = () => null }, f => { f.root.matches = () => false },
  ]) {
    const f = focusFixture(); change(f); assert.equal(focusSyncOverviewRegion(f.root, 'health'), false)
    assert.equal(f.calls.some(c => c[0] === 'scroll'), false)
  }
})
test('failed focus never redirects to another center or activates a fallback action', () => {
  const f = focusFixture(); f.target.focus = () => {}
  assert.equal(focusSyncOverviewRegion(f.root, 'health'), false); assert.equal(f.calls.length, 1)
  f.target.focus = () => { throw new Error('detached') }
  assert.equal(focusSyncOverviewRegion(f.root, 'health'), false)
})
test('overview has no network, persistence, credentials, clipboard or synchronization callback capability', () => {
  for (const file of ['../src/services/syncOverview.mjs', '../src/components/SyncOverviewPanel.jsx']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /\bfetch\s*\(|\bapi\s*\(|\.click\s*\(|onResolve|onRefresh|localStorage|sessionStorage|electronAPI|clipboard|dangerouslySetInnerHTML/)
  }
})

// 2F.15.1: an exclusive headline must not discard independent snapshot facts.
const maskedContexts = [
  ['busy', x => { x.busy = true }, 'waiting', /已读取的状态快照/],
  ['stale', x => { x.health.error = 'PRIVATE_READ_ERROR'; x.health.failures = 1 }, 'stale', /上次读取结果/],
  ['refreshing', x => { x.health.loading = true }, 'stale', /正在刷新；仍是上次读取结果/],
]
for (const [last, mode, warning] of [
  ['recovery_blocked', 'blocked', /恢复保护阻断/], ['retry_wait', 'backoff', /预检暂缓/],
]) for (const source of ['both', 'status-only', 'mode-only']) {
  for (const [context, change, state, readSource] of maskedContexts) test(`${last} ${source} stays visible during ${context}`, () => {
    const x = overviewFixture(); change(x)
    x.status.last_status = source === 'mode-only' ? 'ok' : last
    x.status.recovery = source === 'status-only' ? null : { mode }
    const before = structuredClone(x), v = buildSyncOverview(x)
    assert.equal(v.state, state); assert.equal(v.target, 'health')
    assert.match(v.recoveryNotice, warning); assert.match(v.recoveryNotice, /已读取的快照/)
    assert.match(v.readSource, readSource); assert.deepEqual(x, before)
    assert.doesNotMatch(JSON.stringify(v), /PRIVATE_READ_ERROR/)
  })
}
for (const [label, change, source] of [
  ['captured', () => {}, /已读取的状态快照（非实时保证）/],
  ['stale', x => { x.health.failures = 1 }, /上次读取结果；刷新失败或状态待核实/],
  ['refreshing', x => { x.health.loading = true }, /正在刷新；仍是上次读取结果/],
]) test(`uncertain-write headline retains ${label} provenance independently`, () => {
  const x = overviewFixture(); x.status.last_status = 'review_required'; x.status.recovery.mode = 'review_required'; change(x)
  const v = buildSyncOverview(x)
  assert.equal(v.state, 'uncertain'); assert.match(v.readSource, source)
  assert.equal(v.readAt, new Date(x.health.lastReadAt).toISOString())
  assert.equal(v.lastSuccess, new Date(x.status.recovery.last_success_at * 1000).toISOString())
})
test('waiting also retains stale provenance independently of its headline', () => {
  const x = overviewFixture(); x.busy = true; x.health.loading = true; x.health.failures = 1
  const v = buildSyncOverview(x); assert.equal(v.state, 'waiting'); assert.match(v.readSource, /刷新失败或状态待核实/)
})
for (const [last, mode, words] of [
  ['recovery_blocked', 'backoff', [/恢复保护阻断/, /预检暂缓/]],
  ['review_required', 'blocked', [/恢复保护阻断/, /不一致/]],
  ['review_required', 'backoff', [/预检暂缓/, /不一致/]],
]) test(`${last}/${mode} retains independent warnings under a stronger headline`, () => {
  const x = overviewFixture(); x.status.last_status = last; x.status.recovery.mode = mode
  x.health.error = 'PRIVATE'; x.busy = true
  const v = buildSyncOverview(x)
  for (const wordsToKeep of words) assert.match(v.recoveryNotice, wordsToKeep)
  assert.match(v.readSource, /上次读取结果/); assert.equal(v.target, 'health')
})
test('unread or hostile states cannot fabricate recovery warnings or copy private strings', () => {
  const x = overviewFixture(); x.health.lastReadAt = 0; x.status.last_status = 'recovery_blocked'; x.status.recovery.mode = 'backoff'
  const unread = buildSyncOverview(x)
  assert.equal(unread.recoveryNotice, ''); assert.match(unread.readSource, /尚无可核实/); assert.equal(unread.reportedConflicts, '未知')
  x.health.lastReadAt = 1790500000000
  for (const value of ['constructor', '__proto__', 'PRIVATE_<script>alert(1)</script>']) {
    x.status.last_status = value; x.status.recovery.mode = value; x.health.error = value
    const v = buildSyncOverview(x); assert.equal(v.recoveryNotice, ''); assert.doesNotMatch(JSON.stringify(v), /PRIVATE_|<script>|constructor|__proto__/)
  }
})
test('A-B-A snapshots recompute warning and provenance without inventing a resolution', () => {
  const x = overviewFixture(); x.status.last_status = 'recovery_blocked'; x.status.recovery.mode = 'blocked'; x.busy = true
  const a = buildSyncOverview(x), b = buildSyncOverview(overviewFixture()), again = buildSyncOverview(x)
  assert.match(a.recoveryNotice, /不证明保护已解除/); assert.equal(b.recoveryNotice, '')
  assert.deepEqual(again, a); assert.doesNotMatch(b.detail, /全部同步完成|两端已一致/)
})

// Phase 2F.16: fixed help content is not another status reader or controller.
test('local help has four fixed deeply immutable topics and no user-data slots', async () => {
  const { SYNC_HELP_TOPICS: topics } = await import('../src/services/syncHelp.mjs')
  assert.deepEqual(topics.map(t => t.key), ['first-use', 'operations', 'conflicts', 'recovery'])
  assert.equal(Object.isFrozen(topics), true)
  for (const topic of topics) {
    assert.ok(Object.isFrozen(topic)); assert.ok(Object.isFrozen(topic.steps)); assert.ok(topic.steps.length >= 3)
    assert.ok(topic.steps.every(step => Object.isFrozen(step) && typeof step.title === 'string' && typeof step.detail === 'string'))
  }
  assert.doesNotMatch(JSON.stringify(topics), /https?:|<script|password=|endpoint=/)
})
test('help describes read-only operations and preserves uncertain-write boundaries', async () => {
  const { SYNC_HELP_TOPICS: topics } = await import('../src/services/syncHelp.mjs')
  const operations = JSON.stringify(topics.find(t => t.key === 'operations'))
  const recovery = JSON.stringify(topics.find(t => t.key === 'recovery'))
  assert.match(operations, /不写入探针/); assert.match(operations, /不证明有写入权限/)
  assert.match(operations, /预演结果不是执行完成/); assert.match(operations, /可能修改本机与远端数据/)
  assert.match(recovery, /刷新不是回滚/); assert.match(recovery, /不能单独证明保护已解除/)
  assert.match(recovery, /不要反复执行、清除数据或重新绑定/)
})
test('help has no runtime inputs, effects, storage, requests or action controls', () => {
  const ui = readFileSync(new URL('../src/components/SyncHelpPanel.jsx', import.meta.url), 'utf8')
  const data = readFileSync(new URL('../src/services/syncHelp.mjs', import.meta.url), 'utf8')
  assert.match(ui, /function SyncHelpPanel\(\)/)
  assert.doesNotMatch(ui + data, /\bfetch\s*\(|\bapi\s*\(|useEffect|useLayoutEffect|localStorage|sessionStorage|electronAPI|clipboard|dangerouslySetInnerHTML|<button|<a[\s>]|<input|<textarea|onClick=|onToggle=|onKeyDown=/)
  assert.doesNotMatch(ui, /\bopen=|\bname=|autoFocus/)
})
