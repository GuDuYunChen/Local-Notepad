// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createS3ProbeScope } from './s3-probe-scope.js'
import {
  S3_PROBE_CHANNEL,
  createS3ProbeService,
  encodeS3ProbeRequest,
  registerS3ProbeHandler,
} from './s3-probe-bridge.js'

const payload = overrides => ({
  endpoint: 'https://s3.example.invalid',
  bucket: 'bucket-a',
  region: 'us-east-1',
  prefix: 'safe/',
  accessKeyId: 'AKIA_SYNTHETIC',
  secretAccessKey: 'synthetic-secret',
  sessionToken: 'synthetic-token',
  key: '目录/对象.json',
  maxBytes: 4096,
  readOnly: true,
  ...overrides,
})

function transport({ status = 200, response, hold } = {}) {
  const calls = []
  const requestImpl = vi.fn((url, options, callback) => {
    const req = new EventEmitter()
    req.setTimeout = vi.fn()
    req.destroy = vi.fn(() => { queueMicrotask(() => req.emit('close')) })
    req.end = vi.fn(body => {
      calls.push({ url: String(url), options, body })
      if (hold) { hold.req = req; hold.callback = callback; return }
      const res = new EventEmitter()
      res.statusCode = status
      res.headers = { 'content-type': 'application/json; charset=utf-8' }
      res.resume = vi.fn()
      callback(res)
      queueMicrotask(() => {
        res.emit('data', Buffer.from(JSON.stringify(response)))
        res.complete = true
        res.emit('end')
        req.emit('close')
      })
    })
    return req
  })
  return { requestImpl, calls }
}

const ok = { code: 0, message: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: 17 } }

