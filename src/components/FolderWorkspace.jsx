import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { FOLDER_JOURNAL, FOLDER_CHANGED, createFolderJournal, folderChildren, folderCurrentMatches, folderIntent, folderPath, readFolderWorkspace, sendFolderChange } from '~/services/folderWorkspace.mjs'
import './FolderWorkspace.css'

const controls = node => [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])].filter(n => !n.closest('fieldset:disabled,[hidden]'))
const blank = () => ({ kind:'create', name:'' })
export default function FolderWorkspace({ onClose, onOpenFile }) {
  const [snapshot,setSnapshot] = useState(null), [loading,setLoading] = useState(false), [busy,setBusy] = useState(false), [opening,setOpening] = useState(false), [stale,setStale] = useState(false)
  const [current,setCurrent] = useState(''), [query,setQuery] = useState(''), [page,setPage] = useState(0), [selected,setSelected] = useState([]), [form,setForm] = useState(blank)
  const [confirmation,setConfirmation] = useState(null), [pending,setPending] = useState(null), [corrupt,setCorrupt] = useState(false), [reviewed,setReviewed] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('')
  const alive = useRef(false), panel = useRef(null), reader = useRef(null), writer = useRef(null), navigator = useRef(null), working = useRef(false), composing = useRef(false), epoch = useRef(0), staleRef = useRef(false), origin = useRef({})
  const journal = useMemo(() => createFolderJournal({ getItem:k => localStorage.getItem(k), setItem:(k,v) => localStorage.setItem(k,v), removeItem:k => localStorage.removeItem(k) }),[])
  const readRecord = () => { try { const v = journal.read(); setPending(v); setCorrupt(false); return v } catch { setCorrupt(true); setError('本机操作记录无法读取，原记录保留；暂不允许新修改。'); return null } }
  const load = async (reconcile = false) => {
    if (working.current) return
    const ctl = new AbortController(); reader.current?.abort(); navigator.current?.abort(); reader.current = ctl; setOpening(false); setLoading(true); setSnapshot(null); setSelected([]); setPage(0); setConfirmation(null); setError(''); setMessage(''); setReviewed(false)
    try {
      const value = await readFolderWorkspace(api,ctl.signal)
      if (!alive.current || ctl.signal.aborted || reader.current !== ctl) return
      setSnapshot(value); setCurrent(id => value.items.some(n => n.id === id && n.is_folder) ? id : ''); setStale(false); staleRef.current = false
      const record = journal.read(); setPending(record); setCorrupt(false)
      if (record && reconcile) { setReviewed(true); setMessage(folderCurrentMatches(value,record) ? '当前目录与原目标一致；这不是原请求的历史回执。只读取核对，没有重发。' : '当前目录与原目标不同；这不是原请求的历史回执。没有再次修改，请检查后明确结束本机记录。') }
      else setMessage(record ? '目录已读取；存在待核对操作，先核对当前状态，不会自动重发。' : '完整目录已读取。选择项目后进入目标目录，再确认移动。')
    } catch (e) { if (alive.current && !ctl.signal.aborted && reader.current === ctl) { setError(e.message); readRecord() } }
    finally { if (alive.current && reader.current === ctl) setLoading(false) }
  }
  useLayoutEffect(() => { alive.current = true; const entry = document.activeElement, node = panel.current; controls(node)[0]?.focus(); return () => { alive.current = false; reader.current?.abort(); writer.current?.abort(); navigator.current?.abort(); if (entry?.isConnected && (!document.activeElement || document.activeElement === document.body || node?.contains(document.activeElement))) entry.focus?.() } },[])
  useEffect(() => { readRecord(); void load() },[])
  useEffect(() => {
    const change = e => {
      if (e.detail?.folderOrigin === origin.current || (e.type === 'storage' && e.key !== FOLDER_JOURNAL && e.key !== null)) return
      epoch.current++; staleRef.current = true; reader.current?.abort(); navigator.current?.abort(); setLoading(false); setOpening(false); setStale(true); setConfirmation(null); setReviewed(false); setMessage(''); setError('资料或操作记录已在其它位置变化。输入保留，请重新读取后确认。'); readRecord()
    }
    for (const name of ['storage','library:refresh',FOLDER_CHANGED]) window.addEventListener(name,change)
    return () => { for (const name of ['storage','library:refresh',FOLDER_CHANGED]) window.removeEventListener(name,change) }
  },[])
  useLayoutEffect(() => { if (confirmation) controls(panel.current.querySelector('[role=alertdialog]'))[0]?.focus() },[confirmation])
  const byID = useMemo(() => new Map(snapshot?.items.map(n => [n.id,n]) || []),[snapshot])
  const rows = useMemo(() => snapshot ? folderChildren(snapshot,current,query) : [],[snapshot,current,query])
  const pages = Math.max(1,Math.ceil(rows.length / 50)), folder = byID.get(current), dirty = !!form.name && (form.kind !== 'rename' || form.name !== folder?.title)
  const blocked = !snapshot || loading || busy || opening || stale || !!pending || corrupt
  const quiet = () => { setMessage(''); if (!stale && !pending && !corrupt) setError('') }
  const closeNow = () => { reader.current?.abort(); writer.current?.abort(); navigator.current?.abort(); onClose() }
  const close = () => { if (confirmation) return; if (busy || dirty) setConfirmation({ kind:'leave' }); else closeNow() }
  const changeLocation = id => { setCurrent(id); setQuery(''); setPage(0); setForm(blank()); quiet() }
  const browse = id => { if (dirty) setConfirmation({ kind:'browse',id }); else changeLocation(id) }
  const refresh = () => { if (working.current) return; if (dirty) setConfirmation({ kind:'reload' }); else void load(!!pending) }
  const cancelRead = () => { reader.current?.abort(); reader.current = null; setLoading(false); setSnapshot(null); setMessage('读取已取消，没有采用部分目录。'); setError('') }
  const toggle = key => { quiet(); if (!selected.includes(key) && selected.length >= 100) { setError('每次最多选择100项，请分批整理。'); return } setSelected(ids => ids.includes(key) ? ids.filter(id => id !== key) : ids.length < 100 ? [...ids,key] : ids) }
  const propose = (kind, options) => {
    if (blocked || composing.current) return
    quiet()
    try { const intent = folderIntent(snapshot,kind,options); setConfirmation({ kind:'change',intent }); setError('') } catch (e) { setError(e.message) }
  }
  const run = async intent => {
    if (working.current || blocked || snapshot.revision !== intent.expected_revision || staleRef.current) return
    working.current = true; quiet()
    try { journal.save(intent) } catch { working.current = false; readRecord(); setError('本机操作记录未能保存并读回，尚未发送目录修改。请处理存储空间或已有记录后重试。'); return }
    const ctl = new AbortController(), generation = epoch.current, before = snapshot; writer.current = ctl; setBusy(true); setPending(intent); setReviewed(false); setError(''); setMessage('')
    let acknowledged = false
    try {
      const value = await sendFolderChange(api,before,intent,ctl.signal)
      if (!alive.current || ctl.signal.aborted) return
      acknowledged = true
      if (generation === epoch.current) { setSnapshot(value); setCurrent(id => value.items.some(n => n.id === id && n.is_folder) ? id : ''); setStale(false); staleRef.current = false }
      else { setSnapshot(null); setStale(true); staleRef.current = true }
      setSelected([]); setForm(blank()); setPage(0)
      window.dispatchEvent(new CustomEvent('library:refresh',{ detail:{ folderOrigin:origin.current } }))
      window.dispatchEvent(new CustomEvent(FOLDER_CHANGED,{ detail:{ folderOrigin:origin.current } }))
      journal.clear(intent); setPending(null)
      setMessage(generation === epoch.current ? '本机数据库已确认本次目录修改；笔记正文、标签与附件没有改变。' : '数据库已确认本次操作，随后有外部变化，请重新读取当前目录。')
    } catch { if (alive.current) { setMessage(''); setError(acknowledged ? '数据库已确认，但本机记录未能清除；请只读核对，不要重发。' : '目录修改结果未确认。停止等待或超时不等于撤销，记录已保留；请核对当前状态，不会自动重发。'); readRecord() } }
    finally { working.current = false; if (writer.current === ctl) writer.current = null; if (alive.current) setBusy(false) }
  }
  const openNote = async id => {
    if (!snapshot || loading || busy || opening || staleRef.current || !onOpenFile) return
    if (dirty) { setConfirmation({ kind:'open',id }); return }
    await navigate(id)
  }
  const navigate = async id => {
    const ctl = new AbortController(); navigator.current?.abort(); navigator.current = ctl; setOpening(true); quiet()
    const valid = () => alive.current && !ctl.signal.aborted && navigator.current === ctl && !staleRef.current
    try { const accepted = await onOpenFile(id,{ signal:ctl.signal, shouldSelect:valid }); if (valid()) { if (accepted === true) onClose(); else setMessage('打开已取消，目录与当前笔记保持。') } }
    catch { if (valid()) setError('来源笔记暂时无法打开，请重新读取后重试。') }
    finally { if (alive.current && navigator.current === ctl) setOpening(false) }
  }
  const confirm = () => {
    const choice = confirmation; if (!choice) return; setConfirmation(null)
    if (choice.kind === 'change') { void run(choice.intent); return }
    if (choice.kind === 'leave') { closeNow(); return }
    if (choice.kind === 'browse') { changeLocation(choice.id); return }
    if (choice.kind === 'reload') { setForm(blank()); void load(!!pending); return }
    if (choice.kind === 'open') { setForm(blank()); void navigate(choice.id); return }
    if (choice.kind === 'form') { setForm(choice.form); quiet(); return }
    try { if (choice.kind === 'corrupt') journal.discardCorrupt(choice.raw); else journal.clear(choice.record); setPending(null); setCorrupt(false); setReviewed(false); setError(''); setMessage('本机待核对记录已结束；没有撤销或重发数据库操作。') } catch (e) { setError(e.message); readRecord() }
  }
  const setEdit = next => { if (dirty) setConfirmation({ kind:'form',form:next }); else { setForm(next); quiet() } }
  const clearRecord = () => { try { setConfirmation(corrupt ? { kind:'corrupt',raw:journal.raw() } : { kind:'record',record:pending }) } catch { setError('操作记录无法读取，未清除。') } }
  const keyboard = e => {
    if (opening) return
    e.stopPropagation()
    if (composing.current || e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (confirmation) setConfirmation(null); else close(); return }
    if (e.key === 'Tab') { const nodes = controls(confirmation ? panel.current.querySelector('[role=alertdialog]') : panel.current), first = nodes[0], last = nodes.at(-1); if (!first) e.preventDefault(); else if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus() } }
  }
  const confirmText = confirmation?.kind === 'change' ? `${confirmation.intent.label}。${confirmation.intent.kind === 'move' ? '内部资料随文件夹移动，遇到同名或目录变化会整批拒绝。' : confirmation.intent.kind === 'trash-empty' ? '只移入回收站，不永久删除；有任何隐藏子项也会拒绝。' : '不会覆盖已有同名项目。'}不会修改笔记正文。`
    : ['record','corrupt'].includes(confirmation?.kind) ? '只清除本机操作记录，不撤销或重发数据库修改。已提交操作不会因此回滚，请以最新目录为准。'
      : busy ? '停止等待并关闭？已发送的修改可能仍完成，待核对记录会保留，不会自动重发。' : '放弃尚未提交的名称输入并继续？已保存目录不会改变。'
  return createPortal(<div className="folder-workspace-overlay" data-opening={opening ? 'true' : undefined} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
    <section className="folder-workspace" ref={panel} role="dialog" aria-modal="true" aria-label="本地文件夹整理工作台" onKeyDown={keyboard} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
      <header><div><h2>文件夹整理工作台</h2><p>选择来源 → 浏览目标目录 → 预览并确认移动</p></div><button type="button" aria-label="关闭文件夹整理" disabled={!!confirmation} onClick={close}>×</button></header>
      <div className="folder-workspace-scroll" aria-busy={loading || busy}>
        <p className="folder-workspace-scope">整理本机普通笔记和目录；不改正文、标签或附件。模板与回收站不显示为可移动项，但会参与空目录检查。移走文件夹不会删除内部资料。</p>
        {loading && <p>正在读取完整目录…可以取消。</p>}
        {snapshot && <>
          <nav className="folder-workspace-path" aria-label="当前目录"><button type="button" disabled={busy || opening || !!confirmation || !current} onClick={() => browse('')}>根目录</button><button type="button" disabled={busy || opening || !!confirmation || !current} onClick={() => browse(folder?.parent_id || '')}>上一级</button><strong title={folderPath(snapshot,current)}>{folderPath(snapshot,current)}</strong></nav>
          <p>{snapshot.items.filter(n => n.is_folder).length} 个普通文件夹 · {snapshot.items.filter(n => !n.is_folder).length} 篇普通笔记 · {snapshot.hidden_count} 个模板/回收站项目不在移动列表{stale ? ' · 结果已过时' : ''}</p>
          <fieldset className="folder-workspace-tools" disabled={busy || opening || !!confirmation}>
            <label>当前目录查找<input aria-label="文件夹内容查找" maxLength={128} value={query} onChange={e => { setQuery(e.target.value); setPage(0); quiet() }} /></label>
            <button type="button" disabled={!selected.length} onClick={() => { setSelected([]); quiet() }}>清空选择</button>
            <button type="button" disabled={blocked || !selected.length} onClick={() => propose('move',{ ids:selected,parent_id:current })}>移动所选到当前目录</button>
          </fieldset>
          <div className="folder-workspace-items" role="group" aria-label="目录项目">{rows.slice(page*50,(page+1)*50).map(row => <article key={row.id} data-folder-item={row.id} data-kind={row.is_folder ? 'folder' : 'note'}>
            <label><input type="checkbox" aria-label={`选择 ${row.title}`} disabled={blocked || !!confirmation} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /><span aria-hidden="true">{row.is_folder ? '▣' : '▤'}</span><strong>{row.title || '未命名'}</strong></label>
            <button type="button" disabled={busy || opening || !!confirmation || (!row.is_folder && (stale || !onOpenFile))} onClick={() => row.is_folder ? browse(row.id) : void openNote(row.id)}>{row.is_folder ? '浏览目录' : '打开笔记'}</button>
            {row.is_folder && <small>{snapshot.items.filter(n => n.parent_id === row.id).length} 个普通子项 · {row.hidden_children} 个隐藏子项</small>}
          </article>)}</div>
          {!rows.length && <p>{query ? '当前目录没有符合查找条件的项目。' : '当前目录没有普通项目。隐藏子项不等于可删除。'}</p>}
          <nav aria-label="目录分页"><span>{rows.length} 项 · 第 {page+1}/{pages} 页</span><button type="button" disabled={page===0 || busy || opening || !!confirmation} onClick={() => setPage(p=>p-1)}>上一页</button><button type="button" disabled={page+1>=pages || busy || opening || !!confirmation} onClick={() => setPage(p=>p+1)}>下一页</button></nav>
          {!!selected.length && <details><summary>已选择 {selected.length} 项（跨目录保留选择）</summary><ul>{selected.map(id => <li key={id}>{folderPath(snapshot,id)}</li>)}</ul></details>}
          <form onSubmit={e => { e.preventDefault(); propose(form.kind,{ ids:current ? [current] : [],name:form.name,parent_id:form.kind === 'create' ? current : '' }) }}>
            <fieldset disabled={blocked || !!confirmation}><legend>{form.kind === 'create' ? '在当前目录新建文件夹' : '重命名当前文件夹'}</legend><label>文件夹名称<input aria-label="整理文件夹名称" value={form.name} onChange={e => { setForm({ ...form,name:e.target.value }); quiet() }} onKeyDown={e => { if (e.key === 'Enter' && (composing.current || e.nativeEvent?.isComposing || e.keyCode === 229)) e.preventDefault() }} /></label><button type="submit" disabled={!dirty}>预览名称操作</button><button type="button" disabled={!current} onClick={() => setEdit(form.kind === 'create' ? { kind:'rename',name:folder.title } : blank())}>{form.kind === 'create' ? '改为重命名当前目录' : '改为新建目录'}</button><button type="button" disabled={!current} onClick={() => propose('trash-empty',{ ids:[current] })}>将当前空目录移到回收站</button></fieldset>
          </form>
        </>}
      </div>
      <div className="folder-workspace-feedback" aria-label="目录操作反馈">
        {confirmation && <div role="alertdialog" aria-modal="true" aria-label="确认目录操作"><p>{confirmText}</p><button type="button" onClick={() => setConfirmation(null)}>取消操作</button><button type="button" onClick={confirm}>确认继续</button></div>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        {(pending || corrupt) && <div className="folder-workspace-recovery"><strong>{corrupt ? '操作记录损坏或不可读取' : '有待核对的目录操作'}</strong><button type="button" disabled={busy || loading || opening || !!confirmation || corrupt} onClick={() => void load(true)}>核对当前状态</button><button type="button" disabled={busy || loading || opening || !!confirmation || (!corrupt && !reviewed)} onClick={clearRecord}>{corrupt ? '清除损坏记录' : '结束待核对记录'}</button></div>}
      </div>
      <footer><span>{busy ? '修改已发送；停止等待不等于撤销' : opening ? '等待原保存保护…' : `已选 ${selected.length}/100 项 · 正文保持不变`}</span><button type="button" disabled={busy || loading || opening || !!confirmation} onClick={refresh}>重新读取目录</button>{loading && <button type="button" onClick={cancelRead}>取消读取</button>}{busy && <button type="button" disabled={!!confirmation} onClick={() => writer.current?.abort()}>停止等待</button>}{opening && <button type="button" onClick={() => { navigator.current?.abort(); setOpening(false); setMessage('打开已取消。') }}>取消打开</button>}</footer>
    </section>
  </div>,document.body)
}
