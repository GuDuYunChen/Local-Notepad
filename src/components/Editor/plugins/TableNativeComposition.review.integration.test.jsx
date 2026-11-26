// @vitest-environment happy-dom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

// This is a model of the default DOM edit already observed in the genuine
// Windows report, not a browser/IME acceptance test. Chromium 126's
// InputMethodController::SetComposition ignores compositionstart cancellation
// and continues after focus changes; InsertTextDuringCompositionWithEvents
// targets subsequent events at the now-focused element, then TypingCommand
// inserts through the frame's DOM Selection. The actual locked Lexical
// MutationObserver/reconciler below receives that DOM change without mocks.
// Sources: chromium/126.0.6478.234, core/editing/ime/input_method_controller.cc
// (DispatchCompositionStartEvent, SetComposition, InsertTextDuringCompositionWithEvents)
// and core/editing/commands/typing_command.cc (InsertText).
// happy-dom preserves the frame range when a button takes focus. jsdom's
// HTMLOrSVGElement-impl.focus() instead collapses Selection inside the button,
// which would itself remove the unsafe range before this product can do so.
let host, reactRoot, editor, errors
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const cells = () => [...host.querySelectorAll('td')]
const snapshot = () => editor.getEditorState().toJSON()
const textRows = () => editor.getEditorState().read(() => $getRoot().getFirstChild().getChildren().map(row => row.getChildren().map(cell => cell.getTextContent())))
function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{ namespace: 'table-native-composition-model', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['R1C1', 'R1C2', 'R1C3'], ['R2C1', 'R2C2', 'R2C3']]) {
      table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    }
    $getRoot().append(table)
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture /><TableSelectionPlugin documentId="native-composition-model-note" />
    </div>
  </LexicalComposer>
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const text = cells()[2].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(document.getSelection().toString()).toBe('R1C3')
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  if (!rangeGeometry) delete Range.prototype.getBoundingClientRect
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function selectOtherCells() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true })))
  await settle()
  await act(async () => {
    cells()[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[4].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[4].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(document.activeElement).toBe(editor.getRootElement())
}

function facts() {
  const selection = document.getSelection()
  return { rootFocused: document.activeElement === editor.getRootElement(), modebarFocused: !!document.activeElement?.closest('.table-selection-modebar'), rangeCount: selection.rangeCount, rangeText: selection.toString(), sourceDOM: cells()[2].textContent, sourceState: textRows()[0][2] }
}
function modeledBlinkDefault(text) {
  const target = document.activeElement
  target.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }))
  const beforeInput = new InputEvent('beforeinput', { bubbles: true, cancelable: false, inputType: 'insertCompositionText', data: text, isComposing: true })
  target.dispatchEvent(beforeInput)
  const selection = document.getSelection(), root = editor.getRootElement()
  if (!selection.rangeCount) return { edited: false, target: target.tagName, reason: 'no frame DOM selection' }
  const range = selection.getRangeAt(0), node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE || node !== range.endContainer || !root.contains(node) || root.contentEditable === 'false') {
    return { edited: false, target: target.tagName, reason: 'no editable text range in this root' }
  }
  // This explicitly models the observed native characterData edit. It neither
  // updates a Lexical node nor dispatches a Lexical content command.
  const offset = range.startOffset
  node.replaceData(offset, range.endOffset - offset, text)
  selection.setBaseAndExtent(node, offset + text.length, node, offset + text.length)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertCompositionText', data: text, isComposing: true }))
  return { edited: true, target: target.tagName }
}

test.each([false, true])('blocked compositionstart cancelable=%s must revoke the retained DOM range before native default can write', async cancelable => {
  await selectOtherCells()
  const before = snapshot(), trace = { before: facts() }
  const start = new CompositionEvent('compositionstart', { bubbles: true, cancelable, data: '' })
  await act(async () => {
    editor.getRootElement().dispatchEvent(start)
    trace.afterStart = facts()
    trace.defaultEdit = modeledBlinkDefault('表')
    trace.afterDefault = facts()
  }); await settle(); await settle()
  trace.afterObserver = facts()
  console.info('modeled Blink composition sequence', JSON.stringify(trace))
  expect(editor.isComposing()).toBe(false)
  expect.soft(document.getSelection().rangeCount, JSON.stringify(trace)).toBe(0)
  expect.soft(editor.getEditorState().read(() => $getSelection())).toBeNull()
  expect.soft(snapshot(), JSON.stringify(trace)).toEqual(before)
  expect.soft(cells()[2].textContent, JSON.stringify(trace)).toBe('R1C3')
  expect.soft(document.activeElement?.closest('.table-selection-modebar'), JSON.stringify(trace)).toBeTruthy()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  const done = [...host.querySelectorAll('.table-selection-modebar button')].find(button => button.textContent === '完成')
  await act(async () => done.click()); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(document.getSelection().toString()).toBe('R1C3')
  await act(async () => {
    const range = document.getSelection().getRangeAt(0), node = range.startContainer
    node.replaceData(range.startOffset, range.endOffset - range.startOffset, '续')
    document.getSelection().setBaseAndExtent(node, 1, node, 1)
  }); await settle(); await settle()
  expect(textRows()).toEqual([['R1C1', 'R1C2', '续'], ['R2C1', 'R2C2', 'R2C3']])
  expect(errors).toEqual([])
})

test('mechanism control: synchronously removing the frame range prevents the modeled native default', async () => {
  await selectOtherCells()
  const before = snapshot(), root = editor.getRootElement()
  // This extra listener is only the explicit causal control. The two product
  // regressions above install no guard and must exercise the real plugin.
  const clearFrameRange = () => document.getSelection().removeAllRanges()
  root.addEventListener('compositionstart', clearFrameRange, true)
  let defaultEdit
  try {
    await act(async () => {
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' }))
      defaultEdit = modeledBlinkDefault('表')
    }); await settle(); await settle()
    expect(defaultEdit).toMatchObject({ edited: false, target: 'BUTTON', reason: 'no frame DOM selection' })
    expect(snapshot()).toEqual(before)
    expect(cells()[2].textContent).toBe('R1C3')
    expect(document.activeElement?.closest('.table-selection-modebar')).toBeTruthy()
    expect(errors).toEqual([])
  } finally { root.removeEventListener('compositionstart', clearFrameRange, true) }
})

test('ordinary editor still accepts a native characterData edit through the actual MutationObserver', async () => {
  await act(async () => {
    const range = document.getSelection().getRangeAt(0), node = range.startContainer
    node.replaceData(range.startOffset, range.endOffset - range.startOffset, '表')
    document.getSelection().setBaseAndExtent(node, 1, node, 1)
  }); await settle(); await settle()
  expect(textRows()).toEqual([['R1C1', 'R1C2', '表'], ['R2C1', 'R2C2', 'R2C3']])
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(errors).toEqual([])
})
