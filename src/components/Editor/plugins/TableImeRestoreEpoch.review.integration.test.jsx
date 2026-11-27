// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, createEditor, getNearestEditorFromDOMNode } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import Editor from '../Editor'
import { captureDocumentSelectionSnapshot, writeDocumentSession } from './DocumentSessionPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

// Only scheduling is controlled: these are the actual callbacks requested by
// the real Editor/DocumentSessionPlugin. No callback or restoration is replaced,
// no editor state is injected after mounting, and no browser text edit is modeled.
let host, reactRoot, editor, props, frames, nextFrame, errors
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const cells = () => [...host.querySelectorAll('td,th')]
const snapshot = () => editor.getEditorState().toJSON()
const selectionSnapshot = () => editor.getEditorState().read(() => captureDocumentSelectionSnapshot())
const windowError = event => errors.push(event.error || new Error(event.message))
const savedSelection = {
  anchor: { blockIndex: 1, offset: 0, path: [0, 2, 0, 0], pointType: 'text', nodeOffset: 0 },
  focus: { blockIndex: 1, offset: 0, path: [0, 2, 0, 0], pointType: 'text', nodeOffset: 4 },
}
function content() {
  const fixture = createEditor({ nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } })
  fixture.update(() => {
    const table = $createTableNode()
    for (let row = 1; row <= 3; row++) table.append($createTableRowNode().append(...[1, 2, 3].map(column =>
      $createTableCellNode().append($createParagraphNode().append($createTextNode(`R${row}C${column}`))))))
    $getRoot().append($createParagraphNode().append($createTextNode('Restore document')), table)
  }, { discrete: true })
  return JSON.stringify(fixture.getEditorState())
}
async function nextAnimationFrame() {
  const current = [...frames.entries()]
  expect(current.length).toBeGreaterThan(0)
  for (const [id] of current) frames.delete(id)
  await act(async () => { for (const [, callback] of current) callback(performance.now()) }); await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); errors = []; frames = new Map(); nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  window.addEventListener('error', windowError)
  writeDocumentSession('pending-table-ime-session', { scrollTop: 64, selection: savedSelection })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  props = { documentId: 'pending-table-ime-session', initialContent: content(), readOnly: true, onChange: vi.fn() }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
  expect(cells()).toHaveLength(9)
  await nextAnimationFrame(); await nextAnimationFrame()
  expect(editor.isEditable()).toBe(false)
  props = { ...props, readOnly: false }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  expect(editor.isEditable()).toBe(true)
  // Run the first of the existing two frames. Its real second callback is
  // now pending while the user's subsequent actions take ownership.
  await nextAnimationFrame()
  expect(frames.size).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); window.removeEventListener('error', windowError)
  vi.unstubAllGlobals(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function selectText(element, end) {
  const text = element.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, end)
    document.dispatchEvent(new Event('selectionchange'))
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
  }); await settle()
}
async function blockIme() {
  await selectText(cells()[2], 4)
  expect(document.getSelection().toString()).toBe('R1C3')
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))); await settle()
  await act(async () => {
    cells()[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[4].dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerType: 'mouse', pointerId: 1 }))
    cells()[4].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[4].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    cells()[4].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '表' }))); await settle()
  expect(editor.getEditorState().read(() => $getSelection())).toBeNull()
  expect(document.getSelection().rangeCount).toBe(0)
  expect(document.activeElement?.closest('.table-selection-modebar')).toBeTruthy()
}

test('ordinary return to editing still executes the original two-frame table cursor restoration', async () => {
  const before = snapshot()
  await nextAnimationFrame()
  expect(selectionSnapshot()).toEqual(savedSelection)
  expect(document.getSelection().toString()).toBe('R1C3')
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('an older pending session frame cannot reattach the writable range after bulk IME isolation', async () => {
  const before = snapshot()
  await blockIme()
  await nextAnimationFrame()
  expect.soft(editor.getEditorState().read(() => $getSelection())).toBeNull()
  expect.soft(document.getSelection().rangeCount).toBe(0)
  expect.soft(document.activeElement?.closest('.table-selection-modebar')).toBeTruthy()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('an older session frame cannot replace a new cursor after entering and finishing bulk mode', async () => {
  const before = snapshot()
  await blockIme()
  const done = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
  await act(async () => { done.focus(); done.click() }); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  await selectText(editor.getRootElement().firstElementChild, 7)
  expect(document.getSelection().toString()).toBe('Restore')
  const selected = selectionSnapshot()
  await nextAnimationFrame()
  expect(selectionSnapshot()).toEqual(selected)
  expect(document.getSelection().toString()).toBe('Restore')
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
