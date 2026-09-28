import { createSaveTestServer } from '../save-recovery-server.mjs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from '../../src/App'
import { api, listAllFilesWithContent } from '~/services/api'
import { toast } from '~/services/toast'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { readEditorDraft, writeEditorDraft, removeEditorDraft } from '../../src/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ notes: {}, editorChange: null }))
vi.mock('~/services/api', () => ({ api: vi.fn(), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn(async () => []) }))
vi.mock('~/services/toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
// Real App, real unsaved dialog, real TextEditor, real draft cache and exit bridge.
// Only unrelated navigation panels and the rich-text input are fixtures.
vi.mock('../../src/components/FileList', () => ({ default: ({ onSelect }) => <div>
  <button onClick={() => onSelect({ ...fixture.notes.a })}>打开 A</button>
  <button onClick={() => onSelect({ ...fixture.notes.b })}>打开 B</button>
</div> }))
vi.mock('../../src/components/WorkspaceSidebar', () => ({ default: ({ children, onChangeWorkspace }) => <aside>
  <button onClick={() => onChangeWorkspace('settings')}>切到设置</button>
  <button onClick={() => onChangeWorkspace('notes')}>回到笔记</button>{children}
</aside> }))
vi.mock('../../src/components/SettingsPanel', () => ({ default: () => <div data-test-settings>设置工作区</div> }))
vi.mock('../../src/components/ToastViewport', () => ({ default: () => null }))
vi.mock('../../src/components/FocusSessionBar', () => ({ default: () => null }))
vi.mock('../../src/components/EvidenceReviewBar', () => ({ default: () => null }))
vi.mock('../../src/components/SearchReturnBar', () => ({ default: () => null }))
vi.mock('../../src/components/CollectionReadingBar', () => ({ default: () => null }))
vi.mock('../../src/components/Editor/Editor', () => ({ default: ({ initialContent, onChange, documentId }) => {
  const [text, setText] = React.useState(initialContent || '')
  fixture.editorChange = onChange
  React.useEffect(() => setText(initialContent || ''), [initialContent])
  return <textarea aria-label="实际编辑器输入夹具" data-document-id={documentId} value={text} onChange={event => {
    setText(event.target.value); onChange(event.target.value)
  }}/>
} }))
let host, root, prepare, release, dispose, results, server
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
async function openA() { await click('打开 A'); await until(() => expect(field()?.dataset.documentId).toBe(fixture.notes.a.id)) }
async function quit() {
  await act(async () => { prepare({ id: 'a'.repeat(32) }); await tick() })
  await until(() => expect(results).toHaveLength(1))
  return results[0]
}

const heading = text => JSON.stringify({root:{type:'root',children:[{type:'heading',tag:'h1',children:[{type:'text',text}]}]}})
async function mount() {
  host = document.createElement('div');host.id='root';document.body.append(host);root=createRoot(host)
  results=[]
  dispose=installDocumentQuitBridge({bridge:{
    onQuitPrepare(fn){prepare=fn;return ()=>{}},onQuitRelease(fn){release=fn;return ()=>{}},reportQuitResult(value){results.push(value)}
  }})
  await act(async()=>root.render(<App/>))
  await until(()=>expect([...host.querySelectorAll('button')].some(n=>n.textContent==='打开 A')).toBe(true))
}
async function unmount() { dispose?.();dispose=null;await act(async()=>root.unmount());host.remove();root=null }
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  localStorage.clear()
  server=await createSaveTestServer(process.env.NOTEPAD_SAVE_TEST_SERVER)
  fixture.notes.a=await server.call('/api/files',{method:'POST',body:JSON.stringify({title:'A.md',content:heading('旧标题')})})
  fixture.notes.b=await server.call('/api/files',{method:'POST',body:JSON.stringify({title:'B.md',content:'另一篇'})})
  listAllFilesWithContent.mockRejectedValue(new Error('Forced reference scan failure'))
  // Only the optional reference-list scan fails. Body requests use the REAL
  // HTTP server and migrated SQLite, without manufactured save receipts.
  api.mockImplementation((route,init)=>route.startsWith('/api/files?page')?Promise.reject(new Error('Forced reference scan failure')):server.call(route,init))
  await import('../../src/components/Editor/Editor');await mount()
})
afterEach(async()=>{
  vi.useRealTimers()
  if(root)await unmount()
  for(const note of Object.values(fixture.notes)){editorQuit.forget(note.id);removeEditorDraft(note.id)}
  await server?.dispose()
  vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals()
})
for(const mode of ['Ctrl+S','automatic'])it(`${mode}: heading saves through real HTTP, quit handshake succeeds, graceful server restart reloads exact latest body`,async()=>{
  await openA()
  const next=heading('改过章节与正文 '+mode)
  // Accelerate only the 30s editor interval, leaving real network and timeout
  // clocks intact. This invokes the registered production interval callback.
  let autosave
  if(mode==='automatic'){
    await unmount()
    const real=window.setInterval.bind(window)
    vi.spyOn(window,'setInterval').mockImplementation((callback,ms,...args)=>{
      if(ms===30000)autosave=callback
      return real(callback,ms,...args)
    })
    await mount();await openA()
  }
  await type(next)
  await act(async()=>{
    if(mode==='Ctrl+S')document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))
    else {expect(autosave).toBeTypeOf('function');autosave()}
    await tick()
  })
  await until(()=>expect(editorQuit.pending()).toBe(0))
  expect((await server.call('/api/files/'+fixture.notes.a.id)).content).toBe(next)
  const jobs=await server.call('/api/editor-reference-jobs')
  expect(jobs.some(j=>j.file_id===fixture.notes.a.id&&j.before_content===heading('旧标题')&&j.after_content===next)).toBe(true)
  expect(await quit()).toEqual({id:'a'.repeat(32),ready:true})
  await unmount();await server.stop();await server.start()
  localStorage.clear() // Do not let a renderer cache fake database durability.
  expect((await server.call('/api/files/'+fixture.notes.a.id)).content).toBe(next)
  expect((await server.call('/api/editor-reference-jobs')).some(j=>j.after_content===next)).toBe(true)
  await mount();await openA();await until(()=>expect(field()?.value).toBe(next))
  expect(listAllFilesWithContent).not.toHaveBeenCalled()
})

