import { request as nodeHttpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'

export const S3_PROBE_CHANNEL = 'sync:s3-probe:read'
export const S3_PROBE_URL = 'http://127.0.0.1:27121/api/sync/s3/probe'
export const S3_PROBE_INTENT_HEADER = 'X-Notepad-Read-Only'
export const S3_PROBE_INTENT = 's3-probe'
export const S3_PROBE_REQUEST_LIMIT = 64 * 1024
export const S3_PROBE_RESPONSE_LIMIT = 64 * 1024
export const S3_PROBE_TIMEOUT_MS = 7500

const REQUIRED = Object.freeze([
  'endpoint', 'bucket', 'region', 'accessKeyId', 'secretAccessKey',
  'key', 'maxBytes', 'readOnly',
])
const OPTIONAL = Object.freeze(['prefix', 'sessionToken'])
const ALLOWED = new Set([...REQUIRED, ...OPTIONAL])
const STRING_FIELDS = new Set([
  'endpoint', 'bucket', 'region', 'prefix', 'accessKeyId',
  'secretAccessKey', 'sessionToken', 'key',
])
const SAFE_MESSAGES = new Map([
  [400, new Set(['invalid-request', 'invalid-request-target'])],
  [403, new Set(['native-loopback-required'])],
  [405, new Set(['method-not-allowed'])],
  [413, new Set(['request-too-large'])],
  [415, new Set(['json-required', 'encoded-request-refused'])],
  [422, new Set(['probe-not-readable'])],
  [429, new Set(['probe-busy'])],
  [503, new Set(['probe-unavailable'])],
])
const SAFE_OUTCOMES = new Set([
  'readable',
  'invalid-config',
  'invalid-credentials',
  'invalid-key',
  'access-denied',
  'not-found',
  'redirect-refused',
  'http-failure',
  'too-large',
  'body-rejected',
  'transport-failure',
  'cancelled',
  'deadline-exceeded',
])

const fixedFailure = code => ({ success: false, status: 0, code, data: null })
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Snapshot data descriptors, not getters/toJSON. IPC normally structured-clones
// input, but direct callers must also fail closed without leaking exceptions.
function wellFormed(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = value.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}
export function encodeS3ProbeRequest(value) {
  try {
    if (!plainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) return null
    const keys = Object.getOwnPropertyNames(value)
    if (keys.some(key => !ALLOWED.has(key)) || REQUIRED.some(key => !hasOwn(value, key))) return null
    const clean = Object.create(null)
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key)
      if (!d || !d.enumerable || !hasOwn(d, 'value')) return null
      if (STRING_FIELDS.has(key) && (typeof d.value !== 'string' ||
          d.value.length > S3_PROBE_REQUEST_LIMIT || !wellFormed(d.value))) return null
      clean[key] = d.value
    }
    if (clean.readOnly !== true || !Number.isSafeInteger(clean.maxBytes) ||
        clean.maxBytes < 1 || clean.maxBytes > 1024 * 1024) return null
    const body = JSON.stringify(clean)
    return Buffer.byteLength(body, 'utf8') <= S3_PROBE_REQUEST_LIMIT ? body : null
  } catch { return null }
}

function localProbeURL(value) {
  // This is main-process configuration, never a renderer-controlled destination.
  if (value !== S3_PROBE_URL) throw new Error('invalid native probe target')
  return new URL(value)
}

function exactKeys(value, required, optional = []) {
  return plainObject(value) && required.every(k => hasOwn(value, k)) &&
    Object.keys(value).every(k => required.includes(k) || optional.includes(k))
}
function sanitizedData(value, status, limit) {
  if (!exactKeys(value, ['outcome', 'acceptedBytes'], ['httpStatus'])) return null
  const { outcome, acceptedBytes } = value
  const httpStatus = value.httpStatus === undefined ? 0 : value.httpStatus
  if (!SAFE_OUTCOMES.has(outcome) || !Number.isInteger(httpStatus) ||
      (httpStatus !== 0 && (httpStatus < 100 || httpStatus > 599)) ||
      !Number.isSafeInteger(acceptedBytes) || acceptedBytes < 0 || acceptedBytes > limit) return null
  if (status === 200) {
    if (outcome !== 'readable' || httpStatus !== 200) return null
  } else {
    if (outcome === 'readable' || acceptedBytes !== 0) return null
    const redirects = [301, 302, 303, 307, 308]
    if (outcome === 'access-denied') { if (![401, 403].includes(httpStatus)) return null }
    else if (outcome === 'not-found') { if (httpStatus !== 404) return null }
    else if (outcome === 'redirect-refused') { if (!redirects.includes(httpStatus)) return null }
    else if (outcome === 'http-failure') {
      if (httpStatus < 100 || [200, 401, 403, 404, ...redirects].includes(httpStatus)) return null
    } else if (httpStatus !== 0) return null
  }
  return { outcome, httpStatus, acceptedBytes }
}

