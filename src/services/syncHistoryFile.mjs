import { HISTORY_EXPORT_BYTES, HISTORY_EXPORT_LIMIT } from './syncHistoryExport.mjs'
import { historyOutcome } from './syncConflictHistory.mjs'
import { HISTORY_TIME_ALL, normalizeHistoryTimeFilter } from './syncHistoryTime.mjs'
import { selectHistoryRecords } from './syncHistorySearch.mjs'
import { summarizeHistoryRecords } from './syncHistorySummary.mjs'

const fail = (code = 'invalid') => Object.assign(new Error({
  invalid: '文件内容或记录范围不符合历史导出格式；未替换已查看的文件。',
  version: '仅支持本应用的历史 JSON v1 / v2 文件；没有导入任何数据。',
  size: '文件为空或超过 4 MiB；未读取或截断内容。',
  encoding: '文件不是有效的 UTF-8 JSON 文本。',
  read: '无法读取所选文件，请重新选择；原文件和工作区未修改。',
  timeout: '文件读取超时，请重试；下方已有结果未替换。',
  aborted: '已停止文件读取；没有取消同步或保存任务。',
}[code]), { code })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function keys(value, names) {
  if (!object(value) || Object.keys(value).length !== names.length || names.some(key => !Object.hasOwn(value, key))) throw fail()
}
function text(value, max, nonempty = false) {
  if (typeof value !== 'string' || value.length > max * 2 || [...value].length > max || (nonempty && !value)) throw fail()
  return value
}
function utc(value, nullable = false) {
  if (nullable && value === null) return 0
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw fail()
  const n = Date.parse(value)
  if (!Number.isFinite(n) || n < 0 || n > 253402300799999 || new Date(n).toISOString() !== value ||
      (nullable && (n === 0 || n % 1000 !== 0))) throw fail()
  return n / 1000
}

// Untrusted local file, not a database receipt. Validate *every* row before
// publishing one immutable projection; never display supplied notices as advice.
export function parseHistoryFile(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > HISTORY_EXPORT_BYTES ||
      new TextEncoder().encode(raw).length > HISTORY_EXPORT_BYTES) throw fail('size')
  let input
  try { input = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch { throw fail() }
  if (!object(input) || input.format !== 'local-notepad-conflict-history' || ![1, 2].includes(input.version)) throw fail('version')
  keys(input, ['format', 'version', 'exportedAtUTC', 'scope', 'filters', 'notices', 'records'])
  utc(input.exportedAtUTC)
  const scope = input.scope, filters = input.filters
  keys(scope, ['type', 'loadedCount', 'exportedCount', 'hasUnreadOlderRecords', 'sourceState', 'currentRemoteStateVerified'])
  if (scope.type !== 'loaded-filtered-history' || !Number.isSafeInteger(scope.loadedCount) ||
      !Number.isSafeInteger(scope.exportedCount) || scope.exportedCount < 1 || scope.exportedCount > HISTORY_EXPORT_LIMIT ||
      scope.loadedCount < scope.exportedCount || typeof scope.hasUnreadOlderRecords !== 'boolean' ||
      !['ready', 'error', 'stopped'].includes(scope.sourceState) || scope.currentRemoteStateVerified !== false ||
      !Array.isArray(input.records) || input.records.length !== scope.exportedCount) throw fail()
  keys(filters, ['recordStatus', 'objectType', 'outcome', 'textFilterApplied', ...(input.version === 2 ? ['completedDateUTC'] : [])])
  if (!['all', 'resolved', 'superseded'].includes(filters.recordStatus) ||
      !['all', 'file', 'tag', 'file-tag', 'attachment'].includes(filters.objectType) ||
      !['all', 'local', 'remote', 'superseded', 'unknown'].includes(filters.outcome) || typeof filters.textFilterApplied !== 'boolean') throw fail()
  let timeFilter = HISTORY_TIME_ALL
  if (input.version === 2) {
    keys(filters.completedDateUTC, ['mode', 'from', 'to'])
    try { timeFilter = normalizeHistoryTimeFilter(filters.completedDateUTC) } catch { throw fail() }
    if (timeFilter.mode === 'all' || ['mode', 'from', 'to'].some(key => timeFilter[key] !== filters.completedDateUTC[key])) throw fail()
  }
  if (!Array.isArray(input.notices) || input.notices.length > 32) throw fail()
  input.notices.forEach(value => text(value, 1024))
  const seen = new Set()
  const records = input.records.map(row => {
    keys(row, ['id', 'itemID', 'kind', 'currentTitle', 'createdAtUTC', 'completedAtUTC', 'status', 'resolution', 'outcome'])
    const id = text(row.id, 128, true), itemID = text(row.itemID, 2048, true), title = text(row.currentTitle, 255)
    if (/[\0\r\n]/.test(id) || seen.has(id) || !['file', 'tag', 'file-tag', 'attachment'].includes(row.kind) ||
        !['resolved', 'superseded'].includes(row.status) || !['local', 'remote', 'remote-rebind', 'unknown'].includes(row.resolution) ||
        (filters.recordStatus !== 'all' && row.status !== filters.recordStatus) || row.outcome !== historyOutcome(row)) throw fail()
    seen.add(id)
    return Object.freeze({ id, itemID, title, kind: row.kind, status: row.status, resolution: row.resolution,
      createdAt: utc(row.createdAtUTC, true), resolvedAt: utc(row.completedAtUTC, true) })
  })
  // Date/kind/outcome claims must match all records, not silently filter out
  // contradictory entries. Original query text is intentionally not present.
  const selected = selectHistoryRecords(records, { kind: filters.objectType, outcome: filters.outcome, timeFilter })
  if (selected.matched !== records.length) throw fail()
  return Object.freeze({ version: input.version, exportedAtUTC: input.exportedAtUTC,
    loadedCount: scope.loadedCount, hasUnreadOlderRecords: scope.hasUnreadOlderRecords, sourceState: scope.sourceState,
    filters: Object.freeze({ recordStatus: filters.recordStatus, objectType: filters.objectType,
      outcome: filters.outcome, textFilterApplied: filters.textFilterApplied, timeFilter }),
    records: Object.freeze(records), summary: summarizeHistoryRecords(records) })
}

// Bounded/cancellable local read. Read bytes so invalid UTF-8 is rejected rather
// than replaced. No fetch, filesystem path, writes, object URL or persistence.
export function readHistoryFile(file, { signal, timeoutMs = 8000, readerFactory = () => new FileReader() } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > HISTORY_EXPORT_BYTES) { reject(fail('size')); return }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) { reject(fail('read')); return }
    if (signal?.aborted) { reject(fail('aborted')); return }
    let reader, timer, settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (reader) {
        reader.onload = reader.onerror = reader.onabort = null
        if (error) { try { reader.abort() } catch {} }
      }
      if (error) reject(error); else resolve(result)
    }
    const abort = () => finish(fail('aborted'))
    try {
      reader = readerFactory()
      reader.onload = () => {
        if (settled) return
        if (signal?.aborted) { abort(); return }
        const bytes = reader.result
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) { finish(fail('read')); return }
        let raw
        try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { finish(fail('encoding')); return }
        try { finish(null, parseHistoryFile(raw)) } catch (error) { finish(error.code ? error : fail()) }
      }
      reader.onerror = () => finish(fail('read'))
      reader.onabort = abort
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => finish(fail('timeout')), timeoutMs)
      if (signal?.aborted) abort()
      else reader.readAsArrayBuffer(file)
    } catch { finish(fail('read')) }
  })
}
