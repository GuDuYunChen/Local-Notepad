import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import { extractLexicalText } from '~/utils/lexicalText'
import ConfirmDialog from './ConfirmDialog'
import { readVersionHistory, sameHistoryVersion, formatHistoryTime, historyPreview,
  historyRestoreBlock, captureHistoryReview } from '../services/versionHistory.mjs'
import './VersionHistory.css'

export default function VersionHistory({ fileId, editor }) {
  const [rows, setRows] = useState([]), [status, setStatus] = useState('loading')
  const [problem, setProblem] = useState(''), [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), composing = useRef(false)
  const [previewPage, setPreviewPage] = useState(0), [showCurrent, setShowCurrent] = useState(false)
  const [review, setReview] = useState(null), [busy, setBusy] = useState(false), [result, setResult] = useState(null)
  const clearance = useRef(null)
  useLayoutEffect(() => {
    const panel = clearance.current
    if (!panel) return
    let frame = 0, banner = null
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure) }
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    function measure() {
      frame = 0
      const current = document.querySelector('.reference-maintenance-status')
      if (current !== banner) {
        if (banner) resize?.unobserve(banner)
        banner = current
        if (banner) resize?.observe(banner)
      }
      const bounds = panel.getBoundingClientRect(), overlay = banner?.getBoundingClientRect()
      const overlaps = overlay && overlay.bottom > 0 && overlay.top < window.innerHeight &&
        overlay.right > bounds.left && overlay.left < bounds.right
      const inset = overlaps ? Math.ceil(window.innerHeight - Math.max(0, overlay.top)) + 16 : 16
      panel.style.setProperty('--history-bottom-clearance', inset + 'px')
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => { mutations.disconnect(); resize?.disconnect(); window.removeEventListener('resize', schedule); window.cancelAnimationFrame(frame) }
  }, [fileId])
  const alive = useRef(false), readOwner = useRef(null), operation = useRef(null), focusAfter = useRef(null)
  const latestEditor = useRef(editor); latestEditor.current = editor
  const state = editor?.snapshot?.() || null
  const block = historyRestoreBlock(state, fileId)
  const selected = rows.find(row => row.id === selectedId) || null
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return rows.filter(row => !q || (row.title + '\n' + extractLexicalText(row.content) + '\n' + formatHistoryTime(row.created_at)).toLocaleLowerCase().includes(q))
  }, [rows, query])
  const text = useMemo(() => extractLexicalText(showCurrent ? state?.content : selected?.content) || '', [showCurrent, state?.content, selected])
  const preview = useMemo(() => historyPreview(text, previewPage), [text, previewPage])
  const load = async ({ preserve = false } = {}) => {
    readOwner.current?.abort()
    const ctl = new AbortController(); readOwner.current = ctl
    setStatus('loading'); setProblem('')
    try {
      const list = await readVersionHistory(api, fileId, ctl.signal)
      if (!alive.current || ctl.signal.aborted || readOwner.current !== ctl) return
      setRows(list); setSelectedId(id => preserve && list.some(row => row.id === id) ? id : list[0]?.id ?? null)
      setStatus('ready'); setPreviewPage(0)
    } catch (e) {
      if (!alive.current || ctl.signal.aborted || readOwner.current !== ctl) return
      setRows([]); setSelectedId(null); setStatus('error'); setProblem(e.message)
    }
  }
  useEffect(() => {
    alive.current = true; setRows([]); setSelectedId(null); setResult(null); setReview(null)
    void load()
    return () => { alive.current = false; readOwner.current?.abort(); operation.current?.abort() }
  }, [fileId])
  useEffect(() => {
    if (!review && focusAfter.current) {
      const n = focusAfter.current; focusAfter.current = null
      if (n.isConnected && !n.disabled) n.focus()
    }
  }, [review, busy])
  const requestRestore = event => {
    if (!selected || busy || operation.current || status !== 'ready') return
    try {
      const expected = captureHistoryReview(latestEditor.current?.snapshot?.(), selected)
      setResult(null); focusAfter.current = event.currentTarget; setReview({ version: selected, expected })
    } catch (e) { setResult({ kind: 'error', text: e.message }) }
  }
  const restore = async () => {
    if (!review || operation.current) return
    const requested = review, ctl = new AbortController(); operation.current = ctl
    setBusy(true); setResult(null)
    let adopted = false
    try {
      const latest = await readVersionHistory(api, fileId, ctl.signal)
      if (!alive.current || ctl.signal.aborted) return
      if (!sameHistoryVersion(latest.find(row => row.id === requested.version.id), requested.version))
        throw new Error('所选快照已变化或已被清理，未恢复正文。请刷新历史。')
      if (typeof latestEditor.current?.restore !== 'function') throw new Error('编辑器恢复通道不可用，未改动正文。')
      // The editor performs its own synchronous ID/lifetime/content/pending check.
      const receipt = await latestEditor.current.restore(requested.version, requested.expected, ctl.signal)
      adopted = true
      if (!alive.current || ctl.signal.aborted) return
      if (!receipt || receipt.id !== fileId || receipt.content !== requested.version.content)
        throw new Error('恢复回执不匹配，请在编辑器核对保存状态。')
      setResult({ kind: 'success', text: receipt.unchanged ? '所选快照与当前正文一致，没有写入或新增版本。' : '历史正文已恢复并保存；恢复前的正文已保留为历史快照。标题、标签与位置未改变。' })
      setReview(null); setShowCurrent(false)
      await load({ preserve: true })
    } catch (e) {
      if (alive.current && !ctl.signal.aborted) {
        const blocked = e?.code === 'editor-blocked' || e?.code === 'review-changed' || e?.code === 'cancelled'
        setResult({ kind: 'error', text: blocked || !adopted && /快照已变化|恢复通道不可用/.test(e.message) ? e.message
          : '恢复未完成或保存尚未确认。请检查编辑器中的草稿、保存提示与冲突；不会自动重复恢复。' })
        setReview(null)
      }
    } finally {
      if (operation.current === ctl) { operation.current = null; if (alive.current) setBusy(false) }
    }
  }
  const saveCurrent = async () => {
    if (operation.current || !editor?.saveCurrent) return
    const ctl = new AbortController(); operation.current = ctl; setBusy(true)
    try {
      const captured = latestEditor.current.snapshot()
      await latestEditor.current.saveCurrent(captured)
      if (alive.current && !ctl.signal.aborted) {
        setResult({ kind: 'info', text: '保存操作已返回，请以编辑器当前状态为准；新的修改不会被历史内容覆盖。' })
        await load({ preserve: true })
      }
    } catch {
      if (alive.current && !ctl.signal.aborted) setResult({ kind: 'error', text: '当前笔记保存未确认，请在编辑器处理；尚未发起历史恢复。' })
    } finally { if (operation.current === ctl) { operation.current = null; if (alive.current) setBusy(false) } }
  }
  if (!fileId) return null
  return <section ref={clearance} className="version-history" aria-label="版本历史与恢复">
    <header className="version-header inspector-section-header"><div><div className="inspector-section-eyebrow">本地快照</div><h3>版本历史</h3></div>
      <button type="button" className="btn small" disabled={busy || status === 'loading'} onClick={() => void load({ preserve: true })}>刷新历史</button></header>
    <p className="version-explanation">历史快照不等于当前正文。恢复只替换正文，经过现有保存和冲突保护；不改标题、标签或位置。</p>
    {result && <div className={'version-feedback ' + result.kind} role={result.kind === 'error' ? 'alert' : 'status'}>{result.text}</div>}
    {status === 'error' ? <div className="version-error" role="alert"><p>{problem}</p><button type="button" className="btn" onClick={() => void load()}>重试读取历史</button></div>
      : status === 'loading' ? <p role="status">正在读取历史版本…</p>
      : rows.length === 0 ? <div className="version-empty"><strong>暂无版本历史</strong><p>保存有变动的正文后，原正文会保留为历史快照。这里没有可恢复的记录。</p></div>
      : <>
        <label className="version-search">查找快照<input aria-label="查找历史快照" value={search} disabled={busy}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={e => { composing.current = false; setQuery(e.currentTarget.value) }}
          onChange={e => { setSearch(e.target.value); if (!composing.current) setQuery(e.target.value) }} placeholder="标题、正文或时间" /></label>
        <p className="version-meta">显示 {visible.length} / {rows.length} 份快照</p>
        <div className="version-list" role="list" aria-label="历史快照">
          {visible.length === 0 && <p className="version-empty">没有匹配的快照，清除查找条件可查看全部记录。</p>}
          {visible.map(row => <div key={row.id} role="listitem" className={'version-item' + (row.id === selectedId ? ' selected' : '')}>
            <button type="button" className="version-select-action" data-version-id={row.id} aria-pressed={row.id === selectedId} disabled={busy}
              onClick={() => { setSelectedId(row.id); setPreviewPage(0); setShowCurrent(false); setResult(null) }}>
              <strong>历史快照 #{row.id}</strong><small>{formatHistoryTime(row.created_at)}</small><span>{row.title || '未命名'}</span>
            </button></div>)}
        </div>
        {selected && <div className="version-preview">
          {!visible.some(row => row.id === selected.id) && <p className="version-meta">当前预览的快照不在查找结果中。</p>}
          <div className="version-preview-header"><strong>正文对照</strong><span>{preview.total.toLocaleString()} 字符</span></div>
          <div className="version-preview-switch"><button type="button" aria-pressed={!showCurrent} onClick={() => { setShowCurrent(false); setPreviewPage(0) }}>所选历史</button>
            <button type="button" aria-pressed={showCurrent} onClick={() => { setShowCurrent(true); setPreviewPage(0) }}>当前编辑器</button></div>
          <p className="version-meta">纯文本预览，不显示图片等嵌入内容；恢复使用完整原始正文，不使用预览文本。</p>
          <pre tabIndex={0} aria-label={showCurrent ? '当前正文预览' : '历史正文预览'}>{preview.text || '（空内容）'}</pre>
          {preview.pages > 1 && <div className="version-pagination"><button type="button" disabled={preview.page === 0} onClick={() => setPreviewPage(preview.page - 1)}>上一段</button>
            <span>{preview.page + 1} / {preview.pages}</span><button type="button" disabled={preview.page + 1 === preview.pages} onClick={() => setPreviewPage(preview.page + 1)}>下一段</button></div>}
          {block && <p className="version-block" role="status">{block}</p>}
          {state?.ready && state.id === fileId && state.content !== state.saved && !state.pending && !state.uncertain &&
            <button type="button" className="btn" disabled={busy} onClick={() => void saveCurrent()}>先保存当前笔记</button>}
          <button type="button" className="btn primary version-restore-action" disabled={busy || !!block} onClick={requestRestore}>恢复此快照正文</button>
        </div>}
      </>}
    {review && <ConfirmDialog title="恢复所选历史正文？" message={<>
      <p>快照 #{review.version.id} · {formatHistoryTime(review.version.created_at)}</p>
      <p>恢复前正文会由同一个保存事务保留为快照。若当前笔记变化或保存失败，不会显示为已恢复。</p>
      <p>仅恢复正文；标题、标签和位置保持不变。</p></>} onClose={() => { if (!busy) setReview(null) }} actions={[
        { label: '取消', disabled: busy, onClick: () => setReview(null) },
        { label: '确认恢复正文', kind: 'primary', loading: busy, onClick: () => void restore() },
      ]} />}
  </section>
}
