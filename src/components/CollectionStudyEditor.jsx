import React, { useEffect, useRef, useState } from 'react'
import { STUDY_STATUS_LABELS, MAX_STUDY_NOTE_LENGTH } from '~/services/collectionStudy'
import { collectionStudyDrafts, studyDraftKey } from '~/services/collectionStudyDrafts'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import './CollectionStudy.css'

export default function CollectionStudyEditor({ model, documentId, disabled = false }) {
  const [, render] = useState(0), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false)
  const alive = useRef(true), last = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  if (model.snapshot) last.current = model.snapshot
  const snapshot = model.snapshot || last.current
  if (!snapshot || !snapshot.collection.report.items.some(item => item.id === documentId)) return null
  const key = studyDraftKey(snapshot, documentId), draft = collectionStudyDrafts.get(key)
  const saved = snapshot.data.records.find(item => item.id === documentId)
  const value = draft || { note: saved?.note || '', status: saved?.status || 'unread' }
  const locked = disabled || model.busy || model.loading
  const edit = patch => {
    try {
      collectionStudyDrafts.set(key, { ...value, ...patch, base: draft?.base || snapshot })
      setError(''); setMessage(''); render(value => value + 1)
    } catch (failure) { setError(failure.message) }
  }
  const save = async () => {
    setError(''); setMessage('')
    const result = await model.write((base, options) => model.studyStore.saveNote(base, documentId, value.status, value.note, options), draft?.base || snapshot)
    if (result) { if (draft) collectionStudyDrafts.remove(key, draft); if (alive.current) render(value => value + 1) }
  }
  return <div className="collection-study-editor" aria-label="资料批注编辑">
    <p>人工阅读标记，不代表正文已经核验；修改正文或重新复查不会自动更新这个标记。</p>
    <label>阅读状态<select aria-label="当前资料阅读状态" disabled={locked} value={value.status} onChange={event => edit({ status: event.target.value })}>
      {Object.entries(STUDY_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <label>我的批注<textarea aria-label="当前资料批注" disabled={locked} maxLength={MAX_STUDY_NOTE_LENGTH} rows={4} value={value.note}
      onChange={event => edit({ note: event.target.value })} placeholder="记录疑问、阅读心得或需要再看的地方" /></label>
    <small>{value.note.length} / {MAX_STUDY_NOTE_LENGTH} · {draft ? '批注尚未保存，仅当前窗口保留；退出前请保存或导出。' : '当前显示已存记录；打开笔记不会自动标记已读。'}</small>
    {draft && draft.base.raw !== snapshot.raw && <p role="alert">已存记录在其他操作中更新。你的草稿保留，请先导出，或确认舍弃后加载已存记录。</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="collection-study-actions">
      <button type="button" disabled={locked || !model.snapshot} onClick={() => void save()}>保存批注与进度</button>
      <button type="button" disabled={!draft || locked} onClick={() => setConfirm(true)}>舍弃未存批注</button>
      <button type="button" disabled={locked} onClick={() => {
        try { downloadCollectionReviewReport({ text: `${STUDY_STATUS_LABELS[value.status]}\n\n${value.note}`, filename: 'Local-Notepad-批注草稿.txt', type: 'text/plain;charset=utf-8' }); setMessage('已发起草稿下载，请核对下载目录；未更新已存记录。') }
        catch (failure) { setError(failure.message || '未发起下载，草稿仍保留') }
      }}>导出当前批注草稿</button>
    </div>
    {confirm && <div role="group" aria-label="确认舍弃批注"><p>只舍弃这篇笔记的未存批注，重新显示最新已存记录；不会改动正文。</p>
      <button type="button" onClick={() => setConfirm(false)}>保留批注草稿</button>
      <button type="button" onClick={() => { collectionStudyDrafts.remove(key); setConfirm(false); setError(''); render(value => value + 1); void model.refresh() }}>确认舍弃未存批注</button>
    </div>}
  </div>
}
