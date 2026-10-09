import { request as nodeHttpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { encodeS3LocalOverviewRequest, decodeS3LocalOverviewResponse, localOverviewFailure, sanitizeS3LocalOverviewResult,
  S3_LOCAL_OVERVIEW_RESPONSE_LIMIT } from './s3-local-overview-codec.js'

export const S3_LOCAL_OVERVIEW_CHANNEL = 'sync:s3-local-overview:read'
export const S3_LOCAL_OVERVIEW_URL = 'http://127.0.0.1:27121/api/sync/s3/local-overview'
export const S3_LOCAL_OVERVIEW_TIMEOUT_MS = 7500

function headerValues(res, key) {
  if (!Array.isArray(res.rawHeaders) || res.rawHeaders.length % 2) throw new Error('invalid local overview')
  const out = []
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    const name = res.rawHeaders[i], value = res.rawHeaders[i + 1]
    if (typeof name !== 'string' || typeof value !== 'string') throw new Error('invalid local overview')
    if (name.toLowerCase() === key) out.push(value)
  }
  return out
}
function responseLength(res) {
  const types = headerValues(res, 'content-type')
  if (types.length !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(types[0]) ||
      headerValues(res, 'content-encoding').length || headerValues(res, 'trailer').length ||
      headerValues(res, 'cache-control').length !== 1 || headerValues(res, 'cache-control')[0] !== 'no-store' ||
      headerValues(res, 'x-content-type-options').length !== 1 || headerValues(res, 'x-content-type-options')[0] !== 'nosniff' ||
      res.rawHeaders.some((v, i) => i % 2 === 0 && v.toLowerCase().startsWith('access-control-allow-'))) throw new Error('invalid local overview')
  const lengths = headerValues(res, 'content-length'), transfers = headerValues(res, 'transfer-encoding')
  if (lengths.length > 1 || transfers.length > 1 || (lengths.length && transfers.length) ||
      (transfers.length && transfers[0].toLowerCase() !== 'chunked')) throw new Error('invalid local overview')
  if (!lengths.length) return null
  if (!/^(0|[1-9]\d*)$/.test(lengths[0])) throw new Error('invalid local overview')
  const length = Number(lengths[0])
  if (!Number.isSafeInteger(length) || length > S3_LOCAL_OVERVIEW_RESPONSE_LIMIT) throw new Error('invalid local overview')
  return length
}

