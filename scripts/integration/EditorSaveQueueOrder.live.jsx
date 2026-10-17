import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createSaveTestServer } from '../save-recovery-server.mjs'
import TextEditor from '../../src/components/TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { readEditorDraft, removeEditorDraft } from '../../src/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
// Real TextEditor/save queue/cache/exit bridge and real Go HTTP/SQLite.
// The rich-text input and document switches are programmatically driven fixtures.
vi.mock('../../src/components/Editor/Editor', () => ({ default: ({ initialContent, onChange }) => {
  globalThis.editLiveQueueOrder = onChange
  return <pre data-live-queue>{initialContent}</pre>
} }))
let server, host, root, ref, a, b, prepare, dispose, results, autosave
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const until = fn => vi.waitFor(async () => { await act(tick); fn() }, { timeout: 4000, interval: 15 })
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
async function render(id = a) {
  await act(async () => root.render(<TextEditor ref={ref} activeId={id} autoSaveOnSwitch={false}/>))
}
async function edit(text) { await act(async () => globalThis.editLiveQueueOrder(text)) }
async function startSave() {
  let promise
  await act(async () => { promise = ref.current.save(); void promise.catch(() => {}); await tick() })
  return { promise }
}
async function unmount() { await act(async () => root.unmount()); root = null }
async function quitRestartAndCheck(text) {
  await act(async () => { prepare({ id: 'b'.repeat(32) }); await tick() })
  await until(() => expect(results).toEqual([{ id: 'b'.repeat(32), ready: true }]))
  dispose(); dispose = null
  await unmount(); await server.stop(); await server.start()
  localStorage.clear(); removeEditorDraft(a); editorQuit.forget(a)
  expect((await server.call('/api/files/' + a)).content).toBe(text)
  root = createRoot(host); ref = React.createRef(); await render()
  await until(() => expect(ref.current.getReferenceRefactorState().currentContent).toBe(text))
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); results = []; autosave = null
  const interval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30000) autosave = callback
    return interval(callback, ms, ...args)
  })
  server = await createSaveTestServer(process.env.NOTEPAD_SAVE_TEST_SERVER)
  a = (await server.call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'A.md', content: 'original' }) })).id
  b = (await server.call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'B.md', content: 'other' }) })).id
  api.mockReset(); api.mockImplementation((route, init) => server.call(route, init))
  host = document.createElement('div'); host.id = 'root'; document.body.append(host); root = createRoot(host); ref = React.createRef()
  dispose = installDocumentQuitBridge({ bridge: {
    onQuitPrepare(fn) { prepare = fn; return () => {} }, onQuitRelease() { return () => {} },
    reportQuitResult(value) { results.push(value) },
  } })
  await render(); await until(() => expect(ref.current.getReferenceRefactorState().currentContent).toBe('original'))
})
afterEach(async () => {
  dispose?.(); if (root) await unmount(); host.remove()
  for (const id of [a,b]) { editorQuit.forget(id); removeEditorDraft(id) }
  await server.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('A-B-A saved during one outstanding real request stays A after quit and a database restart', async () => {
  const first = deferred(), second = deferred(); let firstHeld = false, secondHeld = false, lastSettled = false
  api.mockImplementation(async (route, init) => {
    const response = await server.call(route, init)
    if (init?.method === 'PUT' && !firstHeld) { firstHeld = true; await first.promise }
    else if (init?.method === 'PUT' && !secondHeld) { secondHeld = true; await second.promise }
    return response
  })
  await edit('version A'); const p1 = await startSave()
  await until(()=>expect(firstHeld).toBe(true))
  await edit('version B'); const p2 = await startSave()
  await edit('version A'); const last = await startSave(); void last.promise.then(()=>{lastSettled=true})
  await act(async()=>{first.resolve(); await p1.promise; await tick()})
  await until(()=>expect(secondHeld).toBe(true))
  expect(lastSettled).toBe(false)
  await act(async()=>{second.resolve(); await Promise.all([p2.promise,last.promise]); await tick()})
  expect((await server.call('/api/files/'+a)).content).toBe('version A')
  const submitted = puts().map(([,init])=>JSON.parse(init.body))
  expect(submitted.map(p=>p.content)).toEqual(['version A','version B','version A'])
  expect(submitted.map(p=>p.expected_content)).toEqual(['original','version A','version B'])
  expect(new Set(submitted.map(p=>p.save_request_id)).size).toBe(3)
  await quitRestartAndCheck('version A')
})
it('a production autosave queued after a different manual snapshot cannot settle for the earlier matching request', async () => {
  const gate = deferred(); let held = false
  api.mockImplementation(async (route,init)=>{
    const response=await server.call(route,init)
    if(init?.method==='PUT'&&!held){held=true;await gate.promise}
    return response
  })
  await edit('version A'); const p1=await startSave(); await until(()=>expect(held).toBe(true))
  await edit('version B'); const p2=await startSave()
  await edit('version A'); expect(autosave).toBeTypeOf('function')
  await act(async()=>{autosave(); await tick()})
  await act(async()=>{gate.resolve(); await Promise.all([p1.promise,p2.promise]); await tick()})
  await until(()=>expect(puts()).toHaveLength(3))
  await until(()=>expect(editorQuit.hasDraft(a)).toBe(false))
  expect((await server.call('/api/files/'+a)).content).toBe('version A')
  await quitRestartAndCheck('version A')
})
it('an unacknowledged queued real write keeps the exit guard, and reopening reconciles its token before saving the visible revert', async () => {
  const first=deferred(),second=deferred();let firstHeld=false,secondReceipt=null
  api.mockImplementation(async(route,init)=>{
    const response=await server.call(route,init)
    if(init?.method==='PUT'&&!firstHeld){firstHeld=true;await first.promise}
    else if(init?.method==='PUT'&&!secondReceipt){secondReceipt=response;await second.promise}
    return response
  })
  await edit('version A');const p1=await startSave();await until(()=>expect(firstHeld).toBe(true))
  await edit('version B');const p2=await startSave();await edit('version A')
  await act(async()=>{first.resolve();await p1.promise;await tick()})
  await until(()=>expect(secondReceipt?.save_receipt.outcome).toBe('applied'))
  await unmount();await act(async()=>p2.promise)
  expect(readEditorDraft(a)?.content).toBe('version A')
  expect(editorQuit.hasDraft(a)).toBe(true)
  await expect(editorQuit.flush(new AbortController().signal)).rejects.toThrow('unresolved')
  expect((await server.call('/api/files/'+a)).content).toBe('version B')
  await act(async()=>{second.resolve();await tick()})
  root=createRoot(host);ref=React.createRef();await render()
  await until(()=>expect(ref.current.getReferenceRefactorState().currentContent).toBe('version A'))
  const final=await startSave();await act(async()=>final.promise)
  const submitted=puts().map(([,init])=>JSON.parse(init.body))
  expect(submitted).toHaveLength(4);expect(submitted[2]).toEqual(submitted[1])
  expect(submitted[3].content).toBe('version A');expect(submitted[3].expected_content).toBe('version B')
  await quitRestartAndCheck('version A')
})

it('switching away preserves an unrequested visible revert after the older queued body commits, then saves it after reopening', async () => {
  const first = deferred(); let held = false
  api.mockImplementation(async (route,init) => {
    const response = await server.call(route,init)
    if (init?.method === 'PUT' && !held) { held = true; await first.promise }
    return response
  })
  await edit('version A'); const p1 = await startSave(); await until(()=>expect(held).toBe(true))
  await edit('version B'); const p2 = await startSave()
  await edit('version A'); await render(b)
  await until(()=>expect(ref.current.getReferenceRefactorState().currentContent).toBe('other'))
  await act(async()=>{first.resolve(); await Promise.all([p1.promise,p2.promise]); await tick()})
  expect((await server.call('/api/files/'+a)).content).toBe('version B')
  expect(readEditorDraft(a)?.content).toBe('version A'); expect(editorQuit.hasDraft(a)).toBe(true)
  await render(a); await until(()=>expect(ref.current.getReferenceRefactorState().currentContent).toBe('version A'))
  const final = await startSave(); await act(async()=>final.promise)
  expect(puts().map(([,init])=>JSON.parse(init.body).content)).toEqual(['version A','version B','version A'])
  await quitRestartAndCheck('version A')
})
it('a failed intermediate write on a hidden note preserves the latest draft and original retry identity through reopening', async () => {
  const first = deferred(); let held = false, failed = false, interruptedRequest
  api.mockImplementation(async (route,init) => {
    const body = init?.body && JSON.parse(init.body)
    if (init?.method === 'PUT' && body.content === 'version B' && !failed) {
      failed = true; interruptedRequest = body; throw new Error('Injected transport failure before delivery')
    }
    const response = await server.call(route,init)
    if (init?.method === 'PUT' && !held) { held = true; await first.promise }
    return response
  })
  await edit('version A'); const p1 = await startSave(); await until(()=>expect(held).toBe(true))
  await edit('version B'); const p2 = await startSave()
  await edit('version A'); const p3 = await startSave(); await render(b)
  await until(()=>expect(ref.current.getReferenceRefactorState().currentContent).toBe('other'))
  let outcomes
  await act(async()=>{first.resolve(); outcomes = await Promise.allSettled([p1.promise,p2.promise,p3.promise]); await tick()})
  expect(outcomes.map(r=>r.status)).toEqual(['fulfilled','rejected','rejected'])
  expect(readEditorDraft(a)?.content).toBe('version A'); expect(editorQuit.hasDraft(a)).toBe(true)
  await render(a); await until(()=>expect(ref.current.getReferenceRefactorState().currentContent).toBe('version A'))
  const final = await startSave(); await act(async()=>final.promise)
  const submitted = puts().map(([,init])=>JSON.parse(init.body))
  expect(submitted).toHaveLength(4); expect(submitted[2]).toEqual(interruptedRequest)
  expect(submitted[3].content).toBe('version A'); expect(submitted[3].expected_content).toBe('version B')
  await quitRestartAndCheck('version A')
})