describe('native S3 probe bridge', () => {
  it('encodes only the exact bounded read-only contract', () => {
    expect(JSON.parse(encodeS3ProbeRequest(payload()))).toEqual(payload())
    expect(encodeS3ProbeRequest(payload({ readOnly: false }))).toBeNull()
    expect(encodeS3ProbeRequest(payload({ maxBytes: 1048577 }))).toBeNull()
    expect(encodeS3ProbeRequest({ ...payload(), extra: 'no' })).toBeNull()
    expect(encodeS3ProbeRequest(payload({ secretAccessKey: null }))).toBeNull()
    const hidden = payload()
    Object.defineProperty(hidden, 'prefix', { value: 'hidden/', enumerable: false })
    expect(encodeS3ProbeRequest(hidden)).toBeNull()
  })

  it('posts credentials only in the local JSON body and returns a sanitized result', async () => {
    const fake = transport({ response: ok })
    const service = createS3ProbeService({ requestImpl: fake.requestImpl })
    await expect(service.probe(payload())).resolves.toEqual({
      success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: 17 },
    })
    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]
    expect(call.url).toBe('http://127.0.0.1:27121/api/sync/s3/probe')
    expect(call.url).not.toContain('synthetic-secret')
    expect(call.options.method).toBe('POST')
    expect(call.options.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Notepad-Read-Only': 's3-probe',
      'Cache-Control': 'no-store',
    })
    expect(Object.keys(call.options.headers).join(' ')).not.toMatch(/origin|referer|sec-fetch/i)
    expect(JSON.parse(call.body)).toEqual(payload())
  })

  it('never contacts the backend for invalid input or a concurrent call', async () => {
    const hold = {}
    const fake = transport({ hold })
    const service = createS3ProbeService({ requestImpl: fake.requestImpl })
    await expect(service.probe(payload({ readOnly: false }))).resolves.toMatchObject({ code: 'invalid-bridge-request' })
    expect(fake.requestImpl).not.toHaveBeenCalled()
    const first = service.probe(payload())
    await Promise.resolve()
    await expect(service.probe(payload({ key: 'other' }))).resolves.toMatchObject({ code: 'native-probe-busy' })
    const res = new EventEmitter()
    res.statusCode = 200
    res.headers = { 'content-type': 'application/json; charset=utf-8' }
    res.resume = vi.fn()
    hold.callback(res)
    res.emit('data', Buffer.from(JSON.stringify(ok)))
    res.complete = true
    res.emit('end')
    hold.req.emit('close')
    await expect(first).resolves.toMatchObject({ success: true })
  })

  it('passes only safe failure classifications and refuses malformed backend output', async () => {
    const denied = transport({ status: 422, response: {
      code: 422, message: 'probe-not-readable', data: { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 0 },
    } })
    await expect(createS3ProbeService({ requestImpl: denied.requestImpl }).probe(payload())).resolves.toEqual({
      success: false, status: 422, code: 'probe-not-readable', data: { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 0 },
    })
    const malicious = transport({ status: 500, response: {
      code: 500, message: 'secret=synthetic-secret', data: null,
    } })
    const result = await createS3ProbeService({ requestImpl: malicious.requestImpl }).probe(payload())
    expect(result).toEqual({ success: false, status: 0, code: 'native-probe-invalid-response', data: null })
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
  })

  it('rejects encoded, oversized or structurally inconsistent loopback responses', async () => {
    const encodedRequest = vi.fn((url, options, callback) => {
      const req = new EventEmitter()
      req.setTimeout = vi.fn()
      req.destroy = vi.fn()
      req.end = vi.fn(() => {
        const res = new EventEmitter()
        res.statusCode = 200
        res.headers = { 'content-type': 'application/json', 'content-encoding': 'gzip' }
        res.resume = vi.fn()
        callback(res)
      })
      return req
    })
    await expect(createS3ProbeService({ requestImpl: encodedRequest }).probe(payload())).resolves.toMatchObject({ code: 'native-probe-invalid-response' })

    const oversizedRequest = vi.fn((url, options, callback) => {
      const req = new EventEmitter()
      req.setTimeout = vi.fn()
      req.destroy = vi.fn()
      req.end = vi.fn(() => {
        const res = new EventEmitter()
        res.statusCode = 200
        res.headers = { 'content-type': 'application/json' }
        res.resume = vi.fn()
        callback(res)
        queueMicrotask(() => res.emit('data', Buffer.alloc(64 * 1024 + 1)))
      })
      return req
    })
    await expect(createS3ProbeService({ requestImpl: oversizedRequest }).probe(payload())).resolves.toMatchObject({ code: 'native-probe-invalid-response' })

    const partial = transport({ status: 422, response: {
      code: 422, message: 'probe-not-readable', data: { outcome: 'access-denied', httpStatus: 403, acceptedBytes: 1 },
    } })
    await expect(createS3ProbeService({ requestImpl: partial.requestImpl }).probe(payload())).resolves.toMatchObject({ code: 'native-probe-invalid-response' })
  })

  it('rejects any non-fixed native target before a credential-bearing request can exist', () => {
    expect(() => createS3ProbeService({ target: 'https://example.com/api/sync/s3/probe' })).toThrow('invalid native probe target')
    expect(() => createS3ProbeService({ target: 'http://127.0.0.1:27122/api/sync/s3/probe' })).toThrow('invalid native probe target')
    expect(() => createS3ProbeService({ target: 'http://127.0.0.1:27121/api/sync/s3/probe?x=1' })).toThrow('invalid native probe target')
  })

  it('registers one trusted-frame IPC entry and aborts when that renderer is destroyed', async () => {
    const handlers = new Map()
    const sender = new EventEmitter()
    sender.mainFrame = { url: 'file:///synthetic-app/dist/index.html' }
    sender.getURL = () => sender.mainFrame.url
    sender.isDestroyed = () => false
    const win = new EventEmitter()
    win.webContents = sender; win.isDestroyed = () => false
    const scope = createS3ProbeScope({ getWindow: () => win, getExpectedURL: () => 'file:///synthetic-app/dist/index.html' })
    const service = { probe: vi.fn(async (_value, { signal }) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({ success: false, status: 0, code: 'native-probe-cancelled', data: null }), { once: true })
    })) }
    registerS3ProbeHandler({ handle: (key, fn) => handlers.set(key, fn) }, service, scope)
    expect([...handlers.keys()]).toEqual([S3_PROBE_CHANNEL])
    expect(await handlers.get(S3_PROBE_CHANNEL)({ trusted: false }, payload())).toMatchObject({ code: 'untrusted-frame' })
    expect(service.probe).not.toHaveBeenCalled()
    const trusted = handlers.get(S3_PROBE_CHANNEL)({ sender, senderFrame: sender.mainFrame }, payload())
    sender.emit('destroyed')
    await expect(trusted).resolves.toMatchObject({ code: 'native-probe-cancelled' })
    expect(service.probe).toHaveBeenCalledTimes(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })
})
