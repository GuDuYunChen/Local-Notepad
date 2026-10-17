import React, { useEffect, useRef, useState } from 'react'
import { api, searchFiles } from '~/services/api'
import { extractLexicalText } from '~/utils/lexicalText'
import { readQuickResults, readQuickTarget, QUICK_RESULT_LIMIT } from '../services/quickSwitcher.mjs'
import './QuickSwitcher.css'

export function buildHighlightSegments(text, query) {
  const source = String(text || '')
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return [{ text: source, match: false }]

  const hit = new RegExp(normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(source)
  if (!hit) return [{ text: source, match: false }]
  const index = hit.index

  const before = source.slice(0, index)
  const matched = source.slice(index, index + hit[0].length)
  const after = source.slice(index + hit[0].length)

  return [
    ...(before ? [{ text: before, match: false }] : []),
    { text: matched, match: true },
    ...(after ? [{ text: after, match: false }] : []),
  ]
}

export function getSearchMatchScope(file, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) return file?.is_pinned ? 'pinned' : 'recent'

  const title = String(file?.title || '').toLowerCase()
  if (title.includes(normalizedQuery)) return 'title'

  const body = extractLexicalText(file?.content || '').toLowerCase()
  if (body.includes(normalizedQuery)) return 'content'

  return 'other'
}

function HighlightMatch({ text, query }) {
  return buildHighlightSegments(text, query).map((segment, index) => (
    segment.match
      ? <mark key={`m-${index}`} className="search-match">{segment.text}</mark>
      : <React.Fragment key={`t-${index}`}>{segment.text}</React.Fragment>
  ))
}

