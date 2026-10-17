// Read-only quick navigation. A list row is a hint, never permission to replace
// the editor. The final navigation decision belongs to App's existing guard.
export const QUICK_TIMEOUT_MS = 10000
export const QUICK_QUERY_LIMIT = 128
export const QUICK_RESULT_LIMIT = 20
export class QuickReadError extends Error {
  constructor(code, message) { super(message); this.name = 'QuickReadError'; this.code = code }
}
const fail = (code, message) => { throw new QuickReadError(code, message) }
const flag = value => value === undefined || value === false || value === true || value === 0 || value === 1
export function quickQuery(value) {
  if (typeof value !== 'string' || Array.from(value).length > QUICK_QUERY_LIMIT || /[\u0000-\u001f\u007f]/.test(value))
    fail('query', '关键词最多 128 个字符，不能包含控制字符。')
  return value.trim()
}
function validRow(row) {
  return row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512 && !/[\u0000-\u001f\u007f]/.test(row.id) &&
    typeof row.title === 'string' && row.title.length <= 4096 &&
    ['is_folder', 'is_deleted', 'is_pinned'].every(key => flag(row[key])) &&
    (row.updated_at === undefined || Number.isSafeInteger(row.updated_at) && row.updated_at >= 0)
}
export function quickRows(value, recent = false) {
  if (!Array.isArray(value) || value.length > 200) fail('invalid', '笔记列表不完整，未采用这份结果。请重试。')
  const ids = new Set(), rows = []; let bytes = 0
  for (const row of value) {
    if (!validRow(row) || ids.has(row.id)) fail('invalid', '笔记列表身份或格式不正确，未采用这份结果。')
    ids.add(row.id)
    if (row.is_deleted || row.is_folder || row.title.startsWith('__tpl__')) continue
    if (typeof row.content !== 'string') fail('invalid', '笔记正文缺失，未采用这份结果。')
    bytes += row.content.length + row.title.length + row.id.length
    if (bytes > 8 * 1024 * 1024) fail('oversize', '快速结果过大，请使用完整检索与筛选。')
    rows.push(Object.freeze({ ...row }))
  }
  if (recent) rows.sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || (b.updated_at || 0) - (a.updated_at || 0) || a.id.localeCompare(b.id))
  return rows
}
export function quickTarget(value, id) {
  if (!validRow(value) || value.id !== id || typeof value.content !== 'string' || value.is_folder || value.is_deleted || value.title.startsWith('__tpl__'))
    fail('target', '目标笔记已变化、已删除或不是普通笔记，请刷新结果。')
  return Object.freeze({ ...value })
}
export async function boundedQuickRead(call, signal, timeout = QUICK_TIMEOUT_MS) {
  if (signal?.aborted) fail('cancelled', '已停止读取。')
  if (typeof call !== 'function' || !Number.isFinite(timeout) || timeout <= 0) fail('invalid', '读取参数无效。')
  const controller = new AbortController(), deadline = performance.now() + timeout
  let timer, onAbort
  try {
    return await new Promise((resolve, reject) => {
      let done = false
      const end = (fn, value) => { if (!done) { done = true; fn(value) } }
      onAbort = () => { end(reject, new QuickReadError('cancelled', '已停止读取。')); controller.abort() }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => { end(reject, new QuickReadError('timeout', '本机读取超时，请手动重试。')); controller.abort() }, timeout)
      Promise.resolve().then(() => {
        if (done || signal?.aborted) throw new QuickReadError('cancelled', '已停止读取。')
        return call(controller.signal)
      }).then(value => {
        if (signal?.aborted) onAbort()
        else if (performance.now() >= deadline) end(reject, new QuickReadError('timeout', '本机读取超时，请手动重试。'))
        else end(resolve, value)
      }, () => end(reject, new QuickReadError('read', '本机服务读取失败，请检查服务后重试。')))
    })
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}
export async function readQuickResults(api, search, query, signal, timeout) {
  const q = quickQuery(query)
  return quickRows(await boundedQuickRead(s => q ? search(q, { signal: s }) : api('/api/files?size=200', { signal: s }), signal, timeout), !q)
}
export async function readQuickTarget(api, id, signal, timeout) {
  if (typeof id !== 'string' || !id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) fail('target', '笔记标识无效。')
  return quickTarget(await boundedQuickRead(s => api('/api/files/' + encodeURIComponent(id), { signal: s }), signal, timeout), id)
}
