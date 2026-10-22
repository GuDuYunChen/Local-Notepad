import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: ({ initialContent, onChange }) => {
  globalThis.editSaveQueue = onChange
  return <pre data-save-queue>{initialContent}</pre>
} }))
const id = 'queue-order-note'
let host, root, ref, database, writes, resolveFirst, autosave
const receipt = p => ({ id, content: p.content, updated_at: 101,
  save_receipt: { request_id: p.save_request_id, outcome: 'applied', reference_pending: false } })
async function edit(text) { await act(async () => globalThis.editSaveQueue(text)) }
async function save() {
  let promise
  await act(async () => { promise = ref.current.save(); void promise.catch(() => {}); await Promise.resolve() })
  return { promise }
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  localStorage.clear(); removeEditorDraft(id); editorQuit.forget(id)
  database = 'original'; writes = []; resolveFirst = null; autosave = null
  const interval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30000) autosave = callback
    return interval(callback, ms, ...args)
  })
  api.mockReset(); api.mockImplementation(async (_path, init) => {
    if (init?.method !== 'PUT') return { id, content: database, updated_at: 100 }
    const p = JSON.parse(init.body); writes.push(p)
    expect(p.expected_content).toBe(database)
    if (writes.length === 1) await new Promise(resolve => { resolveFirst = resolve })
    database = p.content
    return receipt(p)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); ref = React.createRef()
  await act(async () => root.render(<TextEditor activeId={id} ref={ref} autoSaveOnSwitch={false}/>))
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host.remove(); removeEditorDraft(id); editorQuit.forget(id)
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('saving A then B then A while the first request waits finishes with the last requested A', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const final = await save()
  await act(async () => { resolveFirst(); await Promise.all([a.promise, b.promise, final.promise]) })
  expect(database).toBe('version A')
  expect(writes.map(p => p.content)).toEqual(['version A', 'version B', 'version A'])
  expect(readEditorDraft(id)).toBeNull()
  expect(editorQuit.hasDraft(id)).toBe(false)
})
it('a final save cannot report success before a previously queued different body has finished', async () => {
  const ordinary = api.getMockImplementation(); let resolveSecond, secondStarted = false, finalFinished = false
  api.mockImplementation(async (path, init) => {
    const p = init?.body && JSON.parse(init.body)
    if (p?.content === 'version B') { secondStarted = true; await new Promise(resolve => { resolveSecond = resolve }) }
    return ordinary(path, init)
  })
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const final = await save()
  void final.promise.then(() => { finalFinished = true })
  await act(async () => { resolveFirst(); await a.promise; await Promise.resolve(); await Promise.resolve() })
  expect(secondStarted).toBe(true)
  const premature = finalFinished
  // Always release the test's held transport before asserting, even on the old implementation.
  await act(async () => { resolveSecond(); await Promise.all([b.promise, final.promise]) })
  expect(premature).toBe(false)
  expect(finalFinished).toBe(true); expect(database).toBe('version A')
})
it('an automatic save matching the active body still runs after a different queued manual save', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A')
  expect(autosave).toBeTypeOf('function')
  await act(async () => { autosave(); await Promise.resolve() })
  await act(async () => { resolveFirst(); await Promise.all([a.promise,b.promise]); for (let i=0;i<12;i++) await Promise.resolve() })
  expect(ref.current.getReferenceRefactorState().savedContent).toBe('version A')
})
it('adjacent identical save requests share the tail instead of adding redundant writes', async () => {
  await edit('version A'); const a = await save(); const duplicate = await save()
  await edit('version B'); const b = await save(); const secondDuplicate = await save()
  await act(async () => { resolveFirst(); await Promise.all([a.promise,duplicate.promise,b.promise,secondDuplicate.promise]) })
  expect(writes.map(p => p.content)).toEqual(['version A','version B'])
  expect(database).toBe('version B')
})
it('closing the editor cancels every queued intent without issuing detached writes', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const final = await save()
  await act(async () => { root.unmount(); root = null; await Promise.resolve() })
  expect(writes).toHaveLength(1)
  expect(readEditorDraft(id)?.content).toBe('version A')
  await act(async () => { resolveFirst(); await Promise.all([a.promise,b.promise,final.promise]) })
  expect(writes).toHaveLength(1); expect(editorQuit.hasDraft(id)).toBe(true)
})
it('repeated nonadjacent snapshots keep their requested order across four queued saves', async () => {
  const saves = []
  for (const text of ['version A','version B','version C','version B']) { await edit(text); saves.push((await save()).promise) }
  await act(async () => { resolveFirst(); await Promise.all(saves) })
  expect(writes.map(p=>p.content)).toEqual(['version A','version B','version C','version B'])
  expect(database).toBe('version B'); expect(editorQuit.hasDraft(id)).toBe(false)
})
it('newer text without a save request is not silently included in an older queued snapshot', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('not requested yet')
  await act(async () => { resolveFirst(); await Promise.all([a.promise,b.promise]) })
  expect(writes.map(p=>p.content)).toEqual(['version A','version B'])
  expect(database).toBe('version B')
  expect(readEditorDraft(id)?.content).toBe('not requested yet'); expect(editorQuit.hasDraft(id)).toBe(true)
})
it('a rejected predecessor prevents queued writes and all callers settle without clearing the draft', async () => {
  let rejectFirst
  api.mockImplementation((_path, init) => {
    writes.push(JSON.parse(init.body)); return new Promise((_, reject)=>{ rejectFirst = reject })
  })
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const final = await save()
  let results
  await act(async () => { rejectFirst(new Error('transport failed')); results = await Promise.allSettled([a.promise,b.promise,final.promise]) })
  expect(results.every(result=>result.status==='rejected')).toBe(true)
  expect(writes).toHaveLength(1); expect(database).toBe('original')
  expect(readEditorDraft(id)?.content).toBe('version A'); expect(editorQuit.hasDraft(id)).toBe(true)
})
it('a queued write re-establishes the exit guard before unmount even when the visible text was just acknowledged', async () => {
  const ordinary = api.getMockImplementation(); let resolveSecond, secondStarted = false
  api.mockImplementation((path, init) => {
    const p = init?.body && JSON.parse(init.body)
    if (p?.content === 'version B') { writes.push(p); secondStarted = true; return new Promise(resolve=>{resolveSecond=()=>resolve(receipt(p))}) }
    return ordinary(path,init)
  })
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A') // no new save: the already queued B can still change the database
  await act(async () => { resolveFirst(); await a.promise; for (let i=0;i<8;i++) await Promise.resolve() })
  expect(secondStarted).toBe(true)
  await act(async () => { root.unmount(); root = null; await b.promise })
  expect(readEditorDraft(id)?.content).toBe('version A')
  expect(editorQuit.hasDraft(id)).toBe(true)
  await expect(editorQuit.flush(new AbortController().signal)).rejects.toThrow('unresolved')
  await act(async () => { resolveSecond(); await Promise.resolve() })
  expect(writes).toHaveLength(2)
})

