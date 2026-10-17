// Display-only operation on the currently rendered offline page. No record
// data, remote history, storage, or other panels are read or changed.
export const HISTORY_FILE_DETAILS_SELECTOR = '[data-history-file-identifiers]'
export function setHistoryFileDetailsOpen(list, expanded) {
  if (typeof expanded !== 'boolean') throw new TypeError('展开状态必须是布尔值')
  if (!list) return 0
  const details = list.querySelectorAll(HISTORY_FILE_DETAILS_SELECTOR)
  let changed = 0
  for (const node of details) {
    if (node.open !== expanded) { node.open = expanded; changed++ }
  }
  return changed
}
