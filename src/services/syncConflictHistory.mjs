// Read-only history projection. No titles/content/errors from any other API,
// no persistence, resolving, restoring, polling or synchronization callbacks.
const FILTERS = new Set(['all', 'resolved', 'superseded'])
const KINDS = new Set(['file', 'tag', 'file-tag', 'attachment'])
const RESOLUTIONS = new Set(['local', 'remote', 'remote-rebind', 'unknown'])
const maxTime = 253402300799
const validText = (value, max) => typeof value === 'string' && value.length <= max * 2 && [...value].length <= max
const validCursor = value => value === '' || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,1024}$/.test(value))
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= maxTime
const invalid = () => Object.assign(new Error('记录响应无效，未替换已读取的记录。'), { code: 'invalid' })
export function conflictHistoryURL(filter = 'all', cursor = '') {
  if (!FILTERS.has(filter) || !validCursor(cursor)) throw invalid()
  const params = new URLSearchParams({ filter, limit: '25' })
  if (cursor) params.set('before', cursor)
  return '/api/sync/conflicts/history?' + params.toString()
}
export function parseConflictHistory(value, filter = 'all') {
  if (!FILTERS.has(filter) || value?.version !== 1 || value?.scope !== 'local-workspace' || value?.filter !== filter ||
      !Array.isArray(value.items) || value.items.length > 25 || typeof value.has_more !== 'boolean' ||
      !validCursor(value.next_cursor) || value.has_more !== (value.next_cursor !== '') ||
      (value.has_more && value.items.length === 0)) throw invalid()
  const ids = new Set()
  const items = value.items.map(row => {
    if (!row || !validText(row.id,128) || !row.id || /[\0\r\n]/.test(row.id) || ids.has(row.id) ||
        !validText(row.item_id,2048) || !row.item_id || !validText(row.current_title,255) ||
        !KINDS.has(row.kind) || !['resolved','superseded'].includes(row.status) ||
        (filter !== 'all' && row.status !== filter) || !RESOLUTIONS.has(row.resolution) ||
        !timestamp(row.created_at) || !timestamp(row.resolved_at)) throw invalid()
    ids.add(row.id)
    return Object.freeze({ id: row.id, itemID: row.item_id, kind: row.kind, title: row.current_title,
      createdAt: row.created_at, resolvedAt: row.resolved_at, status: row.status, resolution: row.resolution })
  })
  // Completion timestamps must be descending. IDs are SQL binary-collated; do
  // not substitute the browser's locale sort order for the server's tie-breaker.
  if (items.some((row,i) => i > 0 && row.resolvedAt > items[i-1].resolvedAt)) throw invalid()
  return Object.freeze({ filter, items: Object.freeze(items), nextCursor: value.next_cursor, hasMore: value.has_more })
}
export function appendConflictHistory(previous, page) {
  if (!previous || previous.filter !== page.filter || !previous.hasMore) throw invalid()
  const ids = new Set(previous.items.map(row => row.id))
  if (page.items.some(row => ids.has(row.id)) || (page.items.length && previous.items.length &&
      page.items[0].resolvedAt > previous.items[previous.items.length-1].resolvedAt) ||
      (page.hasMore && page.nextCursor === previous.nextCursor)) throw invalid()
  return Object.freeze({ ...page, items: Object.freeze([...previous.items, ...page.items]) })
}
export function historyTime(value) {
  return timestamp(value) && value > 0 ? new Date(value * 1000).toISOString() : ''
}
export function historyOutcome(row) {
  if (row?.status === 'superseded') return row.resolution === 'remote-rebind' ? '重新绑定后失效；不代表已选边' : '已被后续状态取代；不代表已选边'
  if (row?.status === 'resolved' && row.resolution === 'local') return '当时保留本机版本'
  if (row?.status === 'resolved' && row.resolution === 'remote') return '当时采用远端版本'
  return '当时的处理方式未核实'
}
export async function readConflictHistory(load, { filter = 'all', cursor = '', signal, timeoutMs = 8000 } = {}) {
  const url = conflictHistoryURL(filter, cursor)
  if (typeof load !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw invalid()
  const controller = new AbortController()
  let timer, rejectStop
  const stopped = new Promise((_, reject) => { rejectStop = reject })
  const stop = code => {
    controller.abort()
    rejectStop(Object.assign(new Error(code === 'timeout' ? '读取超时' : '已停止读取'), { code }))
  }
  const abort = () => stop('aborted')
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) { abort(); return await stopped }
    timer = setTimeout(() => stop('timeout'), timeoutMs)
    // Attach to both branches so late resolutions/rejections cannot escape.
    const loaded = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw Object.assign(new Error('已停止读取'), { code: 'aborted' })
      return load(url, { method: 'GET', signal: controller.signal })
    })
    const result = await Promise.race([loaded, stopped])
    if (controller.signal.aborted) throw Object.assign(new Error('已停止读取'), { code: 'aborted' })
    return parseConflictHistory(result, filter)
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort)
  }
}
