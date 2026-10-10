import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { encodeS3LocalOverviewRequest as encode, decodeS3LocalOverviewResponse as decode,
  sanitizeS3LocalOverviewResult as sanitize, localOverviewFailure as failure } from '../electron/s3-local-overview-codec.js'
import { createS3LocalOverviewService as service, registerS3LocalOverviewHandler as register,
  S3_LOCAL_OVERVIEW_URL as URL, S3_LOCAL_OVERVIEW_CHANNEL as CHANNEL } from '../electron/s3-local-overview-bridge.js'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'
import { trackProbeFixture } from './s3-probe-fixture-close.mjs'

const ROOT = fileURLToPath(new globalThis.URL('../', import.meta.url))
const intent = () => ({ readOnly: true })
const invalid = failure('native-local-overview-invalid-response')
const headers = () => ['Content-Type', 'application/json; charset=utf-8', 'Cache-Control', 'no-store', 'X-Content-Type-Options', 'nosniff']
function envelope() {
  return { code: 0, message: 'OK', data: { format: 'local-notepad-s3-local-candidate-overview', version: 1,
    read_only: true, observed_stable: true, complete_for_preview: false,
    records: 2, record_bytes: 110, attachment_bytes: 4, base_items: 1,
    kinds: ['file', 'tag', 'file-tag', 'attachment'].map((kind, i) => ({ kind,
      records: i === 0 || i === 3 ? 1 : 0, record_bytes: i === 0 ? 60 : i === 3 ? 50 : 0 })) } }
}
const accepted = () => decode(200, JSON.stringify(envelope()))
function fake(c = {}) {
  const state = { calls: [], requests: [] }
  state.requestImpl = (url, options, callback) => {
    if (c.throwRequest) throw new Error('PRIVATE_REQUEST')
    const req = new EventEmitter(); state.requests.push(req)
    req.destroy = () => { req.destroyed = true; if (!c.holdClose) queueMicrotask(() => req.emit('close')) }
    req.end = body => {
      state.calls.push({ url: String(url), options, body })
      if (c.throwEnd) throw new Error('PRIVATE_END')
      state.deliver = () => {
        const res = new EventEmitter(); state.res = res
        Object.assign(res, { rawHeaders: c.headers ?? headers(), rawTrailers: c.trailers ?? [], trailers: {},
          statusCode: c.status ?? 200, complete: false, destroy() { this.destroyed = true } })
        callback(res)
        state.end = () => { res.complete = c.complete !== false; res.emit('end'); if (!c.holdClose) req.emit('close') }
        if (!c.holdBody) { res.emit('data', c.raw ?? Buffer.from(JSON.stringify(c.body ?? envelope()))); state.end() }
        return res
      }
      if (!c.holdHeaders) queueMicrotask(state.deliver)
    }
    return req
  }
  return state
}
function scoped(native) {
  const state = { expected: 'file:///synthetic-local-overview/index.html', closing: false }
  const sender = new EventEmitter(); sender.mainFrame = { url: state.expected }
  sender.getURL = () => sender.mainFrame.url; sender.isDestroyed = () => false
  const win = new EventEmitter(); win.webContents = sender; win.isDestroyed = () => false
  state.window = win
  const scope = createS3ProbeScope({ getWindow: () => state.window, getExpectedURL: () => state.expected, isClosing: () => state.closing })
  let invoke
  register({ handle(k, fn) { assert.equal(k, CHANNEL); invoke = fn } }, native, scope)
  const event = { sender, senderFrame: sender.mainFrame }
  return { state, sender, scope, event, invoke: (value = intent(), e = event) => invoke(e, value) }
}

