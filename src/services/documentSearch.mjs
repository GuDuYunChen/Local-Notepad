// Literal, locale-independent Unicode case folding. Offsets always belong to
// the original UTF-16 string: lowercasing a copy can change its length (e.g. İ).
export const SEARCH_LIMITS = Object.freeze({ query: 1024, replacement: 4096, text: 2 * 1024 * 1024, nodes: 20000, matches: 5000, document: 8 * 1024 * 1024 })
export function assertSearchString(value, max, label) {
  if (typeof value !== 'string' || value.length > max * 2 || Array.from(value).length > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error(label + '无效或超过 ' + max + ' 字符上限')
  return value
}
const word = value => !!value && /[\p{L}\p{N}\p{M}\p{Pc}]/u.test(value)
const before = (text, at) => { if (!at) return ''; const low = text.charCodeAt(at - 1); return text.slice(at - (low >= 0xdc00 && low <= 0xdfff && at > 1 ? 2 : 1), at) }
export function findLiteralMatches(text, query, { matchCase = false, wholeWord = false } = {}) {
  if (typeof text !== 'string' || text.length > SEARCH_LIMITS.text) throw new Error('可检索正文超过 2 Mi 个 UTF-16 单位上限，未采用部分结果')
  assertSearchString(query, SEARCH_LIMITS.query, '查找内容')
  if (!query) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, matchCase ? 'gu' : 'giu'), found = []
  for (const hit of text.matchAll(regex)) {
    const start = hit.index, end = start + hit[0].length
    const first = String.fromCodePoint(hit[0].codePointAt(0)), last = before(hit[0], hit[0].length)
    if (wholeWord && ((word(first) && word(before(text, start))) || (word(last) && word(end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '')))) continue
    found.push({ offset: start, length: hit[0].length, text: hit[0] })
    if (found.length > SEARCH_LIMITS.matches) throw new Error('匹配超过 5000 处，请缩小查找范围；未启用部分替换')
  }
  return found
}
export function findTextMatchOffsets(text, query, options = {}) {
  return findLiteralMatches(String(text || ''), String(query || ''), options).map(hit => hit.offset)
}
// Construct every final node value before mutating any node. A search never
// interprets replacement '$&', '$1' or backslashes as regex substitutions.
export function buildReplacementValues(matches, replacement) {
  assertSearchString(replacement, SEARCH_LIMITS.replacement, '替换内容')
  const plans = new Map()
  for (const match of matches) {
    match.parts.forEach((part, index) => {
      const plan = plans.get(part.key) || { key: part.key, kind: part.kind, original: part.original, operations: [] }
      if (plan.original !== part.original || plan.kind !== part.kind) throw new Error('匹配版本不一致，未替换')
      plan.operations.push({ start: part.start, end: part.end, value: index === 0 ? replacement : '' })
      plans.set(part.key, plan)
    })
  }
  let total = 0
  for (const plan of plans.values()) {
    plan.operations.sort((a, b) => b.start - a.start)
    let value = plan.original, boundary = value.length
    for (const op of plan.operations) {
      if (!Number.isInteger(op.start) || !Number.isInteger(op.end) || op.start < 0 || op.end <= op.start || op.end > boundary) throw new Error('匹配范围无效或重叠，未替换')
      value = value.slice(0, op.start) + op.value + value.slice(op.end); boundary = op.start
    }
    total += value.length
    if (total > SEARCH_LIMITS.document) throw new Error('替换结果超过 8 Mi 个 UTF-16 单位，未改动正文')
    plan.value = value
  }
  return [...plans.values()].filter(plan => plan.value !== plan.original)
}
