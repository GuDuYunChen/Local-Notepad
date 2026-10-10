import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { createS3LocalOverviewService, S3_LOCAL_OVERVIEW_TIMEOUT_MS } from '../electron/s3-local-overview-bridge.js'

const failure = code => ({ success: false, status: 0, code, data: null })
const headers = ['Content-Type', 'application/json', 'Cache-Control', 'no-store', 'X-Content-Type-Options', 'nosniff']
const empty = JSON.stringify({ code: 0, message: 'OK', data: {
  format: 'local-notepad-s3-local-candidate-overview', version: 1,
  read_only: true, observed_stable: true, complete_for_preview: false,
  records: 0, record_bytes: 0, attachment_bytes: 0, base_items: 0,
  kinds: ['file', 'tag', 'file-tag', 'attachment'].map(kind => ({ kind, records: 0, record_bytes: 0 })),
} })

// Control only the monotonic clock, in this test worker, while delivering the
// original production event handlers. No sleeping, timer races, ports or I/O.
async function withTransport(run) {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now')
  let at = 1000, callback, onCreate, onEnd, getToken, calls = 0
  const requests = []
  Object.defineProperty(performance, 'now', { configurable: true, value: () => at })
  const service = createS3LocalOverviewService({ getToken: () => getToken ? getToken() : 'a'.repeat(64), requestImpl(_url, _options, respond) {
    calls++; onCreate?.()
    callback = respond
    const req = new EventEmitter()
    req.destroy = () => { req.destroyed = true }
    req.end = () => { onEnd?.() }
    requests.push(req)
    return req
  } })
  const response = () => Object.assign(new EventEmitter(), {
    rawHeaders: [...headers], rawTrailers: [], trailers: {}, statusCode: 200,
    complete: true, destroy() { this.destroyed = true },
  })
  const fixture = { service, requests, response, get calls() { return calls },
    at: value => { at = value }, respond: res => callback(res),
    onCreate: fn => { onCreate = fn }, onEnd: fn => { onEnd = fn }, token: fn => { getToken = fn } }
  try { await run(fixture) }
  finally {
    for (const req of requests) req.emit('close')
    if (descriptor) Object.defineProperty(performance, 'now', descriptor)
    else delete performance.now
  }
}
const events = ['request-error', 'request-close', 'response-error', 'response-aborted',
  'response-close', 'create-throw', 'end-throw', 'header-throw', 'invalid-status']

