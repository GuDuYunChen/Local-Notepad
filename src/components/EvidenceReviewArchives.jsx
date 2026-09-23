import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { reviewArchives, REVIEW_ARCHIVE_PREFIX, downloadReviewArchive } from '~/services/evidenceReviewArchives'
import { planReviewArchiveRestore, readReviewArchive, MAX_REVIEW_ARCHIVE_LENGTH } from '~/services/evidenceReviewArchiveData'
import { downloadEvidenceReviewReport, reviewRows, reviewTotals } from '~/services/evidenceReviewReport'
import { selectProjectEntityEvidence } from './projectEntityEvidenceUtils'
import { toast } from '~/services/toast'
import ConfirmDialog from './ConfirmDialog'
import EvidenceReviewArchiveComparison from './EvidenceReviewArchiveComparison'
import EvidenceReviewBackup from './EvidenceReviewBackup'
import './EvidenceReviewArchives.css'

export function SaveReviewArchiveButton({ disabled = false }) {
  const session = useSyncExternalStore(evidenceReview.subscribe, evidenceReview.getSnapshot, () => null)
  const [saved, setSaved] = useState(null)
  return <span className="evidence-archive-save">
    <button type="button" disabled={disabled || !session || saved === session} onClick={() => {
      const current = evidenceReview.getSnapshot()
      if (!current) return
      try {
        reviewArchives.save(current)
        setSaved(current)
        toast.success('已保存本地核对存档；后续修改需再次存档。存档不包含正文，建议另导出 JSON 备份')
      } catch (error) { toast.error(error.message || '存档失败，当前核对记录仍保留') }
    }}>保存本地存档</button>
    {saved && <small aria-live="polite">{saved === session ? '此份记录已存档' : '本轮有更新，尚未再次存档'}</small>}
  </span>
}

