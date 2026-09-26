import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  captureConflictReview, matchesConflictReview, conflictRecordLabel,
  conflictVersionSummary, conflictChangedFields,
} from '~/services/syncConflictReview.mjs'
import './SyncConflictReview.css'

function Version({ record, side }) {
  const version = useMemo(() => conflictVersionSummary(record), [record])
  return <section className="sync-review-version" aria-label={side + '版本'}>
    <h5>{side}版本 <small>{version.kind} · {version.state}</small></h5>
    <dl>{version.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {version.content && <>
      <p className="sync-review-caption">{version.content.notice}</p>
      <pre tabIndex={0} aria-label={side + '正文预览'}>{version.content.text || '（正文文本为空）'}</pre>
      {version.content.limited && <p className="sync-review-warning">预览未包含全部内容；选择前请核对完整文档。</p>}
    </>}
    {record?.kind === 'attachment' && <p className="sync-review-caption">只对照附件元数据，不下载或执行附件；同名文件也可能内容不同。</p>}
    {version.destructive && <p className="sync-review-warning">这是删除状态，采用此版本会把该状态应用到另一端。</p>}
    {!record && <p>此端没有可供选择的版本，不会把缺失数据视为一个空白版本。</p>}
  </section>
}

// Inline comparison: no modal focus trap, no selection or network mutation on mount.
export default function SyncConflictReview({ conflict, scope, disabled = false, onResolve, onRefresh }) {
  const choiceGroup = useId()
  const [review, setReview] = useState(null)
  const [choice, setChoice] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(null)
  const alive = useRef(false), inFlight = useRef(false), latest = useRef(null), activeReview = useRef(null)
  const heading = useRef(null), opener = useRef(null)
  latest.current = { conflict, scope }
  activeReview.current = review
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (review) heading.current?.focus() }, [review])
  const stale = !!review && !matchesConflictReview(review, conflict, scope)
  const done = !!completed && matchesConflictReview(completed, conflict, scope)
  const locked = disabled || pending || done
  const show = (side = '', event) => {
    if (locked || inFlight.current) return
    try {
      const next = captureConflictReview(conflict, scope)
      if (event?.currentTarget) opener.current = event.currentTarget
      setReview(next); setChoice(next[side + '_record'] ? side : '')
      setAcknowledged(false); setError('')
    } catch (reason) { setError(reason.message) }
  }
  const close = () => {
    if (inFlight.current) return
    setReview(null); setChoice(''); setAcknowledged(false); setError('')
    if (opener.current?.isConnected) opener.current.focus()
  }
  const choose = side => { setChoice(side); setAcknowledged(false); setError('') }
  const submit = async () => {
    if (locked || stale || inFlight.current || !acknowledged || !review?.[choice + '_record']) return
    const captured = review, side = choice
    inFlight.current = true; setPending(true); setError('')
    const isCurrent = () => alive.current && activeReview.current === captured &&
      matchesConflictReview(captured, latest.current.conflict, latest.current.scope)
    try {
      const result = await onResolve(captured, side, isCurrent)
      if (!alive.current) return
      if (result === true) { setCompleted(captured); setReview(null); setAcknowledged(false) }
      else { setError('处理未确认。请先刷新状态再重试；不会自动重复提交。'); setAcknowledged(false) }
    } catch {
      if (alive.current) { setError('处理未确认。请先刷新状态再重试；不会自动重复提交。'); setAcknowledged(false) }
    } finally { inFlight.current = false; if (alive.current) setPending(false) }
  }
  const chosen = review?.[choice + '_record']
  const changes = review ? conflictChangedFields(review) : []
  return <article className="sync-conflict-item sync-conflict-review-item">
    <div><strong>{conflictRecordLabel(conflict.local_record, conflict.item_id)}</strong>
      <span>本机：{conflictRecordLabel(conflict.local_record, '不存在')} · 远端：{conflictRecordLabel(conflict.remote_record, '不存在')}</span>
    </div>
    <div className="sync-conflict-actions">
      <button className="btn small" disabled={locked} onClick={event => show('', event)}>对照版本</button>
      <button className="btn small" disabled={locked} onClick={event => show('remote', event)}>采用远端</button>
      <button className="btn small primary" disabled={locked} onClick={event => show('local', event)}>保留本机</button>
    </div>
    {done && <p className="sync-review-message" role="status">处理请求已完成，以刷新后的同步状态为准。</p>}
    {error && <p className="sync-center-error sync-review-message" role="alert">{error}</p>}
    {review && <section className="sync-conflict-review" aria-label="冲突版本对照" aria-busy={pending}>
      <div className="sync-review-heading"><h4 ref={heading} tabIndex={-1}>先对照，再确认处理</h4>
        <button className="btn small" disabled={pending} onClick={close}>收起对照</button></div>
      <p>差异项：{changes.length ? changes.join('、') : '已展示字段相同，版本摘要仍不同；请核对完整内容'}。</p>
      <p className="sync-review-caption">这是冲突产生时的两端快照，不是实时编辑器。确认时会重读冲突；后台仍会校验基线和两端内容，不会自动合并或猜测版本。</p>
      <div className="sync-review-columns"><Version record={review.local_record} side="本机"/><Version record={review.remote_record} side="远端"/></div>
      {stale && <p className="sync-review-warning" role="alert">冲突或同步目标已变化，旧对照不能提交。请重新对照并确认。</p>}
      <fieldset disabled={locked || stale} className="sync-review-choice">
        <legend>选择要采用的版本</legend>
        <label><input type="radio" name={choiceGroup} checked={choice === 'local'} disabled={!review.local_record} onChange={() => choose('local')}/>保留本机版本 → 更新远端</label>
        <label><input type="radio" name={choiceGroup} checked={choice === 'remote'} disabled={!review.remote_record} onChange={() => choose('remote')}/>采用远端版本 → 更新本机</label>
      </fieldset>
      {chosen && <p className={'sync-review-direction' + (conflictVersionSummary(chosen).destructive ? ' sync-review-warning' : '')}>
        {choice === 'local' ? '将以本机版本更新远端。' : '将以远端版本更新本机。'}
        {conflictVersionSummary(chosen).destructive ? '所选版本是删除状态，请特别核对。' : '未选中的版本不会被自动合并。'}
      </p>}
      <label className="sync-review-ack"><input type="checkbox" checked={acknowledged} disabled={locked || stale || !chosen} onChange={event => setAcknowledged(true === event.target.checked)}/>我已核对两端版本和更新方向，确认处理这个冲突</label>
      <div className="sync-review-footer">
        <button className="btn" disabled={pending || disabled} onClick={() => { setAcknowledged(false); void onRefresh?.() }}>刷新冲突状态</button>
        {stale && <button className="btn" disabled={locked} onClick={() => show()}>重新对照</button>}
        <button className="btn primary" disabled={locked || stale || !chosen || !acknowledged} onClick={() => void submit()}>{pending ? '核对并提交中…' : '确认处理此冲突'}</button>
      </div>
      <small className="sync-review-caption">提交失败或响应中断时不会自动重试。请先刷新并核查结果；收起界面不代表已撤销发送的请求。</small>
    </section>}
  </article>
}
