import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: ({ initialContent, onChange }) => {
  globalThis.changeConflictDraft = onChange
  return <pre data-draft>{initialContent}</pre>
} }))
let host, root, ref, body, ticks
const ack = (p, content = p.content, outcome = 'applied') => ({ id: 'save-conflict', title:'A', content,
  updated_at: 100, save_receipt: { request_id:p.save_request_id, reference_pending:false, outcome } })
async function render(id = 'save-conflict') {
  await act(async()=>root.render(<TextEditor ref={ref} activeId={id} deletedIds={new Set()} autoSaveOnSwitch={false}/>))
}
async function edit(content) { await act(async()=>globalThis.changeConflictDraft(content)) }
async function save() { let result; await act(async()=>{try { result=await ref.current.save() } catch(error) { result=error }}); return result }
async function click(label) { const btn=[...document.querySelectorAll('button')].find(n=>n.textContent===label);expect(btn,label).toBeTruthy();await act(async()=>btn.click()) }
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(100500)
  body='database before'; ticks=[];api.mockReset();localStorage.clear();removeEditorDraft('save-conflict');editorQuit.forget('save-conflict')
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT'){const p=JSON.parse(init.body);ticks.push(p);body=p.content;return ack(p)}
    return {id:'save-conflict',title:'A',content:body,updated_at:100}
  })
  host=document.createElement('div');document.body.append(host);root=createRoot(host);ref=React.createRef();await render()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();removeEditorDraft('save-conflict');editorQuit.forget('save-conflict')})
it('a successful save and its delayed cache timer cannot mask a newer same-second database update',async()=>{
  await edit('my saved body');await save();await act(async()=>vi.advanceTimersByTimeAsync(300))
  expect(readEditorDraft('save-conflict')).toBeNull()
  body='reference maintenance updated body';await render(null);await render()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe(body)
  expect(editorQuit.pending()).toBe(0)
})
it('a terminal database conflict exposes review instead of repeating a permanently stale request',async()=>{
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT'){const p=JSON.parse(init.body);ticks.push(p);return ack(p,'new database version','conflict')}
    return {id:'save-conflict',content:body,updated_at:100}
  })
  await edit('my draft');await save()
  expect(host.textContent).toContain('处理保存冲突')
  await save();await act(async()=>vi.advanceTimersByTimeAsync(30000))
  expect(ticks).toHaveLength(1);expect(editorQuit.pending()).toBe(1)
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('my draft')
})
it('explicitly keeping the draft retries against the reviewed database content with a new token',async()=>{
  let count=0
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT'){const p=JSON.parse(init.body);ticks.push(p);return ++count===1?ack(p,'new database version','conflict'):ack(p)}
    return {id:'save-conflict',content:'new database version',updated_at:100}
  })
  await edit('my draft');await save();await click('处理保存冲突');await click('保留我的正文')
  expect(ticks).toHaveLength(2);expect(ticks[1].expected_content).toBe('new database version')
  expect(ticks[1].save_request_id).not.toBe(ticks[0].save_request_id)
  expect(editorQuit.pending()).toBe(0)
})
it('adopting the database version is explicit, reads it again and does not issue a PUT',async()=>{
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT'){const p=JSON.parse(init.body);ticks.push(p);return ack(p,'database change','conflict')}
    return {id:'save-conflict',content:'latest at review',updated_at:101}
  })
  await edit('my draft');await save();await click('处理保存冲突');await click('采用数据库正文')
  expect(ticks).toHaveLength(1);expect(ref.current.getReferenceRefactorState().currentContent).toBe('latest at review')
  expect(editorQuit.pending()).toBe(0);expect(readEditorDraft('save-conflict')).toBeNull()
})
it('another database update after review is rejected again without discarding the draft',async()=>{
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT'){const p=JSON.parse(init.body);ticks.push(p);return ack(p,ticks.length===1?'reviewed version':'changed again','conflict')}
    return {id:'save-conflict',content:body,updated_at:100}
  })
  await edit('my draft');await save();await click('处理保存冲突');await click('保留我的正文')
  expect(editorQuit.pending()).toBe(1);expect(host.textContent).toContain('处理保存冲突')
  expect(ticks[1].expected_content).toBe('reviewed version')
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('my draft')
})
it('a draft edited while database adoption is waiting is not replaced by the late read',async()=>{
  let finish
  api.mockImplementation(async(_path,init)=>{
    if(init?.method==='PUT')return ack(JSON.parse(init.body),'database','conflict')
    return new Promise(resolve=>{finish=resolve})
  })
  await edit('my draft');await save();await click('处理保存冲突');await click('采用数据库正文')
  await edit('newer draft');await act(async()=>finish({id:'save-conflict',content:'database',updated_at:101}))
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('newer draft');expect(editorQuit.pending()).toBe(1)
})
it('a conflicted draft equal to the observed database still requires a deliberate resolution',async()=>{
 api.mockImplementation(async(_path,init)=>init?.method==='PUT'?ack(JSON.parse(init.body),'database','conflict'):{id:'save-conflict',content:body,updated_at:100})
 await edit('draft');await save();await edit('database')
 await expect(editorQuit.flush(new AbortController().signal)).rejects.toThrow()
 expect(editorQuit.pending()).toBe(1)
})
it('cancel and Escape do not save, adopt or clear the draft; preview text is escaped',async()=>{
 api.mockImplementation(async(_path,init)=>ack(JSON.parse(init.body),'<img src=x onerror=alert(1)>','conflict'))
 await edit('<script>draft</script>');await save();await click('处理保存冲突')
 expect(document.querySelector('[role="dialog"] img,[role="dialog"] script')).toBeNull()
 expect(document.activeElement.textContent).toBe('暂不处理')
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(editorQuit.pending()).toBe(1)
 expect(api.mock.calls.filter(([,i])=>i?.method==='PUT')).toHaveLength(1)
})

