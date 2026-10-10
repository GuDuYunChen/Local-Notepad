// Local inventory only: counts are not a remote plan, a pin, or sync consent.
// No Node imports; the same whitelist can be used at the renderer boundary.
export const S3_LOCAL_OVERVIEW_RESPONSE_LIMIT = 4096
const KINDS = ['file', 'tag', 'file-tag', 'attachment']
const FIELDS = ['format', 'version', 'read_only', 'observed_stable', 'complete_for_preview',
  'records', 'record_bytes', 'attachment_bytes', 'base_items', 'kinds']
const ERRORS = new Map([
  [400, ['invalid-request', 'invalid-request-target']], [403, ['native-loopback-required']],
  [405, ['method-not-allowed']], [408, ['local-overview-cancelled']], [413, ['request-too-large']],
  [415, ['json-required', 'encoded-or-trailer-request-refused']], [422, ['local-overview-not-available']],
  [429, ['local-overview-busy']], [503, ['local-overview-unavailable']], [504, ['local-overview-timeout']],
])
const LOCAL_ERRORS = new Set(['invalid-local-overview-request', 'untrusted-frame',
  'native-local-overview-busy', 'native-local-overview-cancelled', 'native-local-overview-timeout',
  'native-local-overview-unavailable', 'native-local-overview-invalid-response'])
const invalid = () => localOverviewFailure('native-local-overview-invalid-response')
export function localOverviewFailure(code) {
  return Object.freeze({ success: false, status: 0,
    code: LOCAL_ERRORS.has(code) ? code : 'native-local-overview-unavailable', data: null })
}
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid local overview')
  const proto = Object.getPrototypeOf(value)
  if ((proto !== null && proto !== Object.prototype) || Object.getOwnPropertySymbols(value).length) throw new Error('invalid local overview')
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== fields.length || fields.some(key => !names.includes(key))) throw new Error('invalid local overview')
  const out = Object.create(null)
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new Error('invalid local overview')
    out[key] = d.value
  }
  return out
}
function integer(n, max) {
  if (!Number.isSafeInteger(n) || Object.is(n, -0) || n < 0 || n > max) throw new Error('invalid local overview')
  return n
}
export function encodeS3LocalOverviewRequest(value) {
  try { return object(value, ['readOnly']).readOnly === true ? '{"readOnly":true}' : null }
  catch { return null }
}
function summary(value) {
  const d = object(value, FIELDS)
  if (d.format !== 'local-notepad-s3-local-candidate-overview' || d.version !== 1 ||
      d.read_only !== true || d.observed_stable !== true || d.complete_for_preview !== false ||
      !Array.isArray(d.kinds)) throw new Error('invalid local overview')
  // Reject sparse/accessor/augmented arrays without invoking their properties.
  const descriptors = Object.getOwnPropertyDescriptors(d.kinds)
  if (Object.getOwnPropertySymbols(d.kinds).length || Object.keys(descriptors).length !== 5 ||
      descriptors.length?.value !== 4) throw new Error('invalid local overview')
  const kinds = KINDS.map((kind, i) => {
    const entry = descriptors[i]
    if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) throw new Error('invalid local overview')
    const r = object(entry.value, ['kind', 'records', 'record_bytes'])
    if (r.kind !== kind) throw new Error('invalid local overview')
    integer(r.records, 128); integer(r.record_bytes, 1024 * 1024)
    if (r.record_bytes > r.records * 256 * 1024 || r.record_bytes < r.records) throw new Error('invalid local overview')
    return Object.freeze({ kind, records: r.records, record_bytes: r.record_bytes })
  })
  integer(d.records, 256); integer(d.record_bytes, 2 * 1024 * 1024)
  integer(d.attachment_bytes, 64 * 1024 * 1024); integer(d.base_items, 128)
  if (kinds.reduce((n, r) => n + r.records, 0) !== d.records ||
      kinds.reduce((n, r) => n + r.record_bytes, 0) !== d.record_bytes ||
      kinds.slice(0, 3).reduce((n, r) => n + r.records, 0) > 128 ||
      kinds.slice(0, 3).reduce((n, r) => n + r.record_bytes, 0) > 1024 * 1024 ||
      d.attachment_bytes > kinds[3].records * 32 * 1024 * 1024) throw new Error('invalid local overview')
  return Object.freeze({ format: d.format, version: 1, read_only: true, observed_stable: true,
    complete_for_preview: false, records: d.records, record_bytes: d.record_bytes,
    attachment_bytes: d.attachment_bytes, base_items: d.base_items, kinds: Object.freeze(kinds) })
}
// Strict re-validation at IPC delivery; never forward service-owned objects.
export function sanitizeS3LocalOverviewResult(value) {
  try {
    const r = object(value, ['success', 'status', 'code', 'data'])
    if (r.success === true && r.status === 200 && r.code === 'OK') {
      return Object.freeze({ success: true, status: 200, code: 'OK', data: summary(r.data) })
    }
    if (r.success !== false || r.data !== null) return invalid()
    if (r.status === 0 && LOCAL_ERRORS.has(r.code)) return localOverviewFailure(r.code)
    if (!ERRORS.get(r.status)?.includes(r.code)) return invalid()
    return Object.freeze({ success: false, status: r.status, code: r.code, data: null })
  } catch { return invalid() }
}
function parse(raw) {
  if (typeof raw !== 'string' || raw.length > S3_LOCAL_OVERVIEW_RESPONSE_LIMIT ||
      new TextEncoder().encode(raw).length > S3_LOCAL_OVERVIEW_RESPONSE_LIMIT) throw new Error('invalid local overview')
  const value = JSON.parse(raw), stack = []
  // JSON.parse already validates grammar. Detect duplicate decoded keys before
  // accepting its last-value-wins output, including escaped-key aliases.
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const text = token[0]
    if (text === '{' || text === '[') {
      stack.push(new Set()); if (stack.length > 4) throw new Error('invalid local overview')
    } else if (text === '}' || text === ']') stack.pop()
    else if (/^\s*:/.test(raw.slice(token.index + text.length))) {
      const key = JSON.parse(text), keys = stack.at(-1)
      if (!keys || keys.has(key)) throw new Error('invalid local overview')
      keys.add(key)
    }
  }
  return value
}
export function decodeS3LocalOverviewResponse(status, raw) {
  try {
    const e = object(parse(raw), ['code', 'message', 'data'])
    if (status === 200 && e.code === 0 && e.message === 'OK') {
      return sanitizeS3LocalOverviewResult({ success: true, status, code: 'OK', data: e.data })
    }
    if (status === 0 || !ERRORS.get(status)?.includes(e.message) || e.code !== status || e.data !== null) return invalid()
    return sanitizeS3LocalOverviewResult({ success: false, status, code: e.message, data: null })
  } catch { return invalid() }
}
