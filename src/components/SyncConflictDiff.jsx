import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { buildConflictTextDiff, canCompareConflictText, conflictDiffPage } from '~/services/syncConflictDiff.mjs'
import './SyncConflictDiff.css'

const kindLabel = { same: '相同上下文', local: '仅本机', remote: '仅远端' }
const endingLabel = { none: '无换行', LF: '换行 LF', CRLF: '换行 CRLF', CR: '换行 CR' }

function DiffDetails({ model, stale }) {
  const [location, setLocation] = useState({ group: 0, page: 1 })
  const heading = useRef(null), focusRequested = useRef(false)
  const current = conflictDiffPage(model, location.group, location.page)
  useEffect(() => {
    if (!focusRequested.current) return
    focusRequested.current = false
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView?.({ block: 'nearest' })
  }, [location])
  const navigate = (group, page = 1) => { focusRequested.current = true; setLocation({ group, page }) }
  if (!current) return <div className="sync-diff-notice" role="status">{model.message}</div>
  const rows = [...current.before, ...current.changes, ...current.after]
  return <>
    <p className="sync-review-caption">{model.message}</p>
    {stale && <p className="sync-review-warning" role="status">当前差异来自已失效的对照快照，仅供查看；定位差异不会恢复提交资格。</p>}
    <p className="sync-diff-summary">共 {model.groups.length} 处差异 · 仅本机 {model.counts.localOnly} 行 · 仅远端 {model.counts.remoteOnly} 行</p>
    <div className="sync-diff-navigation" role="group" aria-label="正文差异位置">
      <button type="button" className="btn small" disabled={current.group === 0} onClick={() => navigate(current.group - 1)}>上一处差异</button>
      <strong ref={heading} tabIndex={-1}>第 {current.group + 1} / {model.groups.length} 处差异</strong>
      <button type="button" className="btn small" disabled={current.group + 1 === model.groups.length} onClick={() => navigate(current.group + 1)}>下一处差异</button>
    </div>
    <p className="sync-review-caption" role="status">本处显示第 {current.from}–{current.to} 条差异行，共 {current.total} 条；相同上下文不计入。</p>
    <div className="sync-diff-table-wrap" tabIndex={0} aria-label="可滚动的正文差异">
      <table className="sync-diff-table" aria-label="正文差异行">
        <thead><tr><th scope="col">本机行</th><th scope="col">远端行</th><th scope="col">对照文本</th></tr></thead>
        <tbody>{rows.map(line => <tr key={`${line.kind}:${line.localLine}:${line.remoteLine}`} className={'sync-diff-row sync-diff-' + line.kind} data-kind={line.kind}>
          <td>{line.localLine ?? '—'}</td><td>{line.remoteLine ?? '—'}</td>
          <td><div className="sync-diff-line-meta"><strong>{kindLabel[line.kind]}</strong><span>{endingLabel[line.ending]}</span></div>
            <pre>{line.text || <span className="sync-diff-empty">（空行）</span>}</pre></td>
        </tr>)}</tbody>
      </table>
    </div>
    {current.pages > 1 && <div className="sync-diff-navigation" role="group" aria-label="本处差异分页">
      <button type="button" className="btn small" disabled={current.page === 1} onClick={() => navigate(current.group, current.page - 1)}>上一页差异行</button>
      <span>第 {current.page} / {current.pages} 页</span>
      <button type="button" className="btn small" disabled={current.page === current.pages} onClick={() => navigate(current.group, current.page + 1)}>下一页差异行</button>
    </div>}
    <p className="sync-review-caption">本机来源：{model.sourceNotices[0]}。远端来源：{model.sourceNotices[1]}。</p>
  </>
}

// Compute only on demand. Scope all state to the captured review object, not
// merely its conflict ID (an explicit new review may reuse that ID).
export default function SyncConflictDiff({ review, stale = false }) {
  const [requestedReview, setRequestedReview] = useState(null)
  const opener = useRef(null), detailsID = useId()
  const open = !!review && requestedReview === review
  useEffect(() => { setRequestedReview(null) }, [review])
  const model = useMemo(() => open ? buildConflictTextDiff(review) : null, [open, review])
  if (!canCompareConflictText(review)) return null
  return <section className="sync-conflict-diff" aria-label="正文差异定位">
    <div className="sync-diff-heading"><strong>正文差异定位</strong>
      <button ref={opener} type="button" className="btn small" aria-expanded={open} aria-controls={open ? detailsID : undefined}
        onClick={() => { setRequestedReview(open ? null : review); if (open) opener.current?.focus() }}>
        {open ? '收起正文差异' : '查看正文差异'}
      </button>
    </div>
    {model && <div id={detailsID} className="sync-diff-details"><DiffDetails model={model} stale={stale}/></div>}
  </section>
}
