import { searchLibrary, validateSearchResponse } from './globalSearch'
import { collectSearchResultReport, createSearchExportScope, SEARCH_EXPORT_TIMEOUT } from './searchResultExport'

export const SEARCH_COLLECTION_PREFIX = 'localNotepad.searchCollection.v1:'
export const MAX_SEARCH_COLLECTIONS = 40
export const MAX_COLLECTION_ITEMS = 2000
export const MAX_COLLECTION_BYTES = 2 * 1024 * 1024
const fail = message => { throw new Error(message || '资料集格式无效或版本不支持，原记录未改动') }
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const natural = value => Number.isSafeInteger(value) && value >= 0
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const string = (value, max, empty = true) => {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) fail()
  return value
}
const date = value => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail()
  return value
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const bounded = raw => {
  if (typeof raw !== 'string' || raw.length > MAX_COLLECTION_BYTES || new TextEncoder().encode(raw).length > MAX_COLLECTION_BYTES) fail('资料集超过 2 MiB，未截断或写入')
  return raw
}
export function collectionName(value) {
  const name = string(value, 192, false).normalize('NFC').trim()
  if (Array.from(name).length > 48) fail('资料集名称最多 48 个字符')
  return name
}

// Whitelist metadata. Neither stored collections nor their JSON backups contain
// manuscript, excerpts, editor selections, runtime tokens or arbitrary fields.
export function copyCollectionReport(input, allowEmpty = false) {
  if (!record(input) || input.format !== 'local-notepad-search-results' || input.version !== 1 ||
      !['selected', 'all'].includes(input.mode) || input.includeSnippets !== false || !record(input.scope)) fail()
  const scope = input.scope, criteria = scope.criteria
  if (!record(criteria) || !['all', 'title', 'body'].includes(criteria.source) ||
      !['relevance', 'updated', 'title'].includes(criteria.sort) || !natural(criteria.since) ||
      typeof criteria.pinned !== 'boolean' || typeof criteria.matchCase !== 'boolean') fail()
  const cleanCriteria = { query: string(criteria.query, 512), source: criteria.source,
    folderId: string(criteria.folderId, 512), pinned: criteria.pinned, matchCase: criteria.matchCase,
    since: criteria.since, sort: criteria.sort }
  if (Array.from(cleanCriteria.query).length > 128 || cleanCriteria.query !== cleanCriteria.query.normalize('NFC').trim()) fail()
  if (!digest(scope.revision) || !['total', 'pages', 'totalOccurrences', 'scanned', 'unsupported'].every(key => natural(scope[key])) ||
      scope.pageSize !== 20 || scope.pages !== Math.max(1, Math.ceil(scope.total / 20)) || scope.total > scope.scanned || scope.unsupported > scope.scanned ||
      !natural(input.count) || input.count > MAX_COLLECTION_ITEMS || (!allowEmpty && !input.count) || input.count > scope.total ||
      (input.mode === 'all' && input.count !== scope.total) || !Array.isArray(input.items) || input.items.length !== input.count) fail()
  const ids = new Set()
  const items = input.items.map(item => {
    if (!record(item) || !natural(item.updatedAt) || !natural(item.bodyOccurrences) ||
        typeof item.pinned !== 'boolean' || typeof item.titleMatch !== 'boolean' || !digest(item.contentSHA256)) fail()
    const id = string(item.id, 512, false)
    if (ids.has(id)) fail('资料集中有重复笔记标识，未合并或截断')
    ids.add(id)
    return { id, title: string(item.title, 16384), folderPath: string(item.folderPath, 32768), updatedAt: item.updatedAt,
      pinned: item.pinned, titleMatch: item.titleMatch, bodyOccurrences: item.bodyOccurrences, contentSHA256: item.contentSHA256 }
  })
  const occurrences = items.reduce((sum, item) => sum + item.bodyOccurrences, 0)
  if (!natural(occurrences) || occurrences !== input.exportedBodyOccurrences || occurrences > scope.totalOccurrences ||
      (input.mode === 'all' && occurrences !== scope.totalOccurrences)) fail()
  const clean = { format: input.format, version: 1, exportedAt: date(input.exportedAt), mode: input.mode, includeSnippets: false,
    scope: { criteria: cleanCriteria, revision: scope.revision, total: scope.total, pages: scope.pages, pageSize: 20,
      totalOccurrences: scope.totalOccurrences, scanned: scope.scanned, unsupported: scope.unsupported,
      folderLabel: string(scope.folderLabel, 32768) }, count: items.length, exportedBodyOccurrences: occurrences, items }
  bounded(JSON.stringify(clean))
  return freeze(clean)
}
export function readSearchCollection(raw) {
  const value = JSON.parse(bounded(raw).replace(/^\uFEFF/, ''))
  if (!record(value) || value.format !== 'local-notepad-search-collection' || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,96}$/.test(value.id)) fail()
  return freeze({ format: value.format, version: 1, id: value.id, name: collectionName(value.name),
    savedAt: date(value.savedAt), report: copyCollectionReport(value.report) })
}
export function createSearchCollectionStore({ storage = () => globalThis.localStorage,
  createId = () => globalThis.crypto.randomUUID(), now = () => new Date() } = {}) {
  const listeners = new Set()
  const publish = () => { for (const callback of [...listeners]) { try { callback() } catch { /* a view failure is not a failed write */ } } }
  function db() {
    const value = storage()
    if (!value || !['getItem', 'setItem', 'key', 'removeItem'].every(key => typeof value[key] === 'function')) fail('本地资料集存储不可用')
    return value
  }
  function list() {
    try {
      const storage = db(), keys = []
      for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(SEARCH_COLLECTION_PREFIX)) keys.push(key) }
      const entries = keys.map(key => {
        const raw = storage.getItem(key)
        try {
          const collection = readSearchCollection(raw)
          if (key !== SEARCH_COLLECTION_PREFIX + collection.id) fail()
          return { key, raw, collection, error: '' }
        } catch { return { key, raw, collection: null, error: '此资料集损坏或版本不支持，原记录保留' } }
      }).sort((a, b) => (b.collection?.savedAt || '').localeCompare(a.collection?.savedAt || '') || a.key.localeCompare(b.key))
      return { entries, error: '' }
    } catch { return { entries: [], error: '无法读取本地资料集，不能据此判断没有记录；可刷新重试' } }
  }
  function readUnchanged(entry) {
    if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith(SEARCH_COLLECTION_PREFIX)) fail()
    const raw = db().getItem(entry.key)
    if (raw === null || raw !== entry.raw) fail('资料集已被更改或删除，请重新选择')
    return raw
  }
  function save(name, report) {
    const label = collectionName(name), clean = copyCollectionReport(report), shelf = list()
    if (shelf.error) fail(shelf.error)
    if (shelf.entries.length >= MAX_SEARCH_COLLECTIONS) fail('最多保留 40 份资料集，请先备份并手动清理；不会自动淘汰')
    const id = createId(), raw = bounded(JSON.stringify({ format: 'local-notepad-search-collection', version: 1,
      id, name: label, savedAt: now().toISOString(), report: clean }))
    const value = readSearchCollection(raw), storage = db(), key = SEARCH_COLLECTION_PREFIX + id
    if (storage.getItem(key) !== null) fail('资料集标识冲突，没有覆盖已有记录')
    try { storage.setItem(key, raw) } catch { fail('资料集保存失败，可能空间不足或权限受限；原选择仍保留') }
    publish(); return value
  }
  return { list, save, readUnchanged,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    remove(entry) { readUnchanged(entry); db().removeItem(entry.key); publish() },
    export(entry) { return JSON.stringify(readSearchCollection(readUnchanged(entry))) },
    importCopy(raw) { const value = readSearchCollection(raw); return save(value.name, value.report) },
  }
}
export const searchCollections = createSearchCollectionStore()

