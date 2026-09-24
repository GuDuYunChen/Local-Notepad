import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectionStudyHub, selectCollectionStudyHub } from '~/services/collectionStudyHub'
import { collectionStudy, COLLECTION_STUDY_PREFIX, STUDY_STATUS_LABELS } from '~/services/collectionStudy'
import { searchCollections, SEARCH_COLLECTION_PREFIX } from '~/services/searchCollections'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import './CollectionStudyHub.css'

const defaults = () => ({ query: '', status: 'all', collectionKey: '', notesOnly: true, sort: 'updated', page: 1 })
export default function CollectionStudyHub({ active, onLocate, service = collectionStudyHub,
  sourceStore = searchCollections, studyStore = collectionStudy }) {
  const [model, setModel] = useState(null), [filters, setFilters] = useState(defaults)
  const [loading, setLoading] = useState(false), [stale, setStale] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const operation = useRef(null), live = useRef(false)
  const refresh = useCallback(async () => {
    operation.current?.abort()
    const controller = new AbortController(); operation.current = controller
    setLoading(true); setError(''); setMessage('')
    try {
      const next = await service.load({ signal: controller.signal })
      if (live.current && operation.current === controller && !controller.signal.aborted) { setModel(next); setStale(false) }
    } catch (failure) {
      if (live.current && operation.current === controller && !controller.signal.aborted) { setError(failure.message || '工作台读取失败，不能判断为空'); setStale(true) }
    } finally { if (live.current && operation.current === controller) { operation.current = null; setLoading(false) } }
  }, [service])
  useEffect(() => {
    live.current = true
    if (active) void refresh()
    else { operation.current?.abort(); operation.current = null; setLoading(false) }
    return () => { live.current = false; operation.current?.abort(); operation.current = null }
  }, [active, refresh])
  useEffect(() => {
    const invalidate = () => {
      operation.current?.abort(); operation.current = null
      setLoading(false); setStale(true); setMessage('本地记录发生变化，请刷新工作台；旧快照不会覆盖任何批注。')
    }
    const storage = event => { if (event.key === null || event.key?.startsWith(COLLECTION_STUDY_PREFIX) || event.key?.startsWith(SEARCH_COLLECTION_PREFIX)) invalidate() }
    const focus = () => { if (active && model) { try { service.assertCurrent(model) } catch { invalidate() } } }
    const offSource = sourceStore.subscribe(invalidate), offStudy = studyStore.subscribe(invalidate)
    window.addEventListener('storage', storage); window.addEventListener('focus', focus)
    return () => { offSource(); offStudy(); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus) }
  }, [sourceStore, studyStore, service, active, model])
  const view = useMemo(() => selectCollectionStudyHub(model, filters), [model, filters])
  const update = patch => setFilters(previous => ({ ...previous, ...patch, page: 1 }))
  const disabled = !active || loading || stale || !model
  const run = action => {
    setError(''); setMessage('')
    try { action() } catch (failure) { setError(failure.message || '操作未完成'); setStale(true) }
  }
  const exportReport = format => run(() => {
    downloadCollectionReviewReport(service.export(model, filters, format))
    setMessage('已发起当前筛选全部条目的下载，请核对下载目录；包含已存私人批注，不含正文或未存草稿。')
  })
  return <section className="collection-study-hub" aria-label="跨资料集阅读批注工作台">
    <header><h3>阅读批注工作台</h3><p>集中查找各资料集的已存批注和待复看资料。相同笔记在不同资料集中分别显示，不合并批注；人工已读不代表正文已核验。</p></header>
    <div className="study-hub-actions"><button type="button" disabled={!active || loading} onClick={() => void refresh()}>刷新阅读工作台</button>
      {loading && <button type="button" onClick={() => { operation.current?.abort(); operation.current = null; setLoading(false); setStale(true); setMessage('已取消读取，原记录未改动。') }}>取消工作台读取</button>}
      <button type="button" disabled={disabled || !view.total || model?.issues.length > 0} onClick={() => exportReport('markdown')}>导出筛选批注 Markdown</button>
      <button type="button" disabled={disabled || !view.total || model?.issues.length > 0} onClick={() => exportReport('json')}>导出筛选批注 JSON</button>
    </div>
    {loading && <p role="status">正在读取本地资料集与阅读记录…</p>}
    {error && <p className="study-hub-notice" role="alert">{error}</p>}
    {message && <p className="study-hub-notice" role="status">{message}</p>}
    {model && <>
      <div className="study-hub-metrics" aria-label="有效阅读范围统计">
        <span><b>{model.collections.length} / {model.sourceCount}</b>资料集可读取</span><span><b>{model.counts.notes}</b>条已存批注</span>
        <span><b>{model.counts.read}</b>条已读</span><span><b>{model.counts.revisit}</b>条待复看</span><span><b>{model.counts.unread}</b>条未读</span>
      </div>
      <p className="study-hub-caption">以上仅统计本次可读取的 {model.counts.total} 条历史条目；跨资料集重复分别计数。读取时间：{new Date(model.loadedAt).toLocaleString('zh-CN')}{stale ? ' · 快照已过期，请刷新' : ''}</p>
      {model.issues.length > 0 && <details className="study-hub-notice" open><summary>{model.issues.length} 份记录未计入，暂不可导出完整清单</summary>
        <p>缺少来源可能是资料集已删除或恢复暂存，不代表批注可以删除。记录均已保留，可使用原便携文件重新预检恢复。</p>
        {model.issues.map(issue => <p key={issue.key}>{issue.reason}<br /><small>{issue.key}</small></p>)}
      </details>}
      <div className="study-hub-filters">
        <label>搜索批注<input type="search" aria-label="跨资料集批注关键词" maxLength={512} placeholder="批注、标题、目录、笔记 ID 或资料集名" value={filters.query} onChange={e => update({ query: e.target.value })} /></label>
        <label>资料集<select aria-label="阅读工作台资料集筛选" value={filters.collectionKey} onChange={e => update({ collectionKey: e.target.value })}>
          <option value="">全部可读取资料集</option>{model.collections.map(item => <option key={item.key} value={item.key}>{item.name} · {item.count} 篇</option>)}
          {filters.collectionKey && !model.collections.some(item => item.key === filters.collectionKey) && <option value={filters.collectionKey}>原资料集不可用</option>}
        </select></label>
        <label>人工状态<select aria-label="阅读工作台状态筛选" value={filters.status} onChange={e => update({ status: e.target.value })}><option value="all">全部阅读状态</option>{Object.entries(STUDY_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>排序<select aria-label="阅读工作台排序" value={filters.sort} onChange={e => update({ sort: e.target.value })}><option value="updated">批注最近保存</option><option value="collection">资料集与原条目顺序</option></select></label>
        <label className="study-hub-check"><input type="checkbox" checked={filters.notesOnly} onChange={e => update({ notesOnly: e.target.checked })} />只看有批注</label>
        <button type="button" onClick={() => setFilters(defaults())}>重置阅读筛选</button>
      </div>
      <p role="status">符合筛选 {view.total} 条 · 每页 12 条{stale ? '（旧快照）' : ''}</p>
      <div className="study-hub-rows">{view.rows.map(row => <article key={row.key} aria-label={'阅读批注 ' + row.collectionId + ' ' + row.id}>
        <header><strong>{row.title || '未命名'}</strong><span>{STUDY_STATUS_LABELS[row.status]}{row.bookmarked ? ' · 上次书签' : ''}</span></header>
        <p className="study-hub-caption">{row.collectionName} · 原第 {row.ordinal} 条 · {row.folderPath || '根目录'}</p>
        <p className="study-hub-note">{row.note || '（无已存批注）'}</p>
        <small>笔记 ID：{row.id} · {row.updatedAt ? '保存于 ' + new Date(row.updatedAt).toLocaleString('zh-CN') : '未保存人工标记'}</small>
        <button type="button" disabled={disabled || !onLocate} onClick={() => run(() => onLocate(service.locate(model, row.key)))}>查看并编辑此批注</button>
      </article>)}</div>
      {!view.total && <p className="study-hub-empty">当前筛选没有条目。可取消“只看有批注”查看未读和待复看资料；未删除任何记录。</p>}
      <nav className="study-hub-actions" aria-label="阅读工作台分页"><button type="button" disabled={view.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: view.page - 1 }))}>批注上一页</button><span>第 {view.page} / {view.pages} 页</span><button type="button" disabled={view.page >= view.pages} onClick={() => setFilters(previous => ({ ...previous, page: view.page + 1 }))}>批注下一页</button></nav>
    </>}
    <footer>仅汇总已存记录，不检索正文或未保存批注。导出覆盖当前筛选全部分页，最多 8 MiB；清单不是可恢复备份。修改批注仍需进入对应资料集后明确保存。</footer>
  </section>
}
