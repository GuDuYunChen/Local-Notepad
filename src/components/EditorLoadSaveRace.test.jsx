import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: ({ initialContent, onChange }) => {
  globalThis.editLoadRace = onChange
  return <pre data-load-race>{initialContent}</pre>
} }))
const a = 'load-race-a', b = 'load-race-b'
let host, root, ref, onSaved, database, writes
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const file = (id = a, content = database) => ({ id, content, updated_at: 100 })
const receipt = (p, content = p.content, outcome = 'applied') => ({ ...file(a, content),
  save_receipt: { request_id: p.save_request_id, outcome, reference_pending: false } })
async function render(id = a) {
  await act(async () => root.render(<TextEditor activeId={id} ref={ref} onSaved={onSaved} autoSaveOnSwitch={false}/>))
}
async function edit(text) { await act(async () => globalThis.editLoadRace(text)) }
async function startSave() {
  let promise
  await act(async () => { promise = ref.current.save(); void promise.catch(() => {}); await Promise.resolve() })
  return { promise }
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  localStorage.clear(); [a,b].forEach(id => { removeEditorDraft(id); editorQuit.forget(id) })
  database = 'original'; writes = []; onSaved = vi.fn()
  api.mockReset(); api.mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') { const p = JSON.parse(init.body); writes.push(p); database = p.content; return receipt(p) }
    return path.endsWith(b) ? file(b, 'other') : file()
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); ref = React.createRef()
  await render()
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host.remove(); [a,b].forEach(id => { removeEditorDraft(id); editorQuit.forget(id) })
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('a save acknowledgement during A-B-A loading never replaces the newest draft with the empty loading buffer', async () => {
  const save = deferred(), read = deferred(); let request, reloading = false, reloads = 0
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') { request = JSON.parse(init.body); writes.push(request); return save.promise }
    if (path.endsWith(b)) return file(b, 'other')
    if (reloading && ++reloads === 1) return read.promise
    return file()
  })
  await edit('submitted'); const pending = await startSave(); await edit('newest unsaved')
  await render(b); reloading = true; await render(a)
  expect(host.querySelector('[data-load-race]')).toBeNull()
  database = 'submitted'
  await act(async () => { save.resolve(receipt(request)); await pending.promise })
  expect(readEditorDraft(a)?.content).toBe('newest unsaved')
  expect(onSaved).not.toHaveBeenCalled()
  // First GET was captured before the write committed: it is stale, even
  // though it belongs to the current load. A receipt invalidates that read.
  await act(async () => read.resolve(file(a, 'original')))
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('newest unsaved')
  expect(ref.current.getReferenceRefactorState().savedContent).toBe('submitted')
  expect(host.textContent).not.toContain('处理保存冲突')
  expect(reloads).toBe(2); expect(editorQuit.hasDraft(a)).toBe(true)
})
it('a conflict response while the same document reloads preserves its draft rather than an empty placeholder', async () => {
  const save = deferred(), read = deferred(); let request, reloading = false, reloads = 0
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') { request = JSON.parse(init.body); writes.push(request); return save.promise }
    if (path.endsWith(b)) return file(b, 'other')
    if (reloading && ++reloads === 1) return read.promise
    return file()
  })
  await edit('submitted'); const pending = await startSave(); await edit('unsaved after submit')
  await render(b); reloading = true; await render(a); database = 'external update'
  await act(async () => { save.resolve(receipt(request, database, 'conflict')); await pending.promise.catch(() => {}) })
  expect(readEditorDraft(a)?.content).toBe('unsaved after submit')
  await act(async () => read.resolve(file(a, 'original')))
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('unsaved after submit')
  expect(ref.current.getReferenceRefactorState().savedContent).toBe('external update')
  expect(host.textContent).toContain('处理保存冲突')
  expect(editorQuit.hasDraft(a)).toBe(true)
})
it('unmount cancels already queued saves instead of starting another PUT after the editor is gone', async () => {
  const save = deferred()
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') { writes.push(JSON.parse(init.body)); return save.promise }
    return file()
  })
  await edit('first'); const first = await startSave(); await edit('second'); const second = await startSave()
  await act(async () => { root.unmount(); root = null; await Promise.resolve(); await Promise.resolve() })
  expect(writes).toHaveLength(1)
  expect(readEditorDraft(a)?.content).toBe('second')
  await act(async () => { save.resolve(receipt(writes[0])); await first.promise; await second.promise })
  expect(writes).toHaveLength(1); expect(onSaved).not.toHaveBeenCalled()
  expect(editorQuit.hasDraft(a)).toBe(true)
})
it('a stalled initial read times out, offers retry, and ignores its late result after recovery', async () => {
  const read = deferred(); let tries = 0, signal
  api.mockImplementation((path, init) => {
    if (path.endsWith(b)) return file(b, 'other')
    if (++tries === 1) { signal = init.signal; return read.promise }
    return file(a, 'recovered database')
  })
  await render(b); await render(a)
  await act(async () => vi.advanceTimersByTimeAsync(8100))
  expect(host.textContent).toContain('重试加载正文'); expect(signal.aborted).toBe(true)
  const retry = [...host.querySelectorAll('button')].find(n => n.textContent === '重试加载正文')
  await act(async () => retry.click())
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('recovered database')
  await act(async () => read.resolve(file(a, 'late stale database')))
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('recovered database')
  expect(writes).toHaveLength(0)
})
for (const invalid of [null, { id: b, content: 'wrong note' }, { id: a }, { id: a, content: {} }]) {
  it('invalid document reads cannot mount an empty/wrong body or enable a save: ' + JSON.stringify(invalid), async () => {
    await edit('retained draft'); await render(b)
    api.mockResolvedValue(invalid); await render(a)
    expect(host.textContent).toContain('重试加载正文')
    expect(host.querySelector('[data-load-race]')).toBeNull()
    expect(readEditorDraft(a)?.content).toBe('retained draft')
    api.mockClear(); await act(async () => ref.current.save())
    expect(api).not.toHaveBeenCalled(); expect(editorQuit.hasDraft(a)).toBe(true)
  })
}
it('queued saves starting during a reload keep the captured draft instead of recaching the loading placeholder', async () => {
  const first = deferred(), second = deferred(), read = deferred(); let reads = 0
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') {
      const p = JSON.parse(init.body); writes.push(p)
      return writes.length === 1 ? first.promise : second.promise
    }
    if (path.endsWith(b)) return file(b, 'other')
    return ++reads === 1 ? read.promise : file()
  })
  await edit('first'); const p1 = await startSave(); await edit('second'); const p2 = await startSave()
  await render(b); await render(a)
  database = 'first'
  await act(async () => { first.resolve(receipt(writes[0])); await p1.promise; await Promise.resolve() })
  expect(writes).toHaveLength(2); expect(writes[1].content).toBe('second')
  expect(readEditorDraft(a)?.content).toBe('second')
  expect(readEditorDraft(a)?.recovery.attempt.requestID).toBe(writes[1].save_request_id)
  database = 'second'
  await act(async () => { second.resolve(receipt(writes[1])); await p2.promise; read.resolve(file(a, 'original')) })
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('second')
  expect(editorQuit.hasDraft(a)).toBe(false)
})
it('a failed re-read after an intervening acknowledgement leaves the latest draft available for retry', async () => {
  const save = deferred(), read = deferred(); let request, reads = 0
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') { request = JSON.parse(init.body); writes.push(request); return save.promise }
    if (path.endsWith(b)) return file(b, 'other')
    if (++reads === 1) return read.promise
    throw new Error('PRIVATE_LOAD_ERROR')
  })
  await edit('first'); const pending = await startSave(); await edit('newest'); await render(b); await render(a)
  await act(async () => { save.resolve(receipt(request)); await pending.promise; read.resolve(file(a, 'original')) })
  expect(host.textContent).toContain('重试加载正文'); expect(host.textContent).not.toContain('PRIVATE_LOAD_ERROR')
  expect(readEditorDraft(a)?.content).toBe('newest'); expect(editorQuit.hasDraft(a)).toBe(true)
  expect(onSaved).not.toHaveBeenCalled()
})
