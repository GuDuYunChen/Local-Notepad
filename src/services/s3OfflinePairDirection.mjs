import { offlinePairVisibleRows } from './s3OfflinePairView.mjs'

// Presentation over the already-confirmed immutable FILE comparison only.
// Inspect each signed metric, not aggregate totals; opposing changes can cancel.
// Never mutate the comparison shared with the three complete export formats.
export function offlinePairDirectionalRows(comparison, onlyDifferences = false, direction = 'all') {
  if (!['all', 'increase', 'decrease'].includes(direction)) throw new Error('无效的差异方向。')
  const rows = offlinePairVisibleRows(comparison, onlyDifferences)
  if (!onlyDifferences || direction === 'all') return rows
  return Object.freeze(rows.filter(row => direction === 'increase' ? row.delta > 0 : row.delta < 0))
}
