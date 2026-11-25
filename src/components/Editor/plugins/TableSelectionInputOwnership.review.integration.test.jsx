import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, CAN_USE_BEFORE_INPUT } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import { isTableSelectionActive } from '../utils/tableEvents'

// happy-dom lacks only this capability probe. Enable the same beforeinput
// listener used by Chromium; each input event below supplies the actual DOM
// range. No helper performs text edits or dispatches mutation commands.
const { installedTargetRanges } = vi.hoisted(() => {
  const missing = !window.InputEvent.prototype.getTargetRanges
  if (missing) Object.defineProperty(window.InputEvent.prototype, 'getTargetRanges', { configurable: true, value() { return [] } })
  return { installedTargetRanges: missing }
})
afterAll(() => { if (installedTargetRanges) delete window.InputEvent.prototype.getTargetRanges })

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{ namespace: 'table-input-owner', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) {
      table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    }
    $getRoot().append(table)
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture /><TableSelectionPlugin documentId="input-owner-note" />
    </div>
  </LexicalComposer>
}
const cells = () => [...host.querySelectorAll('td')]
const values = () => editor.getEditorState().read(() => $getRoot().getFirstChild().getChildren().map(row => row.getChildren().map(cell => cell.getTextContent())))
const selectionFacts = () => editor.getEditorState().read(() => {
  const selection = $getSelection()
  return $isRangeSelection(selection) ? { type: 'range', key: selection.anchor.key, anchor: selection.anchor.offset, focus: selection.focus.offset, text: selection.getTextContent() } : { type: selection?.constructor.name || 'null' }
})

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness />)); await settle()
  // Set up a normal user text selection through the DOM selection API and its
  // selectionchange event. The editor, not the test, constructs RangeSelection.
  const text = cells()[0].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await settle()
  expect(selectionFacts()).toMatchObject({ type: 'range', anchor: 0, focus: 3, text: 'OLD' })
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

async function selectOtherCells() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true })))
  await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
}

async function input(kind) {
  const facts = { before: selectionFacts() }, root = editor.getRootElement()
  const cut = () => {
    const data = new DataTransfer()
    const event = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data })
    root.dispatchEvent(event)
    facts.cutPrevented = event.defaultPrevented
    facts.clipboardText = data.getData('text/plain')
  }
  await act(async () => {
    if (kind === 'typing') {
      expect(CAN_USE_BEFORE_INPUT).toBe(true)
      const range = document.getSelection().getRangeAt(0).cloneRange()
      const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '新' })
      Object.defineProperty(event, 'getTargetRanges', { value: () => [range] })
      root.dispatchEvent(event)
      facts.prevented = event.defaultPrevented
    } else if (kind === 'context-menu cut') {
      cut()
    } else {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: kind === 'cut' ? 'x' : kind, ctrlKey: kind === 'cut' })
      root.dispatchEvent(event)
      facts.prevented = event.defaultPrevented
      // A real browser dispatches cut if Ctrl+X's default was not prevented.
      if (kind === 'cut' && !event.defaultPrevented) cut()
    }
  })
  await settle()
  return { ...facts, after: selectionFacts(), values: values() }
}

test.each(['Backspace', 'Delete', 'typing', 'cut', 'context-menu cut'])('positive control: ordinary %s events edit the real selected text through RichTextPlugin', async kind => {
  const facts = await input(kind)
  expect(values()[0][0], JSON.stringify(facts)).toBe(kind === 'typing' ? '新-CELL' : '-CELL')
  if (kind.endsWith('cut')) expect(facts.clipboardText).toBe('OLD')
  expect(errors).toEqual([])
})

test.each(['Backspace', 'Delete', 'typing', 'cut', 'context-menu cut'])('custom table selection cannot let %s edit the old unselected cell', async kind => {
  await selectOtherCells()
  const facts = await input(kind)
  expect(values()[0][0], JSON.stringify(facts)).toBe('OLD-CELL')
  expect(errors).toEqual([])
})

async function composition(type, data = '') {
  // compositionstart/end are not cancellable browser events. Propagation must
  // be owned before Lexical handles them; no native DOM text edit is simulated.
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent(type, { bubbles: true, data })))
  await settle()
}


test.each([
  ['b', false], ['i', false], ['u', false], ['e', false], ['x', true],
])('bulk selection blocks text-format shortcut Ctrl+%s without touching retained text', async (key, shiftKey) => {
  await selectOtherCells()
  const before = editor.getEditorState().toJSON()
  expect(isTableSelectionActive(editor)).toBe(true)
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: true, shiftKey })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  expect(event.defaultPrevented).toBe(true)
  expect(editor.getEditorState().toJSON()).toEqual(before)
  expect(values()[0][0]).toBe('OLD-CELL')
  expect(errors).toEqual([])
})

