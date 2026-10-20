import React, { act, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { DndProvider } from 'react-dnd'
import { TestBackend } from 'react-dnd-test-backend'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import FileList from './FileList'
import { api, listAllFiles } from '~/services/api'
import { applyShortcutBindings, getShortcutSnapshot, reloadShortcutPreferences } from '../services/localShortcuts'
vi.mock('~/services/api', () => ({ api: vi.fn(), listAllFiles: vi.fn() }))
vi.mock('./TemplateSelector', () => ({ default: ({ onClose, parentId }) => <div role="dialog" aria-modal="true" data-new-template={parentId}><button onClick={onClose}>关闭模板</button></div> }))
let host, root, beforeNew, props
const tick = async () => { await act(async () => vi.dynamicImportSettled()); await act(async () => new Promise(resolve => setTimeout(resolve, 10))) }
async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<DndProvider backend={TestBackend}><Suspense fallback={null}><FileList {...props} /></Suspense></DndProvider>))
  await tick()
}
async function key(key, flags = {}, target = window) {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...flags })
  Object.defineProperty(event, 'getModifierState', { value: name => name === 'AltGraph' ? Boolean(flags.altGraph) : false })
  await act(async () => target.dispatchEvent(event)); await tick()
  return event
}
async function remap(changes) {
  await act(async () => {
    const state = getShortcutSnapshot()
    expect(applyShortcutBindings({ ...state.bindings, ...changes }, { expectedRevision: state.revision }).ok).toBe(true)
  })
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); reloadShortcutPreferences()
  api.mockReset().mockResolvedValue([])
  listAllFiles.mockReset().mockResolvedValue([
    { id: 'folder-a', title: '目录 A', is_folder: true, parent_id: '' },
    { id: 'folder-b', title: '目录 B', is_folder: true, parent_id: '' },
  ])
  beforeNew = vi.fn().mockResolvedValue(true)
  props = { selectedId: 'folder-a', onSelect: vi.fn(), onBeforeNew: beforeNew }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  localStorage.clear(); reloadShortcutPreferences(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
it('uses the remapped new-note entry exactly once and honours its cancellation', async () => {
  beforeNew.mockResolvedValue(false)
  await remap({ newNote: 'Mod+Alt+J' })
  await key('n'); expect(beforeNew).not.toHaveBeenCalled()
  await key('j', { altKey: true }); expect(beforeNew).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-new-template]')).toBeNull()
  expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
it('uses the current folder and current guard after a parent render', async () => {
  const currentGuard = vi.fn().mockResolvedValue(true)
  await render({ selectedId: 'folder-b', onBeforeNew: currentGuard })
  await key('n')
  expect(beforeNew).not.toHaveBeenCalled(); expect(currentGuard).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-new-template]')?.dataset.newTemplate).toBe('folder-b')
})
it('does not create notes for input composition, long press or an already handled key', async () => {
  await key('n', { isComposing: true }); await key('n', { keyCode: 229 }); await key('n', { repeat: true })
  const handled = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true })
  handled.preventDefault(); await act(async () => window.dispatchEvent(handled)); await tick()
  expect(beforeNew).not.toHaveBeenCalled(); expect(host.querySelector('[data-new-template]')).toBeNull()
})
it('does not create while a shortcut recorder or another modal owns input', async () => {
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
  const field = document.createElement('input'); field.setAttribute('data-shortcut-recorder', 'true'); modal.append(field); document.body.append(modal)
  try { await key('n', {}, field); expect(beforeNew).not.toHaveBeenCalled() } finally { modal.remove() }
})

