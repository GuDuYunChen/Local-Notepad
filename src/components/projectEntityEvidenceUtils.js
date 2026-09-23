import {
  collectProjectPlainText,
  entityTermKey,
  scanProjectEntityMentions,
} from './projectEntityMentionUtils.js'

export const ENTITY_EVIDENCE_SOURCES = [
  { id: 'all', label: '全部来源' },
  { id: 'wiki', label: 'WikiLink' },
  { id: 'canonical', label: '原名' },
  { id: 'alias', label: '别名' },
]

function sourceId(value) {
  return ENTITY_EVIDENCE_SOURCES.some(item => item.id === value) ? value : 'all'
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, Math.floor(number)))
    : fallback
}

function count(value) {
  return Math.max(0, Number(value) || 0)
}

// Filter the existing model rather than rescanning the manuscript for every keypress.
// A mixed-evidence chapter belongs to every source it contains, not only bestSource.
export function selectProjectEntityEvidence(model, entityId, filters = {}) {
  const entity = model?.entityById?.get(entityId)
  const source = sourceId(filters.source)
  const query = entityTermKey(filters.query)
  const volumes = new Map()
  const rows = (entity?.evidence || []).map(item => {
    const chapterEvidence = model.chapterEntities?.[item.chapterId]
    const detail = (Array.isArray(chapterEvidence) ? chapterEvidence : [])
      .find(evidence => evidence.node.id === entityId)
    const counts = {
      wiki: count(detail?.explicitCount),
      canonical: count(detail?.canonicalCount),
      alias: count(detail?.aliasCount),
    }
    const volumeId = String(item.volumeId || '')
    volumes.set(volumeId, item.volumeTitle || '未分卷')
    return {
      ...item,
      volumeId,
      counts,
      matchCount: source === 'all'
        ? counts.wiki + counts.canonical + counts.alias
        : counts[source],
    }
  }).filter(item => {
    if (typeof filters.volumeId === 'string' && item.volumeId !== filters.volumeId) return false
    if (!item.matchCount) return false
    if (!query) return true
    return [item.chapterTitle, item.volumeTitle, ...(item.aliasesMatched || [])]
      .some(value => entityTermKey(value).includes(query))
  }).sort((a, b) => a.ordinal - b.ordinal)

  const pageSize = boundedInteger(filters.pageSize ?? 6, 6, 1, 20)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const focusIndex = typeof filters.focusChapterId === 'string'
    ? rows.findIndex(row => row.chapterId === filters.focusChapterId) : -1
  const page = focusIndex >= 0 ? Math.floor(focusIndex / pageSize) + 1
    : boundedInteger(filters.page ?? 1, 1, 1, pageCount)
  return {
    source,
    chapterQueue: rows.map(row => ({ id: row.chapterId, title: row.chapterTitle, ordinal: row.ordinal })),
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    totalRows: rows.length,
    totalMentions: rows.reduce((sum, item) => sum + item.matchCount, 0),
    page,
    pageCount,
    pageSize,
    volumes: [...volumes].map(([id, label]) => ({ id, label })),
  }
}

// Spans refer to the scanner's NFC-normalized text, not Lexical selection offsets.
// Do not use these offsets to edit or place a caret in the original document.
export function buildEntityEvidenceExcerpt(text, sample, radius = 42) {
  const start = sample.start
  const end = sample.end
  const size = boundedInteger(radius, 42, 1, 100)
  const paragraphStart = text.lastIndexOf('\n', start - 1) + 1
  const nextBreak = text.indexOf('\n', end)
  const paragraphEnd = nextBreak < 0 ? text.length : nextBreak
  const before = Array.from(text.slice(paragraphStart, start))
  const after = Array.from(text.slice(end, paragraphEnd))
  return {
    ...sample,
    before: before.slice(-size).join(''),
    match: text.slice(start, end),
    after: after.slice(0, size).join(''),
    leadingEllipsis: before.length > size,
    trailingEllipsis: after.length > size,
  }
}

function collectWikiSamples(content, noteId, limit) {
  if (!noteId) return { count: 0, samples: [] }
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return { count: 0, samples: [] }
  }
  const pending = [state?.root]
  const samples = []
  let total = 0
  // Only serialize actual link nodes. A link label is not a prose quotation.
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (node.type === 'wiki-link' && String(node.id || '').trim() === String(noteId).trim()) {
      total += 1
      if (samples.length < limit) {
        samples.push({
          title: typeof node.title === 'string' ? node.title : '',
          sectionPath: Array.isArray(node.sectionPath)
            ? node.sectionPath.filter(value => typeof value === 'string')
            : [],
        })
      }
    }
    const children = Array.isArray(node.children) ? node.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
  }
  return { count: total, samples }
}

// Called only for visible evidence cards. The shared scanner remains the single
// authority for overlap, alias conflicts and word boundaries.
export function buildEntityChapterPreview(content, termIndex, entity, options = {}) {
  const source = sourceId(options.source)
  const sampleLimit = boundedInteger(options.sampleLimit ?? 3, 3, 1, 10)
  let samples = []
  let plainCount = 0
  if (source !== 'wiki') {
    const text = collectProjectPlainText(content).normalize('NFC')
    const evidence = scanProjectEntityMentions(text, termIndex, { sampleLimit }).get(entity.id)
    plainCount = source === 'canonical'
      ? count(evidence?.canonicalCount)
      : source === 'alias'
        ? count(evidence?.aliasCount)
        : count(evidence?.canonicalCount) + count(evidence?.aliasCount)
    samples = (evidence?.samples || [])
      .filter(sample => source === 'all' || sample.source === source)
      .map(sample => buildEntityEvidenceExcerpt(text, sample))
  }
  const wiki = source === 'all' || source === 'wiki'
    ? collectWikiSamples(content, entity.noteId, sampleLimit)
    : { count: 0, samples: [] }
  return {
    samples,
    plainCount,
    omittedPlainCount: Math.max(0, plainCount - samples.length),
    wikiLinks: wiki.samples,
    wikiCount: wiki.count,
    omittedWikiCount: Math.max(0, wiki.count - wiki.samples.length),
  }
}