// Recheck against the *original fixed criteria*. Absence means outside the query,
// not proof of deletion. Extra matches for a selected subset are not "new notes".
export function compareSearchCollection(collection, currentReport) {
  const old = copyCollectionReport(collection.report), current = copyCollectionReport(currentReport, true)
  if (JSON.stringify(old.scope.criteria) !== JSON.stringify(current.scope.criteria) || current.mode !== 'all') fail('复查范围不一致，未生成部分变化清单')
  const byId = new Map(current.items.map(item => [item.id, item])), oldIds = new Set(old.items.map(item => item.id))
  const rows = old.items.map(before => {
    const after = byId.get(before.id) || null
    const reasons = []
    if (after) {
      if (after.contentSHA256 !== before.contentSHA256) reasons.push('正文变化')
      if (after.title !== before.title) reasons.push('标题变化')
      if (after.folderPath !== before.folderPath) reasons.push('目录变化')
      if (after.updatedAt !== before.updatedAt) reasons.push('修改时间变化')
      if (after.pinned !== before.pinned) reasons.push('置顶变化')
      if (after.bodyOccurrences !== before.bodyOccurrences || after.titleMatch !== before.titleMatch) reasons.push('命中变化')
    }
    return { id: before.id, before, current: after,
      status: !after ? 'outside' : reasons.includes('正文变化') ? 'body' : reasons.length ? 'metadata' : 'unchanged', reasons }
  })
  const counts = { unchanged: 0, body: 0, metadata: 0, outside: 0 }
  rows.forEach(row => counts[row.status]++)
  return freeze({ checkedAt: current.exportedAt, revision: current.scope.revision, rows, counts,
    otherMatches: current.items.filter(item => !oldIds.has(item.id)).length, currentReport: current })
}
function wait(task, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(new DOMException('已取消资料集复查', 'AbortError')) }
    const cleanup = () => signal.removeEventListener('abort', stop)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) { stop(); return }
    Promise.resolve().then(task).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