function parseUnambiguousJSON(raw) {
  const value = JSON.parse(raw) // Syntax must already be valid for the token scan.
  const stack = []
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const text = token[0]
    if (text === '{' || text === '[') {
      stack.push(new Set())
      if (stack.length > 3) throw new Error('invalid response')
    } else if (text === '}' || text === ']') stack.pop()
    else {
      const decoded = JSON.parse(text)
      if (!wellFormed(decoded)) throw new Error('invalid response')
      if (/^\s*:/.test(raw.slice(token.index + text.length))) {
        const keys = stack.at(-1)
        if (!keys || keys.has(decoded)) throw new Error('invalid response')
        keys.add(decoded)
      }
    }
  }
  return value
}
function sanitizedEnvelope(status, raw, limit) {
  let value
  try { value = parseUnambiguousJSON(raw) } catch { return fixedFailure('native-probe-invalid-response') }
  if (!exactKeys(value, ['code', 'message', 'data']) || !Number.isInteger(status) ||
      !Number.isInteger(value.code) || typeof value.message !== 'string') {
    return fixedFailure('native-probe-invalid-response')
  }
  if (status === 200) {
    const data = sanitizedData(value.data, status, limit)
    if (value.code !== 0 || value.message !== 'OK' || !data) return fixedFailure('native-probe-invalid-response')
    return { success: true, status, code: 'OK', data }
  }
  if (value.code !== status || !SAFE_MESSAGES.get(status)?.has(value.message)) return fixedFailure('native-probe-invalid-response')
  const data = value.data === null ? null : sanitizedData(value.data, status, limit)
  if (value.data !== null && !data) return fixedFailure('native-probe-invalid-response')
  if ((status === 422) !== Boolean(data)) return fixedFailure('native-probe-invalid-response')
  return { success: false, status, code: value.message, data }
}

function headerValues(res, name) {
  // rawHeaders retains duplicate declarations which Node may join or discard.
  if (Array.isArray(res.rawHeaders)) {
    if (res.rawHeaders.length % 2) throw new Error('invalid response')
    const result = []
    for (let i = 0; i < res.rawHeaders.length; i += 2) {
      if (typeof res.rawHeaders[i] !== 'string' || typeof res.rawHeaders[i + 1] !== 'string') throw new Error('invalid response')
      if (res.rawHeaders[i].toLowerCase() === name) result.push(res.rawHeaders[i + 1])
    }
    return result
  }
  return Object.entries(res.headers || {}).filter(([k]) => k.toLowerCase() === name).flatMap(([, v]) => Array.isArray(v) ? v : [v])
}
function responseLength(res) {
  const types = headerValues(res, 'content-type')
  if (types.length !== 1 || typeof types[0] !== 'string' ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(types[0]) ||
      headerValues(res, 'content-encoding').length) throw new Error('invalid response')
  const lengths = headerValues(res, 'content-length')
  const transfers = headerValues(res, 'transfer-encoding')
  if (lengths.length > 1 || transfers.length > 1 ||
      (lengths.length && transfers.length) ||
      (transfers.length && transfers[0].toLowerCase() !== 'chunked')) throw new Error('invalid response')
  if (!lengths.length) return null
  if (typeof lengths[0] !== 'string' || !/^(0|[1-9]\d*)$/.test(lengths[0])) throw new Error('invalid response')
  const length = Number(lengths[0])
  if (!Number.isSafeInteger(length) || length > S3_PROBE_RESPONSE_LIMIT) throw new Error('invalid response')
  return length
}

