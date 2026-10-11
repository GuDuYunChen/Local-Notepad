import { offlinePairDirectionalRows } from './s3OfflinePairDirection.mjs'

// Scope is presentation only. Keep the confirmed comparison, overview and
// export model complete; never combine quantities with capacity values.
export function offlinePairScopedRows(comparison, onlyDifferences = false, direction = 'all', scope = 'all') {
  if (!['all', 'counts', 'bytes'].includes(scope)) throw new Error('无效的指标类型。')
  const rows = offlinePairDirectionalRows(comparison, onlyDifferences, direction)
  if (!onlyDifferences || scope === 'all') return rows
  const unit = scope === 'counts' ? '项' : 'B'
  return Object.freeze(rows.filter(row => row.unit === unit))
}