export async function checkSearchCollection(collection, options = {}) {
  const old = copyCollectionReport(collection.report), criteria = old.scope.criteria
  const controller = new AbortController(), relay = () => controller.abort()
  let timedOut = false
  options.signal?.addEventListener('abort', relay, { once: true })
  if (options.signal?.aborted) relay()
  const timer = setTimeout(() => { timedOut = true; relay() }, SEARCH_EXPORT_TIMEOUT)
  const request = options.request || searchLibrary
  try {
    const first = validateSearchResponse(await wait(() => request({ ...criteria, page: 1, revision: '', anchorId: '' }, controller.signal), controller.signal))
    const scope = createSearchExportScope(criteria, first)
    if (first.page !== 1) fail('复查页号不一致')
    if (criteria.folderId && !first.folders.some(folder => folder.id === criteria.folderId)) fail('原检索目录已不可用；未扩大范围，也未将条目标成已删除')
    if (scope.total > MAX_COLLECTION_ITEMS) fail('当前匹配超过 2000 篇，暂不能完整复查；历史资料集保留，没有截断结果')
    let current
    if (scope.total) current = await collectSearchResultReport(criteria, first, { mode: 'all', includeSnippets: false,
      signal: controller.signal, request, now: options.now, onProgress: options.onProgress })
    else {
      const last = validateSearchResponse(await wait(() => request({ ...criteria, page: 1, revision: scope.revision, anchorId: '' }, controller.signal), controller.signal))
      if (last.page !== 1 || JSON.stringify(createSearchExportScope(criteria, last)) !== JSON.stringify(scope)) fail('资料库已变化，请重新复查')
      current = { format: 'local-notepad-search-results', version: 1, mode: 'all', includeSnippets: false,
        exportedAt: (options.now || new Date()).toISOString(), scope, count: 0, exportedBodyOccurrences: 0, items: [] }
    }
    if (controller.signal.aborted) throw new DOMException('已取消资料集复查', 'AbortError')
    return compareSearchCollection(collection, current)
  } catch (error) {
    if (timedOut) fail('资料集复查超过两分钟，未生成部分结果；历史记录保留')
    throw error
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', relay) }
}
export function downloadSearchCollection(raw, name) {
  const value = readSearchCollection(raw)
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url; link.download = `Local-Notepad-资料集-${value.id}.json`; link.hidden = true
    document.body.append(link); link.click()
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return name || value.name
}
