// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, $isTableSelection, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import TableActionMenuPlugin from './TableActionMenuPlugin'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, errors, hitTarget
const hitTestDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
// One task delivers jsdom's native asynchronous selectionchange, as Chromium
// does after each input event. Do not force synchronous selection reconciliation.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const selectionFacts = () => editor.getEditorState().read(() => {
  const selection = $getSelection()
  return { range: $isRangeSelection(selection), table: $isTableSelection(selection), text: selection?.getTextContent() }
})
function Capture() {
  const [value] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = value }, [value])
  return null
}
function Harness({ documentId = 'pointer-owner-note', selectionPlugin = true } = {}) {
  return <LexicalComposer initialConfig={{ namespace: 'table-pointer-owner', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const values of [['old-range', 'other'], ['selected-C', 'selected-D']]) {
      table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    }
    $getRoot().append(table)
  } }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture />{selectionPlugin && <TableSelectionPlugin documentId={documentId} />}<TableActionMenuPlugin documentId={documentId} />
    </div>
  </LexicalComposer>
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  // The DOM fixture has no layout/hit testing. Supply only the cell under the
  // pointer; the real pinned TablePlugin performs every selection update.
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hitTarget ? [hitTarget] : [] })
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const text = cells()[0].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await settle()
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'old-range' })
  expect(document.getSelection().toString()).toBe('old-range')
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  if (hitTestDescriptor) Object.defineProperty(document, 'elementsFromPoint', hitTestDescriptor)
  else delete document.elementsFromPoint
  if (!rangeGeometry) delete Range.prototype.getBoundingClientRect
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

async function mode(value) {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: value })))
  await settle()
}

async function drag() {
  const start = cells()[2], end = cells()[3]
  const pointer = (type, target, x, buttons) => {
    hitTarget = target
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: 100 })
    target.dispatchEvent(event)
    return event
  }
  // Chromium sends PointerEvents before the compatibility MouseEvents. The
  // original mouse-only fixture never started Lexical's pointer observer.
  await act(async () => {
    const down = pointer('pointerdown', start, 100, 1)
    expect(down.defaultPrevented, 'Pointer cancellation would suppress the compatibility mousedown used by bulk mode').toBe(false)
    start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 100, clientY: 100 }))
  }); await settle()
  await act(async () => {
    pointer('pointermove', end, 220, 1)
    end.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 220, clientY: 100 }))
  }); await settle()
  await act(async () => {
    pointer('pointerup', end, 220, 0)
    end.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: 220, clientY: 100 }))
  }); await settle()
}

test('positive control: native pointer drag reaches the real Lexical TableObserver and clears its DOM range', async () => {
  const before = snapshot()
  await drag()
  expect(selectionFacts()).toEqual({ range: false, table: true, text: 'selected-C\tselected-D\n' })
  expect(document.getSelection().rangeCount).toBe(0)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('custom bulk mode owns pointerdown before the native TableObserver can replace the retained text selection', async () => {
  const before = snapshot()
  await mode(true)
  await drag()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'old-range' })
  expect(document.getSelection().toString()).toBe('old-range')
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('leaving bulk mode restores the existing native pointer selection handler', async () => {
  const before = snapshot()
  await mode(true)
  await mode(false)
  await drag()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(selectionFacts()).toEqual({ range: false, table: true, text: 'selected-C\tselected-D\n' })
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('the real action menu restores the saved Lexical text range before the bulk pointer gesture', async () => {
  const before = snapshot()
  await act(async () => host.querySelector('[aria-label="表格单元格操作"]').click()); await settle()
  // Chromium may discard the DOM range when the menu takes focus. Supply the
  // browser selection event, not a Lexical selection or content command.
  await act(async () => {
    document.getSelection().removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  const entry = [...host.querySelectorAll('.table-action-menu button')].find(button => button.textContent === '多选单元格…')
  expect(entry).toBeTruthy()
  await act(async () => entry.click()); await settle()
  expect(host.querySelector('.table-action-menu')).toBeNull()
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'old-range' })
  expect(document.getSelection().toString()).toBe('old-range')
  expect(document.activeElement).toBe(editor.getRootElement())
  await drag()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'old-range' })
  expect(document.getSelection().toString()).toBe('old-range')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('unmounting the custom plugin removes its pointer ownership listener', async () => {
  const before = snapshot()
  await mode(true)
  await act(async () => reactRoot.render(<Harness selectionPlugin={false} />)); await settle()
  await drag()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(selectionFacts()).toEqual({ range: false, table: true, text: 'selected-C\tselected-D\n' })
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a completed menu action cannot restore an old DOM range across a document session change', async () => {
  const before = snapshot()
  await act(async () => host.querySelector('[aria-label="表格单元格操作"]').click()); await settle()
  const entry = [...host.querySelectorAll('.table-action-menu button')].find(button => button.textContent === '多选单元格…')
  await act(async () => entry.click())
  await act(async () => reactRoot.render(<Harness documentId="different-note" />))
  const text = cells()[1].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    cells()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 220, clientY: 70 }))
    cells()[1].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 220, clientY: 70 }))
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(document.getSelection().toString()).toBe('other')
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'other' })
  // Cross the two old restoration frames. This is an event boundary check,
  // not a grace period for product correctness or a changed test timeout.
  await act(async () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(selectionFacts()).toEqual({ range: true, table: false, text: 'other' })
  expect(document.getSelection().toString()).toBe('other')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a menu whose retained text was replaced cannot restore deleted selection endpoints', async () => {
  await act(async () => host.querySelector('[aria-label="表格单元格操作"]').click()); await settle()
  const entry = [...host.querySelectorAll('.table-action-menu button')].find(button => button.textContent === '多选单元格…')
  expect(entry).toBeTruthy()
  // Pending content work can replace a text node without changing the table,
  // row or cell identity. This must invalidate its retained selection target.
  await act(async () => editor.update(() => {
    const paragraph = $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild()
    paragraph.clear().append($createTextNode('replacement text'))
  }, { discrete: true })); await settle()
  const changed = snapshot()
  await act(async () => entry.click()); await settle()
  expect(errors).toEqual([])
  expect(host.querySelector('.table-action-menu')).toBeNull()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(snapshot()).toEqual(changed)
})
