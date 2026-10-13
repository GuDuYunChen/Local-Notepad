// A history row is a previous snapshot, never evidence of the current body.
export const HISTORY_TIMEOUT_MS = 10000
export const HISTORY_PREVIEW_PAGE = 4000
export class HistoryError extends Error {
  constructor(code, message) { super(message); this.name = 'HistoryError'; this.code = code }
}
const fail = (code, text) => { throw new HistoryError(code, text) }
export function validateHistoryRows(value, fileId) {
  // The production Go DAO returns a nil slice (JSON null) for no snapshots.
  if (value === null) value = []
  if (typeof fileId !== 'string' || !fileId || !Array.isArray(value) || value.length > 50)
    fail('invalid-list', '历史记录格式不正确，未采用这份列表。')
  const ids = new Set()
  return value.map(row => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) ||
        row.file_id !== fileId || typeof row.title !== 'string' || typeof row.content !== 'string' ||
        !Number.isSafeInteger(row.created_at) || row.created_at < 0)
      fail('invalid-list', '历史记录格式或所属笔记不正确，未采用这份列表。')
    ids.add(row.id)
    return Object.freeze({ id: row.id, file_id: row.file_id, title: row.title,
      content: row.content, created_at: row.created_at })
  }).sort((a, b) => b.created_at - a.created_at || b.id - a.id)
}
export function sameHistoryVersion(a, b) {
  return !!a && !!b && ['id', 'file_id', 'title', 'content', 'created_at'].every(key => a[key] === b[key])
}
export function formatHistoryTime(ts) {
  const d = new Date(ts * 1000)
  return ts > 0 && Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }) : '时间未知'
}
export function historyPreview(text, page = 0) {
  const chars = Array.from(String(text ?? ''))
  const pages = Math.max(1, Math.ceil(chars.length / HISTORY_PREVIEW_PAGE))
  const index = Math.min(pages - 1, Math.max(0, Math.trunc(Number(page) || 0)))
  return { text: chars.slice(index * HISTORY_PREVIEW_PAGE, (index + 1) * HISTORY_PREVIEW_PAGE).join(''),
    total: chars.length, page: index, pages }
}
export async function readVersionHistory(api, fileId, signal, timeout = HISTORY_TIMEOUT_MS) {
  if (typeof fileId !== 'string' || !fileId || signal?.aborted)
    fail('cancelled', '本次读取已取消。')
  if (!Number.isFinite(timeout) || timeout <= 0) fail('invalid-timeout', '读取预算无效。')
  const ctl = new AbortController(), deadline = performance.now() + timeout
  let timer, abort
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false
      const end = (fn, value) => { if (!settled) { settled = true; fn(value) } }
      abort = () => { end(reject, new HistoryError('cancelled', '本次读取已取消。')); ctl.abort() }
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => {
        end(reject, new HistoryError('timeout', '读取历史超时，请手动重试。')); ctl.abort()
      }, timeout)
      // Defer the call but check cancellation again BEFORE sending it.
      Promise.resolve().then(() => {
        if (signal?.aborted || ctl.signal.aborted) throw new HistoryError('cancelled', '本次读取已取消。')
        return api('/api/files/' + encodeURIComponent(fileId) + '/versions', { signal: ctl.signal })
      }).then(value => performance.now() >= deadline ? end(reject, new HistoryError('timeout', '读取历史超时，请手动重试。')) : end(resolve, value), () => end(reject, new HistoryError('read-failed', '读取历史失败，当前笔记未被改动。请检查本机服务后重试。')))
    })
    if (signal?.aborted) fail('cancelled', '本次读取已取消。')
    return validateHistoryRows(result, fileId)
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort)
  }
}
export function historyRestoreBlock(state, fileId) {
  if (!state || state.id !== fileId || !state.ready) return '当前笔记尚未加载完成，暂时不能恢复。'
  if (state.pending || state.uncertain) return '当前保存尚未确认或存在冲突，请先在编辑器中完成保存或处理冲突。'
  if (state.content !== state.saved) return '当前笔记有未保存修改，请先保存；不会直接覆盖你的草稿。'
  return ''
}
export function captureHistoryReview(state, version) {
  const issue = historyRestoreBlock(state, version?.file_id)
  if (issue) fail('editor-blocked', issue)
  validateHistoryRows([version], state.id)
  return Object.freeze({ id: state.id, generation: state.generation, boundary: state.boundary,
    revision: state.revision, content: state.content, saved: state.saved })
}
export function assertHistoryReview(state, version, reviewed, signal) {
  if (signal?.aborted) fail('cancelled', '已取消，未恢复正文。')
  const issue = historyRestoreBlock(state, version?.file_id)
  if (issue) fail('editor-blocked', issue)
  if (!reviewed || !['id', 'generation', 'boundary', 'revision', 'content', 'saved'].every(key => state[key] === reviewed[key]))
    fail('review-changed', '笔记或正文已变化，原确认已失效。请重新检查后再恢复。')
  validateHistoryRows([version], state.id)
}
export async function restoreEditorHistory(adapter, version, reviewed, signal) {
  // No asynchronous gap between the final check and adoption into the ORIGINAL
  // editor. SaveEditor supplies the atomic before-snapshot and compare-and-save.
  assertHistoryReview(adapter.snapshot(), version, reviewed, signal)
  if (version.content === reviewed.content) return { id: version.file_id, content: version.content, unchanged: true }
  adapter.replace(version.content)
  const receipt = await adapter.save()
  if (!receipt || receipt.id !== version.file_id || receipt.content !== version.content)
    fail('save-unconfirmed', '恢复保存未确认。历史正文保留为草稿，请在编辑器中核对或重试原保存。')
  return { id: receipt.id, content: receipt.content, unchanged: false }
}
