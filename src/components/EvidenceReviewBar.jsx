import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { toast } from '~/services/toast'
import './EvidenceReviewBar.css'

export default function EvidenceReviewBar({ documentId, dirty = false, onOpenFile, onReturn }) {
  const session = useSyncExternalStore(evidenceReview.subscribe, evidenceReview.getSnapshot, () => null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const index = session?.chapters.findIndex(item => item.id === documentId) ?? -1
  useEffect(() => {
    if (!session || index < 0) return
    evidenceReview.visit(session.id, documentId)
    if (dirty) evidenceReview.setReviewed(session.id, documentId, false)
  }, [session?.id, documentId, index, dirty])

  const sourceModeBlocksNavigation = () => {
    if (!document.querySelector('.markdown-source-overlay')) return false
    toast.warning('请先关闭 Markdown 源码面板；未应用的源码不会被自动覆盖或丢弃')
    return true
  }
  const open = async offset => {
    if (busyRef.current || !session || index < 0 || sourceModeBlocksNavigation()) return
    const target = session.chapters[index + offset]
    if (!target || !onOpenFile) return
    busyRef.current = true
    setBusy(true)
    evidenceNavigation.cancel()
    try {
      // The application resolves false when the unsaved-changes dialog is
      // cancelled. Do not advance progress on click or failed file retrieval.
      const accepted = await onOpenFile(target.id)
      if (accepted !== false) evidenceReview.visit(session.id, target.id)
    } catch {
      toast.error('无法打开证据章节，本轮位置未改变')
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  if (!session) return null
  const reviewed = session.reviewedIds.includes(documentId)
  return (
    <section className="evidence-review-bar" aria-label="证据连续核对" aria-busy={busy}>
      <div className="evidence-review-heading">
        <strong>正在核对 · {session.entityLabel || '实体证据'}</strong>
        <span role="status">
          {index >= 0 ? `第 ${index + 1} / ${session.chapters.length} 个证据章节` : '当前笔记不在本轮范围'}
          {' · '}本轮已核对 {session.reviewedIds.length} 章
        </span>
        <small>范围来自进入时的筛选；相邻按钮打开整章，返回列表可定位具体片段。</small>
      </div>
      <div className="evidence-review-actions">
        <button type="button" disabled={busy || index <= 0 || !onOpenFile} onClick={() => void open(-1)}>上一证据章</button>
        <button type="button" disabled={busy || index < 0 || index >= session.chapters.length - 1 || !onOpenFile} onClick={() => void open(1)}>下一证据章</button>
        <button type="button" aria-pressed={reviewed} disabled={busy || index < 0 || dirty}
          title={dirty ? '保存修改后再标记；编辑会清除本章的已核对标记' : '仅记录本轮进度，不确认关系或修改正文'}
          onClick={() => evidenceReview.setReviewed(session.id, documentId, !reviewed)}>
          {dirty ? '保存后可标记' : reviewed ? '已核对' : '标记已核对'}
        </button>
        <button type="button" className="evidence-review-return" disabled={busy || !onReturn}
          onClick={() => { if (!sourceModeBlocksNavigation()) onReturn?.(session.id) }}>返回证据列表</button>
        <button type="button" disabled={busy} onClick={() => {
          evidenceNavigation.cancel()
          evidenceReview.end(session.id)
        }}>结束核对</button>
      </div>
    </section>
  )
}