function buildPreview(content, query) {
  const text = extractLexicalText(content).replace(/\s+/g, ' ').trim()
  if (!text) return '空白笔记'

  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return text.slice(0, 120)

  const index = text.toLowerCase().indexOf(normalizedQuery)
  if (index < 0) return text.slice(0, 120)

  const start = Math.max(0, index - 42)
  const end = Math.min(text.length, index + normalizedQuery.length + 74)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function formatRelativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts * 1000
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

export default function QuickSwitcher({ open, onClose, onSelectFile, onOpenSearchWorkspace, navigationEpoch }) {
  const [query, setQuery] = useState(''), [applied, setApplied] = useState('')
  const [results, setResults] = useState([]), [status, setStatus] = useState('loading')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0), [activeIndex, setActiveIndex] = useState(0)
  const [opening, setOpening] = useState('')
  const inputRef = useRef(null), resultsRef = useRef(null), panelRef = useRef(null)
  const alive = useRef(false), reading = useRef(null), choosing = useRef(null)
  const queryRef = useRef(''), composing = useRef(false), entryFocus = useRef(null), accepted = useRef(false)
  const latest = useRef({ open, onClose, onSelectFile, onOpenSearchWorkspace }); latest.current = { open, onClose, onSelectFile, onOpenSearchWorkspace }
  const cancelReading = () => { reading.current?.abort(); reading.current = null }
  const cancelOpening = () => { choosing.current?.abort(); choosing.current = null }
  const close = () => { cancelReading(); cancelOpening(); latest.current.onClose?.() }
  useEffect(() => {
    if (!open) return undefined
    alive.current = true; accepted.current = false; composing.current = false
    entryFocus.current = document.activeElement
    queryRef.current = ''; setQuery(''); setApplied(''); setResults([]); setActiveIndex(0); setOpening(''); setNotice(''); setError('')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      alive.current = false; cancelReading(); cancelOpening(); window.clearTimeout(timer)
      if (!accepted.current && entryFocus.current?.isConnected) entryFocus.current.focus?.()
    }
  }, [open])
  useEffect(() => {
    if (!open || composing.current) return undefined
    cancelReading()
    const controller = new AbortController(); reading.current = controller
    const captured = applied
    setStatus('loading'); setResults([]); setActiveIndex(0); setError('')
    const owns = () => alive.current && latest.current.open && reading.current === controller && !controller.signal.aborted && !composing.current && captured === queryRef.current
    const run = async () => {
      if (!owns()) return
      try {
        const rows = await readQuickResults(api, searchFiles, captured, controller.signal)
        if (!owns()) return
        setResults(rows); setStatus('ready')
      } catch (e) {
        if (!owns()) return
        setError(e.message); setStatus('error')
      }
    }
    const timer = captured.trim() ? window.setTimeout(run, 180) : null
    if (!captured.trim()) void run()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [open, applied, retry])
  useEffect(() => {
    if (choosing.current && choosing.current.epoch !== navigationEpoch?.current) {
      cancelOpening(); setOpening(''); setNotice('页面已切换，原打开操作已取消。')
    }
  }, [navigationEpoch?.current])
  const visibleResults = results.slice(0, QUICK_RESULT_LIMIT)
  useEffect(() => {
    resultsRef.current?.querySelector(`[data-result-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, results])
  useEffect(() => {
    if (!open || opening === 'decision') return undefined
    const keyboard = event => {
      if (event.isComposing || event.keyCode === 229 || composing.current) return
      // An App save/discard dialog owns its own keyboard interaction.
      if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(n => n !== panelRef.current)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'Tab' && panelRef.current?.contains(event.target)) {
        const nodes = [...panelRef.current.querySelectorAll('input:not(:disabled),button:not(:disabled):not([tabindex="-1"])')]
        if (!nodes.length) return
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [open, opening])
  const edit = (text, commit = !composing.current) => {
    queryRef.current = text; cancelReading(); cancelOpening(); setOpening(''); setQuery(text); setNotice(''); setError(''); setStatus('loading'); setResults([])
    if (commit) { setApplied(text); setRetry(v => v + 1) }
  }
  const choose = async file => {
    if (!file || status !== 'ready' || choosing.current || composing.current || queryRef.current !== applied) return
    const controller = new AbortController(); controller.epoch = navigationEpoch?.current; choosing.current = controller
    const owns = () => alive.current && latest.current.open && choosing.current === controller && !controller.signal.aborted
    setOpening('reading'); setError(''); setNotice('正在核对目标笔记…')
    const cancelled = () => {
      if (!owns()) return
      choosing.current = null; setOpening(''); setNotice('未切换笔记，当前草稿保持不变。')
      window.setTimeout(() => { if (alive.current && !choosing.current) inputRef.current?.focus() }, 0)
    }
    try {
      const fresh = await readQuickTarget(api, file.id, controller.signal)
      if (!owns()) return
      if (controller.epoch !== navigationEpoch?.current) { cancelled(); return }
      if (typeof latest.current.onSelectFile !== 'function') throw new Error('笔记打开通道不可用。')
      setOpening('decision'); setNotice('请在编辑器的保存确认框中决定是否切换。')
      latest.current.onSelectFile(fresh, {
        shouldSelect: () => owns() && controller.epoch === navigationEpoch?.current,
        onCancel: cancelled,
        afterSelect: () => {
          if (!owns()) return
          accepted.current = true; choosing.current = null; setOpening(''); latest.current.onClose?.()
        },
      })
    } catch (e) {
      if (!owns()) return
      choosing.current = null; setOpening(''); setNotice('')
      setError(e?.code ? e.message : '目标笔记暂时无法打开，请刷新结果后重试。')
    }
  }
  const keys = event => {
    if (event.nativeEvent?.isComposing || event.keyCode === 229 || composing.current || opening) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visibleResults.length) setActiveIndex(n => (n + (event.key === 'ArrowDown' ? 1 : -1) + visibleResults.length) % visibleResults.length)
    }
    if (event.key === 'Enter') { event.preventDefault(); void choose(visibleResults[activeIndex]) }
  }
  if (!open) return null
  return <div className="quick-switcher-overlay" style={opening === 'decision' ? { visibility: 'hidden' } : undefined}
    onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
    <section ref={panelRef} className="quick-switcher" role="dialog" aria-modal="true" aria-label="快速搜索笔记">
      <div className="quick-switcher-search">
        <input ref={inputRef} value={query} disabled={!!opening} placeholder="搜索标题或正文…" aria-label="搜索标题或正文" role="combobox"
          aria-controls="quick-switcher-results" aria-expanded={status === 'ready' && visibleResults.length > 0} aria-autocomplete="list"
          aria-activedescendant={status === 'ready' && visibleResults[activeIndex] ? `quick-result-${visibleResults[activeIndex].id}` : undefined}
          onChange={e => edit(e.target.value)} onKeyDown={keys}
          onCompositionStart={() => { composing.current = true; cancelReading(); setResults([]); setStatus('loading') }}
          onCompositionEnd={e => { composing.current = false; edit(e.currentTarget.value, true) }} />
        <kbd>Ctrl K</kbd><button type="button" className="btn small" aria-label="关闭快速搜索" onClick={close}>关闭</button>
      </div>
      <div className="quick-switcher-meta" role="status"><span>{applied.trim() ? '搜索结果' : '最近修改 · 置顶优先'}</span><span>{status === 'loading' ? '搜索中…' : status === 'error' ? '读取失败' : `${visibleResults.length} 项`}</span></div>
      {notice && <div className="quick-switcher-notice" role="status">{notice}</div>}
      {error && <div className="quick-switcher-notice" role="alert"><strong>{status === 'error' ? '快速搜索未完成' : '笔记未打开'}</strong><p>{error}</p>
        <button type="button" className="btn small" disabled={!!opening} onClick={() => { cancelReading(); setRetry(v => v + 1); setNotice('') }}>{status === 'error' ? '重试快速搜索' : '刷新快速结果'}</button></div>}
      {opening === 'reading' && <button className="btn small quick-switcher-stop" type="button" onClick={() => { cancelOpening(); setOpening(''); setNotice('已停止打开，未切换笔记。'); window.setTimeout(() => { if (alive.current && !choosing.current) inputRef.current?.focus() }, 0) }}>停止打开</button>}
      <div id="quick-switcher-results" ref={resultsRef} className="quick-switcher-results" role="listbox" aria-label="搜索结果" aria-busy={status === 'loading'}>
        {status === 'ready' && !visibleResults.length && <div className="quick-switcher-empty"><strong>{applied.trim() ? '没有找到匹配的笔记' : '还没有可打开的笔记'}</strong><span>{applied.trim() ? '换一个关键词，或进入完整检索。' : '创建笔记后可在这里查找和打开。'}</span></div>}
        {visibleResults.map((file, index) => <button type="button" tabIndex={-1} disabled={status !== 'ready' || !!opening} id={`quick-result-${file.id}`} data-result-index={index} key={file.id}
          className={`quick-switcher-result${index === activeIndex ? ' active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => void choose(file)} role="option" aria-selected={index === activeIndex}>
          <span className="quick-switcher-result-main"><span className="quick-switcher-result-title-row"><span className="quick-switcher-result-title">{file.is_pinned ? <span aria-label="已置顶">★</span> : null}<HighlightMatch text={file.title} query={applied} /></span>
            <span className="quick-switcher-match-badge">{{title:'标题命中',content:'正文命中',pinned:'已置顶',recent:'最近修改'}[getSearchMatchScope(file, applied)] || '匹配结果'}</span></span>
            <span className="quick-switcher-result-preview"><HighlightMatch text={buildPreview(file.content, applied)} query={applied} /></span></span>
          <span className="quick-switcher-result-time">{formatRelativeTime(file.updated_at)}</span>
        </button>)}
      </div>
      <div className="quick-switcher-meta">{onOpenSearchWorkspace && <button type="button" className="btn small" disabled={!!opening || composing.current} onClick={() => { accepted.current = true; cancelReading(); latest.current.onOpenSearchWorkspace(query) }}>完整检索与筛选</button>}<span>快速结果最多展示 20 项{!applied.trim() ? '，最近候选最多 200 条' : ''}</span></div>
      <footer className="quick-switcher-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
    </section>
  </div>
}
