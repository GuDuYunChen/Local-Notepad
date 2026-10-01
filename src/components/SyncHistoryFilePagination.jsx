import React, { useEffect, useId, useRef, useState } from 'react'
import { parseHistoryFilePageJump } from '~/services/syncHistoryFilePageJump.mjs'

export default function SyncHistoryFilePagination({ selection, report, filters, order, onNavigate }) {
  const { page, pages, matched, from, to } = selection
  const [draft, setDraft] = useState(pages ? String(page + 1) : '')
  const [error, setError] = useState('')
  const composing = useRef(false)
  const hintID = useId(), errorID = useId()
  // Same-size replacement files and A-B-A filters are new contexts. Keep the
  // DOM/focus, but discard any jump draft or error belonging to the old one.
  useEffect(() => {
    setDraft(pages ? String(page + 1) : ''); setError(''); composing.current = false
  }, [page, pages, report, filters, order])
  const go = target => {
    if (!matched || !Number.isSafeInteger(target) || target < 0 || target >= pages) return
    setDraft(String(target + 1)); setError('')
    if (target !== page) onNavigate(target)
  }
  const jump = () => {
    if (!matched || composing.current) return
    try { go(parseHistoryFilePageJump(draft, pages)) }
    catch (e) { setError(e.message) }
  }
  const enter = event => {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.preventDefault(); jump()
  }
  return <div className="sync-history-file-pages" role="group" aria-label="离线文件分页">
    <button type="button" className="btn small" data-history-file-first aria-disabled={!matched || page === 0} onClick={() => { if (page > 0) go(0) }}>首页</button>
    <button type="button" className="btn small" data-history-file-prev aria-disabled={!matched || page === 0} onClick={() => go(page - 1)}>上一页</button>
    <span data-history-file-page role="status">{matched ? <>第 {page + 1} / {pages} 页，本页第 {from}–{to} 条</> : '没有匹配记录，暂无可翻页内容'}</span>
    <button type="button" className="btn small" data-history-file-next aria-disabled={!matched || page + 1 >= pages} onClick={() => go(page + 1)}>下一页</button>
    <button type="button" className="btn small" data-history-file-last aria-disabled={!matched || page + 1 >= pages} onClick={() => { if (page + 1 < pages) go(pages - 1) }}>末页</button>
    <div className="sync-history-file-page-jump">
      <label>跳至第 <input type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
        data-history-file-jump-input aria-label="离线文件跳转页码" aria-describedby={hintID + (error ? ' ' + errorID : '')}
        aria-invalid={!!error} readOnly={!matched} value={draft}
        onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={enter}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={event => { if (composing.current) { composing.current = false; setDraft(event.currentTarget.value) } }}
        onBlur={() => { composing.current = false }}/><span>页</span></label>
      <button type="button" className="btn small" data-history-file-jump aria-disabled={!matched} onClick={jump}>跳转</button>
      <span id={hintID}>{matched ? `共 ${pages} 页，仅在当前文件匹配结果中定位，不重新读取文件。` : '没有匹配记录，不能跳页。'}</span>
    </div>
    {error && <p className="sync-history-file-page-error" id={errorID} data-history-file-jump-error role="alert">{error}</p>}
  </div>
}
