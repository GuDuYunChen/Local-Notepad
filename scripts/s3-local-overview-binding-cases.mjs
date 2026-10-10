import assert from 'node:assert/strict'
import { createS3LocalOverviewBinding as create, S3_LOCAL_OVERVIEW_DISCONNECTED as CLOSED,
  S3_LOCAL_OVERVIEW_LIMITATION as LIMITATION } from '../src/services/s3LocalOverviewBinding.mjs'

export const localOverviewIntent = () => ({ readOnly: true })
export function localOverviewSuccess() {
  return { success: true, status: 200, code: 'OK', data: {
    format: 'local-notepad-s3-local-candidate-overview', version: 1, read_only: true,
    observed_stable: true, complete_for_preview: false, records: 2, record_bytes: 110,
    attachment_bytes: 4, base_items: 1,
    kinds: ['file', 'tag', 'file-tag', 'attachment'].map((kind, i) => ({ kind,
      records: i === 0 || i === 3 ? 1 : 0, record_bytes: i === 0 ? 60 : i === 3 ? 50 : 0 })),
  } }
}
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function fixture(options = {}) {
  const state = { calls: [], reads: 0, clock: 100, timers: new Set(), cancellations: 0 }
  state.bridge = { s3LocalOverviewRead(input) { state.calls.push(input); return state.native ? state.native(input) : localOverviewSuccess() } }
  const binding = create({ getBridge: () => { state.reads++; return state.bridge },
    now: () => state.clock, schedule(fn, ms) { const token = { fn, ms }; state.timers.add(token); return token },
    cancel(token) { state.cancellations++; state.timers.delete(token) }, ...options })
  state.timeout = () => { state.clock += 10_000; for (const token of [...state.timers]) token.fn() }
  return { state, binding }
}
const clean = out => { assert.equal(out.summary, null); assert.equal(out.limitation, LIMITATION); assert.doesNotMatch(JSON.stringify(out), /PRIVATE|secret|password|credential/) }

