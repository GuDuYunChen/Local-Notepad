import React, { useEffect, useId, useRef, useState } from 'react'
import { filterLocalActions, LOCAL_ACTION_CATEGORIES, LOCAL_ACTION_QUERY_LIMIT } from '../services/localActions.mjs'
import './LocalActions.css'

export default function LocalActions({ open, onClose, onExecute, contextVersion }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('全部')
  const [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const panel = useRef(null), input = useRef(null), entryFocus = useRef(null), request = useRef(null), mounted = useRef(false), composing = useRef(false), accepted = useRef(false)
  const latest = useRef({ onClose, onExecute }); latest.current = { onClose, onExecute }
  const uid = useId(), rows = filterLocalActions(query, category), active = rows[Math.min(index, rows.length - 1)]
  const cancel = () => { request.current?.abort(); request.current = null }
  const close = () => { cancel(); latest.current.onClose?.() }
  useEffect(() => {
    if (!open) return undefined
    mounted.current = true; accepted.current = false; composing.current = false; entryFocus.current = document.activeElement
    setQuery(''); setCategory('全部'); setIndex(0); setBusy(false); setNotice(''); setError('')
    const timer = setTimeout(() => input.current?.focus(), 0)
    return () => { mounted.current = false; cancel(); clearTimeout(timer); if (!accepted.current && entryFocus.current?.isConnected) entryFocus.current.focus?.() }
  }, [open])
  useEffect(() => {
    if (!request.current) return
    cancel(); setBusy(false); setNotice('页面已变化，未继续执行原操作。'); setError('')
  }, [contextVersion])
  useEffect(() => { panel.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest' }) }, [active?.id])
  const run = async action => {
    if (!action || request.current || composing.current) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setNotice('正在交给原功能入口；如有未保存内容，请先完成原保存确认。')
    const owns = () => mounted.current && request.current === controller && !controller.signal.aborted
    try {
      if (typeof latest.current.onExecute !== 'function') throw new Error('本地功能入口暂不可用，请关闭后重新打开。')
      const result = await latest.current.onExecute(action.id, { signal: controller.signal })
      if (!owns()) return
      if (result?.accepted === true && result.id === action.id) { accepted.current = true; request.current = null; latest.current.onClose?.(); return }
      setNotice(result?.reason === 'focus-session' ? '请先结束当前专注 Session，再执行工作区跳转。' : '未执行操作，当前笔记和未保存内容保持不变。')
    } catch {
      if (owns()) { setNotice(''); setError('入口执行失败，未自动重试。请确认当前页面后，再选择操作重试。') }
    } finally { if (owns()) { request.current = null; setBusy(false); input.current?.focus() } }
  }
  const keyboard = event => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || composing.current || event.repeat) return
    // A nested save decision owns its input. Never dismiss it from here.
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(n => n !== panel.current)) return
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Tab') {
      const nodes = [...panel.current.querySelectorAll('input:not(:disabled),select:not(:disabled),button:not(:disabled):not([tabindex="-1"])')]
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus() }
    }
    if (event.target !== input.current || busy || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setIndex(i => rows.length ? (i + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0)
    } else if (event.key === 'Enter') { event.preventDefault(); void run(active) }
  }
  if (!open) return null
  return <div className="local-actions-overlay" data-running={busy} onMouseDown={event => { if (event.target === event.currentTarget && !busy) close() }}>
    <section ref={panel} className="local-actions" role="dialog" aria-modal="true" aria-labelledby={uid + '-title'} onKeyDownCapture={keyboard}>
      <header><div><p className="local-actions-eyebrow">仅本机 · 功能导航</p><h2 id={uid + '-title'}>快捷操作</h2></div><button type="button" className="btn" aria-label="关闭快捷操作" onClick={close}>关闭</button></header>
      <div className="local-actions-controls">
        <label className="local-actions-query">查找功能<input ref={input} value={query} maxLength={LOCAL_ACTION_QUERY_LIMIT} disabled={busy} role="combobox" aria-label="查找本地功能" aria-expanded="true" aria-controls={uid + '-list'} aria-activedescendant={active ? uid + '-' + active.id : undefined} autoComplete="off" placeholder="例如：待办、附件、备份…" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onChange={e => { setQuery(e.target.value); setIndex(0); setNotice(''); setError('') }} /></label>
        <label>分类<select aria-label="本地功能分类" value={category} disabled={busy} onChange={e => { setCategory(e.target.value); setIndex(0); setNotice(''); setError('') }}>{LOCAL_ACTION_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <div className="local-actions-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : <p role="status">{notice || `${rows.length} 个本地入口；只打开功能，不自动修改、恢复或删除资料。`}</p>}</div>
      <div id={uid + '-list'} className="local-actions-results" role="listbox" aria-label="本地功能" aria-busy={busy}>
        {rows.map((a, i) => <button key={a.id} id={uid + '-' + a.id} role="option" aria-selected={active?.id === a.id} tabIndex={-1} type="button" disabled={busy} data-local-action={a.id} onMouseMove={() => setIndex(i)} onClick={() => void run(a)}><span className="local-actions-category">{a.category}</span><span><strong>{a.label}</strong><small>{a.description}</small></span><span aria-hidden="true">↗</span></button>)}
        {!rows.length && <p className="local-actions-empty">没有匹配的本地功能，请修改关键词或分类。</p>}
      </div>
      <footer><span>↑ ↓ 选择 · Enter 打开 · Esc 取消<br />不占用已有全局快捷键</span><button type="button" className="btn primary" disabled={busy || !active} onClick={() => void run(active)}>{busy ? '等待原入口确认…' : '打开所选功能'}</button></footer>
    </section>
  </div>
}
