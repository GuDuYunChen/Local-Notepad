import { searchLibrary, searchParameters, validateSearchResponse, SEARCH_PAGE_SIZE, SEARCH_SOURCES, SEARCH_KINDS } from './globalSearch'

export const MAX_SEARCH_EXPORT_ITEMS = 2000
export const MAX_SEARCH_EXPORT_BYTES = 8 * 1024 * 1024
export const SEARCH_EXPORT_TIMEOUT = 120000
const changed = () => new Error('检索范围或资料库已变化，请重新检索并选择；未生成部分清单')
const abort = signal => { if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError') }
function cancellableRequest(task, signal) {
  // Fetch normally observes AbortSignal; also reject promptly if a transport
  // adapter ignores it. A late resolve/reject is handled, never published.
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(new DOMException('已取消导出', 'AbortError')) }
    const cleanup = () => signal.removeEventListener('abort', stop)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) { stop(); return }
    try {
      Promise.resolve(task()).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    } catch (error) { cleanup(); reject(error) }
  })
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Page, return anchors and server revisions are not search criteria.
export function searchExportFilterKey(filters) {
  const params = searchParameters({ ...filters, page: 1, revision: '', anchorId: '' })
  return params.toString()
}

export function createSearchExportScope(filters, response) {
  validateSearchResponse(response)
  const params = new URLSearchParams(searchExportFilterKey(filters))
  if (response.query !== params.get('q') || response.page_size !== SEARCH_PAGE_SIZE ||
    !Object.hasOwn(SEARCH_SOURCES, params.get('source')) ||
    !['relevance', 'updated', 'title'].includes(params.get('sort')) ||
    !Number.isSafeInteger(Number(params.get('since'))) || Number(params.get('since')) < 0) throw changed()
  const criteria = {
    query: response.query, source: params.get('source'), folderId: params.get('folder_id'),
    pinned: params.get('pinned') === '1', matchCase: params.get('match_case') === '1',
    since: Number(params.get('since')), sort: params.get('sort'),
  }
  return freeze({ criteria, revision: response.revision, total: response.total,
    pages: response.pages, pageSize: response.page_size, totalOccurrences: response.total_occurrences,
    scanned: response.scanned, unsupported: response.unsupported,
    folderLabel: criteria.folderId ? response.folders.find(folder => folder.id === criteria.folderId)?.label || criteria.folderId : '全部目录与项目',
  })
}

function assertPage(data, scope, page) {
  validateSearchResponse(data)
  if (data.page !== page || data.page_size !== scope.pageSize || data.pages !== scope.pages ||
    data.revision !== scope.revision || data.query !== scope.criteria.query || data.total !== scope.total ||
    data.total_occurrences !== scope.totalOccurrences || data.scanned !== scope.scanned ||
    data.unsupported !== scope.unsupported) throw changed()
}

function reportItem(item, includeSnippets) {
  // Whitelist: never export raw content, editor offsets, return tokens or URLs.
  const result = { id: item.id, title: item.title, folderPath: item.folder_path,
    updatedAt: item.updated_at, pinned: item.is_pinned, titleMatch: item.title_match,
    bodyOccurrences: item.body_count, contentSHA256: item.content_sha256 }
  if (includeSnippets) result.snippets = item.snippets.map(snippet => ({
    kind: snippet.kind, before: snippet.before, match: snippet.match, after: snippet.after,
    leading: snippet.leading, trailing: snippet.trailing,
  }))
  return result
}

// Re-read only selected pages, or all pages for a complete export. Every request
// carries the same revision. Failure/abort/overflow returns no partial report.
export async function collectSearchResultReport(filters, response, options = {}) {
  const scope = createSearchExportScope(filters, response)
  const mode = options.mode || 'selected'
  if (!['selected', 'all'].includes(mode)) throw new Error('请选择所选结果或全部结果')
  const selected = options.selection || []
  const chosen = new Map()
  if (mode === 'selected') {
    if (!Array.isArray(selected)) throw new Error('导出选择无效')
    for (const entry of selected) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || chosen.has(entry.id) ||
        !Number.isSafeInteger(entry.page) || entry.page < 1 || entry.page > scope.pages ||
        typeof entry.contentSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentSHA256)) throw changed()
      chosen.set(entry.id, { ...entry })
    }
  }
  const count = mode === 'all' ? scope.total : chosen.size
  if (!count) throw new Error('没有可导出的结果，请先选择笔记')
  if (count > MAX_SEARCH_EXPORT_ITEMS) throw new Error(`单次最多导出 ${MAX_SEARCH_EXPORT_ITEMS} 篇，请缩小范围；没有截断结果`)
  const pages = mode === 'all' ? Array.from({ length: scope.pages }, (_, i) => i + 1) : [...new Set([...chosen.values()].map(entry => entry.page))].sort((a, b) => a - b)
  const controller = new AbortController()
  let timedOut = false
  const relay = () => controller.abort()
  options.signal?.addEventListener('abort', relay, { once: true })
  if (options.signal?.aborted) relay()
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, SEARCH_EXPORT_TIMEOUT)
  const request = options.request || searchLibrary
  const read = async page => {
    abort(controller.signal)
    const result = await cancellableRequest(() => request({ ...scope.criteria, page, revision: scope.revision, anchorId: '' }, controller.signal), controller.signal)
    abort(controller.signal)
    assertPage(result, scope, page)
    return result
  }
  try {
    const items = [], seen = new Set()
    let bytes = 0
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]
      const data = await read(page)
      for (const item of data.items) {
        if (seen.has(item.id)) throw changed()
        seen.add(item.id)
        if (mode === 'selected' && !chosen.has(item.id)) continue
        if (mode === 'selected' && (chosen.get(item.id).page !== page || chosen.get(item.id).contentSHA256 !== item.content_sha256)) throw changed()
        const row = reportItem(item, options.includeSnippets === true)
        bytes += new TextEncoder().encode(JSON.stringify(row)).length
        if (bytes > MAX_SEARCH_EXPORT_BYTES) throw new Error('清单超过 8 MiB，请减少选择或关闭节选；未生成部分清单')
        items.push(row)
      }
      options.onProgress?.({ completed: index + 1, total: pages.length, phase: 'collect' })
    }
    if (items.length !== count) throw changed()
    const exportedBodyOccurrences = items.reduce((sum, item) => sum + item.bodyOccurrences, 0)
    if (!Number.isSafeInteger(exportedBodyOccurrences) || exportedBodyOccurrences > scope.totalOccurrences ||
      (mode === 'all' && exportedBodyOccurrences !== scope.totalOccurrences)) throw changed()
    // Recheck after the last page, including single-page/selected-only exports.
    options.onProgress?.({ completed: pages.length, total: pages.length, phase: 'verify' })
    await read(pages[0])
    abort(controller.signal)
    const now = options.now || new Date()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('导出时间无效')
    return freeze({ format: 'local-notepad-search-results', version: 1, exportedAt: now.toISOString(),
      mode, includeSnippets: options.includeSnippets === true, scope, count,
      exportedBodyOccurrences, items })
  } catch (failure) {
    if (timedOut) throw new Error('清单准备超过两分钟，请缩小检索范围后重试；未生成部分清单')
    abort(controller.signal)
    throw failure
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', relay)
  }
}

