import { historyOutcomeKey } from './syncHistorySearch.mjs'
import { historyTime } from './syncConflictHistory.mjs'

const OUTCOMES = [['local', '保留本机'], ['remote', '采用远端'], ['superseded', '已失效'], ['unknown', '处理方式未核实']]
const KINDS = [['file', '笔记或文件夹'], ['tag', '标签'], ['file-tag', '标签关联'], ['attachment', '附件']]
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799

// One pass over the same validated selection rendered by the list. Count
// records, not unique objects or sync executions. Never inspect titles/bodies.
export function summarizeHistoryRecords(items) {
  if (!Array.isArray(items)) throw new TypeError('历史记录集合无效')
  const outcomes = Object.fromEntries(OUTCOMES.map(([key]) => [key, 0]))
  const kinds = Object.fromEntries(KINDS.map(([key]) => [key, 0]))
  const ids = new Set()
  let earliest = null, latest = null, known = 0
  for (const row of items) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
        !Object.hasOwn(kinds, row.kind) || !['resolved', 'superseded'].includes(row.status) ||
        !['local', 'remote', 'remote-rebind', 'unknown'].includes(row.resolution) || !validTime(row.resolvedAt)) {
      throw new TypeError('历史记录格式无效，不能给出部分统计')
    }
    ids.add(row.id)
    outcomes[historyOutcomeKey(row)] += 1
    kinds[row.kind] += 1
    if (row.resolvedAt > 0) {
      known += 1
      earliest = earliest === null ? row.resolvedAt : Math.min(earliest, row.resolvedAt)
      latest = latest === null ? row.resolvedAt : Math.max(latest, row.resolvedAt)
    }
  }
  const groups = (labels, counts) => Object.freeze(labels.map(([key, label]) => Object.freeze({ key, label, count: counts[key] })))
  return Object.freeze({ count: items.length, outcomes: groups(OUTCOMES, outcomes), kinds: groups(KINDS, kinds),
    times: Object.freeze({ known, missing: items.length - known,
      earliestUTC: earliest === null ? null : historyTime(earliest), latestUTC: latest === null ? null : historyTime(latest) }) })
}