// The packaged runtime supplies a private process-session capability.
// A standalone instance without getToken cannot access the authenticated host.
// Main-process transport configuration only. No renderer-controlled URL,
// headers, timers, filesystem, database, cache, retry or browser HTTP fallback.
export function createS3LocalOverviewService({ requestImpl = nodeHttpRequest, target = S3_LOCAL_OVERVIEW_URL,
  timeoutMs = S3_LOCAL_OVERVIEW_TIMEOUT_MS, getToken = null } = {}) {
  if (target !== S3_LOCAL_OVERVIEW_URL || typeof requestImpl !== 'function' ||
      (getToken !== null && typeof getToken !== 'function') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S3_LOCAL_OVERVIEW_TIMEOUT_MS) throw new Error('invalid native local overview configuration')
  let active = null
  return Object.freeze({
    async read(value, options = {}) {
      // Reserve BEFORE any reflection: hostile Proxy reentrancy cannot create
      // two requests. IPC normally clones input but direct calls also fail closed.
      if (active) return localOverviewFailure('native-local-overview-busy')
      const slot = {}; active = slot
      const deadline = performance.now() + timeoutMs
      let encoded, signal, token
      const release = () => { if (active === slot) active = null }
      try {
        signal = options.signal
        if (signal !== undefined && !(signal instanceof AbortSignal)) { release(); return localOverviewFailure('invalid-local-overview-request') }
        if (signal?.aborted) { release(); return localOverviewFailure('native-local-overview-cancelled') }
        encoded = encodeS3LocalOverviewRequest(value)
        if (!encoded) { release(); return localOverviewFailure('invalid-local-overview-request') }
        if (getToken !== null) {
          token = getToken()
          if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { release(); return localOverviewFailure('native-local-overview-unavailable') }
        }
        if (signal?.aborted) { release(); return localOverviewFailure('native-local-overview-cancelled') }
        if (performance.now() >= deadline) { release(); return localOverviewFailure('native-local-overview-timeout') }
      } catch { release(); return localOverviewFailure('invalid-local-overview-request') }
      let body = encoded; encoded = null
      return new Promise(resolve => {
        let req, res, timer, settled = false, requestClosed = false, creating = false
        const chunks = []; let bytes = 0
        const finish = result => {
          if (settled) return
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
          chunks.length = 0; body = ''
          resolve(result)
        }
        const fail = code => {
          finish(localOverviewFailure(code))
          try { res?.destroy() } catch {}
          try { req?.destroy() } catch {}
          if (requestClosed || (!req && !creating)) release()
        }
        const abort = () => fail('native-local-overview-cancelled')
        const stopped = () => {
          if (signal?.aborted) { abort(); return true }
          if (performance.now() >= deadline) { fail('native-local-overview-timeout'); return true }
          return settled
        }
        timer = setTimeout(() => fail('native-local-overview-timeout'), Math.max(1, deadline - performance.now()))
        try {
          signal?.addEventListener('abort', abort, { once: true })
          if (stopped()) return
          creating = true
          req = requestImpl(new URL(S3_LOCAL_OVERVIEW_URL), {
            method: 'POST', agent: false, maxHeaderSize: 16 * 1024,
            headers: { 'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': String(Buffer.byteLength(body, 'utf8')),
              'X-Notepad-Read-Only': 's3-local-overview', 'Cache-Control': 'no-store', 'Connection': 'close',
              ...(token ? { 'X-Notepad-Local-Overview': token } : {}) },
          }, incoming => {
            res = incoming
            res.on('error', () => fail('native-local-overview-unavailable'))
            res.on('aborted', () => fail('native-local-overview-unavailable'))
            res.on('close', () => { if (!settled) fail('native-local-overview-unavailable') })
            if (stopped()) { try { res.destroy() } catch {}; return }
            let length
            try { length = responseLength(res) } catch { fail('native-local-overview-invalid-response'); return }
            res.on('data', chunk => {
              if (stopped()) return
              if (!Buffer.isBuffer(chunk) || bytes + chunk.length > S3_LOCAL_OVERVIEW_RESPONSE_LIMIT) { fail('native-local-overview-invalid-response'); return }
              bytes += chunk.length; chunks.push(chunk)
            })
            res.on('end', () => {
              if (stopped()) return
              if (res.complete !== true || (length !== null && bytes !== length) ||
                  res.rawTrailers?.length || Object.keys(res.trailers || {}).length) { fail('native-local-overview-invalid-response'); return }
              let raw
              try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)) }
              catch { fail('native-local-overview-invalid-response'); return }
              const result = decodeS3LocalOverviewResponse(res.statusCode, raw)
              if (result.code === 'native-local-overview-invalid-response') { fail(result.code); return }
              if (!stopped()) finish(result)
            })
          })
          creating = false
          req.on('error', () => fail(signal?.aborted ? 'native-local-overview-cancelled' : 'native-local-overview-unavailable'))
          req.on('close', () => {
            requestClosed = true; release()
            if (!settled) finish(localOverviewFailure(signal?.aborted ? 'native-local-overview-cancelled' : 'native-local-overview-unavailable'))
          })
          if (stopped()) { try { req.destroy() } catch {}; return }
          req.end(body)
        } catch { creating = false; fail('native-local-overview-unavailable') }
      })
    },
  })
}

export function registerS3LocalOverviewHandler(ipcMain, service, scope) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || !service || typeof service.read !== 'function' ||
      !scope || typeof scope.acquire !== 'function') throw new Error('native local overview bridge unavailable')
  ipcMain.handle(S3_LOCAL_OVERVIEW_CHANNEL, async (event, value) => {
    let lease
    try {
      lease = scope.acquire(event, randomUUID())
      if (!lease.ok) return localOverviewFailure(lease.code === 'probe-busy' ? 'native-local-overview-busy' : 'untrusted-frame')
      if (!lease.mayDeliver()) return localOverviewFailure('native-local-overview-cancelled')
      if (!encodeS3LocalOverviewRequest(value)) return localOverviewFailure('invalid-local-overview-request')
      const result = await service.read(value, { signal: lease.signal })
      if (!lease.mayDeliver()) return localOverviewFailure('native-local-overview-cancelled')
      const safe = sanitizeS3LocalOverviewResult(result)
      return lease.mayDeliver() ? safe : localOverviewFailure('native-local-overview-cancelled')
    } catch { return localOverviewFailure('native-local-overview-unavailable') }
    finally { lease?.release?.() }
  })
}
