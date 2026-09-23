import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildEntityTermIndex } from './projectEntityMentionUtils'
import {
  ENTITY_EVIDENCE_SOURCES,
  buildEntityChapterPreview,
  selectProjectEntityEvidence,
} from './projectEntityEvidenceUtils'
import EvidenceLocateButton from './EvidenceLocateButton'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { hasReviewAnnotations } from '~/services/evidenceReviewReport'
import { toast } from '~/services/toast'
import EvidenceReviewRecords from './EvidenceReviewRecords'
import './ProjectEntityEvidencePanel.css'

function title(value) {
  return String(value || '未命名').replace(/\.[^.]+$/, '')
}

function ChapterEvidenceCard({ row, chapter, entity, termIndex, source, onOpenFile }) {
  const preview = useMemo(
    () => chapter ? buildEntityChapterPreview(chapter.content, termIndex, entity, { source }) : null,
    [chapter, termIndex, entity, source],
  )
  return (
    <article className="project-entity-evidence-card" data-evidence-chapter={row.chapterId} aria-label={'正文证据章节 ' + row.ordinal}>
      <header>
        <div>
          <strong>#{row.ordinal} {title(row.chapterTitle)}</strong>
          <small>{row.volumeTitle || '未分卷'} · 当前筛选 {row.matchCount} 次提及</small>
        </div>
        <button
          type="button"
          disabled={!chapter || !onOpenFile}
          onClick={() => {
            evidenceNavigation.cancel()
            try {
              Promise.resolve(onOpenFile?.(row.chapterId)).catch(() => toast.error('打开证据章节失败'))
            } catch { toast.error('打开证据章节失败') }
          }}
          aria-label={'打开证据章节 ' + title(row.chapterTitle)}
        >
          打开章节
        </button>
      </header>
      <div className="project-entity-evidence-provenance" aria-label="本章证据来源">
        {ENTITY_EVIDENCE_SOURCES.filter(item => item.id !== 'all' && row.counts[item.id] > 0)
          .map(item => <span key={item.id}>{item.label} {row.counts[item.id]}</span>)}
      </div>
      {preview ? (
        <>
          {preview.samples.map(sample => (
            <div className="project-entity-evidence-excerpt" key={sample.source + ':' + sample.start}>
              <small>{sample.source === 'alias' ? '别名' : '原名'} · {sample.term}</small>
              <p>
                {sample.leadingEllipsis && '…'}{sample.before}
                <mark>{sample.match}</mark>
                {sample.after}{sample.trailingEllipsis && '…'}
              </p>
              <EvidenceLocateButton chapterId={row.chapterId} content={chapter.content}
                sample={sample} onOpenFile={onOpenFile}
                label={'定位正文证据 ' + row.ordinal + ' ' + sample.start} />
            </div>
          ))}
          {preview.wikiLinks.length > 0 && (
            <div className="project-entity-evidence-wiki">
              <small>明确 WikiLink（链接标签，不是正文节选）</small>
              {preview.wikiLinks.map((link, index) => (
                <div key={index} className="project-entity-evidence-wiki-item">
                  <code>
                    {'[[' + (link.title || '未命名链接') +
                      (link.sectionPath.length ? '#' + link.sectionPath.join(' › ') : '') + ']]'}
                  </code>
                  <EvidenceLocateButton chapterId={row.chapterId} content={chapter.content}
                    noteId={entity.noteId} occurrence={index} onOpenFile={onOpenFile}
                    label={'定位 WikiLink 证据 ' + row.ordinal + ' ' + (index + 1)} />
                </div>
              ))}
            </div>
          )}
          {preview.omittedPlainCount + preview.omittedWikiCount > 0 && (
            <p className="project-entity-evidence-note">
              另有 {preview.omittedPlainCount + preview.omittedWikiCount} 次提及，请打开章节查看。
            </p>
          )}
          {!preview.samples.length && !preview.wikiLinks.length && (
            <p className="project-entity-evidence-note">当前正文未生成可展示节选，请打开章节核对。</p>
          )}
        </>
      ) : <p className="project-entity-evidence-note">当前章节内容暂不可用。</p>}
    </article>
  )
}