export function registerNativeOverviewDeadlineTests(test) {
  for (const mode of ['invalid-input', 'input-throw', 'invalid-token', 'token-throw', 'options-throw']) for (const late of [false, true]) {
    test(`native overview deadline preflight ${mode} ${late ? 'at deadline' : 'before deadline'}`, async () => {
      await withTransport(async f => {
        const at = 1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS - (late ? 0 : 1)
        let input = { readOnly: true }, options = {}
        if (mode.startsWith('input') || mode === 'invalid-input') input = new Proxy({}, {
          getPrototypeOf() { f.at(at); if (mode === 'input-throw') throw Error('PRIVATE_INPUT'); return null },
        })
        if (mode === 'invalid-token') f.token(() => { f.at(at); return null })
        if (mode === 'token-throw') f.token(() => { f.at(at); throw Error('PRIVATE_TOKEN') })
        if (mode === 'options-throw') options = { get signal() { f.at(at); throw Error('PRIVATE_OPTIONS') } }
        const code = late ? 'native-local-overview-timeout'
          : mode === 'invalid-token' ? 'native-local-overview-unavailable' : 'invalid-local-overview-request'
        assert.deepEqual(await f.service.read(input, options), failure(code))
        assert.equal(f.calls, 0)
      })
    })
  }
  test('native overview deadline cancelled token acquisition stays offline', async () => {
    await withTransport(async f => {
      const controller = new AbortController()
      f.token(() => { f.at(1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS); controller.abort(); return null })
      assert.deepEqual(await f.service.read({ readOnly: true }, { signal: controller.signal }), failure('native-local-overview-cancelled'))
      assert.equal(f.calls, 0)
    })
  })
  for (const event of events) for (const late of [false, true]) {
    test(`native overview deadline ${event} ${late ? 'at deadline' : 'before deadline'}`, async () => {
      await withTransport(async f => {
        const at = 1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS - (late ? 0 : 1)
        const throws = () => { f.at(at); throw Error('PRIVATE_TRANSPORT_FAILURE') }
        if (event === 'create-throw') f.onCreate(throws)
        if (event === 'end-throw') f.onEnd(throws)
        const pending = f.service.read({ readOnly: true })
        if (!event.endsWith('-throw') || event === 'header-throw') {
          const req = f.requests[0], res = f.response()
          if (event === 'header-throw') Object.defineProperty(res, 'rawHeaders', { get: throws })
          if (event === 'invalid-status') Object.defineProperty(res, 'statusCode', { get() { f.at(at); return 500 } })
          f.respond(res)
          if (!['header-throw', 'invalid-status'].includes(event)) f.at(at)
          if (event.startsWith('request-')) req.emit(event.slice(8), Error('PRIVATE_REQUEST'))
          else if (event.startsWith('response-')) res.emit(event.slice(9), Error('PRIVATE_RESPONSE'))
          else if (event === 'invalid-status') { res.emit('data', Buffer.from(empty)); res.emit('end') }
        }
        const code = late ? 'native-local-overview-timeout'
          : ['header-throw', 'invalid-status'].includes(event) ? 'native-local-overview-invalid-response'
            : 'native-local-overview-unavailable'
        const result = await pending
        assert.deepEqual(result, failure(code))
        assert.equal(f.calls, 1)
        // Failure delivery must not release the real request slot early.
        if (!['create-throw', 'request-close'].includes(event)) {
          assert.equal((await f.service.read({ readOnly: true })).code, 'native-local-overview-busy')
          assert.equal(f.calls, 1)
        }
      })
    })
  }
  test('native overview deadline cancellation retains priority after deadline', async () => {
    await withTransport(async f => {
      const controller = new AbortController(), p = f.service.read({ readOnly: true }, { signal: controller.signal })
      f.at(1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS); controller.abort()
      f.requests[0].emit('error', Error('PRIVATE_LATE'))
      assert.deepEqual(await p, failure('native-local-overview-cancelled'))
      assert.equal((await f.service.read({ readOnly: true })).code, 'native-local-overview-busy')
    })
  })
  test('native overview deadline settled success is not replaced by later error or close', async () => {
    await withTransport(async f => {
      const p = f.service.read({ readOnly: true }), res = f.response()
      f.respond(res); res.emit('data', Buffer.from(empty)); res.emit('end')
      const first = await p; assert.equal(first.success, true)
      f.at(1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS); f.requests[0].emit('error', Error('PRIVATE_LATE'))
      f.requests[0].emit('close'); assert.equal(await p, first)
    })
  })
  test('native overview deadline settled early failure is not changed by late error', async () => {
    await withTransport(async f => {
      const p = f.service.read({ readOnly: true })
      f.requests[0].emit('error', Error('PRIVATE_FIRST'))
      const first = await p; assert.equal(first.code, 'native-local-overview-unavailable')
      f.at(1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS); f.requests[0].emit('error', Error('PRIVATE_LATE'))
      assert.equal(await p, first)
    })
  })
  test('native overview deadline close releases slot for explicit retry without automatic I/O', async () => {
    await withTransport(async f => {
      const p = f.service.read({ readOnly: true })
      f.at(1000 + S3_LOCAL_OVERVIEW_TIMEOUT_MS); f.requests[0].emit('error', Error('PRIVATE'))
      assert.equal((await p).code, 'native-local-overview-timeout')
      f.requests[0].emit('close'); assert.equal(f.calls, 1)
      const next = f.service.read({ readOnly: true }), res = f.response()
      f.respond(res); res.emit('data', Buffer.from(empty)); res.emit('end')
      assert.equal((await next).success, true); assert.equal(f.calls, 2)
    })
  })
}
