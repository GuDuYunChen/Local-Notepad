import { useEffect, useRef, useState } from 'react'
import { createCollectionReadingContext, restoreCollectionReading } from '~/services/collectionReading'
import { serializeCollectionReviewReport, downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import { SEARCH_COLLECTION_PREFIX, MAX_COLLECTION_BYTES, searchCollections,
  readSearchCollection, checkSearchCollection, downloadSearchCollection } from '~/services/searchCollections'

// View state lives above the editor's save/discard guard, so cancelling an open
// does not lose the selected collection, page or historical comparison.
export default function useSearchCollections({ active, store = searchCollections }) {
  const [shelf, setShelf] = useState(() => store.list())
  const [selectedKey, setSelectedKey] = useState('')
  const [check, setCheck] = useState(null), [page, setPage] = useState(1)
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all')
  const [message, setMessage] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(null)
  const [deleting, setDeleting] = useState(null), [preview, setPreview] = useState(null)
  const [restoreTick, setRestoreTick] = useState(0), [focusRequest, setFocusRequest] = useState(null)
  const [checkStale, setCheckStale] = useState(false)
  const pendingRestore = useRef(null)
  const operation = useRef(null), latest = useRef(null)
  const selected = shelf.entries.find(entry => entry.key === selectedKey) || null
  latest.current = { active, selected }
  const refresh = () => setShelf(store.list())
  const cancel = () => {
    operation.current?.abort(); operation.current = null
    setBusy(false); setProgress(null)
  }
  useEffect(() => {
    const listener = () => refresh()
    const storage = event => { if (event.key === null || event.key?.startsWith(SEARCH_COLLECTION_PREFIX)) refresh() }
    const unsubscribe = store.subscribe(listener)
    window.addEventListener('storage', storage); window.addEventListener('focus', listener)
    refresh()
    return () => { unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('focus', listener) }
  }, [store])
  useEffect(() => {
    cancel()
    const restoration = pendingRestore.current; pendingRestore.current = null
    if (restoration && restoration.context.entry.raw === selected?.raw) {
      const context = restoration.context
      setCheck(restoration.check); setCheckStale(Boolean(restoration.check)); setPage(restoration.page)
      setQuery(context.view.query); setStatus(context.view.status)
      setFocusRequest({ id: context.documentId, tick: restoreTick })
      setMessage(restoration.check ? '已返回原条目和筛选；保留的是先前复查快照，正文可能已变化，请重新检查。' : '已返回原资料集条目和筛选；当前显示历史元数据，未自动复查。')
    } else { setCheck(null); setCheckStale(false); setStatus('all'); setPage(1); setFocusRequest(null) }
  }, [selected?.raw, selectedKey, restoreTick])
  useEffect(() => {
    if (!active) { cancel(); setPreview(null); setDeleting(null) }
    return () => { operation.current?.abort(); operation.current = null }
  }, [active])
  const run = action => {
    setMessage(''); setError('')
    try { return action() } catch (failure) { setError(failure.message || '操作未完成，原资料集保留'); refresh() }
  }
  const choose = key => {
    cancel(); setSelectedKey(key); setCheck(null); setPage(1); setQuery(''); setStatus('all'); setMessage(''); setError(''); setDeleting(null)
  }
  const inspect = async (reportFormat = null) => {
    if (!active || !selected?.collection || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(null); setError(''); setMessage(''); setCheck(null)
    const entry = selected
    const current = () => !controller.signal.aborted && operation.current === controller && latest.current.active && latest.current.selected?.raw === entry.raw
    try {
      const collection = readSearchCollection(store.readUnchanged(entry))
      const result = await checkSearchCollection(collection, { signal: controller.signal,
        onProgress: value => { if (current()) setProgress(value) } })
      if (!current()) return
      store.readUnchanged(entry)
      if (reportFormat) {
        const output = serializeCollectionReviewReport(collection, result.currentReport, reportFormat)
        if (!current()) return
        store.readUnchanged(entry)
        downloadCollectionReviewReport(output)
      }
      setCheck(result); setCheckStale(false); if (!reportFormat) setPage(1)
      setMessage(reportFormat ? '已重新复查并发起完整报告下载，请核对下载目录；包含全部历史条目和额外匹配，不受列表筛选或分页限制。' : '复查完成；只表示本次读取时的状态，历史资料集没有被覆盖。')
    } catch (failure) { if (current()) { setError(failure.message || '复查未完成'); refresh() } }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); setProgress(null) } }
  }
  const prepareImport = async file => {
    if (!file || !active || operation.current) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setPreview(null); setMessage(''); setError('')
    try {
      if (file.size > MAX_COLLECTION_BYTES) throw new Error('资料集文件超过 2 MiB，未读取或导入')
      const raw = await file.text()
      if (controller.signal.aborted || operation.current !== controller || !latest.current.active) return
      const value = readSearchCollection(raw)
      setPreview({ raw, value }); setMessage('预检通过，确认后新增独立副本；不会覆盖同名资料集或笔记。')
    } catch (failure) { if (operation.current === controller && !controller.signal.aborted) setError(failure.message || '文件读取失败') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  return { store, shelf, selected, check, checkStale, focusRequest, page, setPage, query, status, message, error, busy, progress, deleting, preview,
    exportReview: format => inspect(format),
    prepareOpen: item => run(() => {
      if (!selected?.collection) return null
      const raw = store.readUnchanged(selected)
      return createCollectionReadingContext({ key: selected.key, raw }, item.studyResume === true ? null : check, item.studyResume === true ? { query: '', status: 'all' } : { query, status }, item.id)
    }),
    markOpened: () => setCheckStale(Boolean(check)),
    restoreReading: context => run(() => {
      const restoration = restoreCollectionReading(context, store)
      cancel(); setError(''); setDeleting(null); setPreview(null)
      pendingRestore.current = restoration; setShelf(store.list()); setSelectedKey(context.entry.key)
      setRestoreTick(value => value + 1)
    }),
    setQuery: value => { setQuery(value); setPage(1) }, setStatus: value => { setStatus(value); setPage(1) },
    choose, refresh, inspect, prepareImport,
    cancel: () => { cancel(); setMessage('已取消准备，原资料集保留。') },
    export: () => run(() => { downloadSearchCollection(store.export(selected)); setMessage('已发起资料集 JSON 下载，请核对下载目录；不是完整正文备份。') }),
    requestDelete: () => { setDeleting(selected); setError('') }, cancelDelete: () => setDeleting(null),
    confirmDelete: () => run(() => { store.remove(deleting); setDeleting(null); choose(''); setMessage('资料集已删除，笔记未改动。') }),
    cancelImport: () => setPreview(null),
    confirmImport: () => run(() => {
      if (!preview) return
      const value = store.importCopy(preview.raw); setPreview(null); choose(SEARCH_COLLECTION_PREFIX + value.id)
      setMessage('已导入独立资料集；显示历史元数据，打开时仍读取当前笔记。')
    }),
    canOpen: item => run(() => { const value = readSearchCollection(store.readUnchanged(selected)); return value.report.items.some(row => row.id === item.id) }),
  }
}
