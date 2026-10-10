// Shared native/renderer preview wire contract. The Go handler remains the authority for
// canonical records, their relationships, connection policy and remote pins.
// Never call getters/toJSON, normalize strings, or return caller-owned objects.
export const S3_PREVIEW_REQUEST_LIMIT = 2 * 1024 * 1024
export const S3_PREVIEW_RESPONSE_LIMIT = 16 * 1024
export const S3_PREVIEW_LIMITS = Object.freeze({
  localRecordBytes: 256 * 1024, totalLocalRecordBytes: 1024 * 1024, maxLocalRecords: 128,
  manifestBytes: 1024 * 1024, recordBytes: 256 * 1024, totalRecordBytes: 4 * 1024 * 1024,
  maxRecords: 128, maxItems: 384,
})
// UTF-8 byte counting is shared by main and the isolated renderer.
// No Buffer shim or Node import is needed by renderer consumers.
const utf8Length = s => new TextEncoder().encode(s).length
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const HASH = /^[a-f0-9]{64}$/
const KINDS = Object.freeze(['file', 'tag', 'file-tag', 'attachment'])
const COUNTS = Object.freeze(['total', 'upload_candidates', 'download_candidates', 'conflicts', 'noops'])
const MESSAGES = new Map([
  [400, ['invalid-request', 'invalid-request-target', 'invalid-connection']],
  [403, ['native-loopback-required']], [405, ['method-not-allowed']],
  [408, ['preview-cancelled']], [413, ['request-too-large']],
  // Go's current refusal includes trailers. Keep the previously accepted fixed
  // alias for compatibility; neither spelling can carry data or another status.
  [415, ['json-required', 'encoded-request-refused', 'encoded-or-trailer-request-refused']], [422, ['preview-not-available']],
  [429, ['preview-busy']], [503, ['preview-unavailable']], [504, ['preview-timeout']],
])
export const previewFailure = code => Object.freeze({ success: false, status: 0, code, data: null })

function wellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}
function text(s, max) {
  if (typeof s !== 'string' || s.length > max || !wellFormed(s) || utf8Length(s) > max) throw new Error('invalid preview')
  return s
}
function identity(s) {
  text(s, 1024)
  if (!s.length || !s.trim() || /[\x00-\x1f\x7f]/.test(s)) throw new Error('invalid preview')
  return s // Identity is NOT trimmed, normalized, case-folded or a path.
}
function dataObject(value, required, optional = [], max = required?.length + optional.length) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid preview')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) throw new Error('invalid preview')
  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > max || (required && (required.some(k => !own(value, k)) || keys.some(k => !required.includes(k) && !optional.includes(k))))) throw new Error('invalid preview')
  const result = Object.create(null)
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d || !d.enumerable || !own(d, 'value')) throw new Error('invalid preview')
    result[key] = d.value
  }
  return result
}

// An IPC structured clone is not a guarantee of shape or a total IPC memory
// limit. Bound the exact UTF-8 body here; deeper Record JSON is not reinterpreted.
export function encodeS3PreviewRequest(value) {
  try {
    const root = dataObject(value, ['readOnly', 'connection', 'pin', 'basis', 'limits'])
    if (root.readOnly !== true) return null
    const limits = dataObject(root.limits, Object.keys(S3_PREVIEW_LIMITS))
    for (const key of Object.keys(limits)) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > S3_PREVIEW_LIMITS[key]) return null
    }
    const connection = dataObject(root.connection, ['endpoint', 'bucket', 'region', 'accessKeyId', 'secretAccessKey'], ['prefix', 'sessionToken'])
    for (const key of Object.keys(connection)) connection[key] = text(connection[key], 16384)
    const pin = dataObject(root.pin, ['storeId', 'generation', 'sha256'])
    identity(pin.storeId)
    if (!Number.isSafeInteger(pin.generation) || pin.generation < 1 || typeof pin.sha256 !== 'string' || !HASH.test(pin.sha256)) return null
    const basis = dataObject(root.basis, ['storeId', 'localRecords', 'baseItems'])
    if (basis.storeId !== pin.storeId) return null
    const local = dataObject(basis.localRecords, null, [], limits.maxLocalRecords)
    const base = dataObject(basis.baseItems, null, [], 128)
    let bytes = 0
    for (const key of Object.keys(local)) {
      identity(key); text(local[key], limits.localRecordBytes)
      bytes += utf8Length(local[key])
      if (bytes > limits.totalLocalRecordBytes) return null
    }
    for (const key of Object.keys(base)) {
      identity(key)
      if (typeof base[key] !== 'string' || !HASH.test(base[key])) return null
    }
    basis.localRecords = local; basis.baseItems = base
    root.connection = connection; root.pin = pin; root.basis = basis; root.limits = limits
    const body = JSON.stringify(root)
    return utf8Length(body) <= S3_PREVIEW_REQUEST_LIMIT
      ? Object.freeze({ body, maxItems: limits.maxItems }) : null
  } catch { return null }
}

