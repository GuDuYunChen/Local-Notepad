import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import { extractLexicalText } from '../utils/lexicalText'
import { editorQuit, EditorQuitError } from '../services/editorQuit.mjs'
import ConfirmDialog from './ConfirmDialog'
import { dailyRequest } from '../services/dailyNotes.mjs'
import { createTemplateJournal, createTemplateOperations, readTemplateLibrary, templateName, textTemplateDocument, editableTemplateText, validTemplate, TEMPLATE_DRAFT_KEY } from '../services/templateLibrary.mjs'
import './TemplateLibrary.css'

let memoryDraft = null, quitUnregister = null
function syncDraftQuitGuard() {
  if (memoryDraft?.dirty && !memoryDraft.persisted) {
    if (!quitUnregister) quitUnregister = editorQuit.register(() => { if (memoryDraft?.dirty && !memoryDraft.persisted) throw new EditorQuitError('unresolved') })
  } else { quitUnregister?.(); quitUnregister = null }
}
const emptyDraft = () => ({ title: '', text: '', original: null, dirty: false, persisted: true })
export default function TemplateLibrary({ onClose, onCreated, beforeCreate, parentId = '', parentLabel = '根目录', seed = null }) {
  const [rows, setRows] = useState([]), [status, setStatus] = useState('loading'), [message, setMessage] = useState('')
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [page, setPage] = useState(0)
  const [selected, setSelected] = useState(seed ? { id: 'builtin:' + seed.id, title: seed.title, content: textTemplateDocument(seed.content), archived: false, updated_at: 0 } : null)
  const [draft, setDraft] = useState(() => {
    if (memoryDraft && !memoryDraft.persisted) return memoryDraft
    try {
      if (memoryDraft && localStorage.getItem(TEMPLATE_DRAFT_KEY)) return memoryDraft
      memoryDraft = null; const raw = localStorage.getItem(TEMPLATE_DRAFT_KEY); if (raw) { const value = JSON.parse(raw); if (typeof value.title !== 'string' || typeof value.text !== 'string') throw Error(); if (value.original) validTemplate(value.original); return (memoryDraft = { ...value, dirty: true, persisted: true }) } }
    catch { return (memoryDraft = { ...emptyDraft(), dirty: true, persisted: true, corrupt: true, error: '本机模板草稿无法读取；原记录保留，请明确放弃损坏草稿后再编辑。' }) }
    return emptyDraft()
  })
  const [editing, setEditing] = useState(() => !!draft.dirty), [name, setName] = useState(seed ? seed.title + '.md' : '')
  const [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState(null)
  const [entries, setEntries] = useState([]), [result, setResult] = useState(null)
  const alive = useRef(false), owner = useRef(0), controller = useRef(null), readController = useRef(null), panelRef = useRef(null), action = useRef(false), draftRef = useRef(draft), searchComposing = useRef(false)
  draftRef.current = draft
  const [searchInput, setSearchInput] = useState('')
  const journal = useMemo(() => createTemplateJournal({ get length() { return localStorage.length }, key: i => localStorage.key(i), getItem: k => localStorage.getItem(k), setItem: (k,v) => localStorage.setItem(k,v), removeItem: k => localStorage.removeItem(k) }), [])
  const operations = useMemo(() => createTemplateOperations(api, journal), [journal])
  const selectedText = selected ? extractLexicalText(selected.content) : ''
  const visible = rows.filter(r => r.archived === archived && (!query || (r.title + '\n' + extractLexicalText(r.content)).toLocaleLowerCase().includes(query.toLocaleLowerCase())))
  const maxPage = Math.max(0, Math.ceil(visible.length / 12) - 1), currentPage = Math.min(page, maxPage)
  const refreshEntries = () => { try { setEntries(journal.list()) } catch { setMessage('操作记录无法读取，未自动删除。') } }
  const load = async () => {
    const token = ++owner.current, ctl = new AbortController(); readController.current?.abort(); readController.current = ctl
    setStatus('loading'); setMessage('')
    try { const data = await readTemplateLibrary(api, ctl.signal); if (alive.current && token === owner.current) { setRows(data); setStatus('ready') } }
    catch (error) { if (alive.current && token === owner.current && !ctl.signal.aborted) { setRows([]); setStatus('error'); setMessage(error.message) } }
  }
  useEffect(() => {
    alive.current = true; void load(); refreshEntries()
    syncDraftQuitGuard(); panelRef.current?.querySelector('button')?.focus()
    return () => { alive.current = false; owner.current++; controller.current?.abort(); readController.current?.abort() }
  }, [])
  const persistDraft = next => {
    next = { ...next, dirty: true, persisted: false }
    try { const raw = JSON.stringify(next); localStorage.setItem(TEMPLATE_DRAFT_KEY, raw); if (localStorage.getItem(TEMPLATE_DRAFT_KEY) !== raw) throw Error(); next.persisted = true; delete next.error }
    catch { next.error = '草稿暂时只在内存中，不能安全退出；请重试保存草稿或明确放弃。' }
    memoryDraft = next; draftRef.current = next; setDraft(next); syncDraftQuitGuard()
  }
  const discardDraft = () => {
    try { localStorage.removeItem(TEMPLATE_DRAFT_KEY); if (localStorage.getItem(TEMPLATE_DRAFT_KEY) !== null) throw Error() }
    catch { setMessage('草稿清除失败，原草稿仍保留。'); return false }
    memoryDraft = null; syncDraftQuitGuard(); const next = emptyDraft(); draftRef.current = next; setDraft(next); setEditing(false); return true
  }
  const close = () => {
    if (action.current) { controller.current?.abort(); setMessage('已停止等待；操作记录保留，重新打开后请核对。'); return }
    if (draftRef.current.dirty) { setConfirmation({ type: 'close' }); return }
    onClose?.()
  }
  useEffect(() => {
    const key = e => {
      if (e.key === 'Tab' && !confirmation) { const items = [...(panelRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') || [])].filter(n => n.getClientRects().length); const first = items[0], last = items.at(-1); if (first && e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (last && !e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() } }
      if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (!confirmation) close() } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })
  const startEdit = (row = null) => {
    const next = { title: row?.title || '', text: row ? editableTemplateText(row.content) ?? '' : '', original: row, dirty: false, persisted: true }
    const apply = () => { memoryDraft = next; draftRef.current = next; setDraft(next); setEditing(true); setResult(null) }
    if (draftRef.current.dirty) { setConfirmation({ type: 'replace', apply }); return }
    apply()
  }
  const run = async (entry, send, draftToClear = null) => {
    if (action.current) return
    action.current = true; setBusy(true); setMessage(''); setResult(null)
    const ctl = new AbortController(); controller.current?.abort(); controller.current = ctl
    try {
      const outcome = await operations.run(entry, send, ctl.signal, entry.value.type === 'create' && entry.value.payload.kind === 'note' ? async () => {
        if (beforeCreate && await beforeCreate() === false) throw Error('已取消新建；当前笔记未被替换。')
      } : undefined)
      if (!alive.current || ctl.signal.aborted) return
      setResult({ entry, ...outcome }); setMessage(outcome.message)
      if (outcome.current) setSelected(previous => previous?.id === outcome.current.id ? outcome.current : previous)
      if (outcome.confirmed && (entry.value.type === 'change' || entry.value.payload.kind === 'template')) {
        if (draftToClear && draftRef.current === draftToClear) discardDraft()
        // Keep acknowledgement visible even if refreshing the list fails.
        const listCtl = new AbortController(); readController.current?.abort(); readController.current = listCtl; const readToken = ++owner.current
        try { const list = await readTemplateLibrary(api, listCtl.signal); if (alive.current && !listCtl.signal.aborted && readToken === owner.current) { setRows(list); setStatus('ready') } }
        catch { if (alive.current) { setStatus('error'); setMessage(outcome.message + ' 列表刷新失败，请手动重新读取。') } }
      }
    } catch (error) { if (alive.current) setMessage('操作尚未确认：' + error.message + ' 操作记录已保留；核对不会重新写入。') }
    finally { action.current = false; if (alive.current) { setBusy(false); refreshEntries() } }
  }
  const begin = async (intent, draftToClear = null) => { try { const entry = journal.save(intent); refreshEntries(); await run(entry, true, draftToClear) } catch (e) { setMessage(e.message) } }
  const saveTemplate = async () => {
    if (busy || action.current) return
    try {
      const title = templateName(draft.title), raw = draft.original && editableTemplateText(draft.original.content) === null ? draft.original.content : textTemplateDocument(draft.text)
      if (draft.original) await begin({ type: 'change', expected: draft.original, next: { ...draft.original, title, content: raw } }, draftRef.current)
      else await begin({ type: 'create', payload: { kind: 'template', title, content: raw, parent_id: '' } }, draftRef.current)
    } catch (e) { setMessage(e.message) }
  }
  const createCopy = async () => {
    if (!selected || busy || action.current) return
    try { templateName(name); await begin({ type: 'create', payload: { kind: 'note', title: name, content: textTemplateDocument(selectedText), parent_id: parentId } }) }
    catch (e) { setMessage(e.message) }
  }
  const openCreated = async () => {
    if (!result?.receipt || result.receipt.state !== 'available' || action.current) return
    action.current = true; setBusy(true); const ctl = new AbortController(); controller.current = ctl
    try {
      if (beforeCreate && await beforeCreate() === false) return
      const file = await dailyRequest(api, '/api/files/' + encodeURIComponent(result.receipt.file_id), { signal: ctl.signal })
      if (!file || file.id !== result.receipt.file_id || file.is_folder || file.is_deleted || file.title?.startsWith('__tpl__') || typeof file.content !== 'string') throw Error('创建后的笔记已变化或不可用，请在笔记列表中核对。')
      if (alive.current && !ctl.signal.aborted) await onCreated?.(file)
    } catch (e) { if (alive.current) setMessage(e.message) }
    finally { action.current = false; if (alive.current) setBusy(false) }
  }
  const archive = row => setConfirmation({ type: 'archive', row, title: row.archived ? '恢复这个模板？' : '移除这个模板？' })
  const modal = confirmation
  return <div className="modal-overlay template-library-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
    <section ref={panelRef} className="template-library" role="dialog" aria-modal="true" aria-labelledby="template-library-title">
      <header><div><small>本地资料 · 模板</small><h2 id="template-library-title">我的模板库</h2><p>管理可复用的文本结构，创建独立笔记；不会覆盖当前正文。</p></div><button type="button" className="btn" onClick={close}>{busy ? '停止等待' : '返回模板选择'}</button></header>
      {message && <p className="template-library-feedback" role="status">{message}</p>}
      <div className="template-library-layout">
        <section className="template-library-index" aria-label="模板列表">
          <div className="template-library-actions"><button className="btn primary" disabled={busy} onClick={() => startEdit()}>新建模板</button><button className="btn" disabled={busy || status === 'loading'} onClick={() => void load()}>刷新模板库</button></div>
          <label>查找模板<input value={searchInput} onCompositionStart={() => { searchComposing.current = true }} onCompositionEnd={e => { searchComposing.current = false; setQuery(e.currentTarget.value); setPage(0) }} onChange={e => { setSearchInput(e.target.value); if (!searchComposing.current) { setQuery(e.target.value); setPage(0) } }} /></label>
          <label className="template-library-check"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(0) }} />查看已移除模板</label>
          {archived && <p>已移除模板可恢复；原有30天清理策略仍适用。</p>}
          {status === 'loading' ? <p role="status">正在读取模板库…</p> : status === 'error' ? <p role="alert">模板库读取失败，不能据此判断为空。请刷新重试。</p> : <>
            <p>{visible.length} 个模板</p>
            {!visible.length && <p>{query ? '没有匹配的模板。' : '暂无模板，可以新建一个。'}</p>}
            <ul>{visible.slice(currentPage * 12, currentPage * 12 + 12).map(row => <li key={row.id}><button className="template-library-row" aria-pressed={selected?.id === row.id} onClick={() => { setSelected(row); setName(row.title + '.md') }} disabled={busy}><strong>{row.title}</strong><span>{row.archived ? '已移除' : '本地模板'}</span></button><div><button className="btn small" disabled={busy || row.archived} onClick={() => startEdit(row)}>编辑</button><button className="btn small" disabled={busy} onClick={() => archive(row)}>{row.archived ? '恢复模板' : '移除模板'}</button></div></li>)}</ul>
            {maxPage > 0 && <nav aria-label="模板分页"><button disabled={!currentPage} onClick={() => setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {maxPage+1}</span><button disabled={currentPage===maxPage} onClick={() => setPage(currentPage+1)}>下一页</button></nav>}
          </>}
        </section>
        <section className="template-library-detail" aria-label={editing ? '编辑模板' : '模板预览与新建'}>
          {editing ? <><h3>{draft.original ? '编辑模板' : '新建文本模板'}</h3><label>模板名称<input aria-label="模板名称" maxLength={120} disabled={busy || draft.corrupt} value={draft.title} onChange={e => persistDraft({ ...draft, title: e.target.value })} /></label>
            <label>模板正文<textarea aria-label="模板正文" value={draft.text} disabled={busy || draft.corrupt || !!draft.original && editableTemplateText(draft.original.content) === null} onChange={e => persistDraft({ ...draft, text: e.target.value })} /></label>
            {draft.original && editableTemplateText(draft.original.content) === null && <p>这是旧富文本模板，本页仅改名并保留完整原文；创建笔记时会明确使用文本副本。</p>}
            <p>{draft.error || (draft.dirty ? '草稿已保存在本机应用配置中，尚未保存到模板库。' : '模板正文支持多行文本；空白正文也可保存。')}</p>
            <div className="template-library-actions"><button className="btn primary" disabled={busy || draft.corrupt} onClick={() => void saveTemplate()}>保存模板</button><button className="btn" disabled={busy} onClick={() => setConfirmation({ type: 'discard' })}>放弃草稿</button>{draft.error && !draft.corrupt && <button className="btn" onClick={() => persistDraft(draft)}>重试保存草稿</button>}</div>
          </> : selected ? <><h3>{selected.title}</h3><p>纯文本预览；创建的是独立文本笔记，不复制图片、附件等嵌入对象，原模板不变。</p><pre tabIndex={0} aria-label="模板正文预览">{selectedText || '（空白模板）'}</pre><label>新笔记名称<input aria-label="新笔记名称" disabled={busy} value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label><p>创建位置：{parentLabel}。目录失效时不会改存根目录。</p><button className="btn primary" disabled={busy || selected.archived} onClick={() => void createCopy()}>从预览创建文本笔记</button></> : <p>选择模板查看内容，或新建自己的文本模板。</p>}
          {result?.confirmed && <section className="template-library-result" aria-label="操作结果"><strong>{result.message}</strong>{result.receipt?.state === 'available' && result.entry.value.payload?.kind === 'note' && <button className="btn primary" disabled={busy} onClick={() => void openCreated()}>打开已创建的笔记</button>}</section>}
        </section>
      </div>
      <details className="template-library-records" open={entries.length > 0}><summary>本机操作记录（{entries.length}）</summary><p>写入前保存操作编号。超时不代表失败；先核对，重试复用同一编号。重新打开不会自动发送。</p>
        {entries.map(entry => <article key={entry.key}><span>{entry.error || (entry.value.type === 'create' ? '创建：' + entry.value.payload.title : '修改：' + entry.value.next.title)}</span><div>{!entry.error && <><button className="btn small" disabled={busy} onClick={() => void run(entry, false)}>核对操作结果</button><button className="btn small" disabled={busy} onClick={() => void run(entry, true)}>重试同一操作</button></>}<button className="btn small" disabled={busy} onClick={() => setConfirmation({ type: 'clear', entry })}>清除这条记录</button></div></article>)}
      </details>
      {modal && <ConfirmDialog title={modal.title || (modal.type === 'clear' ? '清除本机操作记录？' : '处理尚未保存的模板草稿')} message={modal.type === 'archive' ? '只影响选定模板，不删除已用它创建的笔记。恢复遇到同名项时会拒绝覆盖。' : modal.type === 'clear' ? '仅移除本机查询编号，不撤销后端操作。尚未确认的创建可能已经完成，清除后请勿靠新请求重复创建。' : '保留草稿后可重新打开继续；明确放弃才会清除。'} onClose={() => setConfirmation(null)} actions={[
        { label: '取消', onClick: () => setConfirmation(null) },
        ...(modal.type === 'close' ? [{ label: '保留草稿并关闭', disabled: !draft.persisted, onClick: () => { setConfirmation(null); onClose?.() } }] : []),
        { label: modal.type === 'archive' ? (modal.row.archived ? '确认恢复模板' : '确认移除模板') : modal.type === 'clear' ? '确认清除记录' : '确认放弃草稿', kind: 'primary', onClick: () => {
          setConfirmation(null)
          if (modal.type === 'archive') void begin({ type: 'change', expected: modal.row, next: { ...modal.row, archived: !modal.row.archived } })
          else if (modal.type === 'clear') { try { journal.remove(modal.entry); refreshEntries(); if (result?.entry.key === modal.entry.key) setResult(null) } catch (e) { setMessage(e.message) } }
          else if (discardDraft()) { if (modal.type === 'close') onClose?.(); if (modal.type === 'replace') modal.apply() }
        } },
      ]} />}
    </section>
  </div>
}
