import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { readEditorDraftDurable, writeEditorDraft } from '~/services/editorDraftCache'
import { editorQuit } from '~/services/editorQuit.mjs'

vi.mock('~/services/api', async () => {
  const { editorSaveReceiptFixture } = await import('../test/editorSaveReceiptFixture.mjs')
  return { api: editorSaveReceiptFixture(vi.fn()) }
})
vi.mock('~/services/editorDraftCache', () => ({
  readEditorDraft: vi.fn(() => null), readEditorDraftDurable: vi.fn(async () => null),
  removeEditorDraft: vi.fn(), writeEditorDraft: vi.fn(),
}))
vi.mock('./Editor/utils/referenceUtils', () => ({ hasHeadingStructureChanged: () => false }))
vi.mock('./Editor/Editor', () => ({ default: function Input({ initialContent, onChange }) {
  const [value, setValue] = React.useState(initialContent)
  React.useEffect(() => setValue(initialContent), [initialContent])
  return <textarea aria-label="draft-test-editor" value={value} onChange={event => {
    setValue(event.target.value); onChange(event.target.value)
  }} />
} }))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let host, root, ref, bodies, pending
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
const render = async id => act(async () => { root.render(<TextEditor ref={ref} activeId={id} autoSaveOnSwitch={false} deletedIds={new Set()} />); await drain() })
const edit = async value => act(async () => {
  const field = host.querySelector('textarea')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); await drain()
})
const signal = async (type, id = 'a') => act(async () => { window.dispatchEvent(new CustomEvent(type, { detail: { id } })); await drain() })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await import('./Editor/Editor'); ref = React.createRef(); bodies = { a: 'old', b: 'other' }; pending = []
  for (const id of ['a', 'b']) editorQuit.forget(id)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.mockReset(); readEditorDraftDurable.mockReset().mockResolvedValue(null); writeEditorDraft.mockClear()
  api.mockImplementation(async (path, init) => {
    const id = decodeURIComponent(path.split('/').at(-1))
    if (init?.method !== 'PUT') return { id, content: bodies[id], updated_at: 1 }
    const content = JSON.parse(init.body).content
    if (pending.length) await pending.shift().promise
    bodies[id] = content
    return { id, content, updated_at: 2 }
  })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  for (const id of ['a', 'b']) editorQuit.forget(id)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('draft durability in the existing editor workflow', () => {
  it('rereads the database when a save receipt arrives during the durable-cache await', async () => {
    await render('a'); await edit('new saved body')
    const save = deferred(); pending.push(save)
    let saving
    await act(async () => { saving = ref.current.save(); await drain() })
    expect(puts()).toHaveLength(1)
    await render('b')
    const durable = deferred(); readEditorDraftDurable.mockImplementationOnce(() => durable.promise)
    await render('a'); expect(host.querySelector('textarea')).toBeNull()
    await act(async () => { save.resolve(); await saving; await drain() })
    await act(async () => { durable.resolve(null); await drain() })
    expect(host.querySelector('textarea')?.value).toBe('new saved body')
    expect(ref.current.getReferenceRefactorState().savedContent).toBe('new saved body')
    expect(puts()).toHaveLength(1)
  })
  it('explains memory-only recovery failure and retries the backup without saving the body', async () => {
    await render('a'); await edit('unsaved body')
    await signal('editor:draft-persistence-error')
    const banner = host.querySelector('[data-draft-persistence-warning]')
    expect(banner?.textContent).toContain('关闭或崩溃后可能无法恢复')
    writeEditorDraft.mockClear()
    await act(async () => banner.querySelector('button').click())
    expect(writeEditorDraft).toHaveBeenCalledWith('a', 'unsaved body', undefined, expect.objectContaining({ id: 'a' }))
    expect(puts()).toHaveLength(0)
    expect(editorQuit.pending()).toBe(1)
    await signal('editor:draft-persistence-ready')
    expect(host.querySelector('[data-draft-persistence-warning]')).toBeNull()
  })
  it('does not show or clear the current warning for a different document', async () => {
    await render('a'); await edit('unsaved body')
    await signal('editor:draft-persistence-error', 'b')
    expect(host.querySelector('[data-draft-persistence-warning]')).toBeNull()
    await signal('editor:draft-persistence-error', 'a')
    await signal('editor:draft-persistence-ready', 'b')
    expect(host.querySelector('[data-draft-persistence-warning]')).not.toBeNull()
    await render('b')
    expect(host.querySelector('[data-draft-persistence-warning]')).toBeNull()
  })
  it('does not call a confirmed database save unsaved because mirror cleanup failed', async () => {
    await render('a'); await signal('editor:draft-persistence-error')
    expect(host.querySelector('[data-draft-persistence-warning]')).toBeNull()
    expect(puts()).toHaveLength(0)
  })
})