function ArchiveManager({ projectId, entityId, intelligence, onRestored }) {
  const [result, setResult] = useState(() => reviewArchives.list())
  const [scope, setScope] = useState(projectId && entityId ? 'current' : 'all')
  const [page, setPage] = useState(1)
  const [action, setAction] = useState(null)
  const [importing, setImporting] = useState(false)
  const mounted = useRef(true)
  const input = useRef(null)
  const trigger = useRef(null)
  useEffect(() => {
    mounted.current = true
    const refresh = () => setResult(reviewArchives.list())
    const unsubscribe = reviewArchives.subscribe(refresh)
    const onStorage = event => { if (event.key === null || event.key?.startsWith(REVIEW_ARCHIVE_PREFIX)) refresh() }
    window.addEventListener('storage', onStorage)
    refresh()
    return () => { mounted.current = false; unsubscribe(); window.removeEventListener('storage', onStorage) }
  }, [])
  const entries = useMemo(() => result.entries.filter(entry => scope === 'all' ||
    (entry.archive?.data.projectId === projectId && entry.archive?.data.entityId === entityId)), [result, scope, projectId, entityId])
  const pages = Math.max(1, Math.ceil(entries.length / 5))
  const currentPage = Math.min(page, pages)
  const plan = entry => {
    const archive = readReviewArchive(reviewArchives.readUnchanged(entry))
    const entity = intelligence?.entityById?.get(entityId)
    if (!entity) throw new Error('当前实体不可用；存档仍保留，可导出历史清单')
    const view = selectProjectEntityEvidence(intelligence, entityId, archive.data.filters)
    return planReviewArchiveRestore(archive, { projectId, entityId, entityLabel: entity.label, chapterQueue: view.chapterQueue })
  }
  const close = () => { setAction(null); trigger.current?.focus() }
  const beginRestore = (entry, event) => {
    if (evidenceReview.getSnapshot()) { toast.warning('请先保存并结束当前核对，再恢复存档；不会覆盖本轮记录'); return }
    try {
      const preview = plan(entry)
      trigger.current = event.currentTarget
      setAction({ type: 'restore', entry, preview })
    } catch (error) { toast.error(error.message) }
  }
  const confirm = () => {
    try {
      if (action.type === 'delete') reviewArchives.remove(action.entry)
      else {
        const latest = plan(action.entry)
        // The model may have changed while the confirmation was open.
        if (JSON.stringify(latest) !== JSON.stringify(action.preview)) throw new Error('正文证据范围已变化，请重新点击恢复并核对预览')
        const restored = evidenceReview.restoreArchive(latest.data)
        if (!restored) throw new Error('当前已有核对或正在打开章节；请先结束该轮，存档没有覆盖任何记录')
        evidenceNavigation.cancel()
        onRestored?.(restored)
        toast.success('已恢复备注与待修改项；所有章节需重新核对。原存档仍保留')
      }
    } catch (error) { toast.error(error.message || '操作失败，原记录未改动') }
    close()
  }
  const importFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || importing) return
    setImporting(true)
    try {
      if (file.size > MAX_REVIEW_ARCHIVE_LENGTH * 3) throw new Error('存档文件过大，未导入')
      const raw = await file.text()
      if (!mounted.current) return
      reviewArchives.importFile(raw)
      setScope('all'); setPage(1)
      toast.success('存档已导入本地，尚未恢复核对；请在对应项目和实体中明确选择恢复')
    } catch (error) { if (mounted.current) toast.error(error.message || '导入失败，已有记录未改动') }
    finally { if (mounted.current) setImporting(false) }
  }
  return <details className="evidence-review-archives">
    <summary>本地核对存档 · {result.error ? '读取失败' : result.entries.length + ' 份'}</summary>
    <div className="evidence-review-archives-body">
      <p>手动保存的独立快照，刷新或重启后仍可读取；后续备注不会自动写入旧存档。仅保存在当前浏览器／应用用户数据中，不是云备份，也不随正文数据库备份迁移，请导出 JSON 留存。</p>
      <div className="evidence-review-archives-tools">
        <label>查看范围<select aria-label="存档查看范围" value={scope} onChange={event => { setScope(event.target.value); setPage(1) }}>
          <option value="current">当前项目与实体</option><option value="all">全部本地存档</option>
        </select></label>
        <button type="button" disabled={importing} onClick={() => input.current?.click()}>{importing ? '正在读取存档…' : '导入存档 JSON'}</button>
        <input ref={input} type="file" accept=".json,application/json" aria-label="导入核对存档文件" hidden onChange={event => void importFile(event)} />
        <button type="button" onClick={() => setResult(reviewArchives.list())}>刷新存档列表</button>
      </div>
      {result.error && <p role="alert">{result.error}</p>}
      <EvidenceReviewBackup key={scope} entries={entries} storageError={result.error}
        scopeLabel={scope === 'current' ? '当前项目与实体' : '全部本地存档'} />
      <EvidenceReviewArchiveComparison entries={entries} storageError={result.error} />
      {!result.error && !entries.length && <p>此范围暂无存档。可在本轮记录中点击“保存本地存档”，或切换至全部本地存档。</p>}
      <ul>
        {entries.slice((currentPage - 1) * 5, currentPage * 5).map(entry => {
          const data = entry.archive?.data
          const totals = data ? reviewTotals(reviewRows(data)) : null
          const matches = data?.projectId === projectId && data?.entityId === entityId
          return <li key={entry.key}>
            <strong>{data?.entityLabel || (data ? '实体核对存档' : '不可读取的存档')}</strong>
            {data ? <>
              <time dateTime={entry.archive.savedAt}>{new Date(entry.archive.savedAt).toLocaleString('zh-CN', { hour12: false })}</time>
              <p>项目 {data.projectId} · {data.chapters.length} 章 · 历史已核对 {totals.reviewed} · 待修改 {totals.changes} · 有备注 {totals.noted}</p>
              {!matches && <p>恢复前请切换到对应项目与实体（{data.entityId}）。</p>}
            </> : <p role="status">{entry.error}</p>}
            <div className="evidence-review-archives-actions">
              {data && <button type="button" disabled={!matches || !onRestored} onClick={event => beginRestore(entry, event)}>恢复此存档</button>}
              {data && <button type="button" onClick={() => {
                try { const fresh = readReviewArchive(reviewArchives.readUnchanged(entry)); downloadEvidenceReviewReport(fresh.data) }
                catch (error) { toast.error(error.message || '历史清单导出失败') }
              }}>导出历史清单</button>}
              <button type="button" onClick={() => { try { downloadReviewArchive(entry) } catch (error) { toast.error(error.message) } }}>导出存档 JSON</button>
              <button type="button" onClick={event => { trigger.current = event.currentTarget; setAction({ type: 'delete', entry }) }}>删除此存档</button>
            </div>
          </li>
        })}
      </ul>
      {pages > 1 && <nav aria-label="核对存档分页">
        <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页存档</button>
        <span>{currentPage} / {pages}</span>
        <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页存档</button>
      </nav>}
      {action && <ConfirmDialog title={action.type === 'delete' ? '删除这份本地存档？' : '恢复核对存档？'}
        message={action.type === 'delete' ? '只删除此份本地快照，不改动当前核对、正文或已经导出的文件。删除后无法撤销，建议先导出 JSON。' :
          `将恢复备注、待修改项和筛选。${action.preview.resetCount} 章历史已核对标记不会沿用，所有章节需重新核对；按当前筛选新增 ${action.preview.addedCount} 个证据章。不会修改正文或删除原存档。`}
        onClose={close} actions={[
          { label: '取消', kind: 'primary', onClick: close },
          { label: action.type === 'delete' ? '确认删除存档' : '恢复并重新核对', onClick: confirm },
        ]} />}
    </div>
  </details>
}

export default function EvidenceReviewArchives(props) {
  return <ArchiveManager key={JSON.stringify([props.projectId, props.entityId])} {...props} />
}
