import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { TASK_PAGE_SIZE, readTaskCenter, filterTasks, readTaskSource, downloadTaskCenter } from '~/services/taskCenter.mjs'
import './TaskCenter.css'

const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])].filter(n => !n.closest('[hidden],fieldset:disabled'))
export default function TaskCenter({ onClose, onOpenFile }) {
  const [snapshot, setSnapshot] = useState(null), [loading, setLoading] = useState(false), [opening, setOpening] = useState(false), [stale, setStale] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('pending'), [sort, setSort] = useState('updated'), [page, setPage] = useState(0), [gaps, setGaps] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [exporting, setExporting] = useState(false), [details, setDetails] = useState(false)
  const alive = useRef(false), request = useRef(null), navigation = useRef(null), staleRef = useRef(false), panel = useRef(null), composing = useRef(false), exportButton = useRef(null), wasExporting = useRef(false)
  const refresh = async () => {
    navigation.current?.abort(); setOpening(false)
    const ctl = new AbortController(); request.current?.abort(); request.current = ctl
    setLoading(true); setSnapshot(null); setStale(false); staleRef.current = false; setError(''); setMessage(''); setExporting(false); setPage(0); setGaps(false)
    try { const value = await readTaskCenter(api, ctl.signal); if (alive.current && !ctl.signal.aborted && request.current === ctl) { setSnapshot(value); setMessage('待办已读取。请在来源笔记中勾选并保存，返回后重新读取。') } }
    catch (e) { if (alive.current && !ctl.signal.aborted && request.current === ctl) setError(e.message) }
    finally { if (alive.current && request.current === ctl) setLoading(false) }
  }
  const stop = () => { request.current?.abort(); request.current = null; setLoading(false); setSnapshot(null); setError(''); setMessage('读取已取消，没有采用部分结果。') }
  const close = () => { request.current?.abort(); navigation.current?.abort(); onClose() }
  useLayoutEffect(() => { alive.current = true; const entry = document.activeElement, node = panel.current; controls(node)[0]?.focus(); return () => { alive.current = false; request.current?.abort(); navigation.current?.abort(); if (entry?.isConnected && (!document.activeElement || document.activeElement === document.body || node?.contains(document.activeElement))) entry.focus?.() } }, [])
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const changed = () => { staleRef.current = true; request.current?.abort(); request.current = null; navigation.current?.abort(); setLoading(false); setOpening(false); setStale(true); setExporting(false); setMessage(''); setError('资料库已变化，请重新读取后打开来源或导出。') }; window.addEventListener('library:refresh', changed); return () => window.removeEventListener('library:refresh', changed) }, [])
  useLayoutEffect(() => { if (exporting) controls(panel.current.querySelector('[role=alertdialog]'))[0]?.focus(); else if (wasExporting.current) exportButton.current?.focus(); wasExporting.current = exporting }, [exporting])
  const notesById = useMemo(() => new Map(snapshot?.notes.map(n => [n.id, n]) || []), [snapshot])
  const items = useMemo(() => snapshot ? filterTasks(snapshot, { query, filter, sort }) : [], [snapshot, query, filter, sort])
  const gapNotes = snapshot?.notes.filter(n => !n.supported) || []
  const pages = Math.max(1, Math.ceil((gaps ? gapNotes.length : items.length) / TASK_PAGE_SIZE))
  const change = (setter, value) => { setter(value); setPage(0); setGaps(false); setMessage(''); if (!stale) setError('') }
  const open = async (note, task = null) => {
    if (!note || !onOpenFile || staleRef.current || loading || opening || exporting) return
    const ctl = new AbortController(); navigation.current = ctl; setOpening(true); setError(''); setMessage('')
    const current = () => alive.current && !ctl.signal.aborted && navigation.current === ctl && !staleRef.current
    let sourceError = null
    try {
      const accepted = await onOpenFile(note.id, { signal: ctl.signal, shouldSelect: current, refreshCurrent: true,
        ...(task?.block_id ? { blockId: task.block_id } : {}),
        readFile: async (id, { signal }) => { if (id !== note.id) throw Error('来源身份不一致'); try { return await readTaskSource(api, note, signal) } catch (e) { sourceError = e; throw e } } })
      if (current()) {
        if (accepted === true) onClose()
        else if (sourceError?.code === 'STALE_TASK_SOURCE') { staleRef.current = true; setStale(true); setError(sourceError.message) }
        else if (sourceError) setError('来源暂时无法读取，请重试；未修改待办。')
        else setMessage('打开已取消，待办清单保留。')
      }
    } catch { if (current()) setError('来源暂时无法打开，请重试；未修改待办。') }
    finally { if (alive.current && navigation.current === ctl) setOpening(false) }
  }
  const exportNow = () => {
    if (!snapshot || loading || staleRef.current) return
    setError(''); setMessage('')
    try { downloadTaskCenter(snapshot, { query, filter, sort }, details); setExporting(false); setMessage('已发起待办报告下载，请检查保存结果。没有修改笔记。') }
    catch { setError('报告未能导出，待办结果仍保留，请重试。') }
  }
  const keyboard = e => {
    if (opening) return
    e.stopPropagation()
    if (composing.current || e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (exporting) setExporting(false); else close(); return }
    if (e.key === 'Tab') { const nodes = controls(exporting ? panel.current.querySelector('[role=alertdialog]') : panel.current), first = nodes[0], last = nodes.at(-1); if (!first) e.preventDefault(); else if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus() } }
  }
  const disabled = stale || opening || exporting
  return createPortal(<div className="task-center-overlay" data-opening={opening ? 'true' : undefined} onMouseDown={e => { if (e.target === e.currentTarget && !exporting) close() }}>
    <section ref={panel} className="task-center" role="dialog" aria-modal="true" aria-label="本地待办任务中心" onKeyDown={keyboard} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <header><div><h2>待办任务中心</h2><p>集中回访 · 在原笔记勾选 · 沿用保存保护</p></div><button type="button" aria-label="关闭待办任务中心" disabled={exporting} onClick={close}>×</button></header>
      <div className="task-center-scroll" aria-busy={loading}>
        <p className="task-center-scope">仅汇总已保存普通笔记的富文本复选清单和支持的 Markdown 待办。不含未保存草稿、模板或回收站；这里不直接勾选另一份正文。</p>
        {loading && <p>正在读取本机待办…可以随时取消。</p>}
        {snapshot && <>
          <dl className="task-center-cards">{[['未完成', snapshot.totals.pending], ['已完成', snapshot.totals.done], ['含待办笔记', snapshot.totals.with_tasks]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString('zh-CN')}</dd></div>)}</dl>
          <p>读取 {snapshot.totals.notes} 篇普通笔记 · {new Date(snapshot.captured_at * 1000).toLocaleString('zh-CN')}{stale ? ' · 已过时' : ''}</p>
          <details><summary>识别范围与完成流程</summary><p>富文本读取明确的复选清单。Markdown 识别行首最多三个空格缩进的 - [ ]、- [x] 等列表；围栏代码与引用段不计入。更深缩进的候选待办或未知结构会列为覆盖缺口。这里的完成状态不是历史完成时间或提醒。</p><p>打开来源 → 在原编辑器勾选 → 通过原保存流程保存 → 回到设置重新读取。存在稳定块地址时定位来源块，否则打开原笔记并显示行号或待办序号供查找。</p></details>
          {snapshot.totals.unsupported > 0 && <p className="task-center-warning">{snapshot.totals.unsupported} 篇来源未完整识别，不能据此认定没有待办。<button type="button" disabled={disabled} onClick={() => { setGaps(!gaps); setPage(0); setMessage('') }}>{gaps ? '返回待办列表' : '查看未完整识别来源'}</button></p>}
          <fieldset className="task-center-filters" disabled={disabled}><legend>查找待办</legend><label>任务或标题<input aria-label="待办查找" value={query} maxLength={128} onChange={e => change(setQuery, e.target.value)} /></label><label>状态<select aria-label="待办状态" value={filter} onChange={e => change(setFilter, e.target.value)}><option value="pending">未完成</option><option value="done">已完成</option><option value="all">全部</option></select></label><label>排序<select aria-label="待办排序" value={sort} onChange={e => change(setSort, e.target.value)}><option value="updated">来源最近修改</option><option value="title">来源标题</option><option value="status">未完成优先</option></select></label></fieldset>
          <p>当前 {gaps ? gapNotes.length : items.length} 项 · 第 {page + 1}/{pages} 页</p>
          <div className="task-center-items">{gaps ? gapNotes.slice(page * 50, (page + 1) * 50).map(n => <article key={n.id}><strong>{n.title || '未命名笔记'}</strong><button type="button" disabled={disabled || !onOpenFile} onClick={() => void open(n)}>检查来源</button><small>部分结构未识别；已识别任务仍在清单中。</small></article>) : items.slice(page * 50, (page + 1) * 50).map(t => <article key={`${t.note_id}:${t.ordinal}`} data-task-note={t.note_id} data-task-ordinal={t.ordinal} data-done={String(t.done)}><div><span className="task-center-state">{t.done ? '✓ 已完成' : '□ 未完成'}</span><strong>{t.text || '（空任务）'}{t.truncated ? '…［摘要，完整内容请查看来源］' : ''}</strong></div><button type="button" disabled={disabled || !onOpenFile} onClick={() => void open(notesById.get(t.note_id), t)}>打开来源</button><small>{notesById.get(t.note_id).title || '未命名笔记'} · {t.format === 'markdown' ? `Markdown 第 ${t.line} 行` : `富文本第 ${t.ordinal} 项待办`}{t.block_id ? ' · 可定位来源块' : ''}</small></article>)}</div>
          {!gaps && !items.length && <p>{filter === 'pending' ? '当前筛选没有已识别的未完成待办。可切换“全部”查看其他状态。' : '没有符合条件的已识别待办。'}</p>}
          <nav aria-label="待办分页"><button type="button" disabled={disabled || page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><button type="button" disabled={disabled || page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button></nav>
        </>}
      </div>
      <div className="task-center-feedback" aria-label="待办操作反馈">
        {exporting && <div role="alertdialog" aria-modal="true" aria-label="确认待办报告导出"><p>默认只导出计数，不含任务文字、标题或查询词。勾选后附当前筛选任务摘要及来源身份，请妥善保管。</p><label><input type="checkbox" checked={details} onChange={e => setDetails(e.target.checked)} />包含任务文字和来源标题</label><button type="button" onClick={() => setExporting(false)}>取消导出</button><button type="button" onClick={exportNow}>确认导出</button></div>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      </div>
      <footer><span>原笔记是唯一编辑来源</span><button type="button" disabled={loading || opening || exporting} onClick={() => void refresh()}>重新读取</button>{loading && <button type="button" onClick={stop}>取消读取</button>}{opening && <button type="button" onClick={() => { navigation.current?.abort(); setOpening(false); setMessage('打开已取消。') }}>取消打开</button>}<button ref={exportButton} type="button" disabled={!snapshot || loading || disabled} onClick={() => { setDetails(false); setMessage(''); setError(''); setExporting(true) }}>导出待办报告</button></footer>
    </section>
  </div>, document.body)
}
