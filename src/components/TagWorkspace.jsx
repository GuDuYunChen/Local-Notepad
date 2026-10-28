import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '~/services/api'
import { tagColor } from '~/services/noteTags.mjs'
import { TAG_WORKSPACE_CHANGED, TAG_WORKSPACE_JOURNAL, createTagWorkspaceJournal, readTagWorkspace, readTagWorkspaceNotes, sendTagWorkspaceIntent, tagWorkspaceCurrentMatches, tagWorkspaceIntent } from '~/services/tagWorkspace.mjs'
import './TagWorkspace.css'
const composing = e => e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229
const focusables = node => [...(node?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(item => !item.closest('[hidden], fieldset:disabled'))
const blankForm = () => ({ kind: 'create', id: '', name: '', color: '#7e5bef' })

export default function TagWorkspace({ onClose, onOpenFile }) {
  const [snapshot, setSnapshot] = useState(null), [status, setStatus] = useState('loading')
  const [selected, setSelected] = useState(''), [page, setPage] = useState(null), [pageBusy, setPageBusy] = useState(false)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [unused, setUnused] = useState(false)
  const [form, setForm] = useState(blankForm), [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false), [opening, setOpening] = useState(false), [stale, setStale] = useState(false)
  const [pending, setPending] = useState(null), [corrupt, setCorrupt] = useState(false), [reviewed, setReviewed] = useState(false)
  const [confirmation, setConfirmation] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState('')
  const alive = useRef(false), readOwner = useRef(null), pageOwner = useRef(null), writeOwner = useRef(null), openOwner = useRef(null), action = useRef(false), composingRef = useRef(false)
  const panel = useRef(null), currentSnapshot = useRef(null), currentSelected = useRef(''), externalEpoch = useRef(0)
  currentSnapshot.current = snapshot; currentSelected.current = selected
  const journal = useMemo(() => createTagWorkspaceJournal({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }), [])
  const readPending = () => { try { const next = journal.read(); setPending(next); setCorrupt(false); return next } catch { setCorrupt(true); setError('本机操作记录无法读取；原记录保留，暂不允许新修改。'); return null } }
  const load = async (reconcile = false) => {
    if (action.current) return
    const ctl = new AbortController(); readOwner.current?.abort(); pageOwner.current?.abort(); readOwner.current = ctl
    setStatus('loading'); setPage(null); setPageBusy(false); setError(''); setMessage(''); setConfirmation(null)
    try {
      const value = await readTagWorkspace(api, ctl.signal)
      if (!alive.current || ctl.signal.aborted || readOwner.current !== ctl) return
      setSnapshot(value); setStatus('ready'); setStale(false)
      setSelected(id => value.tags.some(tag => tag.id === id) ? id : value.tags[0]?.id || '')
      if (reconcile) {
        const item = journal.read(); setPending(item); setCorrupt(false); setReviewed(true)
        setMessage(item ? (tagWorkspaceCurrentMatches(value, item) ? '当前标签状态与目标一致；这不是原请求的历史回执。核对后可以结束本机记录，不会重发。' : '当前标签状态与原目标不同；没有再次修改。请核对后明确结束本机记录。') : '已重新读取完整标签库。')
      }
    } catch (failure) { if (alive.current && !ctl.signal.aborted && readOwner.current === ctl) { setSnapshot(null); setStatus('error'); setError(failure.message); setReviewed(false) } }
  }
  const loadPage = async (offset = 0, source = snapshot, id = selected) => {
    if (!source || !id || action.current) return
    const ctl = new AbortController(); pageOwner.current?.abort(); pageOwner.current = ctl; setPage(null); setPageBusy(true)
    try {
      const value = await readTagWorkspaceNotes(api, source, id, offset, ctl.signal)
      if (alive.current && !ctl.signal.aborted && pageOwner.current === ctl && currentSnapshot.current?.revision === source.revision && currentSelected.current === id) setPage(value)
    } catch (failure) { if (alive.current && !ctl.signal.aborted && pageOwner.current === ctl) { setError(failure.message + '；请重新读取标签库。'); setStale(true) } }
    finally { if (alive.current && pageOwner.current === ctl) setPageBusy(false) }
  }
  useLayoutEffect(() => {
    alive.current = true; const entry = document.activeElement, node = panel.current
    focusables(node)[0]?.focus()
    return () => { alive.current = false; readOwner.current?.abort(); pageOwner.current?.abort(); writeOwner.current?.abort(); openOwner.current?.abort(); if (entry?.isConnected && (!document.activeElement || document.activeElement === document.body || node?.contains(document.activeElement))) entry.focus?.() }
  }, [])
  useEffect(() => { readPending(); void load() }, [])
  useEffect(() => { if (snapshot && selected && !stale) void loadPage(0, snapshot, selected); else { pageOwner.current?.abort(); setPage(null) } }, [snapshot, selected, stale])
  useEffect(() => {
    const changed = event => {
      if (event.type === 'storage' && event.key !== TAG_WORKSPACE_JOURNAL && event.key !== null) return
      externalEpoch.current++; readOwner.current?.abort(); pageOwner.current?.abort(); setPage(null); setPageBusy(false); setStatus(currentSnapshot.current ? 'ready' : 'error'); setStale(true); setConfirmation(null); setReviewed(false)
      readPending(); setMessage(''); setError('标签或操作记录已在其它位置变化，请重新读取后确认；当前输入保留。')
    }
    window.addEventListener('storage', changed); window.addEventListener('note-tags:changed', changed); window.addEventListener(TAG_WORKSPACE_CHANGED, changed)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('note-tags:changed', changed); window.removeEventListener(TAG_WORKSPACE_CHANGED, changed) }
  }, [])
  useLayoutEffect(() => { if (confirmation) panel.current.querySelector('[role="alertdialog"] button')?.focus() }, [confirmation])
  const selectedTag = snapshot?.tags.find(tag => tag.id === selected)
  const dirty = form.kind === 'rename' ? Boolean(snapshot?.tags.find(tag => tag.id === form.id) && (form.name !== snapshot.tags.find(tag => tag.id === form.id).name || form.color !== tagColor(snapshot.tags.find(tag => tag.id === form.id).color))) : Boolean(form.name)
  const blocked = busy || opening || status !== 'ready' || stale || !!pending || corrupt
  const closeNow = () => { writeOwner.current?.abort(); readOwner.current?.abort(); pageOwner.current?.abort(); openOwner.current?.abort(); onClose() }
  const close = () => { if (confirmation) return; if (dirty || busy) setConfirmation({ kind: 'leave' }); else closeNow() }
  const run = async intent => {
    if (action.current || blocked || currentSnapshot.current?.revision !== intent.expected_revision) return
    setMessage('')
    try { journal.save(intent) } catch { setError('本机操作记录未能保存，尚未发送标签修改。请释放本机存储空间后重试，或先核对待处理记录。'); readPending(); return }
    action.current = true; setBusy(true); setPending(intent); setReviewed(false); setError(''); setMessage('')
    readOwner.current?.abort(); pageOwner.current?.abort(); setPageBusy(false)
    const ctl = new AbortController(), epoch = externalEpoch.current; writeOwner.current = ctl
    let acknowledged = false
    try {
      const next = await sendTagWorkspaceIntent(api, intent, ctl.signal)
      if (!alive.current || ctl.signal.aborted) return
      acknowledged = true; setSnapshot(epoch === externalEpoch.current ? next : null); setStatus(epoch === externalEpoch.current ? 'ready' : 'error'); setSelected(intent.kind === 'merge' ? intent.target_id : next.tags.some(tag => tag.id === intent.id) ? intent.id : next.tags[0]?.id || '')
      setForm(blankForm()); setTarget(''); setStale(epoch !== externalEpoch.current)
      setMessage(epoch === externalEpoch.current ? '本机数据库已确认标签修改。笔记正文没有改变。' : '数据库已确认本次操作，但随后有外部变化，请重新读取当前标签库。')
      journal.clear(intent); setPending(null)
    } catch (failure) {
      if (alive.current) { setError(acknowledged ? '数据库已确认，但本机操作记录未能清除；请重新核对，不要重发。' : '标签修改结果未确认。停止或超时不等于撤销；记录已保留，请核对当前状态，不会自动重发。'); readPending() }
    } finally { action.current = false; if (writeOwner.current === ctl) writeOwner.current = null; if (alive.current) { setBusy(false); setPage(null) } }
  }
  const propose = kind => {
    if (blocked || composingRef.current) return
    setMessage('')
    try {
      const intent = tagWorkspaceIntent(snapshot, kind, kind === 'create' || kind === 'rename' ? form : { id: selected, target_id: target })
      const source = snapshot.tags.find(tag => tag.id === intent.id), destination = snapshot.tags.find(tag => tag.id === intent.target_id)
      setError(''); setConfirmation({ kind: 'change', intent, source, destination })
    } catch (failure) { setError(failure.message) }
  }
  const reload = () => { if (action.current) return; if (dirty) setConfirmation({ kind: 'reload' }); else void load(!!pending) }
  const openNote = async id => {
    if (busy || opening || !onOpenFile || stale || pageBusy) return
    if (dirty) { setConfirmation({ kind: 'open', id }); return }
    await navigate(id)
  }
  const navigate = async id => {
    const ctl = new AbortController(); openOwner.current?.abort(); openOwner.current = ctl; setOpening(true); setError('')
    try {
      const accepted = await onOpenFile(id, { signal: ctl.signal, shouldSelect: () => alive.current && !ctl.signal.aborted && openOwner.current === ctl })
      if (alive.current && !ctl.signal.aborted) { if (accepted === true) onClose(); else setError('笔记未打开或已取消；当前标签工作台仍保留。') }
    } catch { if (alive.current && !ctl.signal.aborted) setError('笔记暂时无法打开，请重新读取列表后重试。') }
    finally { if (alive.current && openOwner.current === ctl) setOpening(false) }
  }
  const confirm = () => {
    const choice = confirmation; setConfirmation(null)
    if (choice.kind === 'change') { void run(choice.intent); return }
    if (choice.kind === 'leave') { closeNow(); return }
    if (choice.kind === 'reload') { setForm(blankForm()); void load(!!pending); return }
    if (choice.kind === 'open') { setForm(blankForm()); void navigate(choice.id); return }
    if (choice.kind === 'edit') { setForm(choice.form); return }
    try {
      if (choice.kind === 'corrupt') journal.discardCorrupt(choice.raw); else journal.clear(pending)
      setPending(null); setCorrupt(false); setReviewed(false); setError(''); setMessage('已结束本机操作记录；没有撤销或重发数据库修改。')
    } catch (failure) { setError(failure.message); readPending() }
  }
  const switchForm = next => { if (dirty) setConfirmation({ kind: 'edit', form: next }); else setForm(next) }
  const clearRecord = () => { try { setConfirmation(corrupt ? { kind: 'corrupt', raw: journal.corruptRaw() } : { kind: 'record' }) } catch { setError('操作记录无法读取，未清除') } }
  const onKeyDown = event => {
    event.stopPropagation(); if (composing(event)) return
    if (event.key === 'Escape') { event.preventDefault(); if (confirmation) setConfirmation(null); else close(); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); return }
    if (event.key !== 'Tab') return
    const scope = confirmation ? panel.current.querySelector('[role="alertdialog"]') : panel.current, items = focusables(scope)
    if (!items.length) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === items[0] || !scope.contains(document.activeElement))) { event.preventDefault(); items.at(-1).focus() }
    else if (!event.shiftKey && (document.activeElement === items.at(-1) || !scope.contains(document.activeElement))) { event.preventDefault(); items[0].focus() }
  }
  const tags = (snapshot?.tags || []).filter(tag => (!unused || tag.total_count === 0) && (!query || tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
  const confirmationText = confirmation?.kind === 'change' ? confirmation.intent.kind === 'merge'
    ? `将“${confirmation.source.name}”的全部 ${confirmation.source.total_count} 个关联（其中其他关联 ${confirmation.source.hidden_count} 个）合并到“${confirmation.destination.name}”，去重后删除源标签。目标标签名称和颜色保持；不删除任何笔记。`
    : confirmation.intent.kind === 'delete' ? `删除“${confirmation.source.name}”及其全部 ${confirmation.source.total_count} 个关联，其中包含 ${confirmation.source.hidden_count} 个回收站、文件夹或模板关联。笔记本身和正文保留；标签删除无法自动撤销。`
    : `${confirmation.intent.label}为“${confirmation.intent.name}”，颜色 ${confirmation.intent.color}？只修改标签，不改写笔记正文。`
    : confirmation?.kind === 'leave' ? '放弃尚未提交的输入并关闭？已发送操作不会因此撤销；未确认记录会保留，下次打开可核对。'
    : ['record','corrupt'].includes(confirmation?.kind) ? '仅清除本机待核对记录，不撤销或重发任何数据库操作。请以最新读取结果为准。'
    : '放弃尚未提交的标签输入并继续？已经保存的标签不会改变。'
  return createPortal(<div className="tag-workspace-overlay" data-opening={opening ? 'true' : undefined} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="tag-workspace" role="dialog" aria-modal="true" aria-label="本地标签工作台" ref={panel} onKeyDown={onKeyDown}>
      <header><div><h2>本地标签工作台</h2><p>集中整理标签，不改写笔记正文。单篇标签分配仍在笔记的“管理标签”中。</p></div><button type="button" aria-label="关闭标签工作台" disabled={!!confirmation} onClick={close}>×</button></header>
      <div className="tag-workspace-scroll" aria-busy={status === 'loading' || busy}>
        <fieldset disabled={!!confirmation || busy || opening} className="tag-workspace-filter"><label>查找标签<input aria-label="工作台查找标签" value={search} onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={e => { composingRef.current = false; setQuery(e.currentTarget.value) }} onChange={e => { setSearch(e.target.value); if (!composingRef.current) setQuery(e.target.value) }} /></label><label><input type="checkbox" checked={unused} onChange={e => setUnused(e.target.checked)} />仅看未使用</label><span>{snapshot ? `显示 ${tags.length} / ${snapshot.tags.length} 个标签` : '尚未取得完整列表'}</span></fieldset>
        {status === 'loading' && <p role="status">正在读取完整标签库…</p>}
        {status === 'ready' && <div className="tag-workspace-columns">
          <div className="tag-workspace-list" role="group" aria-label="工作台标签列表">{tags.map(tag => <button key={tag.id} type="button" data-workspace-tag={tag.id} aria-pressed={selected === tag.id} disabled={busy || opening || !!confirmation} onClick={() => { setSelected(tag.id); setTarget('') }}><i style={{ backgroundColor: tagColor(tag.color) }} aria-hidden="true" /><span>{tag.name}<small>{tag.active_count} 篇普通笔记 · {tag.hidden_count} 个其他关联</small></span></button>)}{!tags.length && <p>{snapshot.tags.length ? '没有符合筛选条件的标签。' : '标签库为空，可以创建第一个标签。'}</p>}</div>
          <div className="tag-workspace-detail">
            {selectedTag && <><h3>{selectedTag.name}</h3><p>共 {selectedTag.total_count} 个关联；{selectedTag.hidden_count} 个回收站、文件夹或模板关联不在下方普通笔记列表中，但合并和删除时会包含它们。</p>
              <fieldset disabled={blocked || !!confirmation} className="tag-workspace-actions"><button type="button" onClick={() => switchForm({ kind: 'rename', id: selectedTag.id, name: selectedTag.name, color: tagColor(selectedTag.color) })}>编辑名称与颜色</button><button type="button" onClick={() => propose('delete')}>删除标签</button><label>合并到<select aria-label="合并目标标签" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择目标标签</option>{snapshot.tags.filter(tag => tag.id !== selected).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><button type="button" disabled={!target} onClick={() => propose('merge')}>合并标签</button></fieldset>
              <section aria-label="标签关联笔记"><h4>关联的普通笔记</h4>{pageBusy && <p role="status">正在读取关联笔记…</p>}{page && <><p>共 {page.total} 篇{page.total ? `，当前 ${page.offset + 1}–${page.offset + page.notes.length}` : ''}</p><div className="tag-workspace-notes">{page.notes.map(note => <button type="button" key={note.id} disabled={busy || opening || stale || !!confirmation || !onOpenFile} onClick={() => void openNote(note.id)}>{note.title || '未命名笔记'}</button>)}</div>{page.total === 0 && <p>这个标签尚未关联普通笔记。</p>}<div className="tag-workspace-paging"><button type="button" disabled={page.offset === 0 || busy || opening || !!confirmation} onClick={() => void loadPage(page.offset - 50)}>上一页</button><button type="button" disabled={!page.has_more || busy || opening || !!confirmation} onClick={() => void loadPage(page.offset + 50)}>下一页</button></div></>}</section>
            </>}
            <form className="tag-workspace-edit" onSubmit={e => { e.preventDefault(); propose(form.kind) }}><fieldset disabled={blocked || !!confirmation}><legend>{form.kind === 'create' ? '创建标签' : '修改标签'}</legend><label>标签名称<input aria-label="工作台标签名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }} onKeyDown={e => { if (e.key === 'Enter' && composing(e)) e.preventDefault() }} /></label><label>标签颜色<input aria-label="工作台标签颜色" value={form.color} maxLength={7} spellCheck="false" onChange={e => setForm({ ...form, color: e.target.value })} /></label><button type="submit" disabled={!form.name.trim() || !dirty}>{form.kind === 'create' ? '创建标签' : '保存标签修改'}</button>{form.kind === 'rename' && <button type="button" onClick={() => switchForm(blankForm())}>改为新建</button>}</fieldset></form>
          </div>
        </div>}
      </div>
      <div className="tag-workspace-feedback" aria-label="标签工作台操作反馈">
        {confirmation && <div className="tag-workspace-confirm" role="alertdialog" aria-modal="true" aria-label="确认标签工作台操作"><p>{confirmationText}</p><button type="button" onClick={() => setConfirmation(null)}>取消</button><button type="button" onClick={confirm}>确认</button></div>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        {(pending || corrupt) && <div className="tag-workspace-recovery"><strong>{corrupt ? '操作记录损坏' : '标签操作待核对'}</strong>{pending && <span>{pending.label}</span>}<button type="button" disabled={busy || status === 'loading' || opening || !!confirmation || corrupt} onClick={() => void load(true)}>核对当前标签库</button><button type="button" disabled={busy || opening || !!confirmation || (!corrupt && !reviewed)} onClick={clearRecord}>{corrupt ? '清除损坏记录' : '结束待核对记录'}</button></div>}
      </div>
      <footer><span>{busy ? '修改已发送，等待确认' : opening ? '通过原保存保护打开笔记…' : '仅本机标签 · 正文保持不变'}</span><button type="button" disabled={busy || opening || status === 'loading' || !!confirmation} onClick={reload}>重新读取标签库</button>{busy && <button type="button" disabled={!!confirmation} onClick={() => writeOwner.current?.abort()}>停止等待</button>}{opening && <button type="button" disabled={!!confirmation} onClick={() => { openOwner.current?.abort(); setOpening(false) }}>取消打开</button>}</footer>
    </section>
  </div>, document.body)
}
