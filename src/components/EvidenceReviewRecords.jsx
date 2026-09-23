import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import {
  MAX_REVIEW_NOTE_LENGTH, REVIEW_STATES, downloadEvidenceReviewReport,
  getReviewAnnotation, hasReviewAnnotations, reviewRows, reviewTotals, selectReviewRows,
} from '~/services/evidenceReviewReport'
import { toast } from '~/services/toast'
import ConfirmDialog from './ConfirmDialog'
import { SaveReviewArchiveButton } from './EvidenceReviewArchives'
import './EvidenceReviewRecords.css'

export default function EvidenceReviewRecords({ documentId, dirty = false, busy = false, onOpenFile }) {
  const session = useSyncExternalStore(evidenceReview.subscribe, evidenceReview.getSnapshot, () => null)
  const [filters, setFilters] = useState({ state: 'all', query: '', page: 1 })
  const [endingId, setEndingId] = useState(null)
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const mounted = useRef(true)
  const endButton = useRef(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setFilters({ state: 'all', query: '', page: 1 }); setEndingId(null) }, [session?.id])
  const rows = useMemo(() => reviewRows(session), [session])
  const totals = useMemo(() => reviewTotals(rows), [rows])
  const view = useMemo(() => selectReviewRows(rows, filters), [rows, filters])
  const current = rows.find(row => row.id === documentId)
  const annotation = getReviewAnnotation(session, documentId)
  const blocked = busy || opening
  if (!session) return null

  const update = patch => setFilters(previous => ({ ...previous, ...patch, page: 1 }))
  const exportReport = () => {
    try {
      downloadEvidenceReviewReport(session)
      toast.success('已生成本轮全部章节的核对清单，请在下载位置查看')
    } catch {
      toast.error('清单导出失败，核对记录仍保留在当前窗口，请重试')
    }
  }
  const cancelEnd = () => { setEndingId(null); endButton.current?.focus() }
  const finish = () => {
    if (evidenceReview.end(session.id, { discardAnnotations: true })) evidenceNavigation.cancel()
    setEndingId(null)
  }
  const open = async id => {
    if (blocked || openingRef.current || !onOpenFile) return
    if (document.querySelector('.markdown-source-overlay')) {
      toast.warning('请先关闭 Markdown 源码面板，再打开核对章节')
      return
    }
    openingRef.current = true
    setOpening(true)
    evidenceNavigation.cancel()
    try {
      const accepted = await onOpenFile(id)
      if (accepted !== false) evidenceReview.visit(session.id, id)
    } catch {
      toast.error('无法打开核对章节，备注和本轮位置未改变')
    } finally {
      openingRef.current = false
      if (mounted.current) setOpening(false)
    }
  }
  return (
    <div className="evidence-review-records">
      <div className="evidence-review-records-tools">
        <span>本轮记录 · {session.entityLabel || '实体证据'} · {totals.changes} 章待修改</span>
        <button type="button" onClick={exportReport}>导出本轮清单</button>
        <SaveReviewArchiveButton disabled={blocked} />
        <button type="button" ref={endButton} disabled={blocked} onClick={() => {
          if (hasReviewAnnotations(session)) setEndingId(session.id)
          else finish()
        }}>结束核对</button>
      </div>
      <details className="evidence-review-records-details">
        <summary>核对备注与待修改清单</summary>
        <div className="evidence-review-records-body">
          <p className="evidence-review-records-notice">
            未存档的备注仅保留在当前窗口；需跨重启保留，请手动保存本地存档，或导出 JSON 备份。本轮标记不代表关系成立。
          </p>
          <div className="evidence-review-records-grid">
            <section className="evidence-review-note-editor" aria-label="本章核对备注">
              <strong>{current ? `${current.ordinal} · ${current.title}` : '打开本轮章节后可填写备注'}</strong>
              {current ? <>
                <label>
                  <span>问题、疑点或修订说明</span>
                  <textarea aria-label="本章核对备注内容" value={annotation?.text || ''}
                    maxLength={MAX_REVIEW_NOTE_LENGTH} disabled={blocked} rows={4}
                    placeholder="例如：本章称呼与人物设定不一致，需核对第二卷。"
                    onChange={event => {
                      if (!evidenceReview.setAnnotation(session.id, documentId, { text: event.target.value })) {
                        toast.warning('备注未写入，请检查长度或重新打开本轮清单')
                      }
                    }} />
                </label>
                <small>{(annotation?.text || '').length} / {MAX_REVIEW_NOTE_LENGTH} · 自动记入本轮，不修改正文</small>
                <button type="button" disabled={blocked} aria-pressed={Boolean(annotation?.needsChanges)}
                  onClick={() => evidenceReview.setAnnotation(session.id, documentId, { needsChanges: !annotation?.needsChanges })}>
                  {annotation?.needsChanges ? '取消待修改标记' : '标记待修改'}
                </button>
                <p className="evidence-review-records-notice">
                  {dirty ? '正文有未保存修改；备注仍保留，保存后再重新核对。' :
                    annotation?.needsChanges ? '处理后取消待修改，再明确标记已核对。' : '待修改会清除已核对标记，取消待修改不会自动标记完成。'}
                </p>
              </> : <p className="evidence-review-records-notice">可从右侧清单打开章节，也可直接导出已有记录。</p>}
            </section>
            <section className="evidence-review-records-list" aria-label="本轮核对章节清单">
              <div className="evidence-review-records-filters">
                <label><span>查找章节或备注</span><input type="search" aria-label="核对清单搜索" value={filters.query}
                  onChange={event => update({ query: event.target.value })} /></label>
                <label><span>核对状态</span><select aria-label="核对清单状态" value={filters.state}
                  onChange={event => update({ state: event.target.value })}>
                  {REVIEW_STATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label>
              </div>
              <p aria-live="polite" aria-label="核对清单统计" className="evidence-review-records-notice">
                本轮共 {totals.total} 章 · 已核对 {totals.reviewed} · 未核对 {totals.pending} · 待修改 {totals.changes}；筛选 {view.total} 章
              </p>
              <ul>
                {view.rows.map(row => <li key={row.id}>
                  <button type="button" disabled={blocked || !onOpenFile || row.id === documentId}
                    aria-label={'打开核对清单章节 ' + row.title} aria-current={row.id === documentId ? 'true' : undefined}
                    onClick={() => void open(row.id)}>
                    <span>{row.ordinal} · {row.title}</span>
                    <small>{REVIEW_STATES.find(item => item.id === row.state).label}</small>
                  </button>
                  {row.note && <p>{Array.from(row.note).slice(0, 100).join('')}{Array.from(row.note).length > 100 ? '…' : ''}</p>}
                </li>)}
              </ul>
              {!view.total && <p className="evidence-review-records-notice">没有匹配的核对记录。</p>}
              {view.pageCount > 1 && <nav aria-label="核对清单分页">
                <button type="button" disabled={view.page <= 1} onClick={() => setFilters(old => ({ ...old, page: view.page - 1 }))}>上一页清单</button>
                <span>{view.page} / {view.pageCount}</span>
                <button type="button" disabled={view.page >= view.pageCount} onClick={() => setFilters(old => ({ ...old, page: view.page + 1 }))}>下一页清单</button>
              </nav>}
            </section>
          </div>
        </div>
      </details>
      {endingId === session.id && <ConfirmDialog title="结束本轮核对？"
        message="本轮有备注或待修改标记，结束后会清除当前窗口记录，但不删除已保存的存档。后续修改不会自动存档；请先保存或导出清单。"
        onClose={cancelEnd} actions={[
          { label: '先导出清单', onClick: exportReport },
          { label: '保留并继续', kind: 'primary', onClick: cancelEnd },
          { label: '确认结束并清除', onClick: finish },
        ]} />}
    </div>
  )
}
