// Calendar dates are UTC, not the device timezone or a moving "today" window.
export const HISTORY_TIME_ALL = Object.freeze({ mode: 'all', from: '', to: '' })
const MODES = new Set(['all', 'range', 'missing'])
function dayStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1970-01-01' || value > '9999-12-31') {
    throw new Error('请填写 1970-01-01 至 9999-12-31 之间的完整日期。')
  }
  const time = Date.parse(value + 'T00:00:00.000Z')
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error('日期不存在，请检查月份、日期和闰年。')
  }
  return time / 1000
}
export function normalizeHistoryTimeFilter(value = HISTORY_TIME_ALL) {
  if (!value || !MODES.has(value.mode)) throw new Error('处理日期筛选方式无效。')
  if (value.mode !== 'range') return value.mode === 'all' ? HISTORY_TIME_ALL : Object.freeze({ mode: 'missing', from: '', to: '' })
  const { from = '', to = '' } = value
  if (typeof from !== 'string' || typeof to !== 'string') throw new Error('处理日期必须是完整日期。')
  if (!from && !to) throw new Error('请至少填写一个日期，或选择全部处理日期。')
  if (from) dayStart(from)
  if (to) dayStart(to)
  if (from && to && from > to) throw new Error('起始日期不能晚于结束日期；当前筛选未改变。')
  return Object.freeze({ mode: 'range', from, to })
}
export function sameHistoryTimeFilter(a, b) {
  return a.mode === b.mode && a.from === b.from && a.to === b.to
}
export function compileHistoryTimeFilter(value) {
  const filter = normalizeHistoryTimeFilter(value)
  const first = filter.from ? dayStart(filter.from) : 0
  // One day beyond 9999-12-31 is safe in JS and avoids truncating its last second.
  const end = filter.to ? dayStart(filter.to) + 86400 : 253402300800
  return Object.freeze({ filter, narrowed: filter.mode !== 'all', includes(row) {
    if (filter.mode === 'all') return true
    if (filter.mode === 'missing') return row.resolvedAt === 0
    return Number.isSafeInteger(row.resolvedAt) && row.resolvedAt > 0 && row.resolvedAt >= first && row.resolvedAt < end
  } })
}
export function describeHistoryTimeFilter(value) {
  const filter = normalizeHistoryTimeFilter(value)
  if (filter.mode === 'all') return '全部处理日期（含时间缺失记录）'
  if (filter.mode === 'missing') return '仅处理或失效时间缺失的记录'
  return `处理日期（UTC）：${filter.from || '不限起始'} 至 ${filter.to || '不限结束'}，包含结束当日；不含时间缺失记录`
}
