import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft, writeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: ({ initialContent, onChange }) => {
  globalThis.editRecoveryDraft = onChange
  return <pre data-recovery-content>{initialContent}</pre>
} }))
const id = 'draft-recovery', other = 'draft-other'
let host, root, ref, database, dbTime, requests, firstToken
const receipt = (p, text = p.content, outcome = 'applied') => ({ id, content: text, updated_at: dbTime,
  save_receipt: { request_id: p.save_request_id, outcome, reference_pending: false } })
async function render(activeId = id) {
  await act(async () => root.render(<TextEditor ref={ref} activeId={activeId} autoSaveOnSwitch={false} deletedIds={new Set()}/>))
}
async function edit(text) { await act(async () => globalThis.editRecoveryDraft(text)) }
async function save() {
  let result
  await act(async () => { try { result = await ref.current.save() } catch (e) { result = e } })
  return result
}
async function remount() {
  await act(async () => root.unmount())
  root = createRoot(host); ref = React.createRef(); await render()
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(1700000000500)
  localStorage.clear(); [id, other].forEach(k => { removeEditorDraft(k); editorQuit.forget(k) })
  database = 'original body'; dbTime = 1700000000; requests = []; firstToken = null
  api.mockReset(); api.mockImplementation(async (path, init) => {
    if (path.endsWith(other)) return { id: other, content: 'other body', updated_at: dbTime }
    if (init?.method === 'PUT') {
      const p = JSON.parse(init.body); requests.push(p)
      if (p.expected_content !== database) return receipt(p, database, 'conflict')
      database = p.content; return receipt(p)
    }
    return { id, content: database, updated_at: dbTime }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); ref = React.createRef(); await render()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  [id, other].forEach(k => { removeEditorDraft(k); editorQuit.forget(k) })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('reopening after the five-minute cache window keeps the unconfirmed body reachable and saveable', async () => {
  await edit('unconfirmed draft'); await remount()
  // Leave the actual editor; the 30-second interval is not running here.
  await act(async () => root.unmount()); root = createRoot(host)
  await act(async () => vi.advanceTimersByTimeAsync(6 * 60 * 1000))
  await render()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('unconfirmed draft')
  expect(editorQuit.hasDraft(id)).toBe(true)
  await save(); expect(database).toBe('unconfirmed draft')
  await expect(editorQuit.flush(new AbortController().signal)).resolves.toBeUndefined()
})
it('a newer database timestamp cannot hide an unsaved draft on reopening', async () => {
  await edit('my unsaved draft')
  await act(async () => root.unmount()); root = createRoot(host)
  database = 'new database body'; dbTime += 10
  await render()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('my unsaved draft')
  expect(host.textContent).toContain('处理保存冲突')
  await save(); expect(requests).toHaveLength(0); expect(database).toBe('new database body')
  await expect(editorQuit.flush(new AbortController().signal)).rejects.toThrow()
})
it('same-second external edits are not silently overwritten by restoring a fresh draft', async () => {
  await edit('my draft against original')
  await act(async () => root.unmount()); root = createRoot(host)
  database = 'external edit within same second'
  await render(); expect(ref.current.getReferenceRefactorState().currentContent).toBe('my draft against original')
  await save()
  expect(database).toBe('external edit within same second')
  expect(requests).toHaveLength(0); expect(host.textContent).toContain('处理保存冲突')
})
it('remounting reconciles the original unconfirmed request token before sending newer text', async () => {
  const ordinary = api.getMockImplementation()
  api.mockImplementation((path, init) => {
    if (init?.method === 'PUT') {
      const p = JSON.parse(init.body)
      if (!firstToken) { firstToken = p.save_request_id; requests.push(p); database = p.content; return new Promise(() => {}) }
      if (p.save_request_id === firstToken) { requests.push(p); return receipt(p) }
    }
    return ordinary(path, init)
  })
  await edit('first body')
  let pending
  await act(async () => { pending = ref.current.save(); pending.catch(() => {}); await Promise.resolve() })
  await edit('newest body'); await remount(); await pending
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('newest body')
  await save()
  expect(requests).toHaveLength(3)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[2].expected_content).toBe('first body')
  expect(database).toBe('newest body'); expect(editorQuit.hasDraft(id)).toBe(false)
})
it('switching before the debounce preserves the previous draft even when autosave-on-switch is disabled', async () => {
  await edit('typed less than 250ms ago'); await render(other); await render(id)
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('typed less than 250ms ago')
  expect(requests).toHaveLength(0)
})
it('a larger in-memory draft cannot be shadowed by the older persistent cache entry', async () => {
  writeEditorDraft(id, 'previous small draft')
  const latest = 'L'.repeat(1024 * 1024 + 1)
  writeEditorDraft(id, latest)
  expect(readEditorDraft(id)?.content).toBe(latest)
})
it('an old legacy cache is offered for explicit review rather than written or silently expired', async () => {
  await act(async () => root.unmount()); root = createRoot(host)
  // Prior releases have no saved-base metadata; the timestamp cannot prove safety.
  writeEditorDraft(id, 'legacy unsaved body')
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1000))
  await render()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('legacy unsaved body')
  expect(host.textContent).toContain('处理保存冲突')
  await save(); expect(requests).toHaveLength(0)
})
it('expired provenance remains usable after in-memory modules restart, without relying on the exit ledger', async () => {
  // Inject only the serialized shape emitted by the application: simulates a
  // previous process. No memory cache or unsaved-ledger entry exists for this id.
  await act(async () => root.unmount()); root = createRoot(host); removeEditorDraft(id); editorQuit.forget(id)
  localStorage.setItem('editor:cache:' + id, JSON.stringify({ content: 'from previous process', editedAt: 1,
    recovery: { version: 1, id, expectedContent: 'original body', conflicted: false, attempt: null } }))
  await render()
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('from previous process')
  await save(); expect(database).toBe('from previous process'); expect(editorQuit.hasDraft(id)).toBe(false)
})
it('a serialized unconfirmed token is restored even when the displayed draft equals the fresh database read', async () => {
  await act(async () => root.unmount()); root = createRoot(host); removeEditorDraft(id); editorQuit.forget(id)
  const token='a'.repeat(32)
  localStorage.setItem('editor:cache:' + id, JSON.stringify({content:'original body',editedAt:1,
    recovery:{version:1,id,expectedContent:'original body',conflicted:false,
      attempt:{id,expected:'original body',content:'earlier requested body',requestID:token,mappings:'[]'}}}))
  await render()
  expect(ref.current.clearCache()).toBe(false) // unknown write cannot be discarded
  expect(editorQuit.hasDraft(id)).toBe(true)
  await save()
  expect(requests).toHaveLength(2)
  expect(requests[0].save_request_id).toBe(token)
  expect(requests[1].expected_content).toBe('earlier requested body')
  expect(requests[1].content).toBe('original body')
  expect(database).toBe('original body'); expect(editorQuit.hasDraft(id)).toBe(false)
})
it('explicitly adopting the current database can release a legacy recovered draft without another PUT', async () => {
  await act(async () => root.unmount()); root = createRoot(host)
  writeEditorDraft(id,'legacy draft without a known base'); await render()
  const click = async label => {
    const target=[...document.querySelectorAll('button')].find(b=>b.textContent===label)
    expect(target).toBeTruthy(); await act(async()=>target.click())
  }
  await click('处理保存冲突'); await click('采用数据库正文')
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('original body')
  expect(requests).toHaveLength(0); expect(editorQuit.hasDraft(id)).toBe(false)
  expect(readEditorDraft(id)).toBeNull()
  await expect(editorQuit.flush(new AbortController().signal)).resolves.toBeUndefined()
})
