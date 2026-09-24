import { copySearchPresetFilters, applySearchPresetFilters } from './searchPresets'

// Window-only navigation metadata. No body, excerpts or result cache is retained.
export function createSearchReturnContext(item, filters, response, scrollTop = 0) {
  if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 512 || item.id.includes('\0') ||
    typeof item.title !== 'string' || !response?.items?.some(row => row.id === item.id) ||
    !Number.isSafeInteger(response.page) || response.page < 1) return null
  return Object.freeze({
    documentId: item.id,
    title: item.title,
    filters: copySearchPresetFilters(filters),
    page: response.page,
    scrollTop: Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0,
  })
}

export function restoreSearchReturnFilters(context, now = Date.now()) {
  if (!context?.documentId || typeof context.documentId !== 'string' || context.documentId.length > 512 ||
    context.documentId.includes('\0') || !Number.isSafeInteger(context.page) || context.page < 1) {
    throw new Error('原检索位置不可用，请重新检索')
  }
  return { ...applySearchPresetFilters(context.filters, now), page: context.page, anchorId: context.documentId }
}