export function createS3ProbeService({ requestImpl = nodeHttpRequest, target = S3_PROBE_URL,
  timeoutMs = S3_PROBE_TIMEOUT_MS } = {}) {
  localProbeURL(target)
  if (typeof requestImpl !== 'function') throw new Error('native probe transport unavailable')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S3_PROBE_TIMEOUT_MS) throw new Error('invalid native probe timeout')
  let active = null

  return {
    async probe(value, { signal } = {}) {
      let body = encodeS3ProbeRequest(value)
      if (body === null) return fixedFailure('invalid-bridge-request')
      if (active) return fixedFailure('native-probe-busy')
      if (signal?.aborted) return fixedFailure('native-probe-cancelled')
      const limit = JSON.parse(body).maxBytes
      const slot = {}; active = slot
      return new Promise(resolve => {
        let req, res, timer, settled = false, requestClosed = false
        const chunks = []; let bytes = 0
        const releaseTransport = () => { if (active === slot) active = null }
        const finish = result => {
          if (settled) return
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
          chunks.length = 0; body = ''
          resolve(result)
        }
        const fail = code => {
          finish(fixedFailure(code))
          // Never drain an unbounded rejected response and release the slot.
          try { res?.destroy() } catch {}
          try { req?.destroy() } catch {}
          if (!req || requestClosed) releaseTransport()
        }
        const abort = () => fail('native-probe-cancelled')
        // A wall-clock deadline, not socket-idle timeout: slow-drip responses
        // cannot extend it. Keep the transport slot until ClientRequest closes.
        timer = setTimeout(() => fail('native-probe-timeout'), timeoutMs)
        try {
          signal?.addEventListener('abort', abort, { once: true })
          if (signal?.aborted) { abort(); return }
          req = requestImpl(new URL(target), {
            method: 'POST', agent: false, maxHeaderSize: 16 * 1024,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': String(Buffer.byteLength(body, 'utf8')),
              [S3_PROBE_INTENT_HEADER]: S3_PROBE_INTENT,
              'Cache-Control': 'no-store', 'Connection': 'close',
            },
          }, incoming => {
            res = incoming
            res.on('error', () => fail('native-probe-unavailable'))
            res.on('aborted', () => fail('native-probe-unavailable'))
            res.on('close', () => { if (!settled) fail('native-probe-unavailable') })
            if (settled) { try { res.destroy() } catch {}; return }
            let declaredLength
            try { declaredLength = responseLength(res) } catch { fail('native-probe-invalid-response'); return }
            res.on('data', chunk => {
              if (settled) return
              if (!Buffer.isBuffer(chunk)) { fail('native-probe-invalid-response'); return }
              bytes += chunk.length
              if (bytes > S3_PROBE_RESPONSE_LIMIT) { fail('native-probe-invalid-response'); return }
              chunks.push(chunk)
            })
            res.on('end', () => {
              if (settled) return
              if (res.complete !== true || (declaredLength !== null && bytes !== declaredLength) ||
                  (res.rawTrailers?.length || Object.keys(res.trailers || {}).length)) {
                fail('native-probe-invalid-response'); return
              }
              let raw
              try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) }
              catch { fail('native-probe-invalid-response'); return }
              const result = sanitizedEnvelope(res.statusCode, raw, limit)
              if (result.code === 'native-probe-invalid-response') { fail(result.code); return }
              finish(result)
            })
          })
          req.on('error', () => fail(signal?.aborted ? 'native-probe-cancelled' : 'native-probe-unavailable'))
          req.on('close', () => {
            requestClosed = true; releaseTransport()
            if (!settled) finish(fixedFailure(signal?.aborted ? 'native-probe-cancelled' : 'native-probe-unavailable'))
          })
          if (settled || signal?.aborted) { abort(); return }
          req.end(body)
        } catch { fail('native-probe-unavailable') }
      })
    },
  }
}

export function registerS3ProbeHandler(ipcMain, service, scope) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || !service || typeof service.probe !== 'function' ||
      !scope || typeof scope.acquire !== 'function') throw new Error('native probe bridge unavailable')
  ipcMain.handle(S3_PROBE_CHANNEL, async (event, value) => {
    let lease
    try {
      lease = scope.acquire(event, randomUUID())
      if (!lease.ok) return fixedFailure(lease.code === 'probe-busy' ? 'native-probe-busy' : 'untrusted-frame')
      if (!lease.mayDeliver()) return fixedFailure('native-probe-cancelled')
      const result = await service.probe(value, { signal: lease.signal })
      return lease.mayDeliver() ? result : fixedFailure('native-probe-cancelled')
    } catch { return fixedFailure('native-probe-unavailable') }
    finally { lease?.release?.() }
  })
}
