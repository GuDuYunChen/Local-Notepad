import React, { useEffect, useRef, useState } from 'react'
import { SEARCH_COLLECTION_PREFIX, searchCollections } from '~/services/searchCollections'
import { readCollectionReadingContext, stepCollectionReading } from '~/services/collectionReading'
import useCollectionStudy from '~/hooks/useCollectionStudy'
import { collectionStudy, nextUnreadCollectionItem, summarizeCollectionStudy } from '~/services/collectionStudy'
import { createCollectionReadingContext } from '~/services/collectionReading'
import CollectionStudyEditor from './CollectionStudyEditor'
import './SearchReturnBar.css'

export default function CollectionReadingBar({ origin, documentId, dirty, paused = false, onOpenFile, onMove, onReturn, onEnd, store = searchCollections, studyStore = collectionStudy }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const operation = useRef(null), latest = useRef(null)
  latest.current = { origin, documentId, paused }
  const visible = origin?.kind === 'collection' && origin.documentId === documentId
  const study = useCollectionStudy(visible ? origin.entry : null, { sourceStore: store, studyStore })
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false) }
  useEffect(() => {
    setError(''); setBusy(false)
    if (!visible) return
    const refresh = () => {
      try { readCollectionReadingContext(origin, store); setStale(false) }
      catch { setStale(true); operation.current?.abort() }
    }
    const storage = event => { if (event.key === null || event.key?.startsWith(SEARCH_COLLECTION_PREFIX)) refresh() }
    const unsubscribe = store.subscribe(refresh)
    refresh(); window.addEventListener('storage', storage); window.addEventListener('focus', refresh)
    return () => { unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh); operation.current?.abort(); operation.current = null }
  }, [origin, visible, store])
  useEffect(() => { if (paused) cancel() }, [paused])
  const move = async direction => {
    if (!visible || paused || study.busy || operation.current || !onOpenFile) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError('')
    const valid = () => {
      if (controller.signal.aborted || operation.current !== controller || latest.current.origin !== origin || latest.current.paused) return false
      try { readCollectionReadingContext(origin, store); return true } catch { return false }
    }
    try {
      const unread = direction === 'unread' && study.snapshot ? nextUnreadCollectionItem(study.snapshot, documentId, origin.queue) : null
      const next = direction === 'unread' ? (unread ? createCollectionReadingContext(origin.entry, origin.checkReport ? { currentReport: origin.checkReport } : null, origin.view, unread.id) : null) : stepCollectionReading(origin, direction, store)
      if (!next) return
      const accepted = await onOpenFile(next.documentId, { signal: controller.signal, shouldSelect: valid })
      if (controller.signal.aborted || operation.current !== controller) return
      if (!valid()) { setStale(true); return }
      if (accepted === true) onMove?.(origin, next)
      else setError('未切换笔记：可能已取消、保存未完成或目标不可用；当前位置与草稿保留，不自动跳过。')
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message || '未完成切换，当前位置保留') }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false) } }
  }
  if (!visible) return null
  return <section className="search-return-bar collection-reading-bar" aria-label="资料集连续阅读" aria-busy={busy}>
    <div><strong>{origin.collectionName}</strong><span>第 {origin.index + 1} / {origin.queue.length} 篇</span>
      <small>{dirty ? '未保存草稿仍留在编辑器；切换笔记须经过保存确认。' : '按进入时的筛选连续查看当前笔记；不修改历史资料集，也不自动跳过不可用条目。'}</small>
      {origin.checkReport && <small>队列基于 {new Date(origin.checkReport.exportedAt).toLocaleString('zh-CN')} 的复查快照，不是实时变化列表。</small>}
      {stale && <p role="alert">原资料集已变化、删除或不可读取，连续阅读已停用。返回后请重新选择。</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <small role="status">正在打开；请处理未保存确认，取消后不推进位置。</small>}
    </div>
    <button type="button" disabled={busy || study.busy || paused || stale || origin.index <= 0 || !onOpenFile} onClick={() => void move(-1)}>上一资料</button>
    <button type="button" disabled={busy || study.busy || paused || stale || origin.index >= origin.queue.length - 1 || !onOpenFile} onClick={() => void move(1)}>下一资料</button>
    <button type="button" disabled={busy || study.busy || paused || stale || !onOpenFile || !study.snapshot || study.loading || !nextUnreadCollectionItem(study.snapshot, documentId, origin.queue)} onClick={() => void move('unread')}>下一未读资料</button>
    <button type="button" disabled={busy || study.busy || paused} onClick={onReturn}>返回资料集</button>
    <button type="button" disabled={busy || study.busy || paused} onClick={onEnd}>结束资料集阅读</button>
    <details className="collection-reading-study"><summary>阅读进度与批注</summary>
      {study.error && <p role="alert">{study.error}</p>}
      {study.loading && <p role="status">正在读取阅读记录…</p>}
      {study.snapshot && <>
        <p>已读 {summarizeCollectionStudy(study.snapshot).read} / {study.snapshot.collection.report.count} 篇（整份资料集）；下一未读只遍历本次阅读队列，待复看也会保留。</p>
        <button type="button" disabled={busy || study.busy || paused || stale || study.busy || study.loading} onClick={() => void study.write((snapshot, options) => studyStore.bookmark(snapshot, documentId, options))}>记住当前阅读位置</button>
      </>}
      <CollectionStudyEditor key={origin.entry.key + documentId} model={study} documentId={documentId} disabled={busy || study.busy || paused} />
      <button type="button" disabled={study.busy || study.loading || busy || paused} onClick={() => void study.refresh()}>重新读取阅读记录</button>
    </details>
  </section>
}
