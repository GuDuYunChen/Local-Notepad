// Presentation only: input is the already-validated immutable comparison.
// Never recompute totals or change the model used by exports. Opposing category
// deltas can cancel in the totals, so examine each metric independently.
export function offlinePairVisibleRows(comparison, onlyDifferences = false) {
  return onlyDifferences
    ? Object.freeze(comparison.rows.filter(row => row.delta !== 0))
    : comparison.rows
}
