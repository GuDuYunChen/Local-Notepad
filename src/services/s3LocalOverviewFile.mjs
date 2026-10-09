import { sanitizeS3LocalOverviewResult } from '../../electron/s3-local-overview-codec.js'

export const LOCAL_REPORT_FILE_BYTES = 4096
export const LOCAL_REPORT_FILE_WAIT_MS = 5000
export const LOCAL_REPORT_FILE_NOTICE = '这里只查看所选文件中的统计，不会导入或恢复笔记，也不会扫描当前工作区。文件可能被修改，不能证明来自本机、同一工作区或当前数据。'
const messages = Object.freeze({
  invalid: '报告格式或统计不完整，未显示部分内容。',
  size: '请选择非空且不超过 4 KiB 的统计 JSON 报告。',
  encoding: '文件不是有效的 UTF-8 文本。',
  read: '未能读取所选报告，原文件和笔记未改变。',
  timeout: '文件读取超时，未采用结果；不会自动重试。',
  aborted: '已停止查看本次文件，未改动原文件或笔记。',
})
const fail = (code = 'invalid') => Object.assign(new Error(messages[code]), { code })
const keys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw fail()
}

// File contents are untrusted, not a native receipt. Parse all fields and reject
// duplicate decoded keys, including escaped aliases, before making a projection.
// Supplied notices and unknown/private fields are never rendered as instructions.
export function parseLocalOverviewFile(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > LOCAL_REPORT_FILE_BYTES ||
      new TextEncoder().encode(raw).length > LOCAL_REPORT_FILE_BYTES) throw fail('size')
  try {
    const text = raw.replace(/^\uFEFF/, ''), value = JSON.parse(text), stack = []
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
      const token = match[0]
      if (token === '{' || token === '[') {
        stack.push(new Set()); if (stack.length > 3) throw fail()
      } else if (token === '}' || token === ']') stack.pop()
      else if (/^\s*:/.test(text.slice(match.index + token.length))) {
        const key = JSON.parse(token), seen = stack.at(-1)
        if (!seen || seen.has(key)) throw fail()
        seen.add(key)
      }
    }
    keys(value, ['format', 'version', 'generatedAtUTC', 'scope', 'readOnly', 'completeForPreview', 'notice',
      'generationTimeIsObservationTime', 'records', 'recordBytes', 'attachmentBytes', 'baseItems', 'kinds'])
    if (value.format !== 'local-notepad-local-inventory-report' || value.version !== 1 ||
        value.scope !== 'previously-read-local-observation' || value.readOnly !== true ||
        value.completeForPreview !== false || value.generationTimeIsObservationTime !== false ||
        typeof value.notice !== 'string' || value.notice.length > 1024 ||
        !Array.isArray(value.kinds) || value.kinds.length !== 4) throw fail()
    const stamp = value.generatedAtUTC
    if (typeof stamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stamp)) throw fail()
    const time = Date.parse(stamp)
    if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== stamp) throw fail()
    const kinds = value.kinds.map(row => {
      keys(row, ['kind', 'records', 'recordBytes'])
      return { kind: row.kind, records: row.records, record_bytes: row.recordBytes }
    })
    const safe = sanitizeS3LocalOverviewResult({ success: true, status: 200, code: 'OK', data: {
      format: 'local-notepad-s3-local-candidate-overview', version: 1, read_only: true,
      observed_stable: true, complete_for_preview: false, records: value.records,
      record_bytes: value.recordBytes, attachment_bytes: value.attachmentBytes, base_items: value.baseItems, kinds,
    } })
    if (!safe.success) throw fail()
    // This internal summary is a validated FILE projection only. It must not be
    // passed to a native reader, restore/sync function or a freshness indicator.
    return Object.freeze({ generatedAtUTC: stamp, source: 'untrusted-file', summary: safe.data })
  } catch { throw fail() }
}

// Own a cancellable reader, enforce byte size before I/O and an absolute deadline
// across read/UTF-8 decoding/validation. No fetch, persistence, paths or retries.
export function readLocalOverviewFile(file, { signal, timeoutMs = LOCAL_REPORT_FILE_WAIT_MS,
  readerFactory = () => new FileReader(), clock = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let reader, timer, timerReady = false, settled = false, started, deadline
    const finish = (error, data) => {
      if (settled) return
      settled = true
      if (timerReady) { try { cancel(timer) } catch {} }
      signal?.removeEventListener('abort', abort)
      if (reader) {
        reader.onload = reader.onerror = reader.onabort = null
        if (error) { try { reader.abort() } catch {} }
      }
      if (error) reject(error); else resolve(data)
    }
    const abort = () => finish(fail('aborted'))
    const stopped = () => {
      if (settled) return true
      if (signal?.aborted) { abort(); return true }
      try {
        const at = clock()
        if (!Number.isFinite(at) || at < started) throw fail('read')
        if (at >= deadline) { finish(fail('timeout')); return true }
      } catch { finish(fail('read')); return true }
      return false
    }
    try {
      if (signal !== undefined && !(signal instanceof AbortSignal)) { reject(fail('read')); return }
      if (signal?.aborted) { abort(); return }
      started = clock()
      if (!Number.isFinite(started) || started < 0 || !Number.isSafeInteger(timeoutMs) ||
          timeoutMs < 1 || timeoutMs > LOCAL_REPORT_FILE_WAIT_MS) { finish(fail('read')); return }
      deadline = started + timeoutMs
      const size = file?.size
      if (!Number.isSafeInteger(size) || size < 1 || size > LOCAL_REPORT_FILE_BYTES) { finish(fail('size')); return }
      if (stopped()) return
      reader = readerFactory()
      reader.onload = () => {
        if (stopped()) return
        try {
          const bytes = reader.result
          if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== size) { finish(fail('read')); return }
          let raw
          try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
          catch { finish(fail('encoding')); return }
          const data = parseLocalOverviewFile(raw)
          if (!stopped()) finish(null, data)
        } catch { if (!stopped()) finish(fail()) }
      }
      reader.onerror = () => { if (!stopped()) finish(fail('read')) }
      reader.onabort = abort
      signal?.addEventListener('abort', abort, { once: true })
      timer = schedule(() => finish(fail('timeout')), Math.max(1, deadline - clock()))
      timerReady = true
      if (settled) { try { cancel(timer) } catch {}; return }
      if (!stopped()) reader.readAsArrayBuffer(file)
    } catch { if (!stopped()) finish(fail('read')) }
  }).then(data => { if (signal?.aborted) throw fail('aborted'); return data })
}
