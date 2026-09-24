import React, { useEffect, useRef, useState } from 'react'
import useCollectionStudy from '~/hooks/useCollectionStudy'
import { collectionStudy, summarizeCollectionStudy, STUDY_STATUS_LABELS, MAX_STUDY_BYTES } from '~/services/collectionStudy'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import { searchCollections } from '~/services/searchCollections'
import CollectionStudyEditor from './CollectionStudyEditor'
import './CollectionStudy.css'

export default function CollectionStudyPanel({ entry, onResume, focusRequest = null, disabled = false, sourceStore = searchCollections, studyStore = collectionStudy }) {
  return entry?.collection ? <StudyPanel key={entry.key + ':' + entry.raw} entry={entry} onResume={onResume} focusRequest={focusRequest} disabled={disabled} sourceStore={sourceStore} studyStore={studyStore} /> : null
}
function StudyPanel({ entry, onResume, focusRequest, disabled, sourceStore, studyStore }) {
  const model = useCollectionStudy(entry, { sourceStore, studyStore })
  const [editing, setEditing] = useState(''), [status, setStatus] = useState('all'), [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [message, setMessage] = useState(''), [preview, setPreview] = useState(null), [reading, setReading] = useState(false)
  const operation = useRef(0), live = useRef(true)
  const detailsRef = useRef(null), editorRef = useRef(null), appliedFocus = useRef(null)
  useEffect(() => { live.current = true; return () => { live.current = false; operation.current++ } }, [])
  useEffect(() => { if (disabled) { operation.current++; setReading(false); setPreview(null) } }, [disabled])
  const snapshot = model.snapshot, counts = snapshot ? summarizeCollectionStudy(snapshot) : null
  const bookmarked = snapshot?.collection.report.items.find(item => item.id === snapshot.data.bookmark?.id)
  const byId = new Map(snapshot?.data.records.map(item => [item.id, item]) || [])
  const term = query.normalize('NFC').trim().toLowerCase()
  const rows = (snapshot?.collection.report.items || []).filter(item => {
    const saved = byId.get(item.id)
    return (status === 'all' || (saved?.status || 'unread') === status) && (!term ||
      [item.id, item.title, saved?.note || ''].some(text => text.normalize('NFC').toLowerCase().includes(term)))
  })
  const pages = Math.max(1, Math.ceil(rows.length / 8)), currentPage = Math.min(page, pages)
  const locked = disabled || model.busy || model.loading || reading
  useEffect(() => {
    if (!focusRequest || !snapshot || model.loading || focusRequest.key !== entry.key || focusRequest.raw !== entry.raw || appliedFocus.current === focusRequest.token) return
    const index = snapshot.collection.report.items.findIndex(item => item.id === focusRequest.documentId)
    if (index < 0) return
    appliedFocus.current = focusRequest.token
    setQuery(''); setStatus('all'); setPage(Math.floor(index / 8) + 1); setEditing(focusRequest.documentId)
    if (detailsRef.current) detailsRef.current.open = true
  }, [focusRequest, snapshot, model.loading, entry.key, entry.raw])
  useEffect(() => {
    if (editing && focusRequest?.documentId === editing && appliedFocus.current === focusRequest.token) {
      editorRef.current?.focus({ preventScroll: true }); editorRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [editing, focusRequest])
  const importFile = async file => {
    if (!file || locked) return
    const seq = ++operation.current; setReading(true); setPreview(null); setMessage('')
    try {
      if (file.size > MAX_STUDY_BYTES) throw new Error('阅读记录文件超过 1 MiB，未读取')
      const raw = await file.text()
      if (!live.current || seq !== operation.current) return
      setPreview({ snapshot, value: studyStore.prepareImport(snapshot, raw, sourceStore) })
    } catch (failure) { if (live.current && seq === operation.current) setMessage(failure.message || '文件读取失败') }
    finally { if (live.current && seq === operation.current) setReading(false) }
  }
  return <details ref={detailsRef} className="collection-study-panel"><summary>阅读进度与批注{counts ? ` · 已读 ${counts.read} / ${snapshot.collection.report.count}` : ''}</summary>
    <p>点击保存才写入本地。只保存人工标记、批注与笔记级书签，不保存正文或光标位置；批注与历史资料集分开存储。</p>
    {model.error && <p role="alert">{model.error}</p>}
    {message && <p role="status">{message}</p>}
    {model.loading && <p role="status">正在读取阅读记录…</p>}
    <button type="button" disabled={locked} onClick={() => void model.refresh()}>重新读取阅读记录</button>
    {snapshot && <>
      <p role="status">未读 {counts.unread} · 已读 {counts.read} · 待复看 {counts.revisit} · 有批注 {counts.notes}</p>
      <div className="collection-study-actions">
        <button type="button" disabled={locked || !bookmarked || !onResume} onClick={() => void onResume(bookmarked, { unfiltered: true })}>从上次位置继续（全部条目）</button>
        <button type="button" disabled={locked} onClick={() => {
          try { const text = studyStore.export(snapshot, sourceStore); downloadCollectionReviewReport({ text, filename: `Local-Notepad-阅读记录-${snapshot.collection.id}.json`, type: 'application/json;charset=utf-8' }); setMessage('已发起阅读记录下载，仅包含已保存的状态与批注；未存草稿不在其中。') }
          catch (failure) { setMessage(failure.message) }
        }}>备份阅读记录 JSON</button>
      </div>
      {bookmarked && <p>上次手动保存位置：{bookmarked.title || bookmarked.id}。继续阅读使用全部历史条目，读取当前正文，不自动恢复旧复查筛选。</p>}
      <details><summary>导入阅读记录</summary><p>先导入对应资料集，再选择本功能导出的阅读记录。预检只接受完全相同的历史检索结果；确认会替换当前已存进度与批注，不创建或改写正文。</p>
        <input type="file" accept=".json,application/json" aria-label="选择阅读记录备份" disabled={locked || !!preview} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file) }} />
      </details>
      {reading && <button type="button" onClick={() => { operation.current++; setReading(false); setMessage('已取消读取，原记录保留。') }}>取消读取阅读备份</button>}
      {preview && <div role="group" aria-label="阅读记录导入预检">
        <p>将替换本资料集已存阅读记录，共 {preview.value.data.records.length} 篇有状态或批注。未存批注草稿不会删除，保存时会再次检查冲突。请先备份当前记录。</p>
        <button type="button" disabled={locked} onClick={() => setPreview(null)}>取消阅读记录导入</button>
        <button type="button" disabled={locked} onClick={async () => {
          const result = await model.write((base, options) => studyStore.import(base, preview.value, options), preview.snapshot)
          if (result && live.current) { setPreview(null); setMessage('阅读记录已导入，历史资料集与正文未改动。') }
        }}>确认替换已存阅读记录</button>
      </div>}
      <div className="collection-study-filters">
        <label>阅读状态<select aria-label="资料集阅读筛选" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="all">全部阅读状态</option>{Object.entries(STUDY_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>检索批注<input type="search" maxLength={512} aria-label="搜索资料批注" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="标题、笔记 ID 或已存批注" /></label>
      </div>
      <div className="collection-study-list">{rows.slice((currentPage - 1) * 8, currentPage * 8).map(item => <article key={item.id}>
        <strong>{item.title || '未命名'}</strong><span>{STUDY_STATUS_LABELS[byId.get(item.id)?.status || 'unread']}</span>
        {byId.get(item.id)?.note && <p className="collection-study-note">{byId.get(item.id).note}</p>}
        <button type="button" disabled={locked} onClick={() => setEditing(item.id)}>编辑批注：{item.title || item.id}</button>
      </article>)}</div>
      {!rows.length && <p>没有符合条件的已存阅读记录；未删除任何条目。</p>}
      <nav className="collection-study-actions" aria-label="阅读记录分页"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>阅读记录上一页</button><span>第 {currentPage} / {pages} 页 · {rows.length} 篇</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>阅读记录下一页</button></nav>
      {editing && <div ref={editorRef} tabIndex={-1} key={editing} aria-label="工作台定位的批注编辑器"><h4>编辑：{snapshot.collection.report.items.find(item => item.id === editing)?.title || editing}</h4><CollectionStudyEditor model={model} documentId={editing} disabled={locked || !!preview} /></div>}
    </>}
  </details>
}
