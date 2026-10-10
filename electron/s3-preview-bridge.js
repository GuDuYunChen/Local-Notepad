import { request as nodeHttpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { encodeS3PreviewRequest, decodeS3PreviewResponse, previewFailure,
  S3_PREVIEW_RESPONSE_LIMIT } from './s3-preview-codec.js'

export const S3_PREVIEW_CHANNEL = 'sync:s3-preview:read'
export const S3_PREVIEW_URL = 'http://127.0.0.1:27121/api/sync/s3/preview'
export const S3_PREVIEW_TIMEOUT_MS = 7500

function headerValues(res, key) {
  if (!Array.isArray(res.rawHeaders) || res.rawHeaders.length % 2) throw new Error('invalid preview')
  const out = []
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    const name = res.rawHeaders[i], value = res.rawHeaders[i + 1]
    if (typeof name !== 'string' || typeof value !== 'string') throw new Error('invalid preview')
    if (name.toLowerCase() === key) out.push(value)
  }
  return out
}
function responseLength(res) {
  const types = headerValues(res, 'content-type')
  if (types.length !== 1 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(types[0]) ||
      headerValues(res, 'content-encoding').length || headerValues(res, 'trailer').length) throw new Error('invalid preview')
  const lengths = headerValues(res, 'content-length'), transfers = headerValues(res, 'transfer-encoding')
  if (lengths.length > 1 || transfers.length > 1 || (lengths.length && transfers.length) ||
      (transfers.length && transfers[0].toLowerCase() !== 'chunked')) throw new Error('invalid preview')
  if (!lengths.length) return null
  if (!/^(0|[1-9]\d*)$/.test(lengths[0])) throw new Error('invalid preview')
  const length = Number(lengths[0])
  if (!Number.isSafeInteger(length) || length > S3_PREVIEW_RESPONSE_LIMIT) throw new Error('invalid preview')
  return length
}

// Main-process transport configuration only. No renderer-controlled URL,
// headers, timers, filesystem, database, cache, retry or browser HTTP fallback.
export function createS3PreviewService({ requestImpl = nodeHttpRequest, target = S3_PREVIEW_URL,
  timeoutMs = S3_PREVIEW_TIMEOUT_MS } = {}) {
  if (target !== S3_PREVIEW_URL || typeof requestImpl !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > S3_PREVIEW_TIMEOUT_MS) throw new Error('invalid native preview configuration')
  let active = null
  return Object.freeze({
    async preview(value, options = {}) {
      // Reserve BEFORE any reflection: hostile Proxy reentrancy cannot create
      // two requests. IPC normally clones input but direct calls also fail closed.
      if (active) return previewFailure('native-preview-busy')
      const slot = {}; active = slot
      const deadline = performance.now() + timeoutMs
      let encoded, signal
      const release = () => { if (active === slot) active = null }
      try {
        signal = options.signal
        if (signal !== undefined && !(signal instanceof AbortSignal)) { release(); return previewFailure('invalid-preview-request') }
        if (signal?.aborted) { release(); return previewFailure('native-preview-cancelled') }
        encoded = encodeS3PreviewRequest(value)
        if (!encoded) { release(); return previewFailure('invalid-preview-request') }
        if (signal?.aborted) { release(); return previewFailure('native-preview-cancelled') }
        if (performance.now() >= deadline) { release(); return previewFailure('native-preview-timeout') }
      } catch { release(); return previewFailure('invalid-preview-request') }
      let body = encoded.body
      const maxItems = encoded.maxItems; encoded = null
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
          finish(previewFailure(code))
          try { res?.destroy() } catch {}
          try { req?.destroy() } catch {}
          if (requestClosed || (!req && !creating)) release()
        }
        const abort = () => fail('native-preview-cancelled')
        const stopped = () => {
          if (signal?.aborted) { abort(); return true }
          if (performance.now() >= deadline) { fail('native-preview-timeout'); return true }
          return settled
        }
        timer = setTimeout(() => fail('native-preview-timeout'), Math.max(1, deadline - performance.now()))
        try {
          signal?.addEventListener('abort', abort, { once: true })
          if (stopped()) return
          creating = true
          req = requestImpl(new URL(S3_PREVIEW_URL), {
            method: 'POST', agent: false, maxHeaderSize: 16 * 1024,
            headers: { 'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': String(Buffer.byteLength(body, 'utf8')),
              'X-Notepad-Read-Only': 's3-preview', 'Cache-Control': 'no-store', 'Connection': 'close' },
          }, incoming => {
            res = incoming
            res.on('error', () => fail('native-preview-unavailable'))
            res.on('aborted', () => fail('native-preview-unavailable'))
            res.on('close', () => { if (!settled) fail('native-preview-unavailable') })
            if (stopped()) { try { res.destroy() } catch {}; return }
            let length
            try { length = responseLength(res) } catch { fail('native-preview-invalid-response'); return }
            res.on('data', chunk => {
              if (stopped()) return
              if (!Buffer.isBuffer(chunk) || bytes + chunk.length > S3_PREVIEW_RESPONSE_LIMIT) { fail('native-preview-invalid-response'); return }
              bytes += chunk.length; chunks.push(chunk)
            })
            res.on('end', () => {
              if (stopped()) return
              if (res.complete !== true || (length !== null && bytes !== length) ||
                  res.rawTrailers?.length || Object.keys(res.trailers || {}).length) { fail('native-preview-invalid-response'); return }
              let raw
              try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)) }
              catch { fail('native-preview-invalid-response'); return }
              const result = decodeS3PreviewResponse(res.statusCode, raw, maxItems)
              if (result.code === 'native-preview-invalid-response') { fail(result.code); return }
              if (!stopped()) finish(result)
            })
          })
          creating = false
          req.on('error', () => fail(signal?.aborted ? 'native-preview-cancelled' : 'native-preview-unavailable'))
          req.on('close', () => {
            requestClosed = true; release()
            if (!settled) finish(previewFailure(signal?.aborted ? 'native-preview-cancelled' : 'native-preview-unavailable'))
          })
          if (stopped()) { try { req.destroy() } catch {}; return }
          req.end(body)
        } catch { creating = false; fail('native-preview-unavailable') }
      })
    },
  })
}

export function registerS3PreviewHandler(ipcMain, service, scope) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || !service || typeof service.preview !== 'function' ||
      !scope || typeof scope.acquire !== 'function') throw new Error('native preview bridge unavailable')
  ipcMain.handle(S3_PREVIEW_CHANNEL, async (event, value) => {
    let lease
    try {
      lease = scope.acquire(event, randomUUID())
      if (!lease.ok) return previewFailure(lease.code === 'probe-busy' ? 'native-preview-busy' : 'untrusted-frame')
      if (!lease.mayDeliver()) return previewFailure('native-preview-cancelled')
      const result = await service.preview(value, { signal: lease.signal })
      return lease.mayDeliver() ? result : previewFailure('native-preview-cancelled')
    } catch { return previewFailure('native-preview-unavailable') }
    finally { lease?.release?.() }
  })
}