// Populate the real component's history through its existing naming form. The
// API is isolated, but creation, history dispatch, reload and UI are production.
async function createFolderHistory() {
  const original = await listAllFiles()
  let rows = [...original]
  const created = { id: 'history-folder', title: '新建文件夹', content: '', is_folder: true, parent_id: 'folder-a' }
  listAllFiles.mockImplementation(async () => rows.map(item => ({ ...item })))
  api.mockImplementation(async (path, options) => {
    if (path === '/api/files' && options?.method === 'POST') {
      rows = [...rows, created]
      return { ...created }
    }
    if (path === `/api/files/${created.id}` && options?.method === 'DELETE') {
      rows = rows.filter(item => item.id !== created.id)
      return { ok: true }
    }
    if (path === `/api/files/${created.id}/restore` && options?.method === 'POST') {
      rows = [...rows, created]
      return { ...created }
    }
    throw new Error(`Unexpected isolated history request: ${path}`)
  })
  await key('N', { shiftKey: true })
  const form = host.querySelector('form.name-dialog')
  expect(form).toBeTruthy()
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await tick()
  expect(api.mock.calls.filter(([path, options]) => path === '/api/files' && options?.method === 'POST')).toHaveLength(1)
  expect(host.querySelector('[data-file-id="history-folder"]')).toBeTruthy()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  api.mockClear()
  const tree = host.querySelector('[role="tree"]')
  expect(tree).toBeTruthy()
  tree.focus()
  return { tree, created, rows: () => rows }
}

it('gives remapped Ctrl Alt Z to new-note exactly once without undoing real list history', async () => {
  const history = await createFolderHistory()
  await remap({ newNote: 'Mod+Alt+Z' })
  beforeNew.mockClear()
  await key('z', { altKey: true }, history.tree)
  expect(beforeNew).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-new-template]')).toBeTruthy()
  expect(api).not.toHaveBeenCalled()
  expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
})

it('does not undo list history after a document listener has consumed the same event', async () => {
  const history = await createFolderHistory()
  const consume = vi.fn(event => event.preventDefault())
  document.addEventListener('keydown', consume)
  try { await key('z', {}, history.tree) } finally { document.removeEventListener('keydown', consume) }
  expect(consume).toHaveBeenCalledTimes(1)
  expect(api).not.toHaveBeenCalled()
  expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
})

it.each([
  { isComposing: true }, { keyCode: 229 }, { repeat: true }, { altGraph: true }, { metaKey: true },
])('does not undo real list history for unsupported or composing modifiers: %j', async flags => {
  const history = await createFolderHistory()
  expect((await key('z', flags, history.tree)).defaultPrevented).toBe(false)
  expect(api).not.toHaveBeenCalled()
  expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
})

it('leaves real list history untouched while a modal button owns the foreground', async () => {
  const history = await createFolderHistory()
  await key('N', { shiftKey: true }, history.tree)
  const modal = host.querySelector('form.name-dialog')
  expect(modal).toBeTruthy()
  const cancel = [...modal.querySelectorAll('button')].find(button => button.textContent === '取消')
  expect(cancel).toBeTruthy()
  cancel.focus()
  await key('z', {}, cancel)
  expect(api).not.toHaveBeenCalled()
  expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
  expect(host.querySelector('form.name-dialog')).toBe(modal)
})

it.each(['input', 'textarea', 'select', 'contenteditable'])('preserves %s ownership instead of undoing list history', async tag => {
  const history = await createFolderHistory()
  const field = document.createElement(tag === 'contenteditable' ? 'div' : tag)
  if (tag === 'contenteditable') { field.setAttribute('contenteditable', 'true'); field.tabIndex = 0 }
  document.body.append(field)
  field.focus()
  try {
    expect((await key('z', {}, field)).defaultPrevented).toBe(false)
    expect(api).not.toHaveBeenCalled()
    expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
  } finally { field.remove() }
})

it.each([
  ['Ctrl', {}], ['Meta', { ctrlKey: false, metaKey: true }],
])('keeps real %s Z undo and Shift Z redo working exactly once', async (_label, flags) => {
  const history = await createFolderHistory()
  expect((await key('z', flags, history.tree)).defaultPrevented).toBe(true)
  expect(api.mock.calls).toEqual([[`/api/files/${history.created.id}`, { method: 'DELETE' }]])
  expect(history.rows().some(item => item.id === history.created.id)).toBe(false)
  expect((await key('Z', { ...flags, shiftKey: true }, history.tree)).defaultPrevented).toBe(true)
  expect(api.mock.calls).toEqual([
    [`/api/files/${history.created.id}`, { method: 'DELETE' }],
    [`/api/files/${history.created.id}/restore`, { method: 'POST' }],
  ])
  expect(history.rows().some(item => item.id === history.created.id)).toBe(true)
})
