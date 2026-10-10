import assert from 'node:assert/strict'
import { createS3LocalOverviewBinding as create } from '../src/services/s3LocalOverviewBinding.mjs'
import { localOverviewIntent, localOverviewSuccess } from './s3-local-overview-binding-cases.mjs'

// Deterministic delayed-timer fixtures. No production IPC, network or user data.
function fixture() {
  let clock = 100, settle
  const native = new Promise((_resolve, reject) => { settle = reject })
  const timers = new Set(), calls = []
  const state = {
    invoke: () => native,
    advance: ms => { clock += ms },
    reject: () => settle(Error('PRIVATE_NATIVE_FAILURE')),
    calls, timers,
    fireTimer: () => { for (const callback of [...timers]) callback() },
  }
  const bridge = { s3LocalOverviewRead(input) { calls.push(input); return state.invoke() } }
  state.acquire = () => bridge
  const binding = create({
    getBridge: () => state.acquire(), now: () => clock,
    schedule(callback) { timers.add(callback); return callback },
    cancel(callback) { timers.delete(callback) },
  })
  return { state, binding }
}
function clean(out) {
  assert.equal(out.summary, null)
  assert.equal(out.serviceStatus, 0)
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE_NATIVE_FAILURE/)
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

export function registerS3LocalOverviewFailureDeadlineTests(test) {
  test('local overview failure before deadline stays unavailable and permits deliberate retry', async () => {
    const { state: s, binding: b } = fixture(), close = b.connect()
    const pending = b.read(localOverviewIntent())
    s.advance(9999); s.reject()
    const out = await pending
    assert.equal(out.code, 'native-unavailable'); clean(out)
    assert.equal(b.snapshot(), out); assert.equal(s.timers.size, 0)
    s.invoke = () => localOverviewSuccess()
    assert.equal((await b.read(localOverviewIntent())).state, 'ready')
    assert.equal(s.calls.length, 2); close()
  })
  for (const elapsed of [10000, 10001]) {
    test(`local overview failed promise at ${elapsed}ms obeys deadline even before timer callback`, async () => {
      const { state: s, binding: b } = fixture(), close = b.connect()
      const pending = b.read(localOverviewIntent())
      s.advance(elapsed); s.reject()
      const out = await pending
      assert.equal(out.code, 'wait-timeout'); assert.equal(out.state, 'stopped'); clean(out)
      assert.equal(b.snapshot(), out); assert.equal(s.timers.size, 0); assert.equal(s.calls.length, 1)
      close()
    })
  }
  for (const source of ['native-call', 'thenable', 'bridge-acquisition']) {
    test(`local overview delayed ${source} exception obeys the same absolute deadline`, async () => {
      const { state: s, binding: b } = fixture(), close = b.connect()
      const fail = () => { s.advance(10000); throw Error('PRIVATE_NATIVE_FAILURE') }
      if (source === 'native-call') s.invoke = fail
      if (source === 'thenable') s.invoke = () => Object.defineProperty({}, 'then', { get: fail })
      if (source === 'bridge-acquisition') s.acquire = fail
      const out = await b.read(localOverviewIntent())
      assert.equal(out.code, 'wait-timeout'); clean(out); assert.equal(b.snapshot(), out)
      assert.equal(s.timers.size, 0)
      assert.equal(s.calls.length, source === 'bridge-acquisition' ? 0 : 1)
      close()
    })
  }
  test('local overview late failure releases settled call but never automatically starts another', async () => {
    const { state: s, binding: b } = fixture(), close = b.connect()
    const pending = b.read(localOverviewIntent())
    s.advance(10000); s.reject()
    assert.equal((await pending).code, 'wait-timeout'); await flush()
    assert.equal(s.calls.length, 1); assert.equal(s.timers.size, 0)
    s.invoke = () => localOverviewSuccess()
    assert.equal((await b.read(localOverviewIntent())).state, 'ready')
    assert.equal(s.calls.length, 2); close()
  })
  test('local overview invalidation has priority over a later rejection and does not free pending call', async () => {
    const { state: s, binding: b } = fixture(), close = b.connect()
    const pending = b.read(localOverviewIntent()); b.invalidate()
    const out = await pending; assert.equal(out.code, 'wait-stopped'); clean(out)
    assert.equal((await b.read(localOverviewIntent())).code, 'session-busy')
    s.advance(10001); s.reject(); await flush()
    assert.equal(b.snapshot().code, 'wait-stopped'); assert.equal(s.calls.length, 1)
    s.invoke = () => localOverviewSuccess()
    assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
  })
  test('local overview closed lease late rejection cannot replace a reconnected lease snapshot', async () => {
    const { state: s, binding: b } = fixture(), oldClose = b.connect()
    const pending = b.read(localOverviewIntent()); oldClose(); const close = b.connect()
    assert.equal((await pending).code, 'disposed'); const snapshot = b.snapshot()
    assert.equal((await b.read(localOverviewIntent())).code, 'session-busy')
    s.advance(10000); s.reject(); await flush()
    assert.equal(b.snapshot(), snapshot); assert.equal(s.calls.length, 1)
    s.invoke = () => localOverviewSuccess()
    assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
  })
  test('local overview failed initial clock never becomes an invented timeout or starts native I/O', async () => {
    for (const value of [-1, NaN, Infinity, 'throw']) {
      let clocks = 0, calls = 0, timers = 0
      const b = create({
        now() { clocks++; if (value === 'throw') throw Error('PRIVATE_NATIVE_FAILURE'); return value },
        getBridge() { calls++; throw Error('PRIVATE_NATIVE_FAILURE') },
        schedule() { timers++; return 1 }, cancel() {},
      })
      const close = b.connect(), out = await b.read(localOverviewIntent())
      assert.equal(out.code, 'native-unavailable'); clean(out)
      assert.equal(clocks, 1); assert.equal(calls, 0); assert.equal(timers, 0); close()
    }
  })
  test('local overview timer-first failure keeps the timeout and slot until native promise settles', async () => {
    const { state: s, binding: b } = fixture(), close = b.connect()
    const pending = b.read(localOverviewIntent()); s.advance(10000); s.fireTimer()
    const out = await pending; assert.equal(out.code, 'wait-timeout')
    assert.equal((await b.read(localOverviewIntent())).code, 'session-busy')
    assert.equal(s.calls.length, 1); s.reject(); await flush()
    assert.equal(b.snapshot(), out); assert.equal(s.timers.size, 0)
    s.invoke = () => localOverviewSuccess()
    assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
  })
}
