import React, { useMemo, useState } from 'react'
import { reviewArchives } from '~/services/evidenceReviewArchives'
import { readReviewArchive } from '~/services/evidenceReviewArchiveData'
import {
  compareReviewArchives, selectReviewComparisonRows, buildReviewComparisonReport,
  reviewComparisonScopeLabel, REVIEW_COMPARISON_FILTERS, REVIEW_COMPARISON_KINDS,
  REVIEW_COMPARISON_STATES,
} from '~/services/evidenceReviewComparison'
import { toast } from '~/services/toast'
import './EvidenceReviewArchiveComparison.css'

function optionLabel(entry) {
  const archive = entry.archive
  return `${new Date(archive.savedAt).toLocaleString('zh-CN', { hour12: false })} · ${archive.data.entityLabel || archive.data.entityId} · ${archive.data.chapters.length}章 · ${archive.id}`
}
function ArchiveSide({ label, value }) {
  return <div className="review-compare-side">
    <strong>{label}</strong>
    {value ? <>
      <p>{value.title} · 序号 {value.ordinal} · {REVIEW_COMPARISON_STATES[value.state]}</p>
      <p className="review-compare-note">{value.note || '（无备注）'}</p>
    </> : <p>不在此存档范围内</p>}
  </div>
}

export default function EvidenceReviewArchiveComparison({ entries = [], storageError = '' }) {
  const [baseKey, setBaseKey] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ state: 'changed', query: '', page: 1 })
  const readable = useMemo(() => entries.filter(entry => entry.archive), [entries])
  const base = readable.find(entry => entry.key === baseKey)
  const targets = readable.filter(entry => entry.key !== baseKey && (!base || (
    entry.archive.data.projectId === base.archive.data.projectId &&
    entry.archive.data.entityId === base.archive.data.entityId
  )))
  const target = targets.find(entry => entry.key === targetKey)
  const stale = Boolean(result && (storageError || [result.base, result.target].some(selected =>
    !entries.some(entry => entry.key === selected.key && entry.raw === selected.raw && entry.archive))))
  const comparison = result && !stale ? result.comparison : null
  const view = useMemo(() => selectReviewComparisonRows(comparison, filters), [comparison, filters])
  const resetResult = () => { setResult(null); setError('') }
  const compare = () => {
    if (!base || !target || storageError) return
    try {
      const comparison = compareReviewArchives(
        readReviewArchive(reviewArchives.readUnchanged(base)),
        readReviewArchive(reviewArchives.readUnchanged(target)),
      )
      setResult({ base, target, comparison }); setError('')
      setFilters({ state: 'changed', query: '', page: 1 })
    } catch (failure) { setResult(null); setError(failure.message || '无法对比，请刷新存档列表') }
  }
  const exportReport = () => {
    if (!result || stale || !comparison) return
    let url, link
    try {
      // Revalidate at the action boundary even when no storage event was delivered.
      const fresh = compareReviewArchives(
        readReviewArchive(reviewArchives.readUnchanged(result.base)),
        readReviewArchive(reviewArchives.readUnchanged(result.target)),
      )
      const date = new Date()
      const text = buildReviewComparisonReport(fresh, date)
      url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/markdown;charset=utf-8' }))
      link = document.createElement('a')
      link.href = url
      link.download = `核对存档对比-${date.toISOString().slice(0, 10)}-${fresh.before.id.slice(0, 8)}-${fresh.after.id.slice(0, 8)}.md`
      document.body.append(link); link.click()
    } catch (failure) {
      setResult(null); setError(failure.message || '导出失败，请刷新后重新对比')
      toast.error(failure.message || '对比清单导出失败，存档未改动')
    } finally {
      link?.remove()
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  const updateFilter = patch => setFilters(previous => ({ ...previous, ...patch, page: 1 }))
  return <details className="review-archive-comparison">
    <summary>对比两份核对存档</summary>
    <div className="review-compare-content">
      <p>按所选 A → B 对比同一项目、同一实体的历史记录；不读取正文，不修改存档或当前核对。</p>
      <div className="review-compare-selectors">
        <label>基准 A<select aria-label="对比基准存档" value={baseKey} onChange={event => {
          setBaseKey(event.target.value); setTargetKey(''); resetResult()
        }}><option value="">选择基准存档</option>
          {readable.map(entry => <option key={entry.key} value={entry.key}>{optionLabel(entry)}</option>)}
        </select></label>
        <label>对照 B<select aria-label="对比目标存档" value={targetKey} disabled={!base} onChange={event => {
          setTargetKey(event.target.value); resetResult()
        }}><option value="">选择同一实体的另一份存档</option>
          {targets.map(entry => <option key={entry.key} value={entry.key}>{optionLabel(entry)}</option>)}
        </select></label>
      </div>
      <div className="review-compare-actions">
        <button type="button" disabled={!base || !target || Boolean(storageError)} onClick={compare}>开始对比</button>
        <button type="button" disabled={!base || !target || Boolean(storageError)} onClick={() => {
          setBaseKey(targetKey); setTargetKey(baseKey); resetResult()
        }}>交换 A / B</button>
        <button type="button" disabled={!comparison} onClick={exportReport}>导出完整对比</button>
      </div>
      {readable.length < 2 && <p>当前查看范围内至少需要两份同一项目、同一实体的有效存档。</p>}
      {base && !targets.length && readable.length >= 2 && <p>此基准没有可对比的同项目、同实体存档。</p>}
      {(error || stale) && <p role="alert">{stale ? '所选存档已变化、被删除或不在查看范围内，请刷新并重新选择；旧对比已停用。' : error}</p>}
      {comparison && <>
        <div className="review-compare-provenance">
          <p><b>A：</b>{comparison.before.entityLabel || comparison.entityId} · {comparison.before.savedAt}<br />{reviewComparisonScopeLabel(comparison.before.filters)}</p>
          <p><b>B：</b>{comparison.after.entityLabel || comparison.entityId} · {comparison.after.savedAt}<br />{reviewComparisonScopeLabel(comparison.after.filters)}</p>
        </div>
        <p className="review-compare-caution">取消待修改仅表示人工标记变化，不代表问题已修复；移出范围不算解决。历史已核对不代表当前正文已审核。</p>
        {comparison.filterChanges.length > 0 && <p role="status">两份存档筛选条件不同，范围增减可能来自来源、卷或搜索变化。</p>}
        {comparison.reverseChronology && <p role="status">B 的保存时间早于 A，仍按 A → B 计算；可交换方向。</p>}
        {comparison.sameTimestamp && <p role="status">保存时间相同，不推断先后；按所选 A → B 计算。</p>}
        <p className="review-compare-totals" role="status">
          共同 {comparison.totals.common} 章 · 变化 {comparison.totals.changed} 章 · 未变化 {comparison.totals.unchanged} 章
          {' · '}新增到范围 {comparison.totals.added} 章 · 移出范围 {comparison.totals.removed} 章
        </p>
        <p>共同章节：新增待修改 {comparison.totals.issueAdded} · 取消待修改 {comparison.totals.issueCleared} · 仍待修改 {comparison.totals.issueRetained} · 备注变化 {comparison.totals.noteChanged}。各维度可重叠。</p>
        <div className="review-compare-filters">
          <label>变化类型<select aria-label="存档对比变化筛选" value={filters.state} onChange={event => updateFilter({ state: event.target.value })}>
            {REVIEW_COMPARISON_FILTERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          <label>搜索<input type="search" aria-label="搜索存档对比" placeholder="章节名、ID 或两侧备注" value={filters.query}
            onChange={event => updateFilter({ query: event.target.value })} /></label>
        </div>
        <p aria-live="polite">当前筛选 {view.total} 章；导出始终包含全部 {comparison.totals.total} 章并集。</p>
        <div className="review-compare-rows">
          {view.rows.map(row => <article className="review-compare-row" key={row.id} aria-label={'存档对比章节 ' + row.id}>
            <header><strong>{(row.after || row.before).title}</strong><span>{REVIEW_COMPARISON_KINDS[row.kind]}</span></header>
            <small>章节 ID：{row.id}</small>
            {row.changes.issueAdded && <p>新增待修改标记</p>}
            {row.changes.issueCleared && <p>取消待修改标记（不代表已修复）</p>}
            {row.changes.orderChanged && <p>共同章节相对次序变化</p>}
            <div className="review-compare-sides"><ArchiveSide label="基准 A" value={row.before} /><ArchiveSide label="对照 B" value={row.after} /></div>
          </article>)}
        </div>
        {!view.total && <p>当前筛选没有章节，可切换“全部章节”或清空搜索。</p>}
        {view.total > 0 && <nav aria-label="存档对比分页">
          <button type="button" disabled={view.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: view.page - 1 }))}>上一页对比</button>
          <span>{view.page} / {view.pageCount}</span>
          <button type="button" disabled={view.page >= view.pageCount} onClick={() => setFilters(previous => ({ ...previous, page: view.page + 1 }))}>下一页对比</button>
        </nav>}
      </>}
    </div>
  </details>
}
