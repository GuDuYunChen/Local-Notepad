// Shared by persistence, the alias editor and the evidence scanner.
export const MAX_ENTITY_ALIASES = 24

export function normalizeEntityTerm(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/gu, ' ')
    : ''
}

export function entityTermKey(value) {
  return normalizeEntityTerm(value).toLowerCase()
}

function isUsableTerm(value) {
  return Array.from(value).length >= 2
}

export function normalizeProjectEntityAliases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result = new Map()
  for (const [entityId, aliases] of Object.entries(value)) {
    const id = entityId.trim()
    if (!id || !Array.isArray(aliases)) continue
    const normalized = result.get(id) || []
    const seen = new Set(normalized.map(entityTermKey))
    for (const raw of aliases) {
      const alias = normalizeEntityTerm(raw)
      const key = entityTermKey(alias)
      if (!isUsableTerm(alias) || seen.has(key)) continue
      if (normalized.length >= MAX_ENTITY_ALIASES) break
      seen.add(key)
      normalized.push(alias)
    }
    if (normalized.length) result.set(id, normalized)
  }
  // Own properties also keep imported IDs such as "__proto__" inert.
  return Object.fromEntries(result)
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'quote', 'list', 'listitem',
  'table', 'tablerow', 'tablecell', 'todo',
])
const EXCLUDED_TYPES = new Set([
  'wiki-link', 'code', 'code-block', 'code-highlight',
  'image', 'formula', 'horizontalrule',
])

export function collectProjectPlainText(content) {
  let state
  try {
    state = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    return typeof content === 'string' ? content.normalize('NFC') : ''
  }
  if (typeof state === 'string') return state.normalize('NFC')

  const visit = node => {
    if (!node || typeof node !== 'object') return ''
    // An omitted link/decorator is a boundary, never a way to join two names.
    if (EXCLUDED_TYPES.has(node.type) || node.type === 'linebreak') return '\n'
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
    if (node.type === 'tab') return ' '
    const children = Array.isArray(node.children) ? node.children : []
    const text = (node.type === 'todo' && typeof node.text === 'string' ? node.text : '') +
      children.map(visit).join('')
    if (BLOCK_TYPES.has(node.type)) return '\n' + text + '\n'
    // Unknown non-text leaves must not make their neighbors run together.
    return children.length ? text : '\n'
  }
  return visit(state?.root)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .trim()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termExpression(term) {
  const needsBoundary = !/\p{Script=Han}/u.test(term) && /[\p{L}\p{N}_]/u.test(term)
  const boundary = '[^\\p{L}\\p{N}\\p{M}_]'
  return new RegExp(
    (needsBoundary ? '(^|' + boundary + ')' : '()') +
      escapeRegExp(term) + (needsBoundary ? '(?=$|' + boundary + ')' : ''),
    'giu',
  )
}

export function buildEntityTermIndex(nodes = [], rawAliases = {}) {
  const aliases = normalizeProjectEntityAliases(rawAliases)
  const terms = new Map()
  const add = (label, entityId, source) => {
    const term = normalizeEntityTerm(label)
    if (!isUsableTerm(term)) return
    const key = entityTermKey(term)
    const entry = terms.get(key) || {
      term, canonical: new Set(), alias: new Set(), aliasLabel: '',
    }
    entry[source].add(entityId)
    if (source === 'alias' && !entry.aliasLabel) entry.aliasLabel = term
    terms.set(key, entry)
  }
  for (const node of nodes) add(node.label, node.id, 'canonical')
  // Retain orphaned aliases in storage, but not in the active project's index.
  for (const node of nodes) {
    const values = Object.hasOwn(aliases, node.id) ? aliases[node.id] : []
    for (const alias of values) {
      if (entityTermKey(alias) !== entityTermKey(node.label)) add(alias, node.id, 'alias')
    }
  }

  const aliasConflicts = []
  const canonicalConflicts = []
  const entries = []
  for (const entry of terms.values()) {
    const owners = new Set([...entry.canonical, ...entry.alias])
    if (entry.alias.size && owners.size > 1) {
      aliasConflicts.push({ alias: entry.aliasLabel, entityIds: [...owners].sort() })
    }
    if (entry.canonical.size > 1) {
      canonicalConflicts.push({ label: entry.term, entityIds: [...entry.canonical].sort() })
    }
    let entityId = null
    let source = ''
    if (entry.canonical.size === 1) {
      // A colliding alias must not steal another entity's unique canonical name.
      entityId = [...entry.canonical][0]
      source = 'canonical'
    } else if (!entry.canonical.size && entry.alias.size === 1) {
      entityId = [...entry.alias][0]
      source = 'alias'
    }
    entries.push({
      term: source === 'alias' ? entry.aliasLabel : entry.term,
      entityId,
      source,
      expression: termExpression(entry.term),
    })
  }
  return { entries, aliasConflicts, canonicalConflicts }
}

export function scanProjectEntityMentions(text, index, options = {}) {
  // Sampling is opt-in and bounded per source; overview counts stay unchanged.
  const requestedLimit = Number(options.sampleLimit)
  const sampleLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(10, Math.floor(requestedLimit)))
    : 0
  const occurrences = []
  const normalized = typeof text === 'string' ? text.normalize('NFC') : ''
  for (const entry of index.entries) {
    entry.expression.lastIndex = 0
    for (const match of normalized.matchAll(entry.expression)) {
      const start = match.index + match[1].length
      occurrences.push({ start, end: match.index + match[0].length, entry })
    }
  }
  // Leftmost-longest matching: one span contributes at most one mention.
  // Ambiguous spans also consume their range, blocking misleading shorter terms.
  occurrences.sort((a, b) => a.start - b.start || b.end - a.end)
  const evidence = new Map()
  let consumedUntil = -1
  for (const occurrence of occurrences) {
    if (occurrence.start < consumedUntil) continue
    consumedUntil = occurrence.end
    const { entityId, source, term } = occurrence.entry
    if (entityId === null) continue
    const item = evidence.get(entityId) || {
      canonicalCount: 0, aliasCount: 0, aliasesMatched: new Set(),
    }
    if (source === 'canonical') item.canonicalCount += 1
    else {
      item.aliasCount += 1
      item.aliasesMatched.add(term)
    }
    if (sampleLimit > 0) {
      if (!item.samples) item.samples = []
      if (item.samples.filter(sample => sample.source === source).length < sampleLimit) {
        item.samples.push({ start: occurrence.start, end: occurrence.end, source, term })
      }
    }
    evidence.set(entityId, item)
  }
  return evidence
}

export function getProjectEntityAliasError(entities, entityId, value) {
  const selected = entities.find(entity => entity.id === entityId)
  if (!selected) return '请先选择实体'
  const alias = normalizeEntityTerm(value)
  const key = entityTermKey(alias)
  if (!isUsableTerm(alias)) return '别名至少需要 2 个字符，避免把代词误当实体'
  if (key === entityTermKey(selected.label)) return '别名与实体原名相同'
  const aliases = normalizeProjectEntityAliases({ selected: selected.aliases || [] }).selected || []
  if (aliases.some(item => entityTermKey(item) === key)) return '这个别名已经存在'
  const collision = entities.find(entity => entity.id !== entityId && (
    entityTermKey(entity.label) === key ||
    (Array.isArray(entity.aliases) ? entity.aliases : []).some(item => entityTermKey(item) === key)
  ))
  if (collision) return '别名“' + alias + '”已被“' + collision.label + '”占用，避免歧义请换一个'
  if (aliases.length >= MAX_ENTITY_ALIASES) return '每个实体最多保留 24 个别名，请先删除不再使用的别名'
  return ''
}
