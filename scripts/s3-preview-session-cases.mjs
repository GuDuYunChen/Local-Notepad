import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createS3PreviewSession, S3_PREVIEW_LIMITATION } from '../src/services/s3PreviewSession.mjs'
import { encodeS3PreviewRequest, decodeS3PreviewResponse } from '../electron/s3-preview-codec.js'
import { previewPayload, previewSuccess } from './s3-preview-bridge-cases.mjs'

const reply = () => ({ success: true, status: 200, code: 'OK', data: previewSuccess().data })
const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const clean = r => assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|AKIASYNTHETIC|synthetic\.invalid/)
function rig(invoke = async () => reply(), extras = {}) {
  const calls = [], timers = new Map(); let discoveries = 0, clock = 0, sequence = 0
  const bridge = { s3PreviewRead(p) { calls.push(p); return invoke(p) } }
  const session = createS3PreviewSession({ getBridge: () => { discoveries++; return bridge }, now: () => clock,
    schedule: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id }, cancel: id => timers.delete(id), ...extras })
  return { session, calls, bridge, timers, discoveries: () => discoveries, setClock: n => { clock = n },
    timeout() { for (const { fn } of [...timers.values()]) fn() } }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
export function registerS3PreviewSessionTests(test) {
  test('preview session creation, snapshot and disposal are offline and credential-free', async () => {
    const r = rig(); const first = r.session.snapshot()
    assert.equal(first.state, 'idle'); assert.equal(first, r.session.snapshot()); clean(first)
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(r.session)); assert.equal(first.limitation, S3_PREVIEW_LIMITATION)
    r.session.dispose(); assert.equal((await r.session.read(new Proxy({}, { ownKeys() { throw Error('must not reflect') } }))).code, 'disposed')
    assert.equal(r.discoveries(), 0); assert.equal(r.calls.length, 0)
  })
  test('preview session sends one exact independent Unicode snapshot and reconstructs frozen counts', async () => {
    const d = later(), r = rig(() => d.promise), input = previewPayload()
    input.basis.localRecords['file:雪'] = '{ "content": "e\\u0301 %2F PRIVATE_BODY" }'
    const expected = JSON.parse(JSON.stringify(input)), pending = r.session.read(input)
    assert.deepEqual(r.calls, [expected]); assert.equal(r.session.snapshot().state, 'pending'); clean(r.session.snapshot())
    input.connection.secretAccessKey = 'changed'; input.limits.maxItems = 1
    const raw = reply(); d.resolve(raw); const result = await pending
    assert.equal(result.state, 'ready'); assert.equal(result.summary.counts.conflicts, 1)
    assert.notEqual(result.summary, raw.data); assert.ok(Object.isFrozen(result.summary.kinds[0].counts))
    raw.data.counts.conflicts = 99; assert.equal(result.summary.counts.conflicts, 1)
    assert.equal(r.calls[0].connection.secretAccessKey, 'PRIVATE_SECRET'); assert.equal(r.timers.size, 0); clean(result)
  })
  for (const section of ['root', 'connection', 'pin', 'basis', 'limits', 'localRecords', 'baseItems']) {
    test(`preview session rejects ${section} request getter without executing it or discovering native`, async () => {
      const p = previewPayload(), x = section === 'root' ? p : ['localRecords', 'baseItems'].includes(section) ? p.basis[section] : p[section]
      let touched = 0
      Object.defineProperty(x, Object.keys(x)[0] || 'file:private', { enumerable: true, configurable: true, get() { touched++; throw Error('PRIVATE') } })
      const r = rig(); assert.equal((await r.session.read(p)).code, 'invalid-input')
      assert.equal(touched, 0); assert.equal(r.discoveries(), 0); assert.equal(r.calls.length, 0)
    })
  }
  const badInputs = [
    ['readOnly', p => { p.readOnly = false }], ['generation', p => { p.pin.generation = Number.MAX_SAFE_INTEGER + 1 }],
    ['store mismatch', p => { p.basis.storeId = 'OTHER' }], ['hash', p => { p.pin.sha256 = 'G'.repeat(64) }],
    ['unpaired Unicode', p => { p.connection.prefix = '\ud800' }], ['record bytes', p => { p.basis.localRecords.a = 'a'.repeat(4097) }],
    ['record count', p => { p.basis.localRecords = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), '{}'])) }],
    ['total bytes', p => { p.basis.localRecords = { a: 'a'.repeat(4096), b: 'b'.repeat(4096), c: '{}' } }],
    ['unknown field', p => { p.extra = 'PRIVATE' }], ['limit cap', p => { p.limits.maxItems = 385 }],
  ]
  for (const [name, mutate] of badInputs) test(`preview session refuses ${name} before native I/O`, async () => {
    const p = previewPayload(); mutate(p); const r = rig()
    const out = await r.session.read(p); assert.equal(out.code, 'invalid-input'); assert.equal(r.calls.length, 0); clean(out)
  })
  test('preview session input proxy cannot reenter a second invocation', async () => {
    const r = rig(); let nested, once = false
    const p = new Proxy(previewPayload(), { getPrototypeOf(t) { if (!once) { once = true; nested = r.session.read(previewPayload()) } return Object.getPrototypeOf(t) } })
    assert.equal((await r.session.read(p)).state, 'ready'); assert.equal((await nested).code, 'session-busy'); assert.equal(r.calls.length, 1)
  })
  for (const operation of ['invalidate', 'dispose']) test(`preview session ${operation} during input reflection prevents discovery`, async () => {
    const r = rig(); const p = new Proxy(previewPayload(), { ownKeys(t) { r.session[operation](); return Reflect.ownKeys(t) } })
    const out = await r.session.read(p); assert.equal(out.code, operation === 'dispose' ? 'disposed' : 'wait-stopped')
    assert.equal(r.discoveries(), 0); assert.equal(r.calls.length, 0)
  })
  test('preview session missing or accessor native method never falls back to HTTP', async () => {
    let touched = 0
    const bridge = {}; Object.defineProperty(bridge, 's3PreviewRead', { get() { touched++; throw Error('PRIVATE') } })
    for (const b of [null, {}, bridge]) {
      const r = rig(undefined, { getBridge: () => b }); const out = await r.session.read(previewPayload())
      assert.equal(out.code, 'native-unavailable'); clean(out); assert.equal(r.calls.length, 0)
    }
    assert.equal(touched, 0)
  })
  test('preview session native throw and rejection are fixed failures and permit a new explicit read', async () => {
    for (const invoke of [() => { throw Error('PRIVATE_NATIVE') }, () => Promise.reject(Error('PRIVATE_NATIVE'))]) {
      const r = rig(invoke); const out = await r.session.read(previewPayload())
      assert.equal(out.code, 'native-unavailable'); clean(out)
      r.bridge.s3PreviewRead = async () => reply(); assert.equal((await r.session.read(previewPayload())).state, 'ready')
    }
  })
  const nativeCodes = ['invalid-preview-request', 'native-preview-busy', 'native-preview-cancelled', 'native-preview-timeout', 'native-preview-unavailable', 'native-preview-invalid-response', 'untrusted-frame']
  for (const code of nativeCodes) test(`preview session preserves whitelisted native failure ${code}`, async () => {
    const r = rig(async () => ({ success: false, status: 0, code, data: null })); const out = await r.session.read(previewPayload())
    assert.equal(out.code, code); assert.equal(out.serviceStatus, 0); assert.equal(out.summary, null); clean(out)
  })
  const failures = [[400, 'invalid-request'], [400, 'invalid-request-target'], [400, 'invalid-connection'], [403, 'native-loopback-required'],
    [405, 'method-not-allowed'], [408, 'preview-cancelled'], [413, 'request-too-large'], [415, 'json-required'], [415, 'encoded-request-refused'],
    [422, 'preview-not-available'], [429, 'preview-busy'], [503, 'preview-unavailable'], [504, 'preview-timeout']]
  for (const [status, code] of failures) test(`preview session preserves exact service refusal ${status}/${code}`, async () => {
    const r = rig(async () => ({ success: false, status, code, data: null })); const out = await r.session.read(previewPayload())
    assert.equal(out.state, 'failed'); assert.equal(out.code, code); assert.equal(out.serviceStatus, status); assert.equal(out.summary, null); clean(out)
  })
  const badReplies = [
    ['unknown status', r => { r.status = 404 }], ['false success', r => { r.success = false }], ['wrong message', r => { r.code = 'PRIVATE' }],
    ['extra envelope field', r => { r.extra = 'PRIVATE' }], ['extra summary field', r => { r.data.id = 'PRIVATE' }],
    ['total overflow', r => { r.data.counts.total = 13 }], ['hidden conflict', r => { r.data.counts.conflicts = 0 }],
    ['kind order', r => { r.data.kinds.reverse() }], ['fraction', r => { r.data.counts.total = 0.5 }],
    ['read-write', r => { r.data.read_only = false }], ['wrong format', r => { r.data.format = 'PRIVATE' }],
    ['sparse kinds', r => { delete r.data.kinds[1] }], ['array extras', r => { r.data.kinds.extra = 1 }],
    ['huge code', r => { r.code = 'x'.repeat(257) }], ['circular', r => { r.data.counts = r }],
    ['toJSON', r => { r.data.toJSON = () => { throw Error('PRIVATE') } }],
  ]
  for (const [name, mutate] of badReplies) test(`preview session rejects ${name} reply without partial counts`, async () => {
    const raw = reply(); mutate(raw); const r = rig(async () => raw), out = await r.session.read(previewPayload())
    assert.equal(out.code, 'invalid-reply'); assert.equal(out.summary, null); clean(out)
  })
  for (const section of ['root', 'data', 'counts', 'kinds', 'kind', 'kindCounts']) test(`preview session refuses ${section} result accessor without execution`, async () => {
    const raw = reply(); let touched = 0
    const x = section === 'root' ? raw : section === 'data' ? raw.data : section === 'counts' ? raw.data.counts
      : section === 'kinds' ? raw.data.kinds : section === 'kind' ? raw.data.kinds[0] : raw.data.kinds[0].counts
    const key = Object.keys(x)[0]; Object.defineProperty(x, key, { enumerable: true, get() { touched++; throw Error('PRIVATE') } })
    const r = rig(async () => raw); assert.equal((await r.session.read(previewPayload())).code, 'invalid-reply'); assert.equal(touched, 0)
  })
  test('preview session validates counts against the original requested maxItems', async () => {
    const p = previewPayload(); p.limits.maxItems = 1
    const d = later(), r = rig(() => d.promise), pending = r.session.read(p); p.limits.maxItems = 384
    const raw = reply(); raw.data.counts.total = raw.data.counts.conflicts = 2; raw.data.kinds[0].counts.total = raw.data.kinds[0].counts.conflicts = 2
    d.resolve(raw); assert.equal((await pending).code, 'invalid-reply')
  })
  test('preview session input changes A-B-A cannot revive pending counts or release native ownership', async () => {
    const d = later(), r = rig(() => d.promise), a = previewPayload(), pending = r.session.read(a)
    r.session.invalidate(); r.session.invalidate()
    assert.equal((await pending).code, 'wait-stopped'); assert.equal((await r.session.read(a)).code, 'session-busy'); assert.equal(r.calls.length, 1)
    d.resolve(reply()); await flush(); assert.notEqual(r.session.snapshot().state, 'ready')
    r.bridge.s3PreviewRead = async () => reply(); assert.equal((await r.session.read(a)).state, 'ready')
  })
  test('preview session timeout stops waiting but retains slot until native rejection', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload()); r.timeout()
    assert.equal((await pending).code, 'wait-timeout'); assert.equal(r.timers.size, 0)
    assert.equal((await r.session.read(previewPayload())).code, 'session-busy'); assert.equal(r.calls.length, 1)
    d.reject(Error('PRIVATE_LATE')); await flush(); assert.equal(r.session.snapshot().code, 'wait-timeout')
    r.bridge.s3PreviewRead = async () => reply(); assert.equal((await r.session.read(previewPayload())).state, 'ready')
  })
  test('preview session disposed lifetime cannot inspect late result or reopen', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload()); r.session.dispose()
    let touched = 0; d.resolve(new Proxy({}, { ownKeys() { touched++; throw Error('PRIVATE') } }))
    assert.equal((await pending).code, 'disposed'); await flush()
    assert.equal(touched, 0); assert.equal((await r.session.read(previewPayload())).code, 'disposed')
  })
  test('preview session result proxy cannot reenter while validating native settlement', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload()); let nested, once = false
    d.resolve(new Proxy(reply(), { ownKeys(t) { if (!once) { once = true; nested = r.session.read(previewPayload()) } return Reflect.ownKeys(t) } }))
    assert.equal((await pending).state, 'ready'); assert.equal((await nested).code, 'session-busy'); assert.equal(r.calls.length, 1)
  })
  test('preview session invalidation during reply reflection refuses publication and promise success', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload())
    d.resolve(new Proxy(reply(), { ownKeys(t) { r.session.invalidate(); return Reflect.ownKeys(t) } }))
    assert.equal((await pending).code, 'wait-stopped'); assert.notEqual(r.session.snapshot().state, 'ready')
  })
  test('preview session invalidation between native settlement and consumer microtask rejects old success', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload())
    d.resolve(reply()); queueMicrotask(() => r.session.invalidate())
    assert.equal((await pending).code, 'wait-stopped'); assert.equal(r.session.snapshot().state, 'idle')
  })
  test('preview session checks absolute deadline even when the timer has not fired', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload())
    r.setClock(10_001); d.resolve(reply()); assert.equal((await pending).code, 'wait-timeout'); assert.notEqual(r.session.snapshot().state, 'ready')
  })
  test('preview session parameter preparation consumes the same absolute wait budget', async () => {
    const r = rig(); const p = new Proxy(previewPayload(), { getPrototypeOf(t) { r.setClock(10_001); return Object.getPrototypeOf(t) } })
    assert.equal((await r.session.read(p)).code, 'wait-timeout'); assert.equal(r.calls.length, 0)
  })
  test('preview session reply validation cannot deliver counts after the absolute deadline', async () => {
    const d = later(), r = rig(() => d.promise), pending = r.session.read(previewPayload())
    d.resolve(new Proxy(reply(), { ownKeys(t) { r.setClock(10_001); return Reflect.ownKeys(t) } }))
    assert.equal((await pending).code, 'wait-timeout'); assert.equal(r.session.snapshot().summary, null)
  })
  test('preview session synchronous timer completion cannot invoke native afterward', async () => {
    let clears = 0; const r = rig(undefined, { schedule: fn => { fn(); return 42 }, cancel: id => { assert.equal(id, 42); clears++ } })
    assert.equal((await r.session.read(previewPayload())).code, 'wait-timeout'); assert.equal(r.calls.length, 0); assert.equal(clears, 1)
  })
  test('preview session current explicit invalidation permits a fresh completed check, without automatic calls', async () => {
    const r = rig(); await r.session.read(previewPayload()); r.session.invalidate()
    assert.equal(r.calls.length, 1); assert.equal(r.session.snapshot().code, 'not-checked')
    assert.equal((await r.session.read(previewPayload())).state, 'ready'); assert.equal(r.calls.length, 2)
  })
  test('preview session zero-count success is accepted only as a complete validated overview', async () => {
    const raw = reply(); raw.data.counts.total = raw.data.counts.conflicts = 0; raw.data.kinds[0].counts.total = raw.data.kinds[0].counts.conflicts = 0
    const r = rig(async () => raw), out = await r.session.read(previewPayload())
    assert.equal(out.state, 'ready'); assert.equal(out.summary.counts.total, 0); assert.match(out.limitation, /不代表同步完成/)
  })
  test('preview session accepts bounded native thenable without duplicate dispatch or leaked rejections', async () => {
    const r = rig(() => ({ then(resolve, reject) { resolve(reply()); reject(Error('PRIVATE')); resolve(reply()) } }))
    assert.equal((await r.session.read(previewPayload())).state, 'ready'); assert.equal(r.calls.length, 1); assert.equal(r.timers.size, 0)
  })
  test('preview session rejects invalid local options before accessing a bridge', () => {
    for (const options of [{ timeoutMs: 0 }, { timeoutMs: 10001 }, { timeoutMs: 1.5 }, { getBridge: 1 }, { now: null }, { schedule: null }, { cancel: null }]) {
      assert.throws(() => createS3PreviewSession(options), /Invalid preview session options/)
    }
  })
  test('preview renderer and shared codec execute with no Buffer, fetch or Node globals', () => {
    const url = pathToFileURL(fileURLToPath(new URL('../src/services/s3PreviewSession.mjs', import.meta.url))).href
    const program = `delete globalThis.Buffer; globalThis.fetch=()=>{throw Error('HTTP fallback')};
      const {createS3PreviewSession}=await import(${JSON.stringify(url)});
      const p=${JSON.stringify(previewPayload())}; let n=0;
      globalThis.window={electronAPI:{s3PreviewRead:async x=>{n++; if(JSON.stringify(x)!==JSON.stringify(p))throw Error('changed input');return ${JSON.stringify(reply())}}}};
      const s=createS3PreviewSession(); if(n!==0)throw Error('eager');
      const r=await s.read(p); if(r.state!=='ready'||n!==1)throw Error('not ready');s.dispose();`
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 5000 })
    assert.equal(p.status, 0, p.stderr)
  })
  test('shared codec keeps exact UTF-8 byte accounting for ASCII CJK combining and supplementary text', () => {
    for (const text of ['ascii', '雪', 'e\u0301', '🧩', '\u0000\n', '\ud800']) {
      const p = previewPayload(); p.connection.prefix = text
      const encoded = encodeS3PreviewRequest(p)
      if (text === '\ud800') { assert.equal(encoded, null); continue }
      assert.ok(encoded); assert.equal(new TextEncoder().encode(encoded.body).length, Buffer.byteLength(encoded.body, 'utf8'))
      assert.deepEqual(JSON.parse(encoded.body), p)
    }
    assert.equal(decodeS3PreviewResponse(200, JSON.stringify(previewSuccess()), 12).success, true)
  })
}