function EvidenceBrowser({ projectId, intelligence, entityId, projectMeta, onOpenFile }) {
  const [returning] = useState(() => evidenceReview.getReturn(projectId, entityId))
  const sectionRef = useRef(null)
  const restored = useRef(false)
  const [filters, setFilters] = useState(() => returning
    ? { ...returning.filters, focusChapterId: returning.chapterId }
    : { query: '', source: 'all', volumeId: null, page: 1 })
  const entity = intelligence?.entityById?.get(entityId)
  const view = useMemo(
    () => selectProjectEntityEvidence(intelligence, entityId, filters),
    [intelligence, entityId, filters],
  )
  const chapters = useMemo(
    () => new Map((intelligence?.chapters || []).map(chapter => [chapter.id, chapter])),
    [intelligence],
  )
  const termIndex = useMemo(
    () => buildEntityTermIndex(intelligence?.graph?.nodes || [], projectMeta?.entityAliases),
    [intelligence?.graph, projectMeta?.entityAliases],
  )
  // Match the overview's last-owner resolution for explicitly linked note IDs.
  const previewEntity = useMemo(() => {
    if (!entity?.noteId) return entity
    const owners = (intelligence?.graph?.nodes || [])
      .filter(node => String(node.noteId || '').trim() === String(entity.noteId).trim())
    return owners[owners.length - 1]?.id === entity.id ? entity : { ...entity, noteId: '' }
  }, [entity, intelligence?.graph])
  const updateFilters = patch => setFilters(previous => ({ ...previous, ...patch, focusChapterId: undefined, page: 1 }))
  const resetFilters = () => setFilters({ query: '', source: 'all', volumeId: null, page: 1 })
  const missingVolume = filters.volumeId !== null && !view.volumes.some(volume => volume.id === filters.volumeId)

  useEffect(() => {
    if (!returning || restored.current || !entity) return undefined
    const frame = requestAnimationFrame(() => {
      if (!evidenceReview.finishReturn(returning.id, returning.returnToken)) return
      restored.current = true
      setFilters(previous => ({ ...previous, focusChapterId: undefined, page: view.page }))
      const card = [...(sectionRef.current?.querySelectorAll('[data-evidence-chapter]') || [])]
        .find(element => element.dataset.evidenceChapter === returning.chapterId)
      const target = card || sectionRef.current
      target?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
      if (card) card.querySelector('button')?.focus({ preventScroll: true })
      else {
        sectionRef.current?.querySelector('input')?.focus({ preventScroll: true })
        toast.warning('原证据章节已不符合筛选，已按最新正文恢复列表')
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [entity, returning, view.page, view.rows])

  const openForReview = onOpenFile ? id => {
    const previous = evidenceReview.getSnapshot()
    const session = evidenceReview.start({
      projectId, entityId, entityLabel: entity?.label,
      filters: { ...filters, page: view.page },
    }, view.chapterQueue, id)
    if (!session && hasReviewAnnotations(previous)) {
      toast.warning('本轮有核对备注或待修改项，请先在编辑器核对栏导出并结束本轮，再更换核对范围', 6)
      return false
    }
    if (!session && projectId) toast.warning('本次范围无法建立连续核对，仍可直接打开章节')
    const cancel = () => { if (session) evidenceReview.cancelStart(session.id) }
    try {
      return Promise.resolve(onOpenFile(id)).then(accepted => {
        if (accepted === false) cancel()
        else if (session) evidenceReview.commitStart(session.id)
        return accepted
      }, error => { cancel(); throw error })
    } catch (error) { cancel(); throw error }
  } : undefined

  return (
    <section ref={sectionRef} className="project-entity-evidence-browser" aria-label="实体正文证据">
      <header>
        <h4>正文证据回看{entity ? ' · ' + entity.label : ''}</h4>
        <p>节选按当前正文生成，样式与连续空白已归一化。点击“定位此处”可跳到正文；过期证据需刷新。提及或同章共现不等于关系成立。</p>
      </header>
      <EvidenceReviewRecords onOpenFile={onOpenFile} />
      {!entity ? <p className="project-entity-evidence-note">请选择一个实体查看正文证据。</p> : (
        <>
          <div className="project-entity-evidence-filters">
            <label>
              <span>搜索证据章节</span>
              <input
                type="search"
                aria-label="搜索实体证据章节"
                placeholder="章节名、卷名或命中别名"
                value={filters.query}
                onChange={event => updateFilters({ query: event.target.value })}
              />
            </label>
            <label>
              <span>证据来源</span>
              <select
                aria-label="实体证据来源筛选"
                value={filters.source}
                onChange={event => updateFilters({ source: event.target.value })}
              >
                {ENTITY_EVIDENCE_SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>所在卷</span>
              <select
                aria-label="实体证据卷筛选"
                value={JSON.stringify(filters.volumeId)}
                onChange={event => updateFilters({ volumeId: JSON.parse(event.target.value) })}
              >
                <option value="null">全部卷</option>
                {view.volumes.map(volume => (
                  <option key={volume.id} value={JSON.stringify(volume.id)}>{volume.label}</option>
                ))}
                {missingVolume && <option value={JSON.stringify(filters.volumeId)}>原筛选卷已移除</option>}
              </select>
            </label>
            <button type="button" onClick={resetFilters}>重置筛选</button>
          </div>
          <p className="project-entity-evidence-summary" role="status" aria-live="polite">
            找到 {view.totalRows} 章 · 共 {view.totalMentions} 次{view.source === 'all' ? '' :
              ' ' + ENTITY_EVIDENCE_SOURCES.find(item => item.id === view.source)?.label + ' '}提及
          </p>
          <div className="project-entity-evidence-cards">
            {view.rows.map(row => (
              <ChapterEvidenceCard
                key={row.chapterId}
                row={row}
                chapter={chapters.get(row.chapterId)}
                entity={previewEntity}
                termIndex={termIndex}
                source={view.source}
                onOpenFile={openForReview}
              />
            ))}
          </div>
          {!view.totalRows && <p className="project-entity-evidence-note">没有符合当前筛选的证据。可重置筛选，或补充正文中的明确引用。</p>}
          {view.totalRows > 0 && (
            <nav className="project-entity-evidence-pagination" aria-label="实体证据分页">
              <button
                type="button"
                disabled={view.page <= 1}
                onClick={() => setFilters(previous => ({ ...previous, page: view.page - 1 }))}
              >上一页</button>
              <span>第 {view.page} / {view.pageCount} 页</span>
              <button
                type="button"
                disabled={view.page >= view.pageCount}
                onClick={() => setFilters(previous => ({ ...previous, page: view.page + 1 }))}
              >下一页</button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}

export default function ProjectEntityEvidencePanel(props) {
  // Reset filters/page when switching entity or project, without changing saved data.
  return <EvidenceBrowser key={JSON.stringify([props.projectId || '', props.entityId || ''])} {...props} />
}
