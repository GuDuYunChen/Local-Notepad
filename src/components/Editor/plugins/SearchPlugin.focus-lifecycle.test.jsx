import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { reloadShortcutPreferences, SHORTCUT_STORAGE_KEY } from '~/services/localShortcuts'
import SearchPlugin from './SearchPlugin'

let host, root, editor, errors, frames, sequence
function Capture() {
  const [instance] = useLexicalComposerContext()
  useEffect(() => { editor = instance }, [instance])
  return null
}
function Harness({ documentId = 'A' }) {
  return <LexicalComposer key={documentId} initialConfig={{ namespace: 'search-focus-lifecycle', onError: error => errors.push(error) }}>
    <div className="editor-shell">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <Capture />
      <SearchPlugin documentId={documentId} />
    </div>
  </LexicalComposer>
}
const query = () => host.querySelector('input[aria-label="查找内容"]')
const replacement = () => host.querySelector('input[aria-label="替换内容"]')
const body = () => JSON.stringify(editor.getEditorState().toJSON())
const flush = async () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
function frame() {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback()
}
async function tick() { await act(async () => frame()); await flush() }
function shortcut(key) {
  editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
}
async function mount(documentId = 'A') {
  await act(async () => root.render(<Harness documentId={documentId} />))
  await act(async () => editor.update(() => {
    $getRoot().clear().append($createParagraphNode().append($createTextNode('alpha alpha body')))
  }, { discrete: true }))
  await act(async () => editor.getRootElement().focus())
  await tick()
}
async function open(key = 'f') { await act(async () => shortcut(key)); await flush() }
async function setQuery(value) {
  await act(async () => {
    const node = query()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; frames = new Map(); sequence = 0
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++sequence; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await mount()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); frames.clear()
  localStorage.removeItem(SHORTCUT_STORAGE_KEY); reloadShortcutPreferences()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

for (const [label, trigger, hasReplacement] of [
  ['Ctrl+F', () => shortcut('f'), false],
  ['Ctrl+H', () => shortcut('h'), true],
  ['current-document command', () => window.dispatchEvent(new CustomEvent('editor:open-search', { detail: { documentId: 'A', replace: true } })), true],
]) test(`${label} focuses the query when a frame precedes the pending panel commit`, async () => {
  const before = body()
  // Model a renderer frame running before React commits the requested panel.
  // Focus must still be delivered once the real input is mounted; no second
  // command, click or extra retry is sent to compensate for a missed request.
  await act(async () => {
    trigger()
    expect(query()).toBeNull()
    frame()
    expect(query()).toBeNull()
    await Promise.resolve()
  })
  expect(query()).toBeTruthy()
  expect(Boolean(replacement())).toBe(hasReplacement)
  await tick()
  expect(document.activeElement).toBe(query())
  expect(body()).toBe(before)
  expect(errors).toEqual([])
})

test('a repeated find request refocuses and selects the existing query', async () => {
  await open('h'); await tick(); await setQuery('alpha'); await tick()
  replacement().focus()
  await open('f'); await tick()
  expect(replacement()).toBeNull()
  expect(document.activeElement).toBe(query())
  expect(query().value).toBe('alpha')
  expect([query().selectionStart, query().selectionEnd]).toEqual([0, 5])
  editor.getRootElement().focus()
  await open('f'); await tick()
  expect(document.activeElement).toBe(query())
  expect([query().selectionStart, query().selectionEnd]).toEqual([0, 5])
  expect(errors).toEqual([])
})

test('closing the panel cancels its pending focus without reopening it', async () => {
  await open('h')
  const before = body()
  await act(async () => host.querySelector('[aria-label="关闭文内查找"]').click())
  await tick()
  expect(query()).toBeNull()
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(body()).toBe(before)
  expect(errors).toEqual([])
})

test('switching documents cancels the old panel focus request', async () => {
  await open('h')
  await mount('B'); await tick()
  expect(query()).toBeNull()
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(errors).toEqual([])
})

for (const otherEditor of [false, true]) test(`pending search focus yields to ${otherEditor ? 'another editable document' : 'an external input'}`, async () => {
  await open('h')
  const field = document.createElement(otherEditor ? 'div' : 'input')
  if (otherEditor) { field.contentEditable = 'true'; field.tabIndex = 0 }
  document.body.append(field)
  try {
    field.focus()
    expect(document.activeElement).toBe(field)
    await tick()
    expect(document.activeElement).toBe(field)
    expect(query()).toBeTruthy()
    expect(errors).toEqual([])
  } finally { field.remove() }
})

test('a newly opened modal owns focus before a queued search frame runs', async () => {
  await open('h')
  const modal = document.createElement('section')
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
  const action = document.createElement('button'); action.textContent = '取消当前操作'
  modal.append(action); document.body.append(modal)
  try {
    action.focus()
    await tick()
    expect(document.activeElement).toBe(action)
    expect(query()).toBeTruthy()
    expect(errors).toEqual([])
  } finally { modal.remove() }
})
