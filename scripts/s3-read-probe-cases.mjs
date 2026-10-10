import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { createS3ReadProbeSession as createSession, S3_PROBE_WAIT_MS, S3_PROBE_LIMITATION } from '../src/services/s3ReadProbe.mjs'
import { createS3ReadProbeSession as publicSession } from '../src/services/api.js'
import { encodeS3ProbeRequest, registerS3ProbeHandler, S3_PROBE_CHANNEL } from '../electron/s3-probe-bridge.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'

const payload = (extra = {}) => ({ endpoint: 'https://synthetic.example.invalid', bucket: 'synthetic-bucket', region: 'us-east-1',
  prefix: '前缀', key: '目录/e\u0301 %2F.json', accessKeyId: 'AKIASYNTHETIC', secretAccessKey: ' secret unchanged ',
  sessionToken: ' synthetic token ', maxBytes: 4096, readOnly: true, ...extra })
const ok = (bytes = 17) => ({ success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: bytes } })
const failure = (outcome, httpStatus = 0) => ({ success: false, status: 422, code: 'probe-not-readable', data: { outcome, httpStatus, acceptedBytes: 0 } })
function fixture(invoke = () => ok(), extra = {}) {
  const timers = new Map(), calls = []
  const bridge = { s3ProbeRead(input) { calls.push(input); return invoke(input, this) } }
  let serial = 0
  const session = createSession({ getBridge: () => bridge,
    schedule: (fn, ms) => { assert.equal(ms, S3_PROBE_WAIT_MS); timers.set(++serial, fn); return serial },
    cancel: id => timers.delete(id), ...extra })
  return { session, bridge, calls, timers }
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const safe = value => {
  const text = JSON.stringify(value)
  for (const token of ['synthetic', 'secret unchanged', 'AKIASYNTHETIC', 'PRIVATE_ERROR']) assert.ok(!text.includes(token), 'private input reached public state')
  assert.ok(Object.isFrozen(value)); assert.equal(value.limitation, S3_PROBE_LIMITATION)
}

export function registerS3ReadProbeTests(test) {
  test('S3 renderer public entry is lazy and never uses the generic HTTP API', () => {
    assert.equal(publicSession, createSession)
    let reads = 0
    const s = publicSession({ getBridge: () => { reads++; throw new Error('PRIVATE_ERROR') } })
    assert.equal(s.snapshot().state, 'idle'); s.invalidate(); s.dispose(); assert.equal(reads, 0)
    const source = fs.readFileSync(new URL('../src/services/s3ReadProbe.mjs', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|console)\s*[.(]/)
    assert.doesNotMatch(source, /from ['"]node:|setInterval\s*\(/)
  })
  test('S3 renderer invokes one native method with a detached byte-exact request and correct receiver', async () => {
    const original = payload(), f = fixture((copy, receiver) => {
      assert.equal(receiver, f.bridge); assert.notEqual(copy, original)
      assert.deepEqual(JSON.parse(encodeS3ProbeRequest(copy)), original)
      return ok()
    })
    const result = await f.session.read(original)
    assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0)
    assert.equal(result.state, 'readable'); assert.equal(result.summary.acceptedBytes, 17)
    assert.equal(result.serviceStatus, 200); assert.equal(f.session.snapshot(), result)
    safe(result); assert.ok(Object.isFrozen(result.summary))
  })
  for (const bytes of [0, 1, 4096]) test(`S3 renderer permits complete ${bytes}-byte objects without claiming credential validity`, async () => {
    const f = fixture(() => ok(bytes)), result = await f.session.read(payload())
    assert.equal(result.state, 'readable'); assert.equal(result.summary.acceptedBytes, bytes)
    assert.match(result.limitation, /不验证凭据有效性、列举或写入权限/); safe(result)
  })
  for (const [name, make] of [
    ['null', () => null], ['array', () => []], ['class', () => new Date()],
    ['intent', () => payload({ readOnly: false })], ['minimum', () => payload({ maxBytes: 0 })],
    ['maximum', () => payload({ maxBytes: 1048577 })], ['fraction', () => payload({ maxBytes: 1.5 })],
    ['NaN', () => payload({ maxBytes: NaN })], ['string limit', () => payload({ maxBytes: '1' })],
    ['missing', () => { const p = payload(); delete p.key; return p }],
    ['extra', () => payload({ target: 'PRIVATE_ERROR' })], ['symbol', () => payload({ [Symbol('private')]: 1 })],
    ['string type', () => payload({ secretAccessKey: null })], ['surrogate', () => payload({ key: '\ud800' })],
    ['size', () => payload({ key: 'x'.repeat(65536) })],
    ['hidden', () => Object.defineProperty(payload(), 'key', { value: 'hidden', enumerable: false })],
    ['getter', () => Object.defineProperty(payload(), 'key', { get() { throw new Error('PRIVATE_ERROR') }, enumerable: true })],
    ['proxy', () => new Proxy({}, { ownKeys() { throw new Error('PRIVATE_ERROR') } })],
    ['toJSON', () => payload({ toJSON() { throw new Error('PRIVATE_ERROR') } })],
  ]) test(`S3 renderer rejects ${name} before native invocation`, async () => {
    const f = fixture(), result = await f.session.read(make())
    assert.equal(result.code, 'invalid-input'); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); safe(result)
  })
  test('S3 renderer honors the exact 64KiB UTF8 request budget, not UTF16 character count', async () => {
    const p = payload({ secretAccessKey: '' }), size = Buffer.byteLength(JSON.stringify(p))
    p.secretAccessKey = 'x'.repeat(65536 - size)
    assert.equal(Buffer.byteLength(JSON.stringify(p)), 65536)
    const f = fixture(); assert.equal((await f.session.read(p)).state, 'readable')
    p.secretAccessKey += '雪'
    assert.equal((await f.session.read(p)).code, 'invalid-input'); assert.equal(f.calls.length, 1)
  })
  for (const [outcome, status] of [
    ['access-denied', 401], ['access-denied', 403], ['not-found', 404], ['redirect-refused', 301],
    ['redirect-refused', 302], ['redirect-refused', 303], ['redirect-refused', 307], ['redirect-refused', 308],
    ['http-failure', 204], ['http-failure', 206], ['http-failure', 304], ['http-failure', 429], ['http-failure', 500],
    ...['invalid-config', 'invalid-credentials', 'invalid-key', 'too-large', 'body-rejected', 'transport-failure', 'cancelled', 'deadline-exceeded'].map(x => [x, 0]),
  ]) test(`S3 renderer interprets ${outcome}/${status} without replay, partial data or credential claims`, async () => {
    const f = fixture(() => failure(outcome, status)), result = await f.session.read(payload())
    assert.equal(result.state, 'failed'); assert.equal(result.code, outcome); assert.equal(result.summary.httpStatus, status)
    assert.equal(result.summary.acceptedBytes, 0); assert.equal(f.calls.length, 1); safe(result)
  })
  for (const [status, code] of [[0, 'untrusted-frame'], [0, 'native-probe-busy'], [0, 'native-probe-timeout'],
    [0, 'native-probe-cancelled'], [0, 'native-probe-unavailable'], [0, 'native-probe-invalid-response'], [0, 'invalid-bridge-request'],
    [400, 'invalid-request'], [400, 'invalid-request-target'], [403, 'native-loopback-required'], [405, 'method-not-allowed'],
    [413, 'request-too-large'], [415, 'json-required'], [415, 'encoded-request-refused'], [429, 'probe-busy'], [503, 'probe-unavailable']]) {
    test(`S3 renderer preserves safe bridge/service classification ${status}/${code}`, async () => {
      const f = fixture(() => ({ success: false, status, code, data: null })), result = await f.session.read(payload())
      assert.equal(result.code, code); assert.equal(result.serviceStatus, status); assert.equal(result.summary, null); safe(result)
    })
  }
  for (const [name, make] of [
    ['null', () => null], ['extra private field', () => ({ ...ok(), endpoint: 'synthetic' })],
    ['success mismatch', () => ({ ...ok(), success: false })], ['status mismatch', () => ({ ...ok(), status: 422 })],
    ['private code', () => ({ ...ok(), code: 'PRIVATE_ERROR' })], ['oversize accepted', () => ok(4097)],
    ['negative', () => ok(-1)], ['fractional', () => ok(1.5)], ['missing summary field', () => { const r = ok(); delete r.data.httpStatus; return r }],
    ['partial failure', () => { const r = failure('access-denied', 403); r.data.acceptedBytes = 1; return r }],
    ['outcome mismatch', () => failure('not-found', 403)], ['unknown outcome', () => failure('PRIVATE_ERROR')],
    ['HTTP success as failure', () => failure('http-failure', 200)], ['invalid HTTP range', () => failure('http-failure', 600)],
    ['extra summary field', () => { const r = ok(); r.data.body = 'synthetic'; return r }],
    ['accessor', () => Object.defineProperty(ok(), 'data', { get() { throw new Error('PRIVATE_ERROR') }, enumerable: true })],
    ['reflection', () => new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_ERROR') } })],
    ['wrong failure code/status', () => ({ success: false, status: 403, code: 'OK', data: null })],
  ]) test(`S3 renderer fails closed for ${name} replies`, async () => {
    const f = fixture(make), result = await f.session.read(payload())
    assert.equal(result.code, 'invalid-reply'); assert.equal(result.summary, null); safe(result)
  })
  for (const name of ['missing', 'getter', 'throw', 'reject', 'thenable']) test(`S3 renderer handles ${name} native bridge without HTTP fallback or error disclosure`, async () => {
    const f = fixture(() => {
      if (name === 'throw') throw new Error('PRIVATE_ERROR')
      if (name === 'reject') return Promise.reject(new Error('PRIVATE_ERROR'))
      return { get then() { throw new Error('PRIVATE_ERROR') } }
    }, name === 'missing' ? { getBridge: () => null } : name === 'getter' ? { getBridge() { throw new Error('PRIVATE_ERROR') } } : {})
    const result = await f.session.read(payload()); assert.equal(result.code, 'native-unavailable'); safe(result)
    assert.equal(f.timers.size, 0)
  })
  test('S3 renderer input edits A-B-A invalidate old success and hold the slot until native completion', async () => {
    const d = deferred(), f = fixture(() => d.promise), input = payload()
    const first = f.session.read(input); input.key = 'changed'
    assert.notEqual(f.calls[0].key, input.key)
    f.session.invalidate(); input.key = payload().key; f.session.invalidate()
    assert.equal((await first).code, 'wait-stopped')
    assert.equal((await f.session.read(input)).code, 'session-busy'); assert.equal(f.calls.length, 1)
    d.resolve(ok()); await tick(); assert.notEqual(f.session.snapshot().state, 'readable')
    const next = await f.session.read(input); assert.equal(next.state, 'readable'); assert.equal(f.calls.length, 2)
  })
  test('S3 renderer wait timeout is not native cancellation and cannot release the transport slot', async () => {
    const d = deferred(), f = fixture(() => d.promise), first = f.session.read(payload())
    const timer = [...f.timers.values()][0]; timer()
    assert.equal((await first).code, 'wait-timeout'); assert.equal(f.timers.size, 0)
    assert.equal((await f.session.read(payload())).code, 'session-busy'); d.reject(new Error('PRIVATE_ERROR'))
    await tick(); assert.equal(f.session.snapshot().code, 'wait-timeout')
    timer(); assert.equal(f.session.snapshot().code, 'wait-timeout'); safe(f.session.snapshot())
  })
  test('S3 renderer dispose suppresses late rejection, is idempotent and never permits reuse', async () => {
    const d = deferred(), f = fixture(() => d.promise), first = f.session.read(payload())
    f.session.dispose(); f.session.dispose(); assert.equal((await first).code, 'disposed')
    d.reject(new Error('PRIVATE_ERROR')); await tick()
    assert.equal((await f.session.read(payload())).code, 'disposed'); assert.equal(f.calls.length, 1)
    assert.equal(f.timers.size, 0); safe(f.session.snapshot())
  })
  test('S3 renderer invalidation clears a previously readable summary without retaining credentials', async () => {
    const f = fixture(); await f.session.read(payload()); f.session.invalidate()
    assert.equal(f.session.snapshot().summary, null); assert.equal(f.session.snapshot().code, 'not-checked'); safe(f.session.snapshot())
  })
  test('S3 renderer reentrant input reflection cannot issue a second native request', async () => {
    const d = deferred(), f = fixture(() => d.promise); let nested, entered = false
    const p = new Proxy(payload(), { getPrototypeOf(target) {
      if (!entered) { entered = true; nested = f.session.read(payload()) }
      return Object.getPrototypeOf(target)
    } })
    const first = f.session.read(p)
    assert.equal(f.calls.length, 1); d.resolve(ok()); await first; await nested
  })
  test('S3 renderer reentrant bridge invalidation and synchronous timer do not dispatch', async () => {
    let f; f = fixture(() => ok(), { getBridge: () => { f.session.invalidate(); return f.bridge } })
    assert.equal((await f.session.read(payload())).code, 'wait-stopped'); assert.equal(f.calls.length, 0)
    const immediate = fixture(() => ok(), { schedule: fn => { fn(); return 1 } })
    assert.equal((await immediate.session.read(payload())).code, 'wait-timeout'); assert.equal(immediate.calls.length, 0)
  })
  test('S3 renderer timer failure cannot dispatch and cancellation failure cannot leak raw errors', async () => {
    const f = fixture(() => ok(), { schedule() { throw new Error('PRIVATE_ERROR') } })
    const result = await f.session.read(payload()); assert.equal(result.state, 'failed'); assert.equal(f.calls.length, 0); safe(result)
    const g = fixture(() => ok(), { cancel() { throw new Error('PRIVATE_ERROR') } })
    safe(await g.session.read(payload()))
  })
  for (const ms of [0, 10001, 1.5, NaN, '1']) test(`S3 renderer rejects invalid internal wait budget ${String(ms)}`, () => {
    assert.throws(() => createSession({ timeoutMs: ms }), /Invalid S3 read probe session options/)
  })
  test('S3 renderer interoperates with the unchanged main IPC scope and refuses navigation success', async () => {
    const sender = new EventEmitter(); sender.mainFrame = { url: 'file:///synthetic/dist/index.html' }
    sender.getURL = () => sender.mainFrame.url; sender.isDestroyed = () => false
    const win = new EventEmitter(); win.webContents = sender; win.isDestroyed = () => false
    const scope = createS3ProbeScope({ getWindow: () => win, getExpectedURL: () => 'file:///synthetic/dist/index.html' })
    const handlers = new Map(), d = deferred(); let signal
    registerS3ProbeHandler({ handle: (key, fn) => handlers.set(key, fn) }, { probe(input, options) {
      assert.ok(encodeS3ProbeRequest(input)); signal = options.signal; return d.promise
    } }, scope)
    const f = fixture(input => handlers.get(S3_PROBE_CHANNEL)({ sender, senderFrame: sender.mainFrame }, input))
    try {
      const first = f.session.read(payload())
      sender.emit('did-start-navigation', {}, sender.mainFrame.url, false, true)
      assert.equal(signal.aborted, true); d.resolve(ok())
      const result = await first; assert.equal(result.code, 'native-probe-cancelled'); assert.equal(result.summary, null)
      assert.equal(sender.listenerCount('destroyed'), 0); safe(result)
    } finally { f.session.dispose(); scope.dispose() }
  })
}