export function registerS3LocalOverviewTests(test) {
  test('local overview accepts only one explicit data-only readOnly intent', () => {
    assert.equal(encode(intent()), '{"readOnly":true}')
    assert.equal(encode(Object.assign(Object.create(null), intent())), '{"readOnly":true}')
    for (const value of [null, [], true, {}, { readOnly: false }, { ReadOnly: true }, { readOnly: 'true' },
      { ...intent(), path: 'PRIVATE' }, { ...intent(), limits: {} }, { ...intent(), credentials: {} }]) assert.equal(encode(value), null)
    let reads = 0
    const value = { get readOnly() { reads++; return true } }
    assert.equal(encode(value), null); assert.equal(reads, 0)
    for (const change of [p => Object.defineProperty(p, 'readOnly', { enumerable: false }),
      p => { p[Symbol('PRIVATE')] = 1 }, p => Object.setPrototypeOf(p, { inherited: 1 })]) {
      const p = intent(); change(p); assert.equal(encode(p), null)
    }
  })
  test('local overview accepts exact totals and detached recursively frozen empty or populated summaries', () => {
    const e = envelope(), r = decode(200, JSON.stringify(e))
    assert.equal(r.success, true); assert.deepEqual(r.data, e.data)
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.data) && Object.isFrozen(r.data.kinds) && r.data.kinds.every(Object.isFrozen))
    e.data.kinds[0].records = 99; assert.equal(r.data.kinds[0].records, 1)
    const empty = envelope(); empty.data.records = empty.data.record_bytes = empty.data.attachment_bytes = empty.data.base_items = 0
    for (const row of empty.data.kinds) row.records = row.record_bytes = 0
    assert.equal(decode(200, JSON.stringify(empty)).success, true)
  })
  for (const field of ['format', 'version', 'read_only', 'observed_stable', 'complete_for_preview', 'records', 'record_bytes', 'attachment_bytes', 'base_items', 'kinds']) {
    test(`local overview requires exact ${field} without coercion or private additions`, () => {
      const e = envelope(); delete e.data[field]; assert.deepEqual(decode(200, JSON.stringify(e)), invalid)
      const q = envelope(); q.data[field] = 'PRIVATE'; assert.deepEqual(decode(200, JSON.stringify(q)), invalid)
      const x = envelope(); x.data.private = 'PRIVATE'; assert.deepEqual(decode(200, JSON.stringify(x)), invalid)
    })
  }
  for (const field of ['records', 'record_bytes', 'attachment_bytes', 'base_items']) {
    test(`local overview rejects non-integer negative unsafe ${field}`, () => {
      for (const n of [-1, 0.5, 2 ** 53, Infinity, '1', null]) {
        const e = envelope(); e.data[field] = n; assert.deepEqual(decode(200, JSON.stringify(e)), invalid)
      }
      const r = accepted(); const d = { ...r.data, [field]: -0 }
      assert.deepEqual(sanitize({ ...r, data: d }), invalid)
    })
  }
  test('local overview cross-checks order sums zero-row bytes and aggregate hard budgets', () => {
    for (const change of [d => { d.complete_for_preview = true }, d => { d.observed_stable = false },
      d => d.kinds.reverse(), d => d.kinds.pop(), d => { d.records++ }, d => { d.record_bytes++ },
      d => { d.kinds[1].record_bytes = 1; d.record_bytes++ }, d => { d.base_items = 129 },
      d => { d.attachment_bytes = 32 * 1024 * 1024 + 1 }, d => { d.kinds[0].record_bytes = 0; d.record_bytes = 50 },
      d => { d.kinds[0].records = 129; d.kinds[0].record_bytes = 129; d.records = 130; d.record_bytes = 179 },
      d => { d.kinds[0].records = 128; d.kinds[0].record_bytes = 128; d.kinds[1].records = 1; d.kinds[1].record_bytes = 1; d.records = 130; d.record_bytes = 179 },
      d => { d.kinds[0].record_bytes = 256 * 1024 + 1; d.record_bytes = d.kinds[0].record_bytes + 50 }]) {
      const e = envelope(); change(e.data); assert.deepEqual(decode(200, JSON.stringify(e)), invalid)
    }
  })
  test('local overview refuses duplicate escaped JSON keys nested extras malformed and oversized responses', () => {
    const raw = JSON.stringify(envelope())
    for (const value of [raw.replace('"code":0', '"code":0,"code":0'),
      raw.replace('"records":2', '"records":2,"\\u0072ecords":2'),
      raw.replace('"kind":"file"', '"kind":"file","private":"PRIVATE"'), raw + '{}', '\ufeff' + raw,
      raw.replace('"records":2', '"records":-0'), raw + ' '.repeat(4096), '{']) assert.deepEqual(decode(200, value), invalid)
  })
  test('local overview IPC revalidation never evaluates nested getters or augmented arrays', () => {
    for (const where of ['root', 'data', 'row', 'array']) {
      const e = envelope(); let touched = 0
      const r = { success: true, status: 200, code: 'OK', data: e.data }
      const obj = where === 'root' ? r : where === 'data' ? r.data : where === 'row' ? r.data.kinds[0] : r.data.kinds
      const key = where === 'root' ? 'data' : where === 'data' ? 'records' : where === 'row' ? 'records' : '0'
      Object.defineProperty(obj, key, { enumerable: true, get() { touched++; throw new Error('PRIVATE') } })
      assert.deepEqual(sanitize(r), invalid); assert.equal(touched, 0)
    }
    const r = accepted(); const kinds = [...r.data.kinds]; kinds.private = 'PRIVATE'
    assert.deepEqual(sanitize({ ...r, data: { ...r.data, kinds } }), invalid)
    assert.deepEqual(sanitize({ ...r, private: 'PRIVATE' }), invalid)
  })
  for (const [status, codes] of [[400, ['invalid-request', 'invalid-request-target']], [403, ['native-loopback-required']],
    [405, ['method-not-allowed']], [408, ['local-overview-cancelled']], [413, ['request-too-large']],
    [415, ['json-required', 'encoded-or-trailer-request-refused']], [422, ['local-overview-not-available']],
    [429, ['local-overview-busy']], [503, ['local-overview-unavailable']], [504, ['local-overview-timeout']]]) {
    test(`local overview preserves exact ${status} refusals only with null data`, () => {
      for (const code of codes) {
        const e = { code: status, message: code, data: null }
        assert.deepEqual(decode(status, JSON.stringify(e)), { success: false, status, code, data: null })
        for (const bad of [{ ...e, data: {} }, { ...e, message: code + ' PRIVATE' }, { ...e, code: 0 }]) assert.deepEqual(decode(status, JSON.stringify(bad)), invalid)
      }
    })
  }
  test('local overview uses fixed loopback POST bounded headers and no connection material', async () => {
    const f = fake(); const s = service({ requestImpl: f.requestImpl })
    assert.equal(f.calls.length, 0); assert.deepEqual(await s.read(intent()), accepted())
    const c = f.calls[0]; assert.equal(c.url, URL); assert.equal(c.options.method, 'POST')
    assert.equal(c.body, '{"readOnly":true}'); assert.equal(c.options.headers['Content-Length'], '17')
    assert.equal(c.options.headers['X-Notepad-Read-Only'], 's3-local-overview'); assert.equal(c.options.agent, false)
    assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(c), /credential|PRIVATE|Origin|Referer/)
    for (const options of [{ target: 'http://example.invalid' }, { timeoutMs: 7501 }, { timeoutMs: 0 }, { timeoutMs: 1.1 }, { requestImpl: null }]) assert.throws(() => service(options))
  })
  test('local overview refuses invalid inputs and already cancelled signals without network', async () => {
    const f = fake(), s = service({ requestImpl: f.requestImpl }), c = new AbortController(); c.abort()
    for (const value of [null, {}, { ...intent(), url: URL }]) assert.equal((await s.read(value)).code, 'invalid-local-overview-request')
    assert.equal((await s.read(intent(), { signal: c.signal })).code, 'native-local-overview-cancelled')
    assert.equal((await s.read(intent(), { signal: {} })).code, 'invalid-local-overview-request')
    assert.equal(f.calls.length, 0)
  })
  for (const [name, patch] of [['media', ['Content-Type', 'text/html']], ['duplicate type', ['Content-Type', 'application/json']],
    ['encoding', ['Content-Encoding', 'gzip']], ['second encoding', ['content-encoding', 'identity', 'Content-Encoding', 'gzip']],
    ['trailer', ['Trailer', 'X-Test']], ['cors', ['Access-Control-Allow-Origin', '*']],
    ['large length', ['Content-Length', '4097']], ['bad length', ['Content-Length', '1.5']],
    ['mixed length', ['Content-Length', '1', 'Transfer-Encoding', 'chunked']], ['bad transfer', ['Transfer-Encoding', 'gzip']]]) {
    test(`local overview refuses ${name} headers without adopting a body`, async () => {
      const h = name === 'media' ? [...patch, ...headers().slice(2)] : [...headers(), ...patch]
      const f = fake({ headers: h }); assert.deepEqual(await service({ requestImpl: f.requestImpl }).read(intent()), invalid)
      assert.equal(f.calls.length, 1); assert.equal(f.res.destroyed, true)
    })
  }
  test('local overview refuses missing cache policy nosniff incomplete length trailers invalid UTF8 and redirect', async () => {
    for (const c of [{ headers: headers().slice(0, 2) }, { headers: headers().slice(0, 4) }, { complete: false },
      { headers: [...headers(), 'Content-Length', '1'] }, { trailers: ['X-Test', 'PRIVATE'] },
      { raw: Buffer.from([0xff]) }, { raw: Buffer.alloc(4097, 32) }, { status: 302 }]) {
      const f = fake(c); assert.deepEqual(await service({ requestImpl: f.requestImpl }).read(intent()), invalid); assert.equal(f.calls.length, 1)
    }
  })
  test('local overview handles native request errors without retaining private error details or retries', async () => {
    for (const c of [{ throwRequest: true }, { throwEnd: true }]) {
      const f = fake(c), s = service({ requestImpl: f.requestImpl })
      assert.equal((await s.read(intent())).code, 'native-local-overview-unavailable'); assert.ok(f.calls.length <= 1)
    }
  })
  test('local overview busy admission precedes reentrant reflection', async () => {
    const f = fake(), s = service({ requestImpl: f.requestImpl }); let nested
    const p = new Proxy(intent(), { ownKeys(target) { nested ??= s.read(intent()); return Reflect.ownKeys(target) } })
    assert.equal((await s.read(p)).success, true)
    assert.equal((await nested).code, 'native-local-overview-busy'); assert.equal(f.calls.length, 1)
  })
  for (const kind of ['abort', 'timeout', 'success']) {
    test(`local overview ${kind} keeps admission until actual ClientRequest close`, async () => {
      const f = fake({ holdHeaders: kind !== 'success', holdClose: true }), c = new AbortController()
      const s = service({ requestImpl: f.requestImpl, timeoutMs: kind === 'timeout' ? 30 : 7500 })
      const p = s.read(intent(), { signal: c.signal }); if (kind === 'abort') c.abort()
      const result = await p
      assert.equal(result.success, kind === 'success')
      if (kind !== 'success') assert.equal(result.code, `native-local-overview-${kind === 'abort' ? 'cancelled' : 'timeout'}`)
      assert.equal((await s.read(intent())).code, 'native-local-overview-busy'); assert.equal(f.calls.length, 1)
      if (kind !== 'success') f.deliver() // A late success cannot re-open or overwrite the settled request.
      assert.equal((await s.read(intent())).code, 'native-local-overview-busy')
      f.requests[0].emit('close')
      const next = s.read(intent()); if (kind !== 'success') f.deliver()
      assert.equal((await next).success, true); f.requests.at(-1).emit('close'); assert.equal(f.calls.length, 2)
    })
  }
  test('local overview scope rejects other windows subframes changed documents and invalid inputs before native invocation', async () => {
    let calls = 0; const f = scoped({ async read() { calls++; return accepted() } })
    try {
      for (const e of [{}, { sender: {}, senderFrame: f.sender.mainFrame }, { sender: f.sender, senderFrame: { url: f.state.expected } }]) assert.equal((await f.invoke(intent(), e)).code, 'untrusted-frame')
      assert.equal((await f.invoke({ ...intent(), path: 'PRIVATE' })).code, 'invalid-local-overview-request')
      f.sender.mainFrame.url = 'file:///different.html'; assert.equal((await f.invoke()).code, 'untrusted-frame')
      assert.equal(calls, 0)
    } finally { f.scope.dispose() }
  })
  test('local overview scope aborts on navigation holds in-flight lease and refuses stale replies', async () => {
    let resolve, signal; const f = scoped({ read(_value, options) { signal = options.signal; return new Promise(done => { resolve = done }) } })
    try {
      const p = f.invoke(); f.sender.emit('did-start-navigation', { isMainFrame: true })
      assert.equal(signal.aborted, true); assert.equal((await f.invoke()).code, 'native-local-overview-busy')
      resolve(accepted()); assert.equal((await p).code, 'native-local-overview-cancelled')
      assert.equal(f.sender.listenerCount('did-start-navigation'), 0)
    } finally { f.scope.dispose() }
  })
  test('local overview IPC sanitizes service errors unexpected shapes and late reflective navigation', async () => {
    for (const read of [async () => ({ ...accepted(), private: 'PRIVATE' }), async () => { throw new Error('PRIVATE') }]) {
      const f = scoped({ read }); try { const r = await f.invoke(); assert.equal(r.success, false); assert.equal(r.data, null); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/) } finally { f.scope.dispose() }
    }
    let f; f = scoped({ async read() { return new Proxy(accepted(), { ownKeys(target) { f.sender.emit('did-start-navigation', { isMainFrame: true }); return Reflect.ownKeys(target) } }) } })
    try { assert.equal((await f.invoke()).code, 'native-local-overview-cancelled') } finally { f.scope.dispose() }
  })
  test('local overview real TCP fixture reads chunked counts cancels safely and drains only owned sockets', async () => {
    // Ephemeral isolated test port: assert the production target BEFORE the
    // injected request implementation redirects only this owned test request.
    const clients = new Set(); let mode = 'success', seen = 0
    const server = http.createServer((req, res) => {
      seen++; assert.equal(req.url, '/api/sync/s3/local-overview'); assert.equal(req.method, 'POST')
      const chunks = []; req.on('data', b => chunks.push(b)); req.on('end', () => {
        assert.equal(Buffer.concat(chunks).toString(), '{"readOnly":true}')
        if (mode === 'hold') return
        res.writeHead(mode === 'refuse' ? 422 : 200, Object.fromEntries(Array.from({ length: 3 }, (_, i) => headers().slice(i * 2, i * 2 + 2))))
        const raw = JSON.stringify(mode === 'refuse' ? { code: 422, message: 'local-overview-not-available', data: null } : envelope())
        res.write(raw.slice(0, 20)); res.end(raw.slice(20))
      })
    })
    const close = trackProbeFixture(server, clients)
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve) })
    const s = service({ requestImpl(url, options, cb) {
      assert.equal(String(url), URL); const target = new globalThis.URL(url); target.port = String(server.address().port)
      const req = http.request(target, options, cb); clients.add(req); req.once('close', () => clients.delete(req)); return req
    } })
    async function drained() { await Promise.all([...clients].map(r => new Promise(resolve => r.once('close', resolve)))) }
    try {
      assert.deepEqual(await s.read(intent()), accepted()); await drained()
      mode = 'refuse'; assert.equal((await s.read(intent())).status, 422); await drained()
      mode = 'hold'; const c = new AbortController(), pending = s.read(intent(), { signal: c.signal }); c.abort()
      assert.equal((await pending).code, 'native-local-overview-cancelled'); await drained(); assert.equal(seen, 2)
    } finally { await close() }
    assert.equal(clients.size, 0)
  }, 10000)
  test('local overview accepts upper hard bounds without authorizing preview or fabricating freshness', () => {
    const e = envelope(), d = e.data
    d.kinds[0].records = d.kinds[3].records = 128
    d.kinds[0].record_bytes = d.kinds[3].record_bytes = 1024 * 1024
    d.records = 256; d.record_bytes = 2 * 1024 * 1024; d.attachment_bytes = 64 * 1024 * 1024; d.base_items = 128
    const r = decode(200, JSON.stringify(e)); assert.equal(r.success, true); assert.equal(r.data.complete_for_preview, false)
    d.kinds[0].record_bytes++; d.record_bytes++; assert.deepEqual(decode(200, JSON.stringify(e)), invalid)
    assert.deepEqual(decode(0, JSON.stringify({ code: 0, message: 'native-local-overview-busy', data: null })), invalid)
    assert.deepEqual(sanitize({ success: false, status: 0, code: 'PRIVATE', data: null }), invalid)
  })
  test('local overview rejects stream errors premature close non-buffer chunks and streamed overflow', async () => {
    for (const event of ['request-error', 'request-close', 'response-error', 'response-aborted', 'response-close', 'string', 'overflow']) {
      const f = fake({ holdBody: true }), s = service({ requestImpl: f.requestImpl })
      const p = s.read(intent()); await Promise.resolve()
      if (event === 'request-error') f.requests[0].emit('error', new Error('PRIVATE'))
      else if (event === 'request-close') f.requests[0].emit('close')
      else if (event === 'string') f.res.emit('data', 'not a Buffer')
      else if (event === 'overflow') { f.res.emit('data', Buffer.alloc(4096, 32)); f.res.emit('data', Buffer.from('x')) }
      else f.res.emit(event.slice('response-'.length), new Error('PRIVATE'))
      const r = await p; assert.equal(r.success, false); assert.equal(r.data, null); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/)
      assert.equal(f.calls.length, 1)
    }
  })
  test('local overview does not refresh the absolute deadline during response-body wait', async () => {
    const f = fake({ holdBody: true, holdClose: true }), s = service({ requestImpl: f.requestImpl, timeoutMs: 30 })
    const p = s.read(intent()); await Promise.resolve(); f.res.emit('data', Buffer.from('{'))
    assert.equal((await p).code, 'native-local-overview-timeout')
    assert.equal((await s.read(intent())).code, 'native-local-overview-busy'); f.requests[0].emit('close')
  })
  test('local overview cancellation during request creation destroys the owned request before sending', async () => {
    const c = new AbortController(), f = fake()
    const s = service({ requestImpl(...args) { const req = f.requestImpl(...args); c.abort(); return req } })
    assert.equal((await s.read(intent(), { signal: c.signal })).code, 'native-local-overview-cancelled')
    assert.equal(f.calls.length, 0); assert.equal(f.requests[0].destroyed, true)
  })
  test('local overview shutdown and window replacement never deliver a stale service result', async () => {
    for (const change of ['closing', 'replace', 'dispose']) {
      let resolve; const f = scoped({ read() { return new Promise(done => { resolve = done }) } })
      try {
        const p = f.invoke()
        if (change === 'closing') f.state.closing = true
        else if (change === 'replace') f.state.window = null
        else f.scope.dispose()
        resolve(accepted()); assert.equal((await p).code, 'native-local-overview-cancelled')
        assert.equal(f.sender.listenerCount('did-start-navigation'), 0)
      } finally { f.scope.dispose() }
    }
  })
  // 2F.66 intentionally replaces the earlier opt-in-only boundary. Assert the
  // narrow authenticated wiring instead of prohibiting the requested feature;
  // all preceding transport/scope/codec assertions remain unchanged.
  test('local overview production wiring stays authenticated and saving stays unchanged', () => {
    const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
    const main = source('electron/main.js'), preload = source('electron/preload.js')
    const runtime = source('electron/s3-local-overview-runtime.js')
    const route = source('server/internal/controller/sync_s3_probe.go')
    const host = source('server/internal/syncengine/s3_local_overview_host.go')
    assert.match(main, /createS3LocalOverviewRuntime\(\{/)
    assert.match(main, /localOverviewRuntime\.childEnvironment\(process\.env\)/)
    assert.match(runtime, /randomBytes\(32\)/)
    assert.match(runtime, /getToken: \(\) => isAvailable\(\) \? token : null/)
    assert.match(preload, /s3LocalOverviewRead: payload => ipcRenderer\.invoke\('sync:s3-local-overview:read', payload\)/)
    assert.doesNotMatch(preload, /NOTEPAD_LOCAL_OVERVIEW_TOKEN|childEnvironment|X-Notepad-Local-Overview/)
    assert.match(route, /NewS3LocalOverviewHost\(directory, os\.Getenv\("NOTEPAD_LOCAL_OVERVIEW_TOKEN"\)\)/)
    assert.match(host, /NativeReadOnlyRequest\(r, S3LocalOverviewIntent\)/)
    assert.match(host, /subtle\.ConstantTimeCompare\(received\[:\], h\.tokenHash\[:\]\) != 1/)
    assert.match(host, /RawQuery: "mode=ro"/)
    assert.match(host, /rootErr, dbErr := root\.close\(\), db\.Close\(\)/)
    // Capture only the untouched save/quit implementation, not unrelated main
    // imports. These digests bind this wiring check to its accepted base.
    for (const [file, expected] of [
      ['src/components/TextEditor.jsx', 'f6b10294e8ec07ebd40da1a840207138b3d3e455ce50539d4d35f673ff238f54'],
      ['src/services/editorDraftCache.js', '7d461ff7a46271d8e8d64707559ac872878f3d2786d770bc0a09434df1474e89'],
      ['src/services/editorSaveTransaction.mjs', 'b449dad16834a936fbd5fad318352c961e160e11723cb6627d6a47714d4d36e2'],
      ['src/services/editorQuit.mjs', 'abc21ea59352fede521e6ce6f6904f67af8f3d00b2378efae6a5e6b45c48c205'],
      ['src/services/editorQuitBridge.mjs', '76e0d15c2dbe53548df2aa3c332bd2860047f855cbef45f0f2043031a8d35302'],
      ['electron/quit-save.mjs', '230c779cf1be912a7cfdc0a649eccf53e0a5f79fa4b1c3c94d9013f3372c3a49'],
    ]) assert.equal(createHash('sha256').update(source(file).replace(/\r\n/g, '\n')).digest('hex'), expected, file)
  })
  test('local overview accepts actual Go handler success and every fixed refusal', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-local-wire-')), hashes = []
    const hash = b => createHash('sha256').update(b).digest('hex')
    try {
      fs.writeFileSync(path.join(directory, 'go.mod'), 'module notepad-server\n\ngo 1.22\n')
      for (const name of ['syncengine', 'syncs3', 'syncjob']) {
        const from = path.join(ROOT, 'server/internal', name), to = path.join(directory, 'internal', name); fs.mkdirSync(to, { recursive: true })
        for (const file of fs.readdirSync(from).filter(f => f.endsWith('.go') && (!f.endsWith('_test.go') ||
          ['s3_local_database_test.go', 's3_local_attachments_test.go', 's3_local_candidate_test.go'].includes(f)))) {
          const bytes = fs.readFileSync(path.join(from, file)); fs.writeFileSync(path.join(to, file), bytes)
          hashes.push([path.join(from, file), path.join(to, file), hash(bytes)])
        }
      }
      fs.copyFileSync(path.join(ROOT, 'scripts/fixtures/s3-local-overview/wire_test.go'), path.join(directory, 'internal/syncengine/local_wire_test.go'))
      const p = spawnSync('go', ['test', '-p=2', './internal/syncengine', '-run=^TestLocalOverviewWireFixture$', '-count=1', '-v', '-timeout=15s'],
        { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 256 * 1024,
          env: { ...process.env, GOTOOLCHAIN: 'local', GO111MODULE: 'on', GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off', CGO_ENABLED: '0', GOFLAGS: '' } })
      assert.equal(p.error, undefined); assert.equal(p.status, 0, p.stderr + p.stdout)
      const line = p.stdout.split('\n').find(s => s.startsWith('LOCAL_OVERVIEW_WIRE ')); assert.ok(line)
      const rows = JSON.parse(line.slice('LOCAL_OVERVIEW_WIRE '.length)); assert.equal(rows.length, 18)
      assert.equal(new Set(rows.map(r => r.name)).size, 18)
      const expected = {
        success: [200, 'OK'], method: [405, 'method-not-allowed'], origin: [403, 'native-loopback-required'],
        intent: [403, 'native-loopback-required'], target: [400, 'invalid-request-target'], media: [415, 'json-required'],
        encoding: [415, 'encoded-or-trailer-request-refused'], trailer: [400, 'invalid-request'],
        oversize: [413, 'request-too-large'], body: [400, 'invalid-request'], 'nil-body': [400, 'invalid-request'],
        cancelled: [408, 'local-overview-cancelled'], timeout: [504, 'local-overview-timeout'],
        'read-failure': [422, 'local-overview-not-available'], busy: [429, 'local-overview-busy'],
        unavailable: [503, 'local-overview-unavailable'], duplicate: [400, 'invalid-request'], 'retry-success': [200, 'OK'],
      }
      for (const row of rows) {
        assert.deepEqual([row.status, JSON.parse(row.body).message], expected[row.name], row.name)
        const r = decode(row.status, row.body)
        assert.equal(r.status, row.status, row.name); assert.equal(r.success, row.status === 200, row.name)
        assert.equal(row.cache, 'no-store'); assert.equal(row.nosniff, 'nosniff')
        assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|COMLPT|store|hash/)
        if (r.success) { assert.equal(r.data.records, 5); assert.equal(r.data.attachment_bytes, 4) }
        else assert.equal(r.data, null)
      }
      for (const [from, to, digest] of hashes) { assert.equal(hash(fs.readFileSync(from)), digest); assert.equal(hash(fs.readFileSync(to)), digest) }
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  }, 90000)
}
