import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncStatusReader, mergeSyncDraft, statusRetryDelay, syncHealthLabel, syncStatusLabel } from '../src/services/syncStatusReader.mjs'

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function clock() {
  let time = 1_000
  let id = 0
  const jobs = new Map()
  return {
    now: () => time,
    schedule(fn, ms) { const key = ++id; jobs.set(key, { fn, at: time + ms }); return key },
    cancel(key) { jobs.delete(key) },
    async advance(ms) {
      const target = time + ms
      while (true) {
        const next = [...jobs].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        time = next[1].at; jobs.delete(next[0]); next[1].fn(); await flush()
      }
      time = target; await flush()
    },
    pending: () => jobs.size,
  }
}

test('status reads back off 30/60/120/240/300 seconds and cap safely', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 999].map(statusRetryDelay), [15000, 30000, 60000, 120000, 240000, 300000, 300000])
})
test('background hydration preserves dirty fields and password', () => {
  const draft = { endpoint: 'new-endpoint', username: 'new-user', password: 'unsaved' }
  const saved = { sync_endpoint: 'old-endpoint', sync_username: 'old-user', sync_password: 'must-not-load' }
  assert.deepEqual(mergeSyncDraft(draft, saved, { endpoint: true, username: true }), draft)
  assert.deepEqual(mergeSyncDraft(draft, saved, { endpoint: true }), { ...draft, username: 'old-user' })
})
test('health distinguishes stale reads, conflicts, pause and error', () => {
  const enabled = { sync_enabled: true, sync_auto_enabled: true }
  assert.match(syncHealthLabel(enabled, {}, 'offline'), /上次读取/)
  assert.match(syncHealthLabel(enabled, { open_conflicts: 1 }), /冲突/)
  assert.match(syncHealthLabel({ sync_enabled: false }, {}), /未启用/)
  assert.match(syncHealthLabel(enabled, { last_status: 'error' }), /失败/)
  assert.match(syncStatusLabel('error'), /失败/)
  assert.equal(syncStatusLabel('future-status'), '状态待确认')
})
test('concurrent reads share a single flight', async () => {
  const c = clock(); const d = deferred(); let calls = 0; let snapshots = 0
  const reader = createSyncStatusReader({ ...c, load: () => { calls++; return d.promise }, onSnapshot: () => snapshots++ })
  const first = reader.refresh(); const second = reader.refresh()
  assert.equal(first, second); await flush(); assert.equal(calls, 1)
  d.resolve({}); assert.equal(await first, true); assert.equal(snapshots, 1); assert.equal(c.pending(), 0)
  reader.dispose()
})
test('retry is delayed and a successful read resets failure count', async () => {
  const c = clock(); let calls = 0; const health = []; let broken = true
  const reader = createSyncStatusReader({ ...c, shouldPoll: () => true, load: async () => { calls++; if (broken) throw Error('credential-body'); return {} }, onSnapshot: () => {}, onHealth: h => health.push(h) })
  assert.equal(await reader.refresh(), false)
  assert.equal(health.at(-1).retryAt, c.now() + 30000)
  assert.equal(health.at(-1).error.includes('credential-body'), false)
  await c.advance(29999); assert.equal(calls, 1)
  await c.advance(1); assert.equal(calls, 2); assert.equal(health.at(-1).failures, 2)
  broken = false; assert.equal(await reader.refresh(), true)
  assert.equal(health.at(-1).failures, 0); assert.equal(health.at(-1).retryAt, c.now() + 15000)
  reader.dispose(); assert.equal(c.pending(), 0)
})
test('first-load failure retries even when automatic sync was not enabled', async () => {
  const c = clock(); let calls = 0
  const reader = createSyncStatusReader({ ...c, load: async () => { calls++; if (calls === 1) throw Error('offline'); return {} }, onSnapshot: () => {} })
  await reader.refresh(); await c.advance(30000)
  assert.equal(calls, 2); assert.equal(c.pending(), 0); reader.dispose()
})
test('pausing for a mutation invalidates an older response', async () => {
  const c = clock(); const d = deferred(); const received = []; let calls = 0
  const reader = createSyncStatusReader({ ...c, load: () => ++calls === 1 ? d.promise : { version: 2 }, onSnapshot: value => received.push(value) })
  const old = reader.refresh(); await flush(); reader.setPaused(true)
  assert.equal(await old, false); assert.equal(await reader.refresh(), false)
  assert.equal(await reader.refresh({ allowPaused: true }), true)
  d.resolve({ version: 1 }); await flush()
  assert.deepEqual(received, [{ version: 2 }]); reader.setPaused(false); reader.dispose()
})
test('timeout aborts the request and begins read-only retry', async () => {
  const c = clock(); let signal; const health = []
  const reader = createSyncStatusReader({ ...c, load: value => { signal = value; return new Promise(() => {}) }, onSnapshot: () => assert.fail('hung read cannot succeed'), onHealth: h => health.push(h) })
  const p = reader.refresh(); await flush(); await c.advance(12000)
  assert.equal(await p, false); assert.equal(signal.aborted, true); assert.equal(health.at(-1).failures, 1)
  reader.dispose(); assert.equal(c.pending(), 0)
})
test('dispose prevents late updates and removes retry timers', async () => {
  const c = clock(); const d = deferred(); let signals = 0
  const reader = createSyncStatusReader({ ...c, load: () => d.promise, onSnapshot: () => assert.fail('disposed update'), onHealth: () => signals++ })
  const p = reader.refresh(); await flush(); reader.dispose(); const before = signals
  d.resolve({}); assert.equal(await p, false); await flush(); assert.equal(signals, before); assert.equal(c.pending(), 0)
})
