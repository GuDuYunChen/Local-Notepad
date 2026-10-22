import { HISTORY_FILE_PAGE_SIZE } from './syncHistoryFileSelection.mjs'
import { HISTORY_EXPORT_LIMIT } from './syncHistoryExport.mjs'

// Parse an explicit one-based page, never clamp an invalid request to another
// page. Full-width decimal digits are common with Chinese input methods.
export function parseHistoryFilePageJump(value, pages) {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > Math.ceil(HISTORY_EXPORT_LIMIT / HISTORY_FILE_PAGE_SIZE)) {
    throw new Error('当前没有可跳转的有效页码。')
  }
  if (typeof value !== 'string' || value.length > 32) throw new Error('请输入完整的正整数页码。')
  const digits = value.trim().replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
  if (!/^[0-9]+$/.test(digits)) throw new Error('请输入完整的正整数页码。')
  const page = Number(digits)
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) throw new Error(`页码须在 1 至 ${pages} 之间；当前页面未改变。`)
  return page - 1
}