function unambiguousJSON(raw) {
  const parsed = JSON.parse(raw)
  const stack = []
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const t = token[0]
    if (t === '{' || t === '[') {
      stack.push(new Set())
      if (stack.length > 5) throw new Error('invalid preview')
    } else if (t === '}' || t === ']') stack.pop()
    else {
      const s = JSON.parse(t)
      if (!wellFormed(s)) throw new Error('invalid preview')
      if (/^\s*:/.test(raw.slice(token.index + t.length))) {
        const keys = stack.at(-1)
        if (!keys || keys.has(s)) throw new Error('invalid preview')
        keys.add(s)
      }
    }
  }
  return parsed
}
function counts(value, maxItems) {
  const c = dataObject(value, COUNTS)
  for (const key of COUNTS) if (!Number.isSafeInteger(c[key]) || c[key] < 0 || c[key] > maxItems) throw new Error('invalid preview')
  if (c.total !== c.upload_candidates + c.download_candidates + c.conflicts + c.noops) throw new Error('invalid preview')
  return Object.freeze({ ...c })
}
// The only renderer result is a fresh, recursively frozen whitelist. This
// deliberately does not infer authentication or completed sync from counts.
export function decodeS3PreviewResponse(status, raw, maxItems) {
  try {
    if (typeof raw !== 'string' || utf8Length(raw) > S3_PREVIEW_RESPONSE_LIMIT ||
        !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 384) throw new Error('invalid preview')
    const envelope = dataObject(unambiguousJSON(raw), ['code', 'message', 'data'])
    if (status !== 200) {
      if (!Number.isInteger(status) || envelope.code !== status || !MESSAGES.get(status)?.includes(envelope.message) || envelope.data !== null) throw new Error('invalid preview')
      return Object.freeze({ success: false, status, code: envelope.message, data: null })
    }
    if (envelope.code !== 0 || envelope.message !== 'OK') throw new Error('invalid preview')
    const d = dataObject(envelope.data, ['format', 'version', 'read_only', 'counts', 'kinds'])
    if (d.format !== 'local-notepad-s3-plan-overview' || d.version !== 1 || d.read_only !== true || !Array.isArray(d.kinds) || d.kinds.length !== 4) throw new Error('invalid preview')
    const total = counts(d.counts, maxItems)
    const kinds = d.kinds.map((item, i) => {
      const row = dataObject(item, ['kind', 'counts'])
      if (row.kind !== KINDS[i]) throw new Error('invalid preview')
      return Object.freeze({ kind: row.kind, counts: counts(row.counts, maxItems) })
    })
    for (const key of COUNTS) if (kinds.reduce((n, k) => n + k.counts[key], 0) !== total[key]) throw new Error('invalid preview')
    return Object.freeze({ success: true, status: 200, code: 'OK', data: Object.freeze({
      format: d.format, version: 1, read_only: true, counts: total, kinds: Object.freeze(kinds),
    }) })
  } catch { return previewFailure('native-preview-invalid-response') }
}