export function registerS3LocalOverviewBindingTests(test) {
  test('local overview binding construction subscription and connect replay perform no native reads', () => {
    const { binding: b, state: s } = fixture(); const remove = b.subscribe(() => {})
    const first = b.connect(); first(); const second = b.connect(); first()
    assert.equal(b.snapshot().code, 'not-checked'); assert.equal(s.reads, 0); assert.equal(s.timers.size, 0)
    second(); remove(); assert.equal(s.calls.length, 0)
  })
  test('local overview binding rejects invalid options and duplicate connections', () => {
    for (const o of [{ getBridge: null }, { now: 1 }, { schedule: false }, { cancel: null },
      { timeoutMs: 0 }, { timeoutMs: 10_001 }, { timeoutMs: 1.5 }]) assert.throws(() => create(o), TypeError)
    const { binding: b } = fixture(); const close = b.connect()
    assert.throws(() => b.connect(), TypeError); assert.throws(() => b.subscribe(null), TypeError); close()
  })
  test('local overview binding disconnected commands never reflect inputs', async () => {
    const { binding: b, state: s } = fixture()
    const input = new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_INPUT') } })
    assert.equal(await b.read(input), CLOSED); assert.equal(s.reads, 0)
    const close = b.connect(); close(); assert.equal(await b.read(input), CLOSED)
  })
  test('local overview binding explicitly reads once and returns detached immutable counts', async () => {
    const { binding: b, state: s } = fixture(), raw = localOverviewSuccess(); s.native = () => raw
    const close = b.connect(); const input = localOverviewIntent(), out = await b.read(input)
    assert.equal(out.state, 'ready'); assert.equal(out.summary.records, 2); assert.equal(out.serviceStatus, 200)
    assert.deepEqual(s.calls, [input]); assert.notEqual(s.calls[0], input)
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.summary) && Object.isFrozen(out.summary.kinds) && out.summary.kinds.every(Object.isFrozen))
    raw.data.records = 99; raw.data.kinds[0].records = 99; assert.equal(out.summary.records, 2)
    assert.equal(s.timers.size, 0); assert.equal(b.snapshot(), out); close()
  })
  test('local overview binding invalid requests never resolve the native bridge', async () => {
    const { binding: b, state: s } = fixture(); const close = b.connect(); let getters = 0
    for (const input of [null, [], true, {}, { readOnly: false }, { readOnly: 'true' }, { ReadOnly: true },
      { readOnly: true, path: 'PRIVATE' }, { readOnly: true, credentials: {} }, { readOnly: true, budget: 1 },
      { get readOnly() { getters++; return true } }]) {
      assert.equal((await b.read(input)).code, 'invalid-input'); clean(b.snapshot())
    }
    assert.equal(getters, 0); assert.equal(s.reads, 0); close()
  })
  for (const mode of ['missing', 'accessor', 'inherited', 'throw-getBridge', 'throw-call', 'reject', 'throw-then']) {
    test(`local overview binding handles ${mode} native entry without leaking exceptions`, async () => {
      const { binding: b, state: s } = fixture(mode === 'throw-getBridge' ? { getBridge() { throw Error('PRIVATE_BRIDGE') } } : {})
      let getters = 0
      if (mode === 'missing') s.bridge = undefined
      if (mode === 'accessor') s.bridge = { get s3LocalOverviewRead() { getters++; throw Error('PRIVATE_GETTER') } }
      if (mode === 'inherited') s.bridge = Object.create(s.bridge)
      if (mode === 'throw-call') s.native = () => { throw Error('PRIVATE_CALL') }
      if (mode === 'reject') s.native = () => Promise.reject(Error('PRIVATE_REJECT'))
      if (mode === 'throw-then') s.native = () => ({ get then() { throw Error('PRIVATE_THEN') } })
      const close = b.connect(); const out = await b.read(localOverviewIntent())
      assert.equal(out.code, 'native-unavailable'); clean(out); assert.equal(getters, 0); assert.equal(s.timers.size, 0); close()
    })
  }
  test('local overview binding validates native status and preserves every fixed service refusal', async () => {
    const { binding: b, state: s } = fixture(); const close = b.connect()
    const errors = [[400, 'invalid-request'], [400, 'invalid-request-target'], [403, 'native-loopback-required'],
      [405, 'method-not-allowed'], [408, 'local-overview-cancelled'], [413, 'request-too-large'],
      [415, 'json-required'], [415, 'encoded-or-trailer-request-refused'], [422, 'local-overview-not-available'],
      [429, 'local-overview-busy'], [503, 'local-overview-unavailable'], [504, 'local-overview-timeout'],
      ...['invalid-local-overview-request', 'untrusted-frame', 'native-local-overview-busy',
        'native-local-overview-cancelled', 'native-local-overview-timeout', 'native-local-overview-unavailable'].map(x => [0, x])]
    for (const [status, code] of errors) {
      s.native = () => ({ success: false, status, code, data: null })
      const out = await b.read(localOverviewIntent()); assert.equal(out.code, code); assert.equal(out.serviceStatus, status); clean(out)
    }
    assert.equal(s.calls.length, errors.length); close()
  })
  for (const change of ['extra', 'getter', 'counts', 'preview', 'false-stable', 'wrong-kind', 'negative', 'array-extra', 'unknown-error']) {
    test(`local overview binding rejects ${change} reply without partial statistics`, async () => {
      const { binding: b, state: s } = fixture(); const raw = localOverviewSuccess(); let getters = 0
      if (change === 'extra') raw.private = 'PRIVATE'
      if (change === 'getter') Object.defineProperty(raw, 'data', { enumerable: true, get() { getters++; throw Error('PRIVATE') } })
      if (change === 'counts') raw.data.records++
      if (change === 'preview') raw.data.complete_for_preview = true
      if (change === 'false-stable') raw.data.observed_stable = false
      if (change === 'wrong-kind') raw.data.kinds.reverse()
      if (change === 'negative') raw.data.attachment_bytes = -1
      if (change === 'array-extra') raw.data.kinds.private = 'PRIVATE'
      if (change === 'unknown-error') Object.assign(raw, { success: false, status: 500, code: 'PRIVATE_ERROR', data: null })
      s.native = () => raw; const close = b.connect(); const out = await b.read(localOverviewIntent())
      assert.equal(out.code, 'invalid-reply'); clean(out); assert.equal(getters, 0); close()
    })
  }
  test('local overview binding pending duplicates neither reflect input nor replace the display', async () => {
    const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise; const close = b.connect()
    const p = b.read(localOverviewIntent()), shown = b.snapshot(); let reflection = 0
    const input = new Proxy({}, { ownKeys() { reflection++; return [] } })
    assert.equal((await b.read(input)).code, 'session-busy'); assert.equal(b.snapshot(), shown); assert.equal(reflection, 0)
    d.resolve(localOverviewSuccess()); assert.equal((await p).state, 'ready'); assert.equal(s.calls.length, 1); close()
  })
  for (const outcome of ['resolve', 'reject']) {
    test(`local overview binding invalidation holds its slot through late ${outcome}`, async () => {
      const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise; const close = b.connect()
      const p = b.read(localOverviewIntent()); b.invalidate(); const out = await p
      assert.equal(out.code, 'wait-stopped'); clean(out)
      const refused = b.read(localOverviewIntent()); assert.equal(s.calls.length, 1)
      assert.equal((await refused).code, 'session-busy')
      d[outcome](outcome === 'resolve' ? localOverviewSuccess() : Error('PRIVATE_LATE')); await flush()
      assert.equal(b.snapshot().code, 'wait-stopped'); assert.equal(s.calls.length, 1)
      s.native = () => localOverviewSuccess(); assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
    })
  }
  test('local overview binding timeout is only a wait boundary and does not auto retry', async () => {
    const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise; const close = b.connect()
    const p = b.read(localOverviewIntent()); s.timeout(); assert.equal((await p).code, 'wait-timeout')
    assert.equal(s.timers.size, 0); assert.equal((await b.read(localOverviewIntent())).code, 'session-busy')
    d.resolve(localOverviewSuccess()); await flush(); assert.equal(b.snapshot().code, 'wait-timeout'); assert.equal(s.calls.length, 1); close()
  })
  test('local overview binding delayed timer cannot admit a response past the absolute deadline', async () => {
    const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise; const close = b.connect()
    const p = b.read(localOverviewIntent()); s.clock += 10_000; d.resolve(localOverviewSuccess())
    assert.equal((await p).code, 'wait-timeout'); assert.equal(s.timers.size, 0); close()
  })
  test('local overview binding checks the deadline again after response reflection', async () => {
    const { binding: b, state: s } = fixture()
    s.native = () => new Proxy(localOverviewSuccess(), { getPrototypeOf(target) { s.clock += 10_000; return Object.getPrototypeOf(target) } })
    const close = b.connect(); assert.equal((await b.read(localOverviewIntent())).code, 'wait-timeout'); clean(b.snapshot()); close()
  })
  test('local overview binding releases preflight cancellation without starting native I/O', async () => {
    const { binding: b, state: s } = fixture(); const close = b.connect()
    const stop = b.subscribe(() => { if (b.snapshot().state === 'pending') b.invalidate() })
    assert.equal((await b.read(localOverviewIntent())).code, 'wait-stopped'); assert.equal(s.reads, 0); assert.equal(s.calls.length, 0)
    stop(); assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
  })
  test('local overview binding suppresses result adoption revoked by a ready observer', async () => {
    const { binding: b } = fixture(); const close = b.connect()
    const stop = b.subscribe(() => { if (b.snapshot().state === 'ready') b.invalidate() })
    assert.equal((await b.read(localOverviewIntent())).code, 'wait-stopped'); assert.equal(b.snapshot().summary, null); stop(); close()
  })
  test('local overview binding close and reconnect do not overlap an unsettled native promise', async () => {
    const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise
    const oldClose = b.connect(), p = b.read(localOverviewIntent()); oldClose(); const close = b.connect(); oldClose()
    assert.equal(await p, CLOSED); assert.equal((await b.read(localOverviewIntent())).code, 'session-busy')
    d.resolve(localOverviewSuccess()); await flush(); assert.equal(b.snapshot().summary, null)
    s.native = () => localOverviewSuccess(); assert.equal((await b.read(localOverviewIntent())).state, 'ready')
    assert.equal(s.calls.length, 2); close()
  })
  test('local overview binding closes during result publication without restoring stale counts', async () => {
    const { binding: b } = fixture(); const close = b.connect()
    const stop = b.subscribe(() => { if (b.snapshot().state === 'ready') close() })
    assert.equal(await b.read(localOverviewIntent()), CLOSED); assert.equal(b.snapshot(), CLOSED); stop()
  })
  test('local overview binding reserves before input and response proxy reentrancy', async () => {
    const { binding: b, state: s } = fixture(); const close = b.connect(); const nested = []
    const wrap = value => new Proxy(value, { getPrototypeOf(target) { nested.push(b.read(localOverviewIntent())); return Object.getPrototypeOf(target) } })
    s.native = () => wrap(localOverviewSuccess())
    assert.equal((await b.read(wrap(localOverviewIntent()))).state, 'ready')
    assert.ok(nested.length >= 2); for (const p of nested) assert.equal((await p).code, 'session-busy')
    assert.equal(s.calls.length, 1); close()
  })
  test('local overview binding callback invalidation during bridge acquisition prevents invocation', async () => {
    let b, calls = 0
    b = create({ getBridge() { b.invalidate(); return { s3LocalOverviewRead() { calls++; return localOverviewSuccess() } } } })
    const close = b.connect(); assert.equal((await b.read(localOverviewIntent())).code, 'wait-stopped'); assert.equal(calls, 0); close()
  })
  test('local overview binding observer errors and removals cannot corrupt publication', async () => {
    const { binding: b } = fixture(); let called = 0, args = -1
    const removeBad = b.subscribe(() => { throw Error('PRIVATE_OBSERVER') })
    const removeGood = b.subscribe(function () { called++; args = arguments.length })
    const close = b.connect(); await b.read(localOverviewIntent()); assert.ok(called > 0); assert.equal(args, 0)
    removeGood(); const count = called; b.invalidate(); assert.equal(called, count); removeBad(); close()
  })
  for (const clock of [NaN, Infinity, -1]) {
    test(`local overview binding rejects unusable start clock ${clock}`, async () => {
      const { binding: b, state: s } = fixture({ now: () => clock }); const close = b.connect()
      assert.equal((await b.read(localOverviewIntent())).code, 'native-unavailable'); assert.equal(s.calls.length, 0); close()
    })
  }
  test('local overview binding backwards clock after invocation fails closed', async () => {
    const d = later(), { binding: b, state: s } = fixture(); s.native = () => d.promise; const close = b.connect()
    const p = b.read(localOverviewIntent()); s.clock = 1; d.resolve(localOverviewSuccess())
    assert.equal((await p).code, 'native-unavailable'); clean(b.snapshot()); close()
  })
  test('local overview binding synchronous timer completion prevents native invocation and removes timer', async () => {
    let cleared = 0, calls = 0
    const b = create({ now: () => 1, getBridge: () => ({ s3LocalOverviewRead() { calls++ } }),
      schedule(fn) { fn(); return 8 }, cancel(token) { assert.equal(token, 8); cleared++ } })
    const close = b.connect(); assert.equal((await b.read(localOverviewIntent())).code, 'wait-timeout')
    assert.equal(cleared, 1); assert.equal(calls, 0); close()
  })
  test('local overview binding scheduler failures are sanitized and do not poison a later read', async () => {
    let broken = true
    const { binding: b, state: s } = fixture({ schedule() { if (broken) throw Error('PRIVATE_TIMER'); return 1 }, cancel() { throw Error('PRIVATE_CANCEL') } })
    const close = b.connect(); assert.equal((await b.read(localOverviewIntent())).code, 'native-unavailable'); assert.equal(s.calls.length, 0)
    broken = false; assert.equal((await b.read(localOverviewIntent())).state, 'ready'); close()
  })
  test('local overview binding invalidate clears completed statistics without implicit fetch', async () => {
    const { binding: b, state: s } = fixture(); const close = b.connect()
    await b.read(localOverviewIntent()); b.invalidate(); assert.equal(b.snapshot().code, 'not-checked'); clean(b.snapshot())
    assert.equal(s.calls.length, 1); close()
  })
}
