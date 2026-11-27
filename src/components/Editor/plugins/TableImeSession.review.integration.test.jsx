// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, getNearestEditorFromDOMNode } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import Editor from '../Editor'
import { readDocumentSession } from './DocumentSessionPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

// These cases isolate session persistence after the actual Editor rejects an
// IME start. No native default DOM edit is simulated here: the exact same
// operations run against fc5 and the current range-suspension repair.
let host, reactRoot, editor, props, expectedSession, errors
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const cells = () => [...host.querySelectorAll('td,th')]
const snapshot = () => editor.getEditorState().toJSON()
const windowError = event => errors.push(event.error || new Error(event.message))
function content(marker) {
  const fixture = createEditor({ nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } })
  fixture.update(() => {
    const table = $createTableNode()
    for (let row = 1; row <= 3; row++) table.append($createTableRowNode().append(...[1, 2, 3].map(column =>
      $createTableCellNode().append($createParagraphNode().append($createTextNode(`R${row}C${column}`))))))
    $getRoot().append($createParagraphNode().append($createTextNode(marker)), table)
  }, { discrete: true })
  return JSON.stringify(fixture.getEditorState())
}
async function pagehide() {
  await act(async () => window.dispatchEvent(new Event('pagehide'))); await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); errors = []
  window.addEventListener('error', windowError)
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  props = { documentId: 'table-ime-session-a', initialContent: content('Session A'), onChange: vi.fn(), readOnly: false }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
  expect(cells()).toHaveLength(9)
  const text = cells()[2].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(document.getSelection().toString()).toBe('R1C3')
  await pagehide()
  expectedSession = readDocumentSession(props.documentId)
  expect(expectedSession.selection).toEqual({
    anchor: { blockIndex: 1, offset: 0, path: [0, 2, 0, 0], pointType: 'text', nodeOffset: 0 },
    focus: { blockIndex: 1, offset: 0, path: [0, 2, 0, 0], pointType: 'text', nodeOffset: 4 },
  })
  expect(errors).toEqual([])
})
afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount())
  host.remove(); window.removeEventListener('error', windowError)
  vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function bulk() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))); await settle()
  const start = cells()[3], end = cells()[4]
  await act(async () => {
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    end.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerType: 'mouse', pointerId: 1 }))
    end.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    end.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    end.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(document.getSelection().toString()).toBe('R1C3')
}
async function refusedImeStart() {
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '表' })))
  await settle()
  expect(document.activeElement?.closest('.table-selection-modebar')).toBeTruthy()
  expect(editor.isComposing()).toBe(false)
}

test('ordinary focus on the actual bulk button retains the saved table cursor on pagehide', async () => {
  await bulk(); const before = snapshot()
  const copy = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '复制')
  await act(async () => copy.focus()); await settle(); await pagehide()
  expect(readDocumentSession('table-ime-session-a')).toEqual(expectedSession)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('refused IME does not erase the previous valid table cursor when the page hides', async () => {
  await bulk(); const before = snapshot()
  await refusedImeStart(); await pagehide()
  const actual = readDocumentSession('table-ime-session-a')
  console.info('table session after refused IME/pagehide', JSON.stringify({ expected: expectedSession, actual }))
  expect(actual).toEqual(expectedSession)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('switching documents after refused IME preserves the previous document table cursor', async () => {
  await bulk(); const before = snapshot()
  await refusedImeStart()
  expect(snapshot()).toEqual(before)
  props = { ...props, documentId: 'table-ime-session-b', initialContent: content('Session B') }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('Session B')
  const actual = readDocumentSession('table-ime-session-a')
  console.info('table session after refused IME/document switch', JSON.stringify({ expected: expectedSession, actual }))
  expect(actual).toEqual(expectedSession)
  expect(readDocumentSession('table-ime-session-b')).toBeNull()
  expect(errors).toEqual([])
})

test('bulk background changes away from the suspended endpoint retain its saved table path', async () => {
  await bulk(); await refusedImeStart()
  const yellow = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '浅黄')
  await act(async () => { yellow.focus(); yellow.click() }); await settle()
  const table = snapshot().root.children[1]
  expect(table.children[1].children.slice(0, 2).map(cell => cell.backgroundColor)).toEqual(['#fff3cd', '#fff3cd'])
  expect(cells()[2].textContent).toBe('R1C3')
  const before = snapshot()
  await pagehide()
  expect(readDocumentSession('table-ime-session-a')).toEqual(expectedSession)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('clearing the actual suspended endpoint cannot persist its former text path', async () => {
  await bulk(); await refusedImeStart()
  const source = cells()[2]
  await act(async () => {
    source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    source.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 1 个单元格')
  const clear = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '清空')
  await act(async () => { clear.focus(); clear.click() }); await settle()
  expect(cells()[2].textContent).toBe('')
  const before = snapshot()
  await pagehide()
  expect(readDocumentSession('table-ime-session-a').selection).not.toEqual(expectedSession.selection)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a new real paragraph selection supersedes the suspended table position in persisted session', async () => {
  await bulk(); await refusedImeStart()
  const before = snapshot(), paragraph = editor.getRootElement().firstElementChild
  const text = paragraph.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, 7)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(document.getSelection().toString()).toBe('Session')
  await pagehide()
  expect(readDocumentSession('table-ime-session-a').selection).toEqual({ anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 0, offset: 7 } })
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