it('a hidden note preserves its unrequested visible revert while an older queued snapshot is saved', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A')
  await act(async () => root.render(<TextEditor activeId={null} ref={ref} autoSaveOnSwitch={false}/>))
  await act(async () => { resolveFirst(); await Promise.all([a.promise,b.promise]) })
  expect(database).toBe('version B')
  expect(readEditorDraft(id)?.content).toBe('version A')
  expect(editorQuit.hasDraft(id)).toBe(true)
})
it('a hidden A-B-A queue clears only the final confirmed draft, not an intermediate snapshot', async () => {
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const last = await save()
  await act(async () => root.render(<TextEditor activeId={null} ref={ref} autoSaveOnSwitch={false}/>))
  await act(async () => { resolveFirst(); await Promise.all([a.promise,b.promise,last.promise]) })
  expect(database).toBe('version A')
  expect(readEditorDraft(id)).toBeNull()
  expect(editorQuit.hasDraft(id)).toBe(false)
})
it('a hidden A-B-A queue retains the latest A draft if its intermediate write fails', async () => {
  const ordinary = api.getMockImplementation()
  api.mockImplementation((path, init) => {
    const body = init?.body && JSON.parse(init.body)
    if (body?.content === 'version B') return Promise.reject(new Error('temporary transport failure'))
    return ordinary(path, init)
  })
  await edit('version A'); const a = await save()
  await edit('version B'); const b = await save()
  await edit('version A'); const last = await save()
  await act(async () => root.render(<TextEditor activeId={null} ref={ref} autoSaveOnSwitch={false}/>))
  let outcomes
  await act(async () => { resolveFirst(); outcomes = await Promise.allSettled([a.promise,b.promise,last.promise]) })
  expect(outcomes.map(result=>result.status)).toEqual(['fulfilled','rejected','rejected'])
  expect(readEditorDraft(id)?.content).toBe('version A')
  expect(editorQuit.hasDraft(id)).toBe(true)
})