it('automatic reference maintenance updates an unambiguous source after saving and survives a real restart',async()=>{
  const id=fixture.notes.a.id
  const source=await server.call('/api/files',{method:'POST',body:JSON.stringify({title:'引用.md',content:JSON.stringify({root:{children:[{type:'wiki-link',id,title:'A.md',sectionPath:['旧标题']}]}})})})
  api.mockImplementation((route,init)=>server.call(route,init))
  await openA();await type(heading('新标题'))
  await act(async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}));await tick()})
  await vi.waitFor(async()=>{
    const latest=await server.call('/api/files/'+source.id)
    expect(JSON.parse(latest.content).root.children[0].sectionPath).toEqual(['新标题'])
  },{timeout:5000,interval:30})
  expect(await server.call('/api/editor-reference-jobs')).toEqual([])
  expect(await quit()).toEqual({id:'a'.repeat(32),ready:true})
  await unmount();await server.stop();await server.start()
  expect(JSON.parse((await server.call('/api/files/'+source.id)).content).root.children[0].sectionPath).toEqual(['新标题'])
  expect((await server.call('/api/files/'+id)).content).toBe(heading('新标题'))
})

it('a real acknowledged request replay after restart returns its receipt without overwriting newer body',async()=>{
  const id=fixture.notes.a.id,old=fixture.notes.a.content
  const request=(token,expected,content)=>server.call('/api/files/'+id,{method:'PUT',body:JSON.stringify({save_request_id:token,expected_content:expected,content,section_mappings:'[]'})})
  const token='d'.repeat(32),later='e'.repeat(32)
  await request(token,old,'first committed') // Intentionally discard this response.
  await request(later,'first committed','latest committed')
  await unmount();await server.stop();await server.start()
  expect((await request(token,old,'first committed')).save_receipt.request_id).toBe(token)
  expect((await server.call('/api/files/'+id)).content).toBe('latest committed')
  const versions=await server.call('/api/files/'+id+'/versions')
  expect(versions).toHaveLength(2)
})
