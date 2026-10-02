import { compileHistoryTimeFilter } from './syncHistoryTime.mjs'
// Local-only selection over the already validated history projection. Never
// query the server, inspect historical bodies, mutate rows or persist queries.
export const HISTORY_QUERY_LIMIT = 128
const KINDS = new Set(['all', 'file', 'tag', 'file-tag', 'attachment'])
const OUTCOMES = new Set(['all', 'local', 'remote', 'superseded', 'unknown'])
const fold = text => text.normalize('NFKC').toLowerCase()

export function limitHistoryQuery(value) {
  if (typeof value !== 'string') throw new TypeError('查找文字必须是字符串')
  // Count Unicode characters, not UTF-16 units; do not split an emoji surrogate.
  return [...value].slice(0, HISTORY_QUERY_LIMIT).join('')
}
export function historyOutcomeKey(row) {
  if (row.status === 'superseded') return 'superseded'
  if (row.status === 'resolved' && ['local', 'remote'].includes(row.resolution)) return row.resolution
  return 'unknown'
}
export function selectHistoryRecords(items, { query = '', kind = 'all', outcome = 'all', timeFilter, itemID = '', recordID = '' } = {}) {
  if (!Array.isArray(items) || !KINDS.has(kind) || !OUTCOMES.has(outcome) ||
      typeof itemID !== 'string' || [...itemID].length > 2048 ||
      typeof recordID !== 'string' || [...recordID].length > 2048) throw new TypeError('本地筛选条件无效')
  const dates = compileHistoryTimeFilter(timeFilter)
  const needle = fold(limitHistoryQuery(query).trim())
  const selected = items.filter(row => {
    if (!dates.includes(row)) return false
    if (kind !== 'all' && row.kind !== kind) return false
    if (outcome !== 'all' && historyOutcomeKey(row) !== outcome) return false
    // Object identifiers are opaque identities. Exact-object filtering never
    // folds case, width, whitespace or Unicode before comparing the full ID.
    if (itemID && row.itemID !== itemID) return false
    // Record identifiers are opaque identities too. Keep exact-record scope
    // independent from the normalized free-text search and exact object scope.
    if (recordID && row.id !== recordID) return false
    // Search fields independently: never match across field boundaries or
    // accidentally include a private/unrecognised field in a search result.
    return !needle || [row.title, row.itemID, row.id].some(value => typeof value === 'string' && fold(value).includes(needle))
  })
  return Object.freeze({ items: Object.freeze(selected), loaded: items.length,
    matched: selected.length, narrowed: Boolean(dates.narrowed || needle || kind !== 'all' || outcome !== 'all' || itemID || recordID) })
}
