import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { removeEditorDraft } from '~/services/editorDraftCache'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/Editor', () => ({ default: () => <div className="editor-input" data-lexical-editor="true" /> }))
let host, root
const settle = async () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
async function render(id = 'table-A') {
  await act(async () => root.render(<TextEditor activeId={id} deletedIds={new Set()} autoSaveOnSwitch={false} />))
  await settle()
  expect(host.querySelector('.editor-input')).toBeTruthy()
}
async function mode(target, active = true) {
  await act(async () => target.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: active, bubbles: true })))
}
const active = () => [...host.querySelectorAll('.selection-mode-pill')].some(node => node.textContent === '表格选择')
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  for (const id of ['table-A', 'table-B']) { removeEditorDraft(id); editorQuit.forget(id) }
  api.mockReset()
  api.mockImplementation(async path => ({ id: path.split('/').at(-1), content: '', updated_at: 1 }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  for (const id of ['table-A', 'table-B']) { removeEditorDraft(id); editorQuit.forget(id) }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
test('the table status belongs to its editor and ignores another root', async () => {
  const other = document.createElement('div'); other.dataset.lexicalEditor = 'true'; document.body.append(other)
  try {
    await mode(other)
    expect(active()).toBe(false)
    await mode(host.querySelector('.editor-input'))
    expect(active()).toBe(true)
    await mode(other, false)
    expect(active()).toBe(true)
  } finally { other.remove() }
})
test('table selection status resets when the note changes', async () => {
  await mode(host.querySelector('.editor-input'))
  expect(active()).toBe(true)
  await render('table-B')
  expect(active()).toBe(false)
})
test('table selection status resets when entering reading mode', async () => {
  await mode(host.querySelector('.editor-input'))
  expect(active()).toBe(true)
  await act(async () => host.querySelector('[aria-label="切换到阅读模式"]').click())
  expect(active()).toBe(false)
})