// Encode punctuation so source text cannot create links, headings, HTML or fences.
const literal = value => String(value ?? '').replace(/\r\n?|\n/g, ' ').replace(/[&<>"'`*_\[\]{}()#!|\\~:+.=\-/]/g, ch => '&#' + ch.charCodeAt(0) + ';')
const isoDate = value => {
  const date = new Date(value * 1000)
  return value > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : '未知'
}
export function serializeSearchResultReport(report, format = 'markdown') {
  let raw
  if (format === 'json') raw = JSON.stringify(report, null, 2) + '\n'
  else if (format === 'markdown') {
    const { scope } = report
    const lines = ['# 检索结果清单', '', `导出时间（UTC）：${report.exportedAt}`, '',
      `范围：${report.mode === 'all' ? '全部匹配结果' : '手动选择的结果'} · ${report.count} 篇 / 范围内 ${scope.total} 篇`,
      `关键词：${scope.criteria.query ? literal(scope.criteria.query) : '（空，浏览笔记）'}`,
      `目录：${literal(scope.folderLabel)} · 目录 ID：${literal(scope.criteria.folderId || '（全部）')}`,
      `命中位置：${SEARCH_SOURCES[scope.criteria.source]} · 仅置顶：${scope.criteria.pinned ? '是' : '否'} · 区分大小写：${scope.criteria.matchCase ? '是' : '否'}`,
      `修改时间起点（UTC）：${scope.criteria.since ? isoDate(scope.criteria.since) : '不限'} · 排序：${{ relevance: '标题优先', updated: '最近修改', title: '标题顺序' }[scope.criteria.sort]}`,
      `检索版本：${scope.revision}`, '',
      `已导出笔记的正文命中：${report.exportedBodyOccurrences} 处；整个范围：${scope.totalOccurrences} 处。标题命中另行标记。`,
      `当前范围扫描 ${scope.scanned} 篇；${scope.unsupported} 篇正文格式未能解析，正文结果可能不完整。`, '',
      report.includeSnippets ? '已包含用户明确选择的命中节选，每篇最多 3 段，不是全文或全部命中。' : '仅导出结果元数据，不包含正文或命中节选。',
      '只记录已保存数据的检索快照，不是笔记备份；不包含草稿、回收站、模板、核对记录或外部附件。', '']
    for (const [index, item] of report.items.entries()) {
      lines.push(`## ${index + 1}. ${literal(item.title)}`, '', `笔记 ID：${literal(item.id)}`, `目录：${literal(item.folderPath)}`,
        `修改时间（UTC）：${isoDate(item.updatedAt)} · 置顶：${item.pinned ? '是' : '否'}`,
        `标题命中：${item.titleMatch ? '是' : '否'} · 正文命中：${item.bodyOccurrences} 处`, `正文指纹：${item.contentSHA256}`, '')
      if (report.includeSnippets) {
        for (const [number, snippet] of item.snippets.entries()) lines.push(`节选 ${number + 1} · ${SEARCH_KINDS[snippet.kind]}`, '',
          '> ' + literal((snippet.leading ? '…' : '') + snippet.before + snippet.match + snippet.after + (snippet.trailing ? '…' : '')), '')
        if (item.bodyOccurrences > item.snippets.length) lines.push(`还有 ${item.bodyOccurrences - item.snippets.length} 处命中未附节选。`, '')
      }
    }
    raw = lines.join('\n') + '\n'
  } else throw new Error('不支持的导出格式')
  if (new TextEncoder().encode(raw).length > MAX_SEARCH_EXPORT_BYTES) throw new Error('导出文件超过 8 MiB，请减少选择或关闭节选；未下载部分文件')
  return raw
}

export function downloadSearchResultReport(report, format) {
  const raw = serializeSearchResultReport(report, format)
  const extension = format === 'json' ? 'json' : 'md'
  const name = `Local-Notepad-检索清单-${report.exportedAt.replace(/[:.]/g, '-')}.${extension}`
  const url = URL.createObjectURL(new Blob([raw], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url; link.download = name; link.hidden = true
    document.body.append(link); link.click()
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  // This reports a download request, not a verified filesystem write.
  return name
}
