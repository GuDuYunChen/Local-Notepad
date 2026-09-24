import { api } from './api'
import { createTextEvidenceTarget } from '../components/Editor/utils/evidenceNavigationUtils'

export const SEARCH_PAGE_SIZE = 20
export const SEARCH_SOURCES = { all: '标题和正文', title: '仅标题', body: '仅正文' }
export const SEARCH_KINDS = { body: '普通正文', code: '代码', link: '链接标签', image: '图片说明', formula: '公式源码' }
const integer = value => Number.isSafeInteger(value) && value >= 0
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export function searchParameters(filters) {
  const query = String(filters.query || '').normalize('NFC').trim()
  if (Array.from(query).length > 128) throw new Error('关键词最多 128 个字符')
  const params = new URLSearchParams({
    q: query, source: filters.source || 'all', folder_id: filters.folderId || '',
    pinned: filters.pinned ? '1' : '0', match_case: filters.matchCase ? '1' : '0',
    since: String(filters.since || 0), sort: filters.sort || 'relevance',
    page: String(filters.page || 1), size: String(SEARCH_PAGE_SIZE),
  })
  if (filters.anchorId) {
    if (typeof filters.anchorId !== 'string' || filters.anchorId.length > 512 || filters.anchorId.includes('\0')) throw new Error('返回笔记标识无效')
    params.set('anchor_id', filters.anchorId)
  }
  if (filters.revision) params.set('revision', filters.revision)
  return params
}

export function validateSearchResponse(value) {
  const fail = () => { throw new Error('检索回执不完整，请更新后端或重新搜索') }
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.folders) ||
    !['total', 'total_occurrences', 'page', 'pages', 'page_size', 'scanned', 'unsupported'].every(key => integer(value[key])) ||
    !hash(value.revision) || typeof value.query !== 'string' || value.page < 1 || value.pages < 1 ||
    value.page > value.pages || value.page_size < 1 || value.page_size > 50 ||
    value.pages !== Math.max(1, Math.ceil(value.total / value.page_size)) ||
    value.items.length !== Math.min(value.page_size, value.total - (value.page - 1) * value.page_size) ||
    value.total > value.scanned || value.unsupported > value.scanned) fail()
  if (value.cache_hits !== undefined || value.parsed !== undefined) {
    if (!integer(value.cache_hits) || !integer(value.parsed) || value.cache_hits + value.parsed > value.scanned) fail()
  }
  const ids = new Set()
  for (const item of value.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.title !== 'string' ||
      typeof item.folder_path !== 'string' || !integer(item.updated_at) || typeof item.is_pinned !== 'boolean' ||
      typeof item.title_match !== 'boolean' || !integer(item.body_count) || !hash(item.content_sha256) ||
      !Array.isArray(item.snippets) || item.snippets.length > 3 || item.snippets.length > item.body_count) fail()
    ids.add(item.id)
    for (const snippet of item.snippets) {
      if (!snippet || !Object.hasOwn(SEARCH_KINDS, snippet.kind) ||
        !['before', 'match', 'after'].every(key => typeof snippet[key] === 'string') || !snippet.match ||
        !integer(snippet.start) || !integer(snippet.end) || snippet.start >= snippet.end ||
        typeof snippet.leading !== 'boolean' || typeof snippet.trailing !== 'boolean') fail()
    }
  }
  const folderIds = new Set()
  for (const folder of value.folders) {
    if (!folder || typeof folder.id !== 'string' || !folder.id || folderIds.has(folder.id) || typeof folder.label !== 'string') fail()
    folderIds.add(folder.id)
  }
  return value
}

export async function searchLibrary(filters, signal) {
  const data = validateSearchResponse(await api('/api/search?' + searchParameters(filters), { signal }))
  if (filters.anchorId && (data.anchor_id !== filters.anchorId || typeof data.anchor_found !== 'boolean' ||
    data.anchor_found !== data.items.some(item => item.id === filters.anchorId))) {
    throw new Error('后端未提供有效的原结果回执，请更新后端或重新检索；没有猜测返回位置')
  }
  return data
}

// Never interpret a query as HTML, a regular expression, or an FTS operator.
export function searchTitleSegments(title, query, matchCase = false) {
  const source = String(title || '').normalize('NFC')
  const needle = String(query || '').normalize('NFC').trim()
  if (!needle) return [{ text: source, match: false }]
  const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu')
  let cursor = 0
  const result = []
  for (const hit of source.matchAll(expression)) {
    if (hit.index > cursor) result.push({ text: source.slice(cursor, hit.index), match: false })
    result.push({ text: hit[0], match: true }); cursor = hit.index + hit[0].length
  }
  if (cursor < source.length) result.push({ text: source.slice(cursor), match: false })
  return result
}

export async function prepareSearchLocation(item, snippet, signal) {
  if (!item?.id || snippet?.kind !== 'body') throw new Error('此类结果请打开笔记查看，暂不支持字符定位')
  const file = await api('/api/files/' + encodeURIComponent(item.id), { signal })
  if (!file || file.id !== item.id || file.is_folder || file.is_deleted || typeof file.content !== 'string') {
    throw new Error('目标笔记不存在或已删除，请刷新检索')
  }
  if (signal?.aborted) throw new DOMException('已取消定位', 'AbortError')
  if (!globalThis.crypto?.subtle) throw new Error('当前环境无法校验正文版本，请使用“打开笔记”')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.content))
  if (signal?.aborted) throw new DOMException('已取消定位', 'AbortError')
  const actual = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
  if (actual !== item.content_sha256) throw new Error('正文已变化，请刷新检索后再定位；没有改写笔记')
  const target = createTextEvidenceTarget(file.content, snippet)
  if (!target) throw new Error('当前文字无法精确映射，请打开笔记核对')
  return target
}
