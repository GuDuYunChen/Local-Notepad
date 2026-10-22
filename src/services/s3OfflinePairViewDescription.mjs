const directions = Object.freeze({ all: '全部差异', increase: '仅增加', decrease: '仅减少' })
const scopes = Object.freeze({ all: '全部指标', counts: '仅数量（项）', bytes: '仅容量（B）' })
const orders = Object.freeze({ original: '原始顺序', largest: '幅度从大到小', smallest: '幅度从小到大' })

// Describe the effective view, never the data or an inferred chronology.
// Inactive or mixed-unit ordering must not be advertised as applied.
export function offlinePairViewDescription(onlyDifferences = false, direction = 'all', scope = 'all', order = 'original') {
  if (typeof onlyDifferences !== 'boolean' || !Object.hasOwn(directions, direction) ||
      !Object.hasOwn(scopes, scope) || !Object.hasOwn(orders, order)) throw new Error('无效的比较视图。')
  if (!onlyDifferences) return '全部 12 项 · 原始顺序'
  return `仅差异 · ${scopes[scope]} · ${directions[direction]} · ${orders[scope === 'all' ? 'original' : order]}`
}
