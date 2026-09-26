import test from 'node:test'
import assert from 'node:assert/strict'
import { readSyncPlan, SYNC_PLAN_READ_TIMEOUT_MS } from '../src/services/syncPlanRead.mjs'

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function clock() {
  const timers = new Map(), delays = []
  let next = 0
  return {
    timers, delays,
    schedule(fn, ms) { const id = ++next; timers.set(id, fn); delays.push(ms); return id },
    cancel(id) { timers.delete(id) },
    fire() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn() },
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function observedSignal() {
  const controller = new AbortController()
  const { signal } = controller
  let listening = 0
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = (...args) => { listening++; return add(...args) }
  signal.removeEventListener = (...args) => { listening--; return remove(...args) }
  return { controller, signal, listening: () => listening }
}

test('one successful read receives a live signal and cleans its deadline and listener', async () => {
  const c = clock(), parent = observedSignal(), expected = { uploads: 1 }
  let calls = 0, signal
  const result = await readSyncPlan(next => { calls++; signal = next; return expected }, { ...c, signal: parent.signal })
  assert.equal(result, expected); assert.equal(calls, 1); assert.equal(signal.aborted, false)
  assert.equal(c.timers.size, 0); assert.equal(parent.listening(), 0)
  parent.controller.abort(); assert.equal(signal.aborted, false)
})
test('rejects a missing reader before starting any timer', async () => {
  const c = clock()
  await assert.rejects(readSyncPlan(null, c), TypeError)
  assert.equal(c.timers.size, 0)
})
for (const synchronous of [false, true]) test(`preserves a ${synchronous ? 'synchronous' : 'promise'} read error without retry`, async () => {
  const c = clock(), expected = new Error('read offline'), parent = observedSignal()
  let calls = 0
  await assert.rejects(readSyncPlan(() => {
    calls++
    if (synchronous) throw expected
    return Promise.reject(expected)
  }, { ...c, signal: parent.signal }), error => error === expected)
  assert.equal(calls, 1); assert.equal(c.timers.size, 0); assert.equal(parent.listening(), 0)
})
test('already cancelled request never invokes the reader or creates a deadline', async () => {
  const c = clock(), controller = new AbortController(); controller.abort()
  let calls = 0
  await assert.rejects(readSyncPlan(() => { calls++ }, { ...c, signal: controller.signal }), { code: 'SYNC_PLAN_READ_CANCELLED' })
  assert.equal(calls, 0); assert.equal(c.timers.size, 0); assert.equal(c.delays.length, 0)
})
test('cancellation before the queued reader microtask also prevents its invocation', async () => {
  const c = clock(), controller = new AbortController()
  let calls = 0
  const promise = readSyncPlan(() => { calls++ }, { ...c, signal: controller.signal })
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_CANCELLED' })
  controller.abort(); await rejected; await flush()
  assert.equal(calls, 0); assert.equal(c.timers.size, 0)
})
test('deadline rejects a hung reader even when it ignores abort completely', async () => {
  const c = clock(), parent = observedSignal()
  let signal, calls = 0
  const promise = readSyncPlan(next => { signal = next; calls++; return new Promise(() => {}) }, { ...c, signal: parent.signal })
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_TIMEOUT' })
  await flush(); assert.deepEqual(c.delays, [35_000]); c.fire(); await rejected
  assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(c.timers.size, 0); assert.equal(parent.listening(), 0)
})
test('manual cancellation settles promptly without waiting for transport cooperation', async () => {
  const c = clock(), parent = observedSignal()
  let signal
  const promise = readSyncPlan(next => { signal = next; return new Promise(() => {}) }, { ...c, signal: parent.signal })
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_CANCELLED' })
  await flush(); parent.controller.abort(); await rejected
  assert.equal(signal.aborted, true); assert.equal(c.timers.size, 0); assert.equal(parent.listening(), 0)
})
test('transport replacing AbortError with network failure cannot mask timeout provenance', async () => {
  const c = clock()
  const promise = readSyncPlan(signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('generic network error')), { once: true })
  }), c)
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_TIMEOUT' })
  await flush(); c.fire(); await rejected; await flush()
})
for (const mode of ['fulfill', 'reject']) test(`late ${mode} after timeout is inert and handled`, async () => {
  const c = clock(), old = deferred()
  let deliveries = 0
  const promise = readSyncPlan(() => old.promise, c)
  promise.then(() => deliveries++, () => {})
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_TIMEOUT' })
  await flush(); c.fire(); await rejected
  if (mode === 'fulfill') old.resolve({ old: true }); else old.reject(new Error('late rejection'))
  await flush(); assert.equal(deliveries, 0); assert.equal(c.timers.size, 0)
})
test('an old cancelled response cannot replace an independently completed new request', async () => {
  const c = clock(), controller = new AbortController(), old = deferred()
  const promise = readSyncPlan(() => old.promise, { ...c, signal: controller.signal })
  const rejected = assert.rejects(promise, { code: 'SYNC_PLAN_READ_CANCELLED' })
  await flush(); controller.abort(); await rejected
  const fresh = { id: 'new' }
  const result = await readSyncPlan(() => fresh, c)
  old.resolve({ id: 'old' }); await flush()
  assert.equal(result, fresh); assert.equal(c.timers.size, 0)
})
for (const first of ['abort', 'timeout']) test(`first ${first} wins an abort/deadline race`, async () => {
  const c = clock(), controller = new AbortController()
  const promise = readSyncPlan(() => new Promise(() => {}), { ...c, signal: controller.signal })
  const rejected = assert.rejects(promise, { code: first === 'abort' ? 'SYNC_PLAN_READ_CANCELLED' : 'SYNC_PLAN_READ_TIMEOUT' })
  await flush()
  const timeout = c.timers.values().next().value
  if (first === 'abort') { controller.abort(); timeout() } else { timeout(); controller.abort() }
  await rejected; assert.equal(c.timers.size, 0)
})
for (const requested of [1, 100, SYNC_PLAN_READ_TIMEOUT_MS, 999_999, Infinity, NaN, 0, -1, '100']) {
  test(`requested timeout ${String(requested)} cannot extend or remove the deadline`, async () => {
    const c = clock()
    await readSyncPlan(() => null, { ...c, timeoutMs: requested })
    const expected = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 35_000) : 35_000
    assert.deepEqual(c.delays, [expected]); assert.equal(c.timers.size, 0)
  })
}
test('timer setup failure removes the listener and does not start a reader', async () => {
  const parent = observedSignal(), failure = new Error('scheduler failure')
  let calls = 0
  await assert.rejects(readSyncPlan(() => calls++, {
    signal: parent.signal, schedule: () => { throw failure },
  }), error => error === failure)
  assert.equal(calls, 0); assert.equal(parent.listening(), 0)
})
