import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api, listAllFilesWithContent } from '~/services/api'
import { toast } from '~/services/toast'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { readEditorDraft, writeEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ notes: {}, editorChange: null }))
vi.mock('~/services/api', () => ({ api: vi.fn(), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn(async () => []) }))
vi.mock('~/services/toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
// Real App, real unsaved dialog, real TextEditor, real draft cache and exit bridge.
// Only unrelated navigation panels and the rich-text input are fixtures.
vi.mock('./components/FileList', () => ({ default: ({ onSelect }) => <div>
  <button onClick={() => onSelect({ ...fixture.notes.a })}>打开 A</button>
  <button onClick={() => onSelect({ ...fixture.notes.b })}>打开 B</button>
</div> }))
vi.mock('./components/WorkspaceSidebar', () => ({ default: ({ children, onChangeWorkspace }) => <aside>
  <button onClick={() => onChangeWorkspace('settings')}>切到设置</button>
  <button onClick={() => onChangeWorkspace('notes')}>回到笔记</button>{children}
</aside> }))
vi.mock('./components/SettingsPanel', () => ({ default: () => <div data-test-settings>设置工作区</div> }))
vi.mock('./components/ToastViewport', () => ({ default: () => null }))
vi.mock('./components/FocusSessionBar', () => ({ default: () => null }))
vi.mock('./components/EvidenceReviewBar', () => ({ default: () => null }))
vi.mock('./components/SearchReturnBar', () => ({ default: () => null }))
vi.mock('./components/CollectionReadingBar', () => ({ default: () => null }))
vi.mock('./components/Editor/Editor', () => ({ default: ({ initialContent, onChange, documentId }) => {
  const [text, setText] = React.useState(initialContent || '')
  fixture.editorChange = onChange
  React.useEffect(() => setText(initialContent || ''), [initialContent])
  return <textarea aria-label="实际编辑器输入夹具" data-document-id={documentId} value={text} onChange={event => {
    setText(event.target.value); onChange(event.target.value)
  }}/>
} }))
let host, root, prepare, release, dispose, results, deferredSaves, autosave
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const until = fn => vi.waitFor(async () => { await act(tick); fn() }, { timeout: 2000, interval: 10 })
const field = () => host.querySelector('textarea')
const dialog = () => host.querySelector('[role="dialog"]')
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
async function click(label) {
  const node = [...host.querySelectorAll('button')].find(node => node.textContent === label)
  expect(node, label).toBeTruthy()
  await act(async () => { node.click(); await tick() })
}
async function type(text) {
  const node = field(); expect(node).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function openA() { await click('打开 A'); await until(() => expect(field()?.dataset.documentId).toBe('a')) }
async function quit() {
  await act(async () => { prepare({ id: 'a'.repeat(32) }); await tick() })
  await until(() => expect(results).toHaveLength(1))
  return results[0]
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await import('./components/Editor/Editor')
  await import('./components/SettingsPanel')
  localStorage.clear(); for (const id of ['a','b','orphan']) { editorQuit.forget(id); removeEditorDraft(id) }
  fixture.notes = { a: { id: 'a', title: 'A.md', content: '原文 A', updated_at: 100 }, b: { id: 'b', title: 'B.md', content: '原文 B', updated_at: 100 } }
  results = []; deferredSaves = []; autosave = null
  const originalInterval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30000) autosave = callback
    return originalInterval(callback, ms, ...args)
  })
  api.mockReset()
  api.mockImplementation(async (url, init) => {
    const id = url.split('/').pop()
    if (url === '/api/editor-reference-jobs') return []
    if (url.startsWith('/api/files?page')) return new Promise(() => {})
    if (!fixture.notes[id]) throw new Error('Unexpected fixture request ' + url)
    if (init?.method === 'PUT') {
      const next = { ...fixture.notes[id], ...JSON.parse(init.body), updated_at: 101 }
      fixture.notes[id] = next; return { ...next, save_receipt: { outcome: 'applied', request_id: JSON.parse(init.body).save_request_id, reference_pending: true } }
    }
    return { ...fixture.notes[id] }
  })
  host = document.createElement('div'); host.id = 'root'; document.body.append(host); root = createRoot(host)
  dispose = installDocumentQuitBridge({ bridge: {
    onQuitPrepare(fn) { prepare = fn; return () => {} },
    onQuitRelease(fn) { release = fn; return () => {} },
    reportQuitResult(value) { results.push(value) },
  } })
  await act(async () => root.render(<App/>))
  await until(() => expect([...host.querySelectorAll('button')].some(node => node.textContent === '打开 A')).toBe(true))
})
afterEach(async () => {
  vi.useRealTimers()
  dispose?.()
  await act(async () => { for (const item of deferredSaves) item.resolve(item.receipt); await tick() })
  await act(async () => root.unmount()); host.remove()
  for (const id of ['a','b','orphan']) { editorQuit.forget(id); removeEditorDraft(id) }
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})

