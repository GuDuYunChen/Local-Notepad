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
  globalThis.editLiveLoadRace = onChange
  return <pre data-live-load>{initialContent}</pre>
} }))
let server, host, root, ref, a, b, prepare, dispose, results
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const until = fn => vi.waitFor(async () => { await act(tick); fn() }, { timeout: 4000, interval: 15 })
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
async function render(id = a) {
  await act(async () => root.render(<TextEditor ref={ref} activeId={id} autoSaveOnSwitch={false}/>))
}
async function edit(text) { await act(async () => globalThis.editLiveLoadRace(text)) }
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); results = []
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
for (const outcome of ['applied', 'conflict']) it(`real ${outcome} response during A-B-A reload preserves draft and obtains a post-result snapshot before save/quit/restart`, async () => {
  const writeGate = deferred(), readGate = deferred(); let heldRead, readOnce = false, writeOnce = false
  api.mockImplementation(async (route, init) => {
    if (route === '/api/files/' + a && init?.method === 'PUT' && !writeOnce) {
      writeOnce = true; await writeGate.promise; return server.call(route, init)
    }
    if (route === '/api/files/' + a && (!init?.method || init.method === 'GET') && !readOnce) {
      readOnce = true; heldRead = await server.call(route, init); await readGate.promise; return heldRead
    }
    return server.call(route, init)
  })
  await edit('first submitted'); const pending = await startSave(); await edit('newest still unsaved')
  await render(b); await until(() => expect(ref.current.getReferenceRefactorState().currentContent).toBe('other'))
  await render(a); await until(() => expect(heldRead?.content).toBe('original'))
  if (outcome === 'conflict') await server.call('/api/files/' + a, { method: 'PUT', body: JSON.stringify({ content: 'external after GET' }) })
  await act(async () => { writeGate.resolve(); await pending.promise.catch(() => {}); await tick() })
  expect(readEditorDraft(a)?.content).toBe('newest still unsaved')
  await act(async () => { readGate.resolve(); await tick() })
  await until(() => expect(ref.current.getReferenceRefactorState().currentContent).toBe('newest still unsaved'))
  expect(ref.current.getReferenceRefactorState().savedContent).toBe(outcome === 'conflict' ? 'external after GET' : 'first submitted')
  expect(editorQuit.hasDraft(a)).toBe(true)
  if (outcome === 'conflict') {
    const open = [...host.querySelectorAll('button')].find(n => n.textContent === '处理保存冲突')
    expect(open).toBeTruthy(); await act(async () => open.click())
    const keep = [...document.querySelectorAll('.editor-save-conflict-dialog button')].find(n => n.textContent === '保留我的正文')
    await act(async () => { keep.click(); await tick() })
  } else {
    const final = await startSave(); await act(async () => final.promise)
  }
  await until(() => expect(editorQuit.hasDraft(a)).toBe(false))
  expect((await server.call('/api/files/' + a)).content).toBe('newest still unsaved')
  await quitRestartAndCheck('newest still unsaved')
})
it('unmounted queued Ctrl+S sends no extra real PUT, then reopening reconciles the first receipt and persists the latest text', async () => {
  const gate = deferred(); let firstReceipt
  api.mockImplementation(async (route, init) => {
    const response = await server.call(route, init)
    if (init?.method === 'PUT' && !firstReceipt) { firstReceipt = response; await gate.promise }
    return response
  })
  await edit('first committed'); const p1 = await startSave()
  await until(() => expect(firstReceipt?.save_receipt.outcome).toBe('applied'))
  await edit('latest queued draft'); const p2 = await startSave(); await unmount()
  await act(async () => { gate.resolve(); await p1.promise; await p2.promise; await tick() })
  expect(puts()).toHaveLength(1)
  expect((await server.call('/api/files/' + a)).content).toBe('first committed')
  expect(readEditorDraft(a)?.content).toBe('latest queued draft')
  root = createRoot(host); ref = React.createRef(); await render()
  await until(() => expect(ref.current.getReferenceRefactorState().currentContent).toBe('latest queued draft'))
  const final = await startSave(); await act(async () => final.promise)
  const requests = puts().map(([,init]) => JSON.parse(init.body))
  expect(requests).toHaveLength(3); expect(requests[0]).toEqual(requests[1]); expect(requests[2].content).toBe('latest queued draft')
  await quitRestartAndCheck('latest queued draft')
})