test('toolbar bulk-selection guard is scoped to the owning editor container', async () => {
  const other = document.createElement('div')
  other.className = 'editor-container'
  const otherRoot = document.createElement('div')
  otherRoot.setAttribute('data-lexical-editor', 'true')
  other.append(otherRoot, Object.assign(document.createElement('div'), { className: 'table-selection-modebar' }))
  document.body.append(other)
  expect(isTableSelectionActive(editor)).toBe(false)
  await selectOtherCells()
  expect(isTableSelectionActive(editor)).toBe(true)
  other.remove()
})

test('positive control: compositionstart alone replaces a selected range before any beforeinput event', async () => {
  await composition('compositionstart')
  expect(editor.isComposing()).toBe(true)
  expect(values()[0][0]).not.toContain('OLD')
  expect(values()[0][0].endsWith('-CELL')).toBe(true)
  await composition('compositionupdate')
  await composition('compositionend')
  expect(editor.isComposing()).toBe(false)
  expect(errors).toEqual([])
})

test('custom table selection blocks compositionstart before it can replace the old text range', async () => {
  await selectOtherCells()
  const before = editor.getEditorState().toJSON()
  await composition('compositionstart')
  expect.soft(editor.getEditorState().toJSON()).toEqual(before)
  expect.soft(editor.isComposing()).toBe(false)
  expect(document.activeElement.closest('.table-selection-modebar')).toBeTruthy()
  expect(document.activeElement.tagName).toBe('BUTTON')
  await composition('compositionupdate')
  await composition('compositionend')
  expect(editor.getEditorState().toJSON()).toEqual(before)
  expect(editor.isComposing()).toBe(false)
  expect(errors).toEqual([])
})

test('finishing custom selection restores ordinary text input at the visible text selection', async () => {
  await selectOtherCells()
  const done = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent.trim() === '完成')
  await act(async () => { done.focus(); done.click() }); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(document.activeElement).toBe(editor.getRootElement())
  const facts = await input('typing')
  expect(values()[0][0], JSON.stringify(facts)).toBe('新-CELL')
  expect(values()[1]).toEqual(['selected-C', 'selected-D'])
  expect(errors).toEqual([])
})

test('finishing custom selection restores a normal IME composition and commit', async () => {
  await selectOtherCells()
  const done = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent.trim() === '完成')
  await act(async () => { done.focus(); done.click() }); await settle()
  const text = cells()[0].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  await composition('compositionstart')
  expect(editor.isComposing()).toBe(true)
  await composition('compositionupdate', '新')
  // Composition events alone do not carry a DOM text edit in happy-dom. Use
  // the standard commit beforeinput that Lexical handles in controlled mode;
  // once prevented, the browser does not perform a second native input edit.
  const range = document.getSelection().getRangeAt(0).cloneRange()
  const commit = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromComposition', data: '新', isComposing: false })
  Object.defineProperty(commit, 'getTargetRanges', { value: () => [range] })
  await act(async () => editor.getRootElement().dispatchEvent(commit)); await settle()
  expect(commit.defaultPrevented).toBe(true)
  await composition('compositionend', '新')
  expect(values()).toEqual([['新', 'other'], ['selected-C', 'selected-D']])
  expect(editor.isComposing()).toBe(false)
  expect(errors).toEqual([])
})

test.each([{ shiftKey: false, label: '复制' }, { shiftKey: true, label: '完成' }])('Tab shift=$shiftKey moves from the selected table to $label without editing rows', async ({ shiftKey, label }) => {
  await selectOtherCells()
  const before = editor.getEditorState().toJSON()
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  expect(event.defaultPrevented).toBe(true)
  expect(document.activeElement.closest('.table-selection-modebar')).toBeTruthy()
  expect(document.activeElement.textContent.trim()).toBe(label)
  expect(editor.getEditorState().toJSON()).toEqual(before)
  expect(errors).toEqual([])
})

test('native context-menu copy and paste use the selected cells through the existing guarded clipboard operations', async () => {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('new-C\tnew-D') }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  await selectOtherCells()
  const before = editor.getEditorState().toJSON()
  const copy = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })
  await act(async () => editor.getRootElement().dispatchEvent(copy)); await settle()
  expect(copy.defaultPrevented).toBe(true)
  expect(clipboard.writeText).toHaveBeenCalledOnce()
  expect(clipboard.writeText).toHaveBeenCalledWith('selected-C\tselected-D')
  expect(editor.getEditorState().toJSON()).toEqual(before)
  const data = new DataTransfer()
  data.setData('text/plain', 'must-not-replace-the-old-range')
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
  await act(async () => editor.getRootElement().dispatchEvent(paste)); await settle()
  expect(paste.defaultPrevented).toBe(true)
  expect(clipboard.readText).toHaveBeenCalledOnce()
  expect(values()).toEqual([['OLD-CELL', 'other'], ['new-C', 'new-D']])
  expect(errors).toEqual([])
})