const heading = label => JSON.stringify({ root: { type:'root',children:[{type:'heading',tag:'h1',children:[{type:'text',text:label}]}] } })
async function ctrlS() { await act(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}));await tick()}) }
it('Ctrl+S commits a changed heading even when cross-note scanning fails, then quits and reopens the saved body',async()=>{
  fixture.notes.a.content=heading('第一章')
  listAllFilesWithContent.mockRejectedValue(new Error('reference scanner offline'))
  await openA();await type(heading('第二章'));await ctrlS()
  await until(()=>expect(fixture.notes.a.content).toBe(heading('第二章')))
  expect(listAllFilesWithContent).not.toHaveBeenCalled()
  expect(await quit()).toEqual({id:'a'.repeat(32),ready:true})
  await act(async()=>release({id:'a'.repeat(32)}))
  await click('切到设置');await click('回到笔记')
  await until(()=>expect(field()?.value).toBe(heading('第二章')))
})
it('structural changes are included in the normal 30-second autosave without Ctrl+S',async()=>{
  fixture.notes.a.content=heading('旧标题');await openA();await type(heading('新标题'))
  // Drive the exact registered production interval; network timers remain real.
  expect(autosave).toBeTypeOf('function')
  await act(async()=>{autosave();await tick()})
  await until(()=>expect(fixture.notes.a.content).toBe(heading('新标题')))
})
it('a lost save response can be retried with the same token and then saves the newest edit',async()=>{
  await openA();await type('first committed')
  let oldToken,oldContent
  const impl=api.getMockImplementation()
  api.mockImplementation((url,init)=>{
    if(init?.method==='PUT'){
      const p=JSON.parse(init.body)
      if(!oldToken){oldToken=p.save_request_id;oldContent=p.content;fixture.notes.a.content=p.content;return new Promise(()=>{})}
      if(p.save_request_id===oldToken)return {...fixture.notes.a,content:oldContent,save_receipt:{outcome:'applied',request_id:oldToken,reference_pending:false}}
    }
    return impl(url,init)
  })
  vi.useFakeTimers();await ctrlS();await act(async()=>vi.advanceTimersByTimeAsync(8100));vi.useRealTimers()
  expect(host.textContent).toContain('保存未确认')
  await type('latest kept');await ctrlS()
  await until(()=>expect(fixture.notes.a.content).toBe('latest kept'))
  const sent=puts().map(([,i])=>JSON.parse(i.body))
  expect(sent).toHaveLength(3);expect(sent[0].save_request_id).toBe(sent[1].save_request_id)
  expect(sent[2].expected_content).toBe('first committed')
  expect(await quit()).toEqual({id:'a'.repeat(32),ready:true})
})
it('pressing save with a newer edit during the receipt wait never closes that newer draft',async()=>{
  await openA();await type('submitted');let resolve,request
  api.mockImplementationOnce((_url,init)=>{request=JSON.parse(init.body);return new Promise(r=>resolve=r)})
  await ctrlS();await type('not yet submitted')
  await act(async()=>resolve({...fixture.notes.a,content:'submitted',save_receipt:{outcome:'applied',request_id:request.save_request_id,reference_pending:false}}))
  expect(field().value).toBe('not yet submitted');expect(editorQuit.pending()).toBe(1)
  expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('还有更新的编辑'))
})

it('Ctrl+S does not announce completion while a different saved snapshot is still queued', async () => {
  await openA()
  const ordinary = api.getMockImplementation()
  let releaseFirst, releaseSecond, started = 0
  api.mockImplementation(async (url, init) => {
    if (init?.method === 'PUT') {
      const ordinal = ++started
      if (ordinal === 1) await new Promise(resolve=>{releaseFirst=resolve})
      if (ordinal === 2) await new Promise(resolve=>{releaseSecond=resolve})
    }
    return ordinary(url, init)
  })
  await type('version A'); await ctrlS()
  await type('version B'); await ctrlS()
  await type('version A'); await ctrlS()
  await act(async()=>{releaseFirst(); await tick()})
  await until(()=>expect(started).toBe(2))
  const earlySuccess = toast.success.mock.calls.some(([text])=>text==='正文已保存')
  await act(async()=>{releaseSecond(); await tick()})
  expect(earlySuccess).toBe(false)
  await until(()=>expect(fixture.notes.a.content).toBe('version A'))
  expect(toast.warning).toHaveBeenCalledWith('仍有正文保存正在排队，请等待完成后再继续。')
  expect(toast.success).toHaveBeenCalledWith('正文已保存')
  expect(await quit()).toEqual({id:'a'.repeat(32),ready:true})
})
