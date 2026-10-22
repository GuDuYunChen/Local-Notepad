import { selectHistoryRecords } from './syncHistorySearch.mjs'
import { HISTORY_TIME_ALL } from './syncHistoryTime.mjs'
import { HISTORY_FILE_ORDER_DEFAULT, orderHistoryFileRecords } from './syncHistoryFileOrder.mjs'

export const HISTORY_FILE_PAGE_SIZE = 25
export const HISTORY_FILE_FILTER_ALL = Object.freeze({ query: '', kind: 'all', outcome: 'all', timeFilter: HISTORY_TIME_ALL, itemID: '', recordID: '' })

// Search the entire already validated file BEFORE paging. Neither the original
// file metadata nor the live workspace history becomes part of this selection.
export function selectHistoryFilePage(records, filters = HISTORY_FILE_FILTER_ALL, requestedPage = 0, order = HISTORY_FILE_ORDER_DEFAULT) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new TypeError('离线文件页码无效')
  const selection = selectHistoryRecords(records, filters)
  const ordered = orderHistoryFileRecords(selection.items, order)
  const pages = Math.ceil(selection.matched / HISTORY_FILE_PAGE_SIZE)
  const page = pages ? Math.min(requestedPage, pages - 1) : 0
  const offset = page * HISTORY_FILE_PAGE_SIZE
  return Object.freeze({ total: selection.loaded, matched: selection.matched, narrowed: selection.narrowed,
    page, pages, from: selection.matched ? offset + 1 : 0,
    to: Math.min(offset + HISTORY_FILE_PAGE_SIZE, selection.matched),
    rows: Object.freeze(ordered.slice(offset, offset + HISTORY_FILE_PAGE_SIZE)) })
}
