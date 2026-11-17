import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { DndProvider } from 'react-dnd'
import { TestBackend } from 'react-dnd-test-backend'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import UiThemeProvider from './components/ui/UiThemeProvider'
import { api, listAllFiles, listAllFilesWithContent } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ notes: {}, heldSave: null, holdSave: false }))
vi.mock('~/services/api', async () => {
  const { editorSaveReceiptFixture } = await import('./test/editorSaveReceiptFixture.mjs')
  return { api: editorSaveReceiptFixture(vi.fn()), listAllFiles: vi.fn(),
    listAllFilesWithContent: vi.fn(), createFileVersionSnapshot: vi.fn() }
})
vi.mock('~/services/toast', async importOriginal => ({
  ...await importOriginal(),
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
// App, FileList, sidebar, menus, confirmation, TextEditor, draft storage and
// guarded selection are real. Only the rich-text input and local API are fixtures.
vi.mock('./components/Editor/Editor', () => ({ default: ({ initialContent, onChange, documentId, readOnly }) => {
  const [text, setText] = React.useState(initialContent || '')
  React.useEffect(() => setText(initialContent || ''), [initialContent])
  return <textarea aria-label="正文输入夹具" data-document-id={documentId} value={text} readOnly={readOnly}
    onChange={event => { setText(event.target.value); onChange(event.target.value) }} />
} }))

let host, root, widthDescriptor
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const until = assertion => vi.waitFor(async () => { await act(flush); assertion() }, { timeout: 2000, interval: 10 })
const field = () => host.querySelector('[aria-label="正文输入夹具"]')
const row = id => host.querySelector(`[data-file-id="${id}"]`)
const menu = () => host.querySelector('.file-context-menu')
const confirmation = () => host.querySelector('.consumer-confirm-modal')
const collapsed = () => Boolean(host.querySelector('.workspace-sidebar.collapsed'))
const writes = () => api.mock.calls.filter(([, options]) => /^(POST|PUT|PATCH|DELETE)$/.test(options?.method || 'GET'))
const button = (scope, label) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === label)

async function click(node) {
  expect(node).toBeTruthy()
  await act(async () => {
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    node.click()
    await flush()
  })
}
async function context(id) {
  const title = row(id)?.querySelector('.title')
  expect(title).toBeTruthy()
  await act(async () => {
    title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }))
    title.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 2 }))
    title.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 335 }))
    await flush()
  })
}
async function edit(text) {
  const input = field()
  expect(input?.dataset.documentId).toBe('context-a')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
  await until(() => expect(readEditorDraft('context-a')?.content).toBe(text))
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 704 })
  localStorage.clear()
  for (const id of ['context-a', 'context-b']) { editorQuit.forget(id); removeEditorDraft(id) }
  fixture.notes = {
    'context-a': { id: 'context-a', title: '当前笔记.md', content: '原文 A', parent_id: '', is_folder: false, is_pinned: true, updated_at: 100 },
    'context-b': { id: 'context-b', title: '第二篇笔记.md', content: '原文 B', parent_id: '', is_folder: false, updated_at: 100 },
  }
  fixture.heldSave = null; fixture.holdSave = false
  api.mockReset(); listAllFiles.mockReset(); listAllFilesWithContent.mockReset()
  const files = () => Object.values(fixture.notes).map(note => ({ ...note }))
  listAllFiles.mockImplementation(async () => files())
  listAllFilesWithContent.mockImplementation(async () => files())
  api.mockImplementation(async (url, options) => {
    if (url === '/api/editor-reference-jobs') return []
    if (url.startsWith('/api/files?page=')) return files()
    const id = url.split('/').pop(), note = fixture.notes[id]
    if (!note) throw new Error('Unexpected context-menu fixture request: ' + url)
    if (options?.method === 'PUT') {
      const request = JSON.parse(options.body)
      const commit = () => {
        fixture.notes[id] = { ...note, content: request.content, updated_at: note.updated_at + 1 }
        return { ...fixture.notes[id] }
      }
      if (fixture.holdSave) return new Promise(resolve => { fixture.heldSave = () => resolve(commit()) })
      return commit()
    }
    if (options?.method && options.method !== 'GET') throw new Error('Unexpected context-menu fixture mutation')
    return { ...note }
  })
  await import('./components/Editor/Editor')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<UiThemeProvider><DndProvider backend={TestBackend}><App /></DndProvider></UiThemeProvider>))
  await until(() => expect(field()?.dataset.documentId).toBe('context-a'))
  expect(collapsed()).toBe(true)
  await click(host.querySelector('[aria-label="展开侧边栏"]'))
  await until(() => { expect(row('context-a')).toBeTruthy(); expect(row('context-b')).toBeTruthy() })
  expect(collapsed()).toBe(false)
  expect(localStorage.getItem('sidebarCollapsedV4')).toBe('false')
})

afterEach(async () => {
  await act(async () => { fixture.heldSave?.(); await flush() })
  await act(async () => root.unmount()); host.remove()
  for (const id of ['context-a', 'context-b']) { editorQuit.forget(id); removeEditorDraft(id) }
  localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor)
  else delete window.innerWidth
})

