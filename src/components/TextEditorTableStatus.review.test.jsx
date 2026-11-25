import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { removeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: () => <div className="editor-input" data-lexical-editor="true" tabIndex={0} /> }))
let host, root
const noteId = 'table-owner-review'
const settle = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
const active = () => [...host.querySelectorAll('.selection-mode-pill')].some(node => node.textContent === '表格选择')
const mode = async (target, enabled) => {
  await act(async () => target.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: enabled, bubbles: true })))
  await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); removeEditorDraft(noteId); editorQuit.forget(noteId)
  api.mockReset(); api.mockImplementation(async () => ({ id: noteId, content: '', updated_at: 1 }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<TextEditor activeId={noteId} deletedIds={new Set()} autoSaveOnSwitch={false} />))
  await settle()
  expect(host.querySelector('.editor-input')).toBeTruthy()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); removeEditorDraft(noteId); editorQuit.forget(noteId)
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('legacy window selection events update the sole editor status without making a save request', async () => {
  await mode(window, true)
  expect(active()).toBe(true)
  await mode(window, false)
  expect(active()).toBe(false)
  expect(api.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET')).toEqual([])
})

test('nested editor events cannot activate or clear the parent status', async () => {
  const parent = host.querySelector('.editor-input'), nested = document.createElement('div')
  nested.dataset.lexicalEditor = 'true'; parent.append(nested)
  await mode(nested, true)
  expect(active()).toBe(false)
  await mode(parent, true)
  expect(active()).toBe(true)
  await mode(nested, false)
  expect(active()).toBe(true)
})

test('legacy window events follow the focused editor instead of broadcasting status', async () => {
  const own = host.querySelector('.editor-input'), other = document.createElement('div')
  other.dataset.lexicalEditor = 'true'; other.tabIndex = 0; document.body.append(other)
  try {
    await act(async () => other.focus())
    await mode(window, true)
    expect(active()).toBe(false)
    await act(async () => own.focus())
    await mode(window, true)
    expect(active()).toBe(true)
    await act(async () => other.focus())
    await mode(window, false)
    expect(active()).toBe(true)
    await act(async () => own.focus())
    await mode(window, false)
    expect(active()).toBe(false)
  } finally { other.remove() }
})
