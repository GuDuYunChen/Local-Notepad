import assert from 'node:assert/strict'
import { createS3PreviewBinding } from '../src/services/s3PreviewBinding.mjs'
import { previewPayload, previewSuccess } from './s3-preview-bridge-cases.mjs'
const ok = () => ({ success: true, status: 200, code: 'OK', data: previewSuccess().data })
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function rig(invoke = async () => ok()) {
  const calls = [], timers = new Map()
  let sequence = 0, discoveries = 0
  const bridge = { s3PreviewRead: input => { calls.push(input); return invoke(input) } }
  const binding = createS3PreviewBinding({ getBridge: () => { discoveries++; return bridge }, now: () => 0,
    schedule: fn => { const id = ++sequence; timers.set(id, fn); return id }, cancel: id => timers.delete(id) })
  return { binding, calls, bridge, timers, discoveries: () => discoveries,
    timeout: () => { for (const fn of [...timers.values()]) fn() } }
}
const poison = () => new Proxy({}, { getPrototypeOf() { throw Error('PRIVATE_INPUT_REFLECTION') }, ownKeys() { throw Error('PRIVATE_INPUT_REFLECTION') } })
const clean = value => assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|synthetic\.invalid|AKIASYNTHETIC/)

export function registerS3PreviewBindingTests(test) {
  test('preview binding construction subscription and connection never invoke native', () => {
    const r = rig(), snapshots = []
    assert.ok(Object.isFrozen(r.binding)); const first = r.binding.snapshot()
    assert.equal(first, r.binding.snapshot()); assert.equal(first.code, 'not-checked')
    const unsub = r.binding.subscribe((...args) => { assert.deepEqual(args, []); snapshots.push(r.binding.snapshot()) })
    const disconnect = r.binding.connect(); assert.equal(r.calls.length, 0); assert.equal(r.discoveries(), 0)
    assert.throws(() => r.binding.connect(), /already connected/)
    unsub(); disconnect(); assert.equal(r.discoveries(), 0); snapshots.forEach(clean)
  })
  test('preview binding disconnected reads refuse without input reflection', async () => {
    const r = rig(); assert.equal((await r.binding.read(poison())).code, 'disposed')
    const disconnect = r.binding.connect(); disconnect()
    assert.equal((await r.binding.read(poison())).code, 'disposed'); assert.equal(r.discoveries(), 0)
  })
  test('preview binding publishes pending and frozen counts with stable snapshots', async () => {
    const d = later(), r = rig(() => d.promise); const close = r.binding.connect(), states = []
    r.binding.subscribe(() => { const s = r.binding.snapshot(); states.push(s.state); clean(s); assert.equal(s, r.binding.snapshot()) })
    const p = r.binding.read(previewPayload()); assert.deepEqual(states, ['pending'])
    d.resolve(ok()); const result = await p
    assert.equal(result, r.binding.snapshot()); assert.ok(Object.isFrozen(result.summary.kinds[0].counts))
    assert.deepEqual(states, ['pending', 'ready']); assert.equal(r.calls.length, 1); close()
  })
  test('preview binding busy calls do not inspect payload displace pending or invalidate first result', async () => {
    const d = later(), r = rig(() => d.promise), close = r.binding.connect()
    const p = r.binding.read(previewPayload()), pending = r.binding.snapshot()
    assert.equal((await r.binding.read(poison())).code, 'session-busy'); assert.equal(r.binding.snapshot(), pending)
    d.resolve(ok()); assert.equal((await p).state, 'ready'); assert.equal(r.calls.length, 1); close()
  })
  test('preview binding reentrant input cannot start a second native invocation', async () => {
    const r = rig(), close = r.binding.connect(); let nested
    const input = new Proxy(previewPayload(), { getPrototypeOf(target) { nested = r.binding.read(poison()); return Object.getPrototypeOf(target) } })
    assert.equal((await r.binding.read(input)).state, 'ready'); assert.equal((await nested).code, 'session-busy')
    assert.equal(r.calls.length, 1); close()
  })
  test('preview binding invalidation during input reflection remains offline', async () => {
    const r = rig(), close = r.binding.connect()
    const input = new Proxy(previewPayload(), { getPrototypeOf(target) { r.binding.invalidate(); return Object.getPrototypeOf(target) } })
    assert.equal((await r.binding.read(input)).code, 'wait-stopped'); assert.equal(r.calls.length, 0); close()
  })
  test('preview binding duplicate subscriptions own independent cleanup leases', async () => {
    const r = rig(), close = r.binding.connect(); let n = 0
    const listener = () => { n++ }, off1 = r.binding.subscribe(listener), off2 = r.binding.subscribe(listener)
    off1(); off1(); await r.binding.read(previewPayload()); assert.equal(n, 2)
    off2(); r.binding.invalidate(); assert.equal(n, 2); close()
  })
  test('preview binding removed observer is not notified by an in-progress notification pass', async () => {
    const r = rig(), close = r.binding.connect(); let n = 0, off2
    r.binding.subscribe(() => off2()); off2 = r.binding.subscribe(() => { n++ })
    await r.binding.read(previewPayload()); assert.equal(n, 0); close()
  })
  test('preview binding throwing observer cannot leak errors or block other readers', async () => {
    const r = rig(), close = r.binding.connect(); let n = 0
    r.binding.subscribe(() => { throw Error('PRIVATE_OBSERVER') }); r.binding.subscribe(() => { n++ })
    const out = await r.binding.read(previewPayload()); assert.equal(out.state, 'ready'); assert.equal(n, 2); clean(out); close()
  })
  test('preview binding notifications read latest snapshot after reentrant invalidation', async () => {
    const r = rig(), close = r.binding.connect(), observed = []
    r.binding.subscribe(() => { if (r.binding.snapshot().state === 'ready') r.binding.invalidate() })
    r.binding.subscribe((...args) => { assert.deepEqual(args, []); observed.push(r.binding.snapshot().state) })
    const out = await r.binding.read(previewPayload())
    assert.equal(out.code, 'wait-stopped'); assert.ok(!observed.includes('ready')); assert.equal(r.binding.snapshot().summary, null); close()
  })
  test('preview binding observer disconnect prevents ready result adoption', async () => {
    const r = rig(), close = r.binding.connect()
    r.binding.subscribe(() => { if (r.binding.snapshot().state === 'ready') close() })
    assert.equal((await r.binding.read(previewPayload())).code, 'disposed'); assert.equal(r.binding.snapshot().state, 'disposed')
  })
  test('preview binding newer read from ready observer invalidates the old returned result', async () => {
    const d = later(), r = rig(); const close = r.binding.connect(); let next, once = false
    r.binding.subscribe(() => {
      if (r.binding.snapshot().state === 'ready' && !once) {
        once = true; r.bridge.s3PreviewRead = () => d.promise; next = r.binding.read(previewPayload())
      }
    })
    const first = await r.binding.read(previewPayload())
    assert.equal(first.code, 'wait-stopped'); assert.equal(r.binding.snapshot().state, 'pending')
    d.resolve(ok()); assert.equal((await next).state, 'ready'); close()
  })
  test('preview binding invalidation after publication but before consumer adoption rejects success', async () => {
    const r = rig(), close = r.binding.connect()
    r.binding.subscribe(() => { if (r.binding.snapshot().state === 'ready') queueMicrotask(() => r.binding.invalidate()) })
    assert.equal((await r.binding.read(previewPayload())).code, 'wait-stopped'); assert.equal(r.binding.snapshot().summary, null); close()
  })
  test('preview binding A-B-A invalidation retains native ownership until original call settles', async () => {
    const d = later(), r = rig(() => d.promise), close = r.binding.connect()
    const p = r.binding.read(previewPayload()); r.binding.invalidate(); r.binding.invalidate()
    assert.equal((await p).code, 'wait-stopped')
    assert.equal((await r.binding.read(previewPayload())).code, 'session-busy'); assert.equal(r.calls.length, 1)
    d.resolve(ok()); await flush(); assert.notEqual(r.binding.snapshot().state, 'ready')
    r.bridge.s3PreviewRead = async () => ok(); assert.equal((await r.binding.read(previewPayload())).state, 'ready'); close()
  })
  test('preview binding timeout is observable with no polling no retries and no assumed native cancellation', async () => {
    const d = later(), r = rig(() => d.promise), close = r.binding.connect(), codes = []
    r.binding.subscribe(() => codes.push(r.binding.snapshot().code))
    const p = r.binding.read(previewPayload()); r.timeout(); assert.equal((await p).code, 'wait-timeout')
    assert.deepEqual(codes, ['checking', 'wait-timeout']); assert.equal(r.timers.size, 0)
    assert.equal((await r.binding.read(previewPayload())).code, 'session-busy'); assert.equal(r.calls.length, 1)
    d.reject(Error('PRIVATE_LATE')); await flush(); assert.equal(r.binding.snapshot().code, 'wait-timeout'); close()
  })
  for (const completion of ['resolve', 'reject']) test(`preview binding disconnected late ${completion} cannot publish into a fresh lease`, async () => {
    const d = later(), r = rig(() => d.promise), close1 = r.binding.connect()
    const p = r.binding.read(previewPayload()); close1(); assert.equal((await p).code, 'disposed')
    r.bridge.s3PreviewRead = async () => ok(); const close2 = r.binding.connect()
    const good = await r.binding.read(previewPayload()); close1()
    d[completion](completion === 'resolve' ? ok() : Error('PRIVATE_LATE')); await flush()
    assert.equal(r.binding.snapshot(), good); assert.equal(good.state, 'ready'); close2()
  })
  test('preview binding reconnect during disconnect notification owns a fresh offline lifetime', () => {
    const r = rig(), close1 = r.binding.connect(); let close2
    const off = r.binding.subscribe(() => { if (r.binding.snapshot().state === 'disposed' && !close2) close2 = r.binding.connect() })
    close1(); close1(); assert.equal(r.binding.snapshot().state, 'idle'); assert.equal(r.calls.length, 0)
    // Remove no current lease by calling the stale cleanup.
    assert.throws(() => r.binding.connect(), /already connected/); off(); close2()
  })
  for (const [name, response, expected] of [
    ['malformed counts', () => { const x = ok(); x.data.counts.conflicts = 99; return x }, 'invalid-reply'],
    ['service refusal', () => ({ success: false, status: 422, code: 'preview-not-available', data: null }), 'preview-not-available'],
    ['native rejection', () => Promise.reject(Error('PRIVATE_NATIVE')), 'native-unavailable'],
  ]) test(`preview binding preserves original session ${name} semantics without private data`, async () => {
    const r = rig(response), close = r.binding.connect()
    const out = await r.binding.read(previewPayload()); assert.equal(out.code, expected)
    assert.equal(out, r.binding.snapshot()); assert.equal(out.summary, null); clean(out); close()
  })
  test('preview binding current invalidation clears completed counts and permits a new explicit read', async () => {
    const r = rig(), close = r.binding.connect(); await r.binding.read(previewPayload())
    r.binding.invalidate(); assert.equal(r.binding.snapshot().code, 'not-checked'); assert.equal(r.calls.length, 1)
    assert.equal((await r.binding.read(previewPayload())).state, 'ready'); assert.equal(r.calls.length, 2); close()
  })
  test('preview bindings have isolated subscriptions snapshots and per-instance sessions', async () => {
    const a = rig(), b = rig(), closeA = a.binding.connect(), closeB = b.binding.connect(); let count = 0
    b.binding.subscribe(() => { count++ }); await a.binding.read(previewPayload())
    assert.equal(b.binding.snapshot().state, 'idle'); assert.equal(b.calls.length, 0); assert.equal(count, 0)
    closeA(); closeB()
  })
  test('preview binding invalid observer is rejected without native discovery', () => {
    const r = rig()
    for (const observer of [null, {}, 42, 'PRIVATE']) assert.throws(() => r.binding.subscribe(observer), /Invalid S3 preview observer/)
    assert.equal(r.discoveries(), 0)
  })
}
