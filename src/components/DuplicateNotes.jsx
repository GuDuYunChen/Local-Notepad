import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { DUPLICATE_PAGE_SIZE as PAGE, readDuplicateNotes, duplicateGroups, readDuplicateSource, downloadDuplicateReport } from '~/services/duplicateNotes.mjs'
import './DuplicateNotes.css'
const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || [])].filter(n => !n.closest('[hidden],fieldset:disabled'))
const date = seconds => new Date(seconds * 1000).toLocaleString('zh-CN')

export default function DuplicateNotes({ onClose, onOpenFile }) {
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState(''), [stale, setStale] = useState(false)
  const [query, setQuery] = useState(''), [sort, setSort] = useState('count'), [page, setPage] = useState(0), [selected, setSelected] = useState(null), [memberPage, setMemberPage] = useState(0)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [confirmation, setConfirmation] = useState(null), [details, setDetails] = useState(false)
  const alive = useRef(false), active = useRef(null), staleRef = useRef(false), closing = useRef(false), panel = useRef(null), composing = useRef(false), exportButton = useRef(null), confirmed = useRef(false)
  const current = ctl => alive.current && !closing.current && !ctl.signal.aborted && active.current === ctl
  const begin = kind => { if (active.current || closing.current) return null; const ctl = new AbortController(); active.current = ctl; setBusy(kind); setError(''); setMessage(''); return ctl }
  const finish = ctl => { if (alive.current && active.current === ctl) { active.current = null; setBusy('') } }
  const invalidate = () => { staleRef.current = true; active.current?.abort(); active.current = null; setBusy(''); setStale(true); setConfirmation(null); setMessage(''); setError('资料库已变化，请重新检查后打开来源或导出。') }
  const refresh = async () => {
    const ctl = begin('read'); if (!ctl) return
    setSnapshot(null); setStale(false); staleRef.current = false; setConfirmation(null); setPage(0); setSelected(null); setMemberPage(0)
    try { const value = await readDuplicateNotes(api, ctl.signal); if (current(ctl)) { setSnapshot(value); setMessage('重复检查已完成。结果只表示保存正文相同，不代表可以安全删除。') } }
    catch (e) { if (current(ctl)) setError(e.message) } finally { finish(ctl) }
  }
  const cancel = () => { active.current?.abort(); active.current = null; setBusy(''); setError(''); setMessage(busy === 'export' ? '导出已取消，没有发起下载。' : busy === 'open' ? '打开已取消，检查结果保留。' : '检查已取消，没有采用部分结果。'); if (busy === 'read') setSnapshot(null); if (busy === 'export') setConfirmation(null) }
  const close = () => { if (closing.current) return; closing.current = true; active.current?.abort(); active.current = null; onClose() }
  useLayoutEffect(() => { alive.current = true; const entry = document.activeElement, node = panel.current; controls(node)[0]?.focus(); return () => { alive.current = false; active.current?.abort(); active.current = null; if (entry?.isConnected && (!document.activeElement || document.activeElement === document.body || node?.contains(document.activeElement))) entry.focus?.() } }, [])
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const names = ['library:refresh', 'folder-workspace:changed', 'trash-recovery:changed']; for (const name of names) window.addEventListener(name, invalidate); return () => { for (const name of names) window.removeEventListener(name, invalidate) } }, [])
  useLayoutEffect(() => { if (confirmation) controls(panel.current?.querySelector('[role=alertdialog]'))[0]?.focus(); else if (confirmed.current) exportButton.current?.focus(); confirmed.current = Boolean(confirmation) }, [Boolean(confirmation)])
  const groups = useMemo(() => snapshot ? duplicateGroups(snapshot, { query, sort }) : [], [snapshot, query, sort])
  const byId = useMemo(() => new Map(snapshot?.notes.map(n => [n.id, n]) || []), [snapshot])
  const group = groups.find(g => g.hash === selected), pageCount = Math.max(1, Math.ceil(groups.length / PAGE)), memberPages = Math.max(1, Math.ceil((group?.ids.length || 0) / PAGE))
  const change = (setter, value) => { setter(value); setPage(0); setSelected(null); setMemberPage(0); setMessage(''); if (!stale) setError('') }
  const open = async note => {
    if (!onOpenFile || !note || staleRef.current || confirmation) return
    const ctl = begin('open'); if (!ctl) return
    let sourceError
    try {
      const accepted = await onOpenFile(note.id, { signal: ctl.signal, shouldSelect: () => current(ctl) && !staleRef.current, refreshCurrent: true,
        readFile: async (id, { signal }) => { if (id !== note.id) throw Error('来源身份不一致'); try { return await readDuplicateSource(api, note, signal) } catch (e) { sourceError = e; throw e } } })
      if (current(ctl)) {
        if (accepted === true) close()
        else if (sourceError?.code === 'STALE_DUPLICATE_SOURCE') invalidate()
        else if (sourceError) setError('来源读取失败，请重试；没有修改笔记。')
        else setMessage('打开已取消，检查结果保留。')
      }
    } catch { if (current(ctl)) { if (sourceError?.code === 'STALE_DUPLICATE_SOURCE') invalidate(); else setError('来源暂时无法打开，请重试。') } } finally { finish(ctl) }
  }
  const exportNow = async () => {
    if (!confirmation || !snapshot || staleRef.current) return
    const ctl = begin('export'); if (!ctl) return
    const frozen = confirmation, include = details
    try {
      const fresh = await readDuplicateNotes(api, ctl.signal)
      if (!current(ctl)) return
      if (fresh.revision !== frozen.snapshot.revision) { invalidate(); return }
      downloadDuplicateReport(frozen.snapshot, frozen.options, include)
      setConfirmation(null); setMessage('已发起重复检查报告下载，请核对保存结果；没有修改笔记。')
    } catch { if (current(ctl)) setError('报告未能导出，未采用新的部分结果；可重试或取消。') } finally { finish(ctl) }
  }
  const keyboard = e => {
    if (busy === 'open') return // The original save/discard/cancel owner handles its own keyboard.
    e.stopPropagation()
    if (composing.current || e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (busy) cancel(); else if (confirmation) setConfirmation(null); else close(); return }
    if (e.key === 'Tab') { const nodes = controls(confirmation ? panel.current.querySelector('[role=alertdialog]') : panel.current), first = nodes[0], last = nodes.at(-1); if (!first) e.preventDefault(); else if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus() } }
  }
  const disabled = Boolean(busy || stale || confirmation), t = snapshot?.totals
  return createPortal(<div className="duplicate-notes-overlay" data-opening={busy === 'open' ? 'true' : undefined} onMouseDown={e => { if (e.target === e.currentTarget && !confirmation) close() }}>
    <section className="duplicate-notes" role="dialog" aria-modal="true" aria-label="本地重复笔记检查" ref={panel} onKeyDown={keyboard} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <header><div><h2>重复笔记检查</h2><p>保存正文精确比对 · 不自动合并或删除</p></div><button type="button" aria-label="关闭重复笔记检查" disabled={Boolean(confirmation)} onClick={close}>×</button></header>
      <div className="duplicate-notes-scroll" aria-busy={busy === 'read'}>
        <p className="duplicate-notes-scope">按已保存正文的 UTF-8 字节完全一致分组，不是标题相同、内容相似或可以安全删除。草稿、模板、回收站、零字节正文和附件文件内容不参与分组。</p>
        {busy === 'read' && <p>正在检查本机笔记…可以取消。</p>}
        {snapshot && <>
          <dl className="duplicate-notes-cards">{[['相同正文组', t.groups], ['涉及笔记', t.duplicate_notes], ['额外相同副本', t.additional_copies]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString('zh-CN')}</dd></div>)}</dl>
          <p>已检查 {t.notes} 篇普通笔记 · 零字节正文 {t.empty} 篇 · {date(snapshot.captured_at)}{stale ? ' · 已过时' : ''}</p>
          <details><summary>检查范围与结果的含义</summary><p>只比较保存的原始正文，不忽略空白、富文本标记或块 ID。界面看起来相同的正文仍可能不同；结构相同的富文本空文档可以成组。相同正文也可能有不同标题、位置、标签、引用或历史，不能自动判断保留哪一篇。不计算可释放磁盘空间。</p><p>范围外：模板 {t.templates}，回收站条目 {t.trash}，文件夹 {t.folders}。资料过多或读取失败会拒绝整份检查，不采用截断结果。</p></details>
          <fieldset className="duplicate-notes-filters" disabled={disabled}><legend>查找分组</legend><label>标题或直属目录<input aria-label="重复笔记查找" maxLength={128} value={query} onChange={e => change(setQuery, e.target.value)} /></label><label>排序<select aria-label="重复分组排序" value={sort} onChange={e => change(setSort, e.target.value)}><option value="count">笔记最多</option><option value="updated">最近修改</option><option value="size">单篇正文最大</option></select></label></fieldset>
          {!group && <><p>当前 {groups.length} 组 · 第 {page + 1}/{pageCount} 页。匹配一个成员时显示整组。</p><div className="duplicate-notes-groups">{groups.slice(page * PAGE, (page + 1) * PAGE).map(g => <article key={g.hash} data-duplicate-group={g.hash}><div><strong>{byId.get(g.ids[0]).title || '未命名笔记'}</strong><p>{g.ids.length} 篇保存正文相同 · 每篇 {g.content_bytes.toLocaleString('zh-CN')} 字节</p></div><button type="button" disabled={disabled} onClick={() => { setSelected(g.hash); setMemberPage(0); setMessage('') }}>查看整组</button></article>)}</div>{!groups.length && <p>没有符合条件的完全相同正文组。此结果不代表不存在相似内容。</p>}<nav aria-label="重复分组分页"><button type="button" disabled={disabled || page === 0} onClick={() => setPage(p => p - 1)}>上一页分组</button><button type="button" disabled={disabled || page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>下一页分组</button></nav></>}
          {group && <><button type="button" disabled={disabled} onClick={() => setSelected(null)}>返回分组</button><p>本组 {group.ids.length} 篇 · 第 {memberPage + 1}/{memberPages} 页 · 不推荐自动保留或删除任何成员</p><div className="duplicate-notes-members">{group.ids.slice(memberPage * PAGE, (memberPage + 1) * PAGE).map(id => { const n = byId.get(id); return <article key={id} data-duplicate-note={id}><div><strong>{n.title || '未命名笔记'}</strong><p>直属位置：{n.folder} · 修改：{date(n.updated_at)}</p></div><button type="button" disabled={disabled || !onOpenFile} onClick={() => void open(n)}>打开来源</button></article> })}</div><nav aria-label="重复成员分页"><button type="button" disabled={disabled || memberPage === 0} onClick={() => setMemberPage(p => p - 1)}>上一页成员</button><button type="button" disabled={disabled || memberPage + 1 >= memberPages} onClick={() => setMemberPage(p => p + 1)}>下一页成员</button></nav></>}
        </>}
      </div>
      <div className="duplicate-notes-feedback" aria-label="重复检查操作反馈">
        {confirmation && <div role="alertdialog" aria-modal="true" aria-label="确认重复报告导出"><p>默认只导出计数，不含标题、目录名、笔记 ID、正文摘要或查询词。勾选后附当前筛选整组的来源清单。导出前重新核对完整快照，变化则拒绝。</p><label><input type="checkbox" disabled={Boolean(busy)} checked={details} onChange={e => setDetails(e.target.checked)} />包含标题、目录、来源 ID 和正文摘要</label><button type="button" onClick={() => { if (busy) cancel(); else setConfirmation(null) }}>取消导出</button><button type="button" disabled={Boolean(busy)} onClick={() => void exportNow()}>{busy === 'export' ? '正在核对…' : '确认导出'}</button></div>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      </div>
      <footer><span>只读检查 · 正文不修改</span><button type="button" disabled={Boolean(busy || confirmation)} onClick={() => void refresh()}>重新检查</button>{busy && <button type="button" onClick={cancel}>{busy === 'read' ? '取消检查' : busy === 'open' ? '取消打开' : '停止核对'}</button>}<button type="button" ref={exportButton} disabled={!snapshot || disabled} onClick={() => { setDetails(false); setError(''); setMessage(''); setConfirmation({ snapshot, options: { query, sort } }) }}>导出重复报告</button></footer>
    </section>
  </div>, document.body)
}
