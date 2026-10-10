import { historyTime } from './syncConflictHistory.mjs'

export const HISTORY_FILE_ORDER_DEFAULT = 'file'
export const HISTORY_FILE_ORDER_OPTIONS = Object.freeze([
  { value: 'file', label: '文件原顺序' },
  { value: 'completed-desc', label: '处理或失效时间：由新到旧' },
  { value: 'completed-asc', label: '处理或失效时间：由旧到新' },
  { value: 'created-desc', label: '建立时间：由新到旧' },
  { value: 'created-asc', label: '建立时间：由旧到新' },
].map(option => Object.freeze(option)))
const orders = new Set(HISTORY_FILE_ORDER_OPTIONS.map(option => option.value))
export const isHistoryFileOrder = value => orders.has(value)

// Operate on the whole matched projection before pagination. Never sort the
// report in place, infer missing dates, or use IDs/locale as a tie-breaker.
export function orderHistoryFileRecords(records, order = HISTORY_FILE_ORDER_DEFAULT) {
  if (!Array.isArray(records) || !isHistoryFileOrder(order)) throw new TypeError('离线文件排序方式无效')
  if (order === HISTORY_FILE_ORDER_DEFAULT) return Object.freeze(records.slice())
  const field = order.startsWith('completed-') ? 'resolvedAt' : 'createdAt'
  const direction = order.endsWith('-asc') ? 1 : -1
  const decorated = records.map((row, index) => {
    const time = row?.[field]
    return { row, index, time: historyTime(time) ? time : null }
  })
  decorated.sort((a, b) => {
    if (a.time === null || b.time === null) {
      if (a.time !== b.time) return a.time === null ? 1 : -1
    } else if (a.time !== b.time) return direction * (a.time - b.time)
    return a.index - b.index
  })
  return Object.freeze(decorated.map(item => item.row))
}
