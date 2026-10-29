import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { COMPARISON_PAGE, COMPARISON_ROW_PAGE, readComparisonIndex, comparisonChoices, readNoteComparison, sameNoteComparison, compareNoteText, readComparisonSource, downloadComparisonReport } from '~/services/noteComparison.mjs'
import './NoteComparison.css'

const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || [])].filter(n => !n.closest('[hidden],fieldset:disabled'))
export default function NoteComparison({ onClose, onOpenFile }) {
  const [index, setIndex] = useState(null), [ids, setIds] = useState(['', '']), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [snapshot, setSnapshot] = useState(null), [mode, setMode] = useState('text'), [rowPage, setRowPage] = useState(0), [changeIndex, setChangeIndex] = useState(0)
  const [busy, setBusy] = useState(''), [stale, setStale] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false), [details, setDetails] = useState(false)
  const panel = useRef(null), active = useRef(null), alive = useRef(false), staleRef = useRef(false), closing = useRef(false), composing = useRef(false), exporting = useRef(null), hadConfirm = useRef(false)
  const current = ctl => alive.current && !closing.current && active.current === ctl && !ctl.signal.aborted
  const begin = kind => { if (active.current || closing.current) return null; const ctl = new AbortController(); active.current = ctl; setBusy(kind); setError(''); setMessage(''); return ctl }
  const finish = ctl => { if (alive.current && active.current === ctl) { active.current = null; setBusy('') } }
  const invalidate = () => { staleRef.current = true; active.current?.abort(); active.current = null; setBusy(''); setStale(true); setConfirm(false); setMessage(''); setError('资料库已变化，请刷新目录并重新比较；当前结果不能打开或导出。') }
  const refresh = async () => {
    const ctl = begin('index'); if (!ctl) return
    staleRef.current = false; setStale(false); setIndex(null); setSnapshot(null); setConfirm(false); setPage(0); setIds(['', ''])
    try { const value = await readComparisonIndex(api, ctl.signal); if (current(ctl)) { setIndex(value); setMessage('目录已读取，请明确选择左侧和右侧两篇笔记。') } }
    catch (e) { if (current(ctl)) setError(e.message) } finally { finish(ctl) }
  }
  const cancel = () => {
    active.current?.abort(); active.current = null; setBusy(''); setError('');
    setMessage(busy === 'export' ? '导出已取消，没有发起下载。' : busy === 'open' ? '打开已取消，比较结果保留。' : busy === 'index' ? '目录读取已取消，未采用部分列表。' : '比较已取消，未采用单侧或迟到结果。')
    if (busy === 'export') setConfirm(false)
  }
  const close = () => { if (closing.current) return; closing.current = true; active.current?.abort(); active.current = null; onClose() }
  useLayoutEffect(() => { alive.current = true; const entry = document.activeElement, node = panel.current; controls(node)[0]?.focus(); return () => { alive.current = false; active.current?.abort(); active.current = null; if (entry?.isConnected && (document.activeElement === document.body || node?.contains(document.activeElement))) entry.focus?.() } }, [])
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const names = ['library:refresh','folder-workspace:changed','trash-recovery:changed']; for (const name of names) window.addEventListener(name, invalidate); return () => { for (const name of names) window.removeEventListener(name, invalidate) } }, [])
  useLayoutEffect(() => { if (confirm) controls(panel.current?.querySelector('[role=alertdialog]'))[0]?.focus(); else if (hadConfirm.current) exporting.current?.focus(); hadConfirm.current = confirm }, [confirm])
  const choices = useMemo(() => index ? comparisonChoices(index, query) : [], [index, query])
  const model = useMemo(() => snapshot ? compareNoteText(snapshot.notes[0].content, snapshot.notes[1].content, mode) : null, [snapshot, mode])
  const pages = Math.max(1, Math.ceil(choices.length / COMPARISON_PAGE)), rowPages = Math.max(1, Math.ceil((model?.rows.length || 0) / COMPARISON_ROW_PAGE))
  useLayoutEffect(() => { if (model?.state === 'different') panel.current?.querySelector('[data-change-target=true]')?.scrollIntoView?.({ block: 'nearest' }) }, [changeIndex, rowPage, model])
  const blocked = Boolean(busy || stale || confirm)
  const clearResult = () => { setSnapshot(null); setRowPage(0); setChangeIndex(0); setError(''); setMessage(''); setConfirm(false) }
  const select = (id, side) => { if (blocked) return; clearResult(); setIds(old => old.map((value, i) => i === side ? id : value === id ? '' : value)) }
  const compare = async () => {
    if (!index || staleRef.current || confirm) return
    const ctl = begin('compare'); if (!ctl) return
    setSnapshot(null); setRowPage(0); setChangeIndex(0)
    try {
      const result = await readNoteComparison(api, ids, ctl.signal)
      if (!current(ctl)) return
      if (result.notes.some(n => { const selected = index.notes.find(c => c.id === n.id); return !selected || n.title !== selected.title || n.parent_id !== selected.parent_id })) { invalidate(); return }
      setSnapshot(result); setMessage('比较已完成，仅查看保存正文；没有修改任何笔记。')
    } catch (e) { if (current(ctl)) setError(e.message) } finally { finish(ctl) }
  }
  const open = async side => {
    if (!snapshot || staleRef.current || confirm || !onOpenFile) return
    const ctl = begin('open'); if (!ctl) return
    const note = snapshot.notes[side]; let sourceError
    try {
      const accepted = await onOpenFile(note.id, { signal: ctl.signal, refreshCurrent: true, shouldSelect: () => current(ctl) && !staleRef.current,
        readFile: async (id, { signal }) => { try { if (id !== note.id) throw Error('来源身份不符'); return await readComparisonSource(api, note, signal) } catch (e) { sourceError = e; throw e } } })
      if (current(ctl)) { if (accepted === true) close(); else if (sourceError?.code === 'stale') invalidate(); else if (sourceError) setError('来源无法读取，请重试。'); else setMessage('打开已取消，比较结果保留。') }
    } catch { if (current(ctl)) { if (sourceError?.code === 'stale') invalidate(); else setError('来源无法打开，请重试。') } } finally { finish(ctl) }
  }
  const download = async () => {
    if (!confirm || !snapshot || staleRef.current) return
    const ctl = begin('export'); if (!ctl) return
    const frozen = snapshot, chosenMode = mode, include = details
    try {
      const fresh = await readNoteComparison(api, frozen.notes.map(n => n.id), ctl.signal)
      if (!current(ctl)) return
      if (!sameNoteComparison(frozen, fresh)) { invalidate(); return }
      downloadComparisonReport(frozen, chosenMode, include); setConfirm(false); setMessage('已发起比较报告下载，请核对保存结果；笔记没有修改。')
    } catch { if (current(ctl)) setError('报告未能导出；可重试或取消，不采用新的部分结果。') } finally { finish(ctl) }
  }
  const jump = delta => { const i = Math.max(0, Math.min(model.changes.length - 1, changeIndex + delta)); setChangeIndex(i); setRowPage(Math.floor(model.changes[i] / COMPARISON_ROW_PAGE)) }
  const keyboard = e => {
    e.stopPropagation()
    if (composing.current || e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (busy) cancel(); else if (confirm) setConfirm(false); else close(); return }
    if (e.key === 'Tab') { const list = controls(confirm ? panel.current.querySelector('[role=alertdialog]') : panel.current), first = list[0], last = list.at(-1); if (!first) e.preventDefault(); else if (e.shiftKey && (document.activeElement === first || !list.includes(document.activeElement))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (document.activeElement === last || !list.includes(document.activeElement))) { e.preventDefault(); first.focus() } }
  }
  return createPortal(<div className="note-comparison-overlay" data-opening={busy === 'open' ? 'true' : undefined} onMouseDown={e => { if (e.target === e.currentTarget && !confirm) close() }}>
    <section className="note-comparison" role="dialog" aria-modal="true" aria-label="本地双笔记比较" ref={panel} onKeyDown={keyboard} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <header><div><h2>双笔记比较</h2><p>两篇保存正文 · 只读比较，不自动合并</p></div><button type="button" aria-label="关闭双笔记比较" disabled={confirm} onClick={close}>×</button></header>
      <div className="note-comparison-scroll" aria-busy={busy === 'index' || busy === 'compare'}>
        {!snapshot && <>
          <p className="note-comparison-scope">选择两篇不同的普通笔记。草稿、模板、回收站、标签和附件内容不参与比较；正文每侧最多512KiB，不截断。</p>
          <div className="note-comparison-selection">{['左侧','右侧'].map((side, i) => <div key={side}><strong>{side}</strong><span data-comparison-selection={i}>{index?.notes.find(n => n.id === ids[i])?.title || '尚未选择'}</span><button type="button" disabled={blocked || !ids[i]} aria-label={'清除' + side} onClick={() => { clearResult(); setIds(v => v.map((id, n) => n === i ? '' : id)) }}>清除</button></div>)}</div>
          {index && <><label className="note-comparison-search">查找标题或直属目录<input aria-label="比较笔记查找" maxLength={128} disabled={blocked} value={query} onChange={e => { setQuery(e.target.value); setPage(0); setMessage('') }} /></label><p>普通笔记 {index.notes.length} 篇 · 匹配 {choices.length} 篇 · 第 {page + 1}/{pages} 页</p>
            <div className="note-comparison-choices">{choices.slice(page * COMPARISON_PAGE, (page + 1) * COMPARISON_PAGE).map(n => <article key={n.id} data-compare-note={n.id}><div><strong>{n.title || '未命名笔记'}</strong><p>直属位置：{n.folder}</p></div><button type="button" disabled={blocked || ids[0] === n.id} onClick={() => select(n.id, 0)}>设为左侧</button><button type="button" disabled={blocked || ids[1] === n.id} onClick={() => select(n.id, 1)}>设为右侧</button></article>)}</div>
            {!choices.length && <p>没有匹配的普通笔记。更改查找条件或刷新目录。</p>}<nav aria-label="比较笔记分页"><button type="button" disabled={blocked || page === 0} onClick={() => setPage(v => v - 1)}>上一页笔记</button><button type="button" disabled={blocked || page + 1 >= pages} onClick={() => setPage(v => v + 1)}>下一页笔记</button></nav></>}
        </>}
        {snapshot && <>
          <div className="note-comparison-selection">{snapshot.notes.map((n, i) => <div key={n.id}><strong>{i ? '右侧' : '左侧'}</strong><span>{n.title || '未命名笔记'}</span><small>{n.folder} · {n.content_bytes} 字节</small><button type="button" disabled={blocked || !onOpenFile} onClick={() => void open(i)}>{i ? '打开右侧原文' : '打开左侧原文'}</button></div>)}</div>
          <div className="note-comparison-options"><label>比较模式<select aria-label="笔记比较模式" disabled={blocked} value={mode} onChange={e => { setMode(e.target.value); setRowPage(0); setChangeIndex(0); setError(''); setMessage('') }}><option value="text">正文文本投影</option><option value="raw">保存正文原文</option></select></label><button type="button" disabled={blocked} onClick={clearResult}>返回选择</button></div>
          <p className="note-comparison-scope">文本投影不包含格式或链接目标；图片、公式或未知节点不会伪装成空文本。原文模式比较完整保存字符串，富文本可能为 JSON。均不执行 HTML。</p>
          <p className="note-comparison-result" role="note" data-comparison-state={model.state}>{model.message}{stale ? ' 当前结果已过时。' : ''}</p>
          {model.counts && <p>左侧独有 {model.counts.leftOnly} 行 · 右侧独有 {model.counts.rightOnly} 行 · {model.changes.length} 处差异</p>}
          {model.state === 'different' && <>
            <nav aria-label="笔记差异导航"><button type="button" disabled={blocked || changeIndex === 0} onClick={() => jump(-1)}>上一处差异</button><span>差异 {changeIndex + 1}/{model.changes.length}</span><button type="button" disabled={blocked || changeIndex + 1 >= model.changes.length} onClick={() => jump(1)}>下一处差异</button></nav>
            <div className="note-comparison-lines" role="table" aria-label="笔记行差异"><div role="row" className="note-comparison-line-head"><span role="columnheader">左行</span><span role="columnheader">右行</span><span role="columnheader">保存文本差异</span></div>{model.rows.slice(rowPage * COMPARISON_ROW_PAGE, (rowPage + 1) * COMPARISON_ROW_PAGE).map((r, n) => <div key={rowPage * COMPARISON_ROW_PAGE + n} role="row" data-diff-kind={r.kind} data-change-target={rowPage * COMPARISON_ROW_PAGE + n === model.changes[changeIndex] ? 'true' : undefined}><span role="cell">{r.left ?? '—'}</span><span role="cell">{r.right ?? '—'}</span><div role="cell"><small>{r.kind === 'left' ? '左侧独有' : r.kind === 'right' ? '右侧独有' : '两侧相同'} · 行结束 {r.ending}</small><pre>{r.text || ' '}</pre></div></div>)}</div>
            <nav aria-label="笔记差异分页"><button type="button" disabled={blocked || rowPage === 0} onClick={() => setRowPage(v => v - 1)}>上一页差异</button><span>第 {rowPage + 1}/{rowPages} 页</span><button type="button" disabled={blocked || rowPage + 1 >= rowPages} onClick={() => setRowPage(v => v + 1)}>下一页差异</button></nav>
          </>}
        </>}
        {busy === 'index' && <p>正在读取本机目录…可以取消。</p>}{busy === 'compare' && <p>正在同时读取两篇保存正文…可以取消。</p>}
      </div>
      <div className="note-comparison-feedback" aria-label="笔记比较操作反馈">
        {confirm && <div role="alertdialog" aria-modal="true" aria-label="确认笔记比较导出"><p>默认只导出比较状态和计数，不含标题、ID、正文、目录或摘要。勾选后包含两篇完整保存正文，可能含隐私。导出前重新核对两篇资料，变化则拒绝。</p><label><input type="checkbox" checked={details} disabled={Boolean(busy)} onChange={e => setDetails(e.target.checked)} />包含两篇身份、完整正文和行差异</label><button type="button" onClick={() => busy ? cancel() : setConfirm(false)}>取消导出</button><button type="button" disabled={Boolean(busy)} onClick={() => void download()}>{busy === 'export' ? '正在核对…' : '确认导出'}</button></div>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      </div>
      <footer><span>只读 · 不合并、不删除</span><button type="button" disabled={Boolean(busy || confirm)} onClick={() => void refresh()}>刷新目录</button>{!snapshot && <><button type="button" disabled={blocked || ids.some(id => !id)} onClick={() => { clearResult(); setIds(([a, b]) => [b, a]) }}>交换左右</button><button type="button" disabled={blocked || ids.some(id => !id) || ids[0] === ids[1]} onClick={() => void compare()}>开始比较</button></>}{busy && <button type="button" onClick={cancel}>{busy === 'open' ? '取消打开' : busy === 'export' ? '停止核对' : '取消读取'}</button>}{snapshot && <button type="button" ref={exporting} disabled={blocked} onClick={() => { setDetails(false); setError(''); setMessage(''); setConfirm(true) }}>导出比较报告</button>}</footer>
    </section>
  </div>, document.body)
}