it('keeping a matching conflicted draft still compares the reviewed database body before approving exit', async () => {
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      const request = JSON.parse(init.body); ticks.push(request)
      return ack(request, ticks.length === 1 ? 'reviewed body' : 'changed since review', 'conflict')
    }
    return { id: 'save-conflict', content: body, updated_at: 100 }
  })
  await edit('my draft'); await save(); await edit('reviewed body')
  await click('处理保存冲突'); await click('保留我的正文')
  expect(ticks).toHaveLength(2)
  expect(ticks[1].expected_content).toBe('reviewed body')
  expect(ticks[1].content).toBe('reviewed body')
  expect(ticks[1].save_request_id).not.toBe(ticks[0].save_request_id)
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('reviewed body')
  expect(editorQuit.pending()).toBe(1)
  await expect(editorQuit.flush(new AbortController().signal)).rejects.toThrow()
})
it('matching conflicted content becomes saved only after an actual applied receipt', async () => {
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      const request = JSON.parse(init.body); ticks.push(request)
      return ticks.length === 1 ? ack(request, 'reviewed body', 'conflict') : ack(request)
    }
    return { id: 'save-conflict', content: body, updated_at: 100 }
  })
  await edit('my draft'); await save(); await edit('reviewed body')
  await click('处理保存冲突'); await click('保留我的正文')
  expect(ticks).toHaveLength(2)
  expect(editorQuit.pending()).toBe(0)
  expect(readEditorDraft('save-conflict')).toBeNull()
  await save(); expect(ticks).toHaveLength(2) // ordinary clean saves remain no-ops
})
it('unmounting during database adoption preserves the draft and ignores a late response', async () => {
  let finish
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') return ack(JSON.parse(init.body), 'database', 'conflict')
    return new Promise(resolve => { finish = resolve })
  })
  await edit('my unconfirmed draft'); await save()
  await click('处理保存冲突'); await click('采用数据库正文')
  await act(async () => root.unmount())
  root = createRoot(host)
  expect(editorQuit.pending()).toBe(1)
  await act(async () => finish({ id: 'save-conflict', content: 'database', updated_at: 101 }))
  expect(editorQuit.pending()).toBe(1)
  expect(readEditorDraft('save-conflict')?.content).toBe('my unconfirmed draft')
})
it('a failed database adoption explains the failure inside the still-open dialog', async () => {
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') return ack(JSON.parse(init.body), 'database', 'conflict')
    throw new Error('PRIVATE_TRANSPORT_DETAILS')
  })
  await edit('my draft'); await save()
  await click('处理保存冲突'); await click('采用数据库正文')
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog).not.toBeNull()
  expect(dialog.querySelector('[role="alert"]')).not.toBeNull()
  expect(dialog.querySelector('[role="alert"]').textContent).toContain('草稿仍保留')
  expect(dialog.textContent).not.toContain('PRIVATE_TRANSPORT_DETAILS')
  expect(editorQuit.pending()).toBe(1)
})
it('adoption timeout stays visible and retry can finish without another body write', async () => {
  let finish, signal, tries = 0
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') { ticks.push(JSON.parse(init.body)); return ack(JSON.parse(init.body), 'database', 'conflict') }
    if (++tries === 1) { signal = init.signal; return new Promise(resolve => { finish = resolve }) }
    return { id: 'save-conflict', content: 'database retry', updated_at: 101 }
  })
  await edit('my draft'); await save(); await click('处理保存冲突'); await click('采用数据库正文')
  await act(async () => vi.advanceTimersByTimeAsync(8100))
  expect(signal.aborted).toBe(true)
  expect(document.querySelector('[role="dialog"] [role="alert"]').textContent).toContain('草稿仍保留')
  expect(editorQuit.pending()).toBe(1)
  await click('采用数据库正文')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('database retry')
  expect(editorQuit.pending()).toBe(0); expect(ticks).toHaveLength(1)
  await act(async () => finish({ id: 'save-conflict', content: 'late first read', updated_at: 100 }))
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('database retry')
})
it('switching documents aborts only the adoption read and its late completion cannot clear the original draft', async () => {
  let finish, signal
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') return ack(JSON.parse(init.body), 'database', 'conflict')
    if (path.endsWith('other-note')) return { id: 'other-note', content: 'other document', updated_at: 101 }
    signal = init.signal
    return new Promise(resolve => { finish = resolve })
  })
  await edit('my draft'); await save(); await click('处理保存冲突'); await click('采用数据库正文')
  await render('other-note')
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ id: 'save-conflict', content: 'database', updated_at: 101 }))
  expect(ref.current.getDocumentId()).toBe('other-note')
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('other document')
  expect(editorQuit.hasDraft('save-conflict')).toBe(true)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('cancelling after an adoption failure keeps the draft and clears stale feedback when reopened', async () => {
  api.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') return ack(JSON.parse(init.body), 'database', 'conflict')
    throw new Error('PRIVATE_FAILURE')
  })
  await edit('my draft'); await save(); await click('处理保存冲突'); await click('采用数据库正文')
  expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull()
  await click('暂不处理'); expect(editorQuit.pending()).toBe(1)
  await click('处理保存冲突')
  expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull()
  expect(document.activeElement.textContent).toBe('暂不处理')
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('my draft')
})
