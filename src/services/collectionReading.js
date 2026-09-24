import { SEARCH_COLLECTION_PREFIX, readSearchCollection, compareSearchCollection, searchCollections } from './searchCollections'

export const COLLECTION_PAGE_SIZE = 8
export const COLLECTION_STATUS_LABELS = Object.freeze({ historical: '尚未复查', unchanged: '本次未变化', body: '正文有变化', metadata: '元数据变化', outside: '不在原检索范围' })
const fail = () => { throw new Error('原资料集或阅读范围已不可用，请重新选择；历史记录与正文未改动') }
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function filters(value = {}) {
  if (typeof value.query !== 'string' || value.query.length > 512 ||
      !['all', ...Object.keys(COLLECTION_STATUS_LABELS)].includes(value.status)) fail()
  return { query: value.query, status: value.status }
}

// The UI, return anchor and reading queue use exactly the same order and filters.
export function selectCollectionRows(collection, check = null, view = { query: '', status: 'all' }) {
  const filter = filters(view)
  const rows = check?.rows || collection?.report.items.map(item => ({ id: item.id, before: item, current: null, status: 'historical', reasons: [] })) || []
  const query = filter.query.normalize('NFC').trim().toLowerCase()
  return rows.filter(row => (filter.status === 'all' || row.status === filter.status) && (!query ||
    [row.id, row.before.title, row.before.folderPath, row.current?.title, row.current?.folderPath]
      .some(value => value?.normalize('NFC').toLowerCase().includes(query))))
}

// Window-only, explicitly bounded metadata. No manuscript, excerpt or caret offsets.
// Keep the source bytes so changing/deleting a local collection invalidates the trip.
export function createCollectionReadingContext(entry, check, view, documentId) {
  const collection = readSearchCollection(entry?.raw)
  if (entry.key !== SEARCH_COLLECTION_PREFIX + collection.id) fail()
  const checked = check ? compareSearchCollection(collection, check.currentReport) : null
  const cleanView = filters(view)
  const rows = selectCollectionRows(collection, checked, cleanView)
  const index = rows.findIndex(row => row.id === documentId)
  if (index < 0) fail()
  return freeze({ kind: 'collection', documentId, title: rows[index].before.title,
    collectionName: collection.name, entry: { key: entry.key, raw: entry.raw }, view: cleanView,
    checkReport: checked?.currentReport || null,
    queue: rows.map(row => ({ id: row.id, title: row.before.title })), index })
}

export function readCollectionReadingContext(context, store = searchCollections) {
  if (context?.kind !== 'collection') fail()
  const raw = store.readUnchanged(context.entry)
  // Rebuild from validated records rather than trusting a supplied queue or index.
  return createCollectionReadingContext({ key: context.entry.key, raw },
    context.checkReport ? { currentReport: context.checkReport } : null, context.view, context.documentId)
}
export function stepCollectionReading(context, direction, store = searchCollections) {
  if (direction !== -1 && direction !== 1) fail()
  const valid = readCollectionReadingContext(context, store)
  const target = valid.queue[valid.index + direction]
  if (!target) return null
  return createCollectionReadingContext(valid.entry, valid.checkReport ? { currentReport: valid.checkReport } : null, valid.view, target.id)
}
export function restoreCollectionReading(context, store = searchCollections) {
  const valid = readCollectionReadingContext(context, store)
  const collection = readSearchCollection(valid.entry.raw)
  return { context: valid, collection, check: valid.checkReport ? compareSearchCollection(collection, valid.checkReport) : null,
    page: Math.floor(valid.index / COLLECTION_PAGE_SIZE) + 1 }
}