describe('App context-menu selection at the actual narrow viewport', () => {
  it('keeps the real menu mounted when right-click selects another note and opens its original rename action', async () => {
    await context('context-b')
    await until(() => expect(field()?.dataset.documentId).toBe('context-b'))
    expect(collapsed()).toBe(false)
    expect(localStorage.getItem('sidebarCollapsedV4')).toBe('false')
    expect(row('context-b')?.getAttribute('aria-selected')).toBe('true')
    expect(menu()?.getAttribute('aria-label')).toBe('第二篇笔记.md 操作')
    expect([...menu().querySelectorAll('.menu-item-label')].map(node => node.textContent))
      .toEqual(['置顶', '重命名', '另存为', '移到回收站'])
    await click([...menu().querySelectorAll('button')].find(node => node.querySelector('.menu-item-label')?.textContent === '重命名'))
    await until(() => expect(host.querySelector('.name-dialog-input')?.value).toBe('第二篇笔记'))
    await click(button(host.querySelector('.name-dialog'), '取消'))
    expect(host.querySelector('.name-dialog')).toBeNull()
    expect(field().dataset.documentId).toBe('context-b')
    expect(writes()).toHaveLength(0)
  })

  it('retains ordinary narrow-window collapse for a left-click selection', async () => {
    await click(row('context-b').querySelector('.title'))
    await until(() => expect(field()?.dataset.documentId).toBe('context-b'))
    expect(collapsed()).toBe(true)
    expect(host.querySelector('.file-list')).toBeNull()
    expect(localStorage.getItem('sidebarCollapsedV4')).toBe('true')
    expect(writes()).toHaveLength(0)
  })

  it('keeps the same-note shortcut and its unsaved draft when opening that note menu', async () => {
    await edit('当前笔记未保存正文')
    await context('context-a')
    expect(confirmation()).toBeNull()
    expect(field().dataset.documentId).toBe('context-a')
    expect(field().value).toBe('当前笔记未保存正文')
    expect(menu()?.getAttribute('aria-label')).toBe('当前笔记.md 操作')
    expect(collapsed()).toBe(false)
    expect(writes()).toHaveLength(0)
  })

  it('runs the original unsaved guard before selecting the context target and preserves the draft on cancel', async () => {
    await edit('取消选择时保留的正文')
    await context('context-b')
    expect(confirmation()?.textContent).toContain('当前笔记未保存')
    expect(field().dataset.documentId).toBe('context-a')
    expect(row('context-a')?.getAttribute('aria-selected')).toBe('true')
    expect(row('context-b')?.getAttribute('aria-selected')).toBe('false')
    await click(button(confirmation(), '取消'))
    expect(confirmation()).toBeNull()
    expect(field().dataset.documentId).toBe('context-a')
    expect(field().value).toBe('取消选择时保留的正文')
    expect(readEditorDraft('context-a')?.content).toBe('取消选择时保留的正文')
    expect(fixture.notes['context-a'].content).toBe('原文 A')
    expect(collapsed()).toBe(false)
    expect(writes()).toHaveLength(0)
  })

  it('keeps the sidebar after explicit do-not-save without saving or resurrecting the discarded draft', async () => {
    await edit('明确放弃的正文')
    await context('context-b')
    expect(confirmation()?.textContent).toContain('当前笔记未保存')
    await click(button(confirmation(), '不保存'))
    await until(() => expect(field()?.dataset.documentId).toBe('context-b'))
    expect(collapsed()).toBe(false)
    expect(readEditorDraft('context-a')).toBeNull()
    expect(fixture.notes['context-a'].content).toBe('原文 A')
    expect(writes()).toHaveLength(0)
    await context('context-a')
    await until(() => expect(field()?.dataset.documentId).toBe('context-a'))
    expect(field().value).toBe('原文 A')
    expect(confirmation()).toBeNull()
  })

  it('waits for the original save receipt before selecting the context target with its sidebar preserved', async () => {
    await edit('先保存再选择的正文')
    fixture.holdSave = true
    await context('context-b')
    await click(button(confirmation(), '保存'))
    await until(() => expect(fixture.heldSave).toBeTypeOf('function'))
    expect(field().dataset.documentId).toBe('context-a')
    expect(confirmation()).not.toBeNull()
    expect([...confirmation().querySelectorAll('button')].every(node => node.disabled)).toBe(true)
    expect(fixture.notes['context-a'].content).toBe('原文 A')
    expect(writes()).toHaveLength(1)
    const finish = fixture.heldSave; fixture.heldSave = null
    await act(async () => { finish(); await flush() })
    await until(() => expect(field()?.dataset.documentId).toBe('context-b'))
    expect(confirmation()).toBeNull()
    expect(collapsed()).toBe(false)
    expect(localStorage.getItem('sidebarCollapsedV4')).toBe('false')
    expect(fixture.notes['context-a'].content).toBe('先保存再选择的正文')
    expect(fixture.notes['context-b'].content).toBe('原文 B')
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe('/api/files/context-a')
    expect(readEditorDraft('context-a')).toBeNull()
  })
})
