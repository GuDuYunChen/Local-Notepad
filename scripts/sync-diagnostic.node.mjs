import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { syncDiagnosticFacts, captureSyncDiagnostic, copySyncDiagnostic } from '../src/services/syncDiagnostic.mjs'
const now = 1790500000000
function input() {
  return { settings: { sync_enabled: true, sync_provider: 'webdav', sync_auto_enabled: false, sync_interval_minutes: 5 },
    status: { last_status: 'ok', last_sync_at: 1790499990, last_error: '', base_items: 20, open_conflicts: 0,
      recovery: { mode: 'idle', last_success_at: 1790499990, next_attempt_at: 0 } },
    health: { loading: false, lastReadAt: now - 1000, error: '', failures: 0 },
    conflictCount: 0, busy: false, draftChanged: false, actionFailed: false }
}
const report = x => captureSyncDiagnostic(x, now)
test('valid read distinguishes generated, read, attempt and confirmed-success times', () => {
  const r = report(input())
  assert.equal(r.facts.readState, 'captured'); assert.equal(r.capturedAt, now)
  assert.match(r.text, /生成时间 UTC：2026-/); assert.match(r.text, /最近状态读取 UTC：/)
  assert.match(r.text, /最近同步尝试 UTC：/); assert.match(r.text, /最近确认成功 UTC：/)
  assert.match(r.text, /非实时保证/); assert.match(r.text, /不代表两端现在完全一致/)
})
test('unread initial list is unknown rather than zero or success', () => {
  const x = input(); x.health.lastReadAt = 0
  const r = report(x)
  assert.equal(r.facts.openConflicts, null); assert.equal(r.facts.listedConflicts, null)
  assert.equal(r.facts.lastState, 'unknown'); assert.match(r.text, /未读取的数量不是零/)
})
test('stale snapshot retains actual last values and warns instead of claiming current health', () => {
  const x = input(); x.health.error = 'very-private-error'; x.health.failures = 2
  const r = report(x)
  assert.equal(r.facts.readState, 'stale'); assert.equal(r.facts.baseItems, 20)
  assert.match(r.text, /先刷新同步状态/); assert.doesNotMatch(r.text, /very-private-error/)
})
test('refreshing captures only the previously read snapshot', () => {
  const x = input(); x.health.loading = true
  assert.equal(report(x).facts.readState, 'refreshing')
})
for (const raw of [undefined, null, [], false, 12, 'raw-text']) test(`invalid input (${String(raw)}) is unknown, not a crash or empty success`, () => {
  const r = report(raw); assert.equal(r.facts.readState, 'unavailable'); assert.equal(r.facts.openConflicts, null)
})
for (const value of [-1, 1.1, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`count ${String(value)} cannot be silently coerced`, () => {
  const x = input(); x.status.base_items = value; x.status.open_conflicts = value; x.conflictCount = value
  const f = syncDiagnosticFacts(x)
  assert.equal(f.baseItems, null); assert.equal(f.openConflicts, null); assert.equal(f.listedConflicts, null)
})
test('boolean and enum strings are never truthy or prototype-based approvals', () => {
  for (const value of ['true', 1, {}, 'constructor', '__proto__']) {
    const x = input(); x.settings.sync_enabled = value; x.settings.sync_auto_enabled = value; x.settings.sync_provider = value
    x.status.last_status = value; x.status.recovery.mode = value
    const f = report(x).facts
    assert.equal(f.enabled, null); assert.equal(f.automatic, null); assert.equal(f.provider, 'unknown')
    assert.equal(f.lastState, 'unknown'); assert.equal(f.recovery, 'unknown')
  }
})
test('malformed and overflowing timestamps never invent a generation or success date', () => {
  for (const value of [0, -1, NaN, Infinity, '1790499990', Number.MAX_SAFE_INTEGER]) {
    const x = input(); x.status.last_sync_at = value; x.status.recovery.last_success_at = value
    const r = captureSyncDiagnostic(x, value)
    assert.equal(r.capturedAt, null); assert.equal(r.facts.lastAttemptAt, null); assert.equal(r.facts.lastSuccessAt, null)
  }
})
test('count disagreement is reported without choosing a winning counter', () => {
  const x = input(); x.status.open_conflicts = 5; x.conflictCount = 3
  const r = report(x); assert.match(r.text, /待处理数：5/); assert.match(r.text, /列表数：3/)
  assert.match(r.text, /数量不一致/)
})
test('uncertain writes have priority even over read failure, drafts, active operation and conflicts', () => {
  for (const mode of ['applying', 'review_required']) {
    const x = input(); x.status.recovery.mode = mode; x.health.error = 'secret'; x.busy = true; x.draftChanged = true; x.conflictCount = 4
    const r = report(x)
    assert.match(r.text, /不要反复执行或重新绑定/); assert.doesNotMatch(r.text, /secret/)
  }
})
for (const [name, patch, message] of [
  ['busy', x => { x.busy = true }, /界面仍在等待操作结果/],
  ['draft', x => { x.draftChanged = true }, /存在未保存的配置草稿/],
  ['conflicts', x => { x.conflictCount = 1 }, /到冲突中心逐项对照/],
  ['backoff', x => { x.status.recovery.mode = 'backoff' }, /处于暂缓状态/],
  ['blocked', x => { x.status.recovery.mode = 'blocked' }, /跳过恢复保护/],
  ['disabled', x => { x.settings.sync_enabled = false }, /同步尚未启用/],
  ['error', x => { x.status.last_status = 'error' }, /未推断故障原因/],
]) test(`${name} supplies advice but no inferred error cause or automatic action`, () => {
  const x = input(); patch(x); assert.match(report(x).text, message)
})
test('redaction by selection survives secrets in every free-text field and arbitrary extras', () => {
  const marker = 'PRIVATE_SENTINEL_甲😀<script>secret()</script>'
  const x = input()
  Object.assign(x.settings, { sync_endpoint: marker, sync_username: marker, sync_password: marker, token: marker })
  Object.assign(x.status, { device_id: marker, remote_store_id: marker, remote_revision: marker, last_error: marker,
    error: { raw: marker }, content: marker, title: marker, path: marker, attachment: { name: marker } })
  x.health.error = marker; x.status.recovery.error = marker; x.unknown = marker
  const r = report(x)
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SENTINEL|<script>|remote_revision|sync_endpoint|device_id/)
  assert.equal(r.facts.readError, true); assert.equal(r.facts.syncError, true)
  assert.match(r.text, /计数和时间仍可能透露使用情况/)
})
test('source mutation cannot rewrite a frozen report or add secrets later', () => {
  const x = input(), before = structuredClone(x), r = report(x), text = r.text
  assert.deepEqual(x, before)
  x.status.open_conflicts = 7; x.settings.sync_username = 'secret'
  assert.equal(r.text, text); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.facts))
  assert.throws(() => { r.facts.openConflicts = 7 }, TypeError)
})
test('diagnostic observation omits unknown/private fields and remains bounded for huge error strings', () => {
  const a = input(), b = input(); b.status.content = 'x'.repeat(1000000); b.settings.sync_endpoint = 'y'.repeat(1000000)
  assert.deepEqual(syncDiagnosticFacts(a), syncDiagnosticFacts(b))
  b.status.last_error = 'x'.repeat(1000000)
  assert.ok(report(b).text.length < 8192)
})
test('copy succeeds only on a fulfilled explicit write and clears deadline', async () => {
  const writes = [], canceled = []; let deadlines = 0
  assert.equal(await copySyncDiagnostic('visible report', value => { writes.push(value) }, { schedule: () => ++deadlines, cancel: id => canceled.push(id) }), true)
  assert.deepEqual(writes, ['visible report']); assert.deepEqual(canceled, [1])
})
test('missing clipboard, invalid text and thrown/rejected writes do not replay', async () => {
  assert.equal(await copySyncDiagnostic('x', null), false)
  let calls = 0
  assert.equal(await copySyncDiagnostic('x'.repeat(8193), () => calls++), false)
  for (const write of [() => { calls++; throw new Error('secret') }, () => { calls++; return Promise.reject(new Error('secret')) }]) {
    assert.equal(await copySyncDiagnostic('x', write), false)
  }
  assert.equal(calls, 2)
})
test('clipboard timeout ends waiting; ignored late completion cannot replay', async () => {
  let expire, finish, calls = 0
  const task = copySyncDiagnostic('visible report', () => { calls++; return new Promise(r => { finish = r }) },
    { schedule: cb => { expire = cb; return 1 }, cancel: () => {} })
  expire(); assert.equal(await task, false); finish(); await Promise.resolve(); assert.equal(calls, 1)
})
test('presentation has no API, persistence, file access or synchronization callbacks', () => {
  for (const file of ['../src/services/syncDiagnostic.mjs', '../src/components/SyncDiagnosticPanel.jsx']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /\bfetch\s*\(|\bapi\s*\(|localStorage|sessionStorage|electronAPI|onResolve|onRefresh|dangerouslySetInnerHTML/)
  }
})

// These fixed strings are emitted by RecoveryRunner.Status, not free-text errors.
const recoveryCases = [
  ['review_required', 'review_required', '写入结果待确认', /不要反复执行或重新绑定/],
  ['retry_wait', 'backoff', '预检暂缓，等待重试', /处于暂缓状态/],
  ['recovery_blocked', 'blocked', '恢复保护阻断，需处理', /跳过恢复保护/],
]
for (const [lastState, mode, label] of recoveryCases) test(`RECOVERY_STATUS: preserve backend status ${lastState}`, () => {
  const x = input(); x.status.last_status = lastState; x.status.recovery.mode = mode
  const r = report(x)
  assert.equal(r.facts.lastState, lastState, 'RECOVERY_STATUS: supported backend state was lost')
  assert.ok(r.text.includes('最近状态：' + label))
  assert.doesNotMatch(r.text, /恢复信息提示：/)
})
for (const [lastState, , label, advice] of recoveryCases) test(`RECOVERY_DETAIL: ${lastState} survives missing detail without inventing recovery`, () => {
  const x = input(); x.status.last_status = lastState; delete x.status.recovery
  const r = report(x)
  assert.equal(r.facts.recovery, 'unknown')
  assert.equal(r.facts.lastSuccessAt, null); assert.equal(r.facts.nextAttemptAt, null)
  assert.ok(r.text.includes('最近状态：' + label))
  assert.match(r.text, /恢复详情缺失或不受支持/)
  assert.match(r.text, advice, 'RECOVERY_DETAIL: explicit recovery warning fell through to generic advice')
  assert.doesNotMatch(r.text, /下一步参考：可先预演/)
})
test('known status and contradictory recovery detail stay separate, not silently reconciled', () => {
  for (const [lastState, mode] of [['review_required', 'idle'], ['retry_wait', 'blocked'], ['recovery_blocked', 'backoff'], ['ok', 'review_required']]) {
    const x = input(); x.status.last_status = lastState; x.status.recovery.mode = mode
    const r = report(x)
    assert.equal(r.facts.lastState, lastState); assert.equal(r.facts.recovery, mode)
    assert.match(r.text, /最近状态与恢复详情不一致/)
    assert.doesNotMatch(r.text, /下一步参考：可先预演/)
  }
})
test('uncertain last status wins even when detail is missing and every other signal competes', () => {
  for (const detail of [undefined, null, {}, { mode: 'idle' }, { mode: 'backoff' }]) {
    const x = input(); x.status.last_status = 'review_required'; x.status.recovery = detail
    x.health.error = 'PRIVATE_ERROR'; x.health.failures = 3; x.draftChanged = true; x.busy = true; x.conflictCount = 5
    const r = report(x)
    assert.match(r.text, /不要反复执行或重新绑定/)
    assert.doesNotMatch(r.text, /PRIVATE_ERROR/)
  }
})
test('uncertain recovery mode still takes priority over a different last status', () => {
  for (const lastState of ['ok', 'retry_wait', 'recovery_blocked', 'error']) {
    const x = input(); x.status.last_status = lastState; x.status.recovery.mode = 'applying'
    assert.match(report(x).text, /不要反复执行或重新绑定/)
  }
})
test('blocked recovery evidence is not weakened to backoff or conflict handling', () => {
  for (const [lastState, mode] of [['recovery_blocked', 'backoff'], ['retry_wait', 'blocked']]) {
    const x = input(); x.status.last_status = lastState; x.status.recovery.mode = mode
    x.status.open_conflicts = 2; x.conflictCount = 2
    const r = report(x)
    assert.match(r.text, /下一步参考：.*跳过恢复保护/)
    assert.doesNotMatch(r.text, /下一步参考：到冲突中心/)
  }
})
test('actual last-state changes now produce distinct observation keys even without detail', () => {
  const x = input(); delete x.status.recovery
  const keys = recoveryCases.map(([state]) => { x.status.last_status = state; return report(x).key })
  assert.equal(new Set(keys).size, 3)
})
test('unknown or hostile recovery status strings remain unknown and cannot leak into copied text', () => {
  for (const value of ['constructor', '__proto__', 'REVIEW_REQUIRED', 'review_required ', 'PRIVATE_SECRET', null, {}, 1]) {
    const x = input(); x.status.last_status = value; x.status.recovery.mode = value
    const r = report(x)
    assert.equal(r.facts.lastState, 'unknown'); assert.equal(r.facts.recovery, 'unknown')
    assert.doesNotMatch(r.text, /PRIVATE_SECRET|constructor|__proto__|REVIEW_REQUIRED/)
  }
})
test('newly recognized codes do not fabricate successful reads or success timestamps', () => {
  for (const [lastState, mode] of recoveryCases) {
    const x = input(); x.status.last_status = lastState; x.status.recovery = { mode }; x.health.lastReadAt = 0
    const r = report(x)
    assert.equal(r.facts.lastState, 'unknown'); assert.equal(r.facts.recovery, 'unknown')
    assert.equal(r.facts.lastSuccessAt, null); assert.match(r.text, /尚无可核实的读取结果/)
  }
})
test('matching applying status is valid and earlier successful time is retained as earlier evidence only', () => {
  const x = input(); x.status.last_status = 'review_required'; x.status.recovery.mode = 'applying'
  const before = structuredClone(x), r = report(x)
  assert.deepEqual(x, before); assert.equal(r.facts.lastSuccessAt, x.status.recovery.last_success_at * 1000)
  assert.doesNotMatch(r.text, /恢复信息提示：/); assert.match(r.text, /不要反复执行或重新绑定/)
  assert.ok(Object.isFrozen(r.facts) && r.text.length < 8192)
})
