import { offlinePairScopedRows } from './s3OfflinePairScope.mjs'

// Sort a copied presentation list, never the complete comparison used by exports.
// Only one unit may be ordered by magnitude. Ties retain canonical metric order.
export function offlinePairOrderedRows(comparison, onlyDifferences = false, direction = 'all', scope = 'all', order = 'original') {
  if (!['original', 'largest', 'smallest'].includes(order)) throw new Error('无效的差异排序。')
  const rows = offlinePairScopedRows(comparison, onlyDifferences, direction, scope)
  if (!onlyDifferences || scope === 'all' || order === 'original') return rows
  const ranked = rows.map((row, index) => ({ row, index }))
  ranked.sort((left, right) => {
    const a = Math.abs(left.row.delta), b = Math.abs(right.row.delta)
    if (a === b) return left.index - right.index
    const ascending = a < b ? -1 : 1
    return order === 'smallest' ? ascending : -ascending
  })
  return Object.freeze(ranked.map(item => item.row))
}
