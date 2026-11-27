import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, REDO_COMMAND, UNDO_COMMAND } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableColumnResizePlugin from './TableColumnResizePlugin'
import TableReorderPlugin from './TableReorderPlugin'
import { toast } from '~/services/toast'

vi.mock('~/services/toast', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

let host, root, editor, errors, props, history, frameId, frames
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const tableJSON = () => snapshot().root.children.find(node => node.type === 'table')
const texts = () => tableJSON().children.map(row => row.children.map(cell => cell.children.map(paragraph => paragraph.children.map(text => text.text).join('')).join('\n')))
const cellWithText = text => [...host.querySelectorAll('td, th')].find(cell => cell.textContent === text)
const button = label => host.querySelector('.editor-container').querySelector(`:scope > button[aria-label="${label}"]`)
const mouse = (element, type, values = {}) => element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...values }))

function $table(values = [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']]) {
  const table = $createTableNode().setColWidths([120, 160, 200])
  values.forEach((rowValues, rowIndex) => {
    const row = $createTableRowNode()
    rowValues.forEach((value, columnIndex) => row.append(
      $createTableCellNode(rowIndex === 0 ? 1 : 0, 1, [120, 160, 200][columnIndex])
        .append($createParagraphNode().append($createTextNode(value))),
    ))
    table.append(row)
  })
  return table
}

function Capture({ editable }) {
  const [current] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = current; if (current.isEditable() !== editable) current.setEditable(editable) }, [current, editable])
  return null
}

function Harness({ editable, showPlugin, documentId }) {
  return <LexicalComposer initialConfig={{
    namespace: 'table-gestures', nodes: [TableNode, TableRowNode, TableCellNode], editable: true,
    editorState: () => $getRoot().append($table(), $createParagraphNode().append($createTextNode('outside table'))),
    onError: error => errors.push(error),
  }}>
    <Capture editable={editable} />
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin />
      <HistoryPlugin externalHistoryState={history} />
      {showPlugin && <><TableColumnResizePlugin documentId={documentId} /><TableReorderPlugin documentId={documentId} /></>}
    </div>
  </LexicalComposer>
}

async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<Harness {...props} />))
  await settle()
}
async function flushFrames() {
  await act(async () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  })
  await settle()
}
async function hover(cell) {
  expect(cell).toBeTruthy()
  await act(async () => mouse(cell, 'mousemove', { clientX: cell.getBoundingClientRect().right }))
  await flushFrames()
}
async function beginResize(cell = cellWithText('A1')) {
  await hover(cell)
  const resize = button('调整表格列宽')
  expect(resize).toBeTruthy()
  const startX = cell.getBoundingClientRect().right
  await act(async () => mouse(resize, 'mousedown', { clientX: startX, button: 0, detail: 1 }))
  return startX
}
function dataTransfer() {
  const data = new Map()
  return { types: [], effectAllowed: 'uninitialized', dropEffect: 'none',
    setData(type, value) { data.set(type, value); this.types = [...data.keys()] },
    getData(type) { return data.get(type) || '' },
  }
}
function drag(element, type, transfer) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  element.dispatchEvent(event)
  return event
}
async function beginReorder(type = 'row', cell = cellWithText('A1')) {
  await hover(cell)
  const control = button(type === 'row' ? '拖动当前行排序' : '拖动当前列排序')
  expect(control).toBeTruthy()
  const transfer = dataTransfer()
  await act(async () => drag(control, 'dragstart', transfer))
  return transfer
}
async function drop(transfer, target, hoverTarget = target) {
  await act(async () => drag(hoverTarget, 'dragover', transfer))
  await settle()
  await act(async () => drag(target, 'drop', transfer))
  await settle()
}
async function mutate(update) {
  await act(async () => editor.update(update, { discrete: true }))
  await settle()
}
async function command(value) {
  await act(async () => editor.dispatchCommand(value, undefined))
  await settle()
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; frames = new Map(); frameId = 0
  history = createEmptyHistoryState()
  props = { editable: true, showPlugin: true, documentId: 'note-A' }
  vi.clearAllMocks()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.hasAttribute('data-table-autofit-measure')
      ? Math.max(...[...this.querySelectorAll('td, th')].map(cell => cell.textContent.length * 8 + 28))
      : parseFloat(this.style.width) || (this.tagName === 'TABLE' ? 480 : 120)
    const left = ['TD', 'TH'].includes(this.tagName) ? this.cellIndex * 120 + 40 : 40
    return { left, right: left + width, top: 50, bottom: 90, width, height: 40, x: left, y: 50, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors).toEqual([])
})

test('TH cells expose usable resize and reorder controls that remain while the pointer enters each control', async () => {
  expect(cellWithText('A1').tagName).toBe('TH')
  for (const label of ['调整表格列宽', '拖动当前行排序', '拖动当前列排序']) {
    await hover(cellWithText('A1'))
    const control = button(label)
    expect(control).toBeTruthy()
    await act(async () => {
      mouse(host.querySelector('.editor-input > p'), 'mousemove', { clientX: 20 })
      mouse(control, 'mousemove', { clientX: 160 })
    })
    await flushFrames()
    expect(button(label)).toBe(control)
  }
})

test('resize previews stay outside saved state, final pointer commits once, and undo/redo/reload restore canonical widths', async () => {
  const before = snapshot(), startX = await beginResize()
  await act(async () => mouse(window, 'mousemove', { clientX: startX + 20 }))
  expect(cellWithText('A1').style.width).toBe('140px')
  expect(snapshot()).toEqual(before)
  await act(async () => {
    mouse(window, 'mousemove', { clientX: startX + 30 })
    mouse(window, 'mouseup', { clientX: startX + 40, button: 0 })
  })
  await settle()
  expect(tableJSON().colWidths).toEqual([160, 160, 200])
  expect(tableJSON().children.map(row => row.children.map(cell => cell.width))).toEqual([[160, 160, 200], [160, 160, 200], [160, 160, 200]])
  const saved = snapshot()
  expect(history.undoStack).toHaveLength(1)
  await command(UNDO_COMMAND)
  expect(snapshot()).toEqual(before)
  expect(cellWithText('A1').style.width).toBe('120px')
  expect(cellWithText('A1').style.minWidth).toBe('')
  await command(REDO_COMMAND)
  expect(snapshot()).toEqual(saved)
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved))))
  await settle()
  expect(snapshot()).toEqual(saved)
  expect([...host.querySelectorAll('col')].map(col => col.style.width)).toEqual(['160px', '160px', '200px'])
})

test('a normal first click keeps the double-click autofit path available and long content is clamped', async () => {
  await mutate(() => $getRoot().getFirstChild().getChildren()[1].getFirstChild().getFirstChild().getFirstChild().setTextContent('long content'.repeat(100)))
  const startX = await beginResize()
  await act(async () => mouse(window, 'mouseup', { clientX: startX, button: 0 }))
  await settle()
  expect(button('调整表格列宽')).toBeTruthy()
  await act(async () => mouse(button('调整表格列宽'), 'dblclick', { detail: 2 }))
  await settle()
  expect(tableJSON().colWidths).toEqual([600, 160, 200])
  expect(tableJSON().children.every(row => row.children[0].width === 600)).toBe(true)
  expect(history.undoStack).toHaveLength(2)
  expect(host.querySelector('[data-table-autofit-measure]')).toBeNull()
})

test('autofit shrinks a wide column and repeating it neither grows width nor creates another undo entry', async () => {
  const startX = await beginResize()
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 380, button: 0 }))
  await settle()
  expect(tableJSON().colWidths[0]).toBe(500)
  for (let attempt = 0; attempt < 2; attempt++) {
    await hover(cellWithText('A1'))
    await act(async () => mouse(button('调整表格列宽'), 'dblclick', { detail: 2 }))
    await settle()
    expect(tableJSON().colWidths[0]).toBe(90)
  }
  expect(history.undoStack).toHaveLength(2)
  expect(host.querySelector('[data-table-autofit-measure]')).toBeNull()
})

test('clicking a fractional-pixel column edge without moving does not create a save or undo change', async () => {
  const cell = cellWithText('A1'), rectangle = cell.getBoundingClientRect(), before = snapshot()
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ ...rectangle, width: 120.25, right: rectangle.left + 120.25 })
  const startX = await beginResize(cell)
  await act(async () => mouse(window, 'mouseup', { clientX: startX, button: 0 }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(history.undoStack).toHaveLength(0)
  expect(button('调整表格列宽')).toBeTruthy()
})

test.each(['colspan', 'rowspan'])('resize resolves logical columns after an earlier %s', async span => {
  await mutate(() => {
    const table = $getRoot().getFirstChild(), rows = table.getChildren()
    if (span === 'colspan') { rows[0].getFirstChild().setColSpan(2).setWidth(280); rows[0].getChildren()[1].remove() }
    else { rows[0].getFirstChild().setRowSpan(2); rows[1].getFirstChild().remove() }
  })
  const text = span === 'colspan' ? 'A3' : 'B2'
  const startX = await beginResize(cellWithText(text))
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 40, button: 0 }))
  await settle()
  expect(tableJSON().colWidths).toEqual(span === 'colspan' ? [120, 160, 240] : [120, 200, 200])
  expect(cellWithText('A1').style.width).toBe(span === 'colspan' ? '280px' : '120px')
  expect(cellWithText(span === 'colspan' ? 'C3' : 'A2').style.width).toBe(span === 'colspan' ? '240px' : '200px')
})

test('resizing a column under a merged cell updates its span width without shifting other columns', async () => {
  await mutate(() => {
    const row = $getRoot().getFirstChild().getFirstChild()
    row.getFirstChild().setColSpan(2).setWidth(280); row.getChildren()[1].remove()
  })
  const startX = await beginResize(cellWithText('B2'))
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 40, button: 0 }))
  await settle()
  expect(tableJSON().colWidths).toEqual([120, 200, 200])
  expect(cellWithText('A1').style.width).toBe('320px')
  expect(cellWithText('B1').style.width).toBe('120px')
})

test('resizing beside columns represented only by merged cells preserves their inferred canonical total', async () => {
  await mutate(() => {
    const table = $getRoot().getFirstChild()
    table.setColWidths(undefined)
    table.getChildren().forEach(row => {
      row.getFirstChild().setColSpan(2).setWidth(240)
      row.getChildren()[1].remove()
      row.getLastChild().setWidth(100)
    })
  })
  const startX = await beginResize(cellWithText('A3'))
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 50, button: 0 }))
  await settle()
  expect(tableJSON().colWidths).toEqual([120, 120, 150])
  expect(tableJSON().children.map(row => row.children.map(cell => cell.width))).toEqual([[240, 150], [240, 150], [240, 150]])
  expect(cellWithText('A1').style.width).toBe('240px')
})

const boundaries = [
  ['Escape', async () => { await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))) }],
  ['window blur', async () => { await act(async () => window.dispatchEvent(new Event('blur'))) }],
  ['live read-only', async () => { await act(async () => editor.setEditable(false)) }],
  ['reading and editing return', async () => { await render({ editable: false, showPlugin: false }); await render({ editable: true, showPlugin: true }) }],
  ['plugin unmount', () => render({ showPlugin: false })],
  ['document change', () => render({ documentId: 'note-B' })],
  ['document A-B-A', async () => { await render({ documentId: 'note-B' }); await render({ documentId: 'note-A' }) }],
]

test.each(boundaries)('resize cancels at %s without saved changes or leaked preview styles', async (_, transition) => {
  const before = snapshot(), cell = cellWithText('A1'), oldWidth = cell.style.width, startX = await beginResize(cell)
  await act(async () => mouse(window, 'mousemove', { clientX: startX + 70 }))
  expect(cell.style.width).toBe('190px')
  await transition()
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 70, button: 0 }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(cell.style.width).toBe(oldWidth)
  expect(host.querySelector('col').style.width).toBe('120px')
  expect(history.undoStack).toHaveLength(0)
})

test('scroll during resize restores the preview without saving stale geometry', async () => {
  const before = snapshot(), startX = await beginResize()
  await act(async () => {
    mouse(window, 'mousemove', { clientX: startX + 70 })
    host.querySelector('.editor-container').dispatchEvent(new Event('scroll'))
    mouse(window, 'mouseup', { clientX: startX + 70, button: 0 })
  })
  await settle()
  expect(snapshot()).toEqual(before)
  expect(cellWithText('A1').style.width).toBe('120px')
  expect(host.querySelector('col').style.width).toBe('120px')
  expect(history.undoStack).toHaveLength(0)
})

test('a structural change during resize cancels and cannot resize a replacement column', async () => {
  const startX = await beginResize(cellWithText('A2'))
  await act(async () => mouse(window, 'mousemove', { clientX: startX + 70 }))
  await mutate(() => {
    const table = $getRoot().getFirstChild()
    table.getChildren().forEach(row => row.getFirstChild().remove())
    table.setColWidths([160, 200])
  })
  const changed = snapshot()
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 70, button: 0 }))
  await settle()
  expect(snapshot()).toEqual(changed)
  expect(cellWithText('A2').style.width).toBe('160px')
})

test('a newer persisted width wins over an active resize preview', async () => {
  const startX = await beginResize()
  await act(async () => mouse(window, 'mousemove', { clientX: startX + 70 }))
  await mutate(() => {
    const table = $getRoot().getFirstChild()
    table.setColWidths([210, 160, 200]); table.getChildren().forEach(row => row.getFirstChild().setWidth(210))
  })
  const changed = snapshot()
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 70, button: 0 }))
  await settle()
  expect(snapshot()).toEqual(changed)
  expect(cellWithText('A1').style.width).toBe('210px')
})

test.each(['row', 'col'])('a %s drop uses the real destination, keeps cell identity/styles and has one undo/redo step', async type => {
  await mutate(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().setBackgroundColor('#aabbcc'))
  const before = snapshot(), baselineHistory = history.undoStack.length, originalColor = cellWithText('A1').style.backgroundColor
  const transfer = await beginReorder(type)
  const target = cellWithText(type === 'row' ? 'C1' : 'A3')
  await act(async () => drag(target, 'dragover', transfer))
  await settle()
  expect(host.querySelectorAll(type === 'row' ? '.table-row-drop-target' : '.table-col-drop-target').length).toBeGreaterThan(0)
  await act(async () => drag(target, 'drop', transfer))
  await settle()
  expect(texts()).toEqual(type === 'row' ? [['B1', 'B2', 'B3'], ['C1', 'C2', 'C3'], ['A1', 'A2', 'A3']] : [['A2', 'A3', 'A1'], ['B2', 'B3', 'B1'], ['C2', 'C3', 'C1']])
  expect(tableJSON().colWidths).toEqual(type === 'row' ? [120, 160, 200] : [160, 200, 120])
  expect(cellWithText('A1').style.backgroundColor).toBe(originalColor)
  expect(host.querySelector('.table-row-drop-target,.table-col-drop-target')).toBeNull()
  expect(history.undoStack.length - baselineHistory).toBe(1)
  const changed = snapshot()
  await command(UNDO_COMMAND); expect(snapshot()).toEqual(before)
  await command(REDO_COMMAND); expect(snapshot()).toEqual(changed)
})

test.each(['paragraph', 'another table'])('hovering a valid destination then dropping on %s does not reorder', async location => {
  if (location === 'another table') await mutate(() => $getRoot().append($table([['other1', 'other2', 'other3']])))
  const before = snapshot(), transfer = await beginReorder()
  const target = location === 'paragraph' ? host.querySelector('.editor-input > p') : cellWithText('other1')
  await drop(transfer, target, cellWithText('C1'))
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.table-row-drop-target,.table-col-drop-target')).toBeNull()
})

test('drop recomputes destination instead of using the last dragover row', async () => {
  const transfer = await beginReorder()
  await drop(transfer, cellWithText('B1'), cellWithText('C1'))
  expect(texts()).toEqual([['B1', 'B2', 'B3'], ['A1', 'A2', 'A3'], ['C1', 'C2', 'C3']])
})

test('native drag scrolling clears old markers and keeps distant rows reachable by their real drop target', async () => {
  const transfer = await beginReorder()
  await act(async () => drag(cellWithText('C1'), 'dragover', transfer))
  expect(host.querySelector('.table-row-drop-target')).toBeTruthy()
  await act(async () => host.querySelector('.editor-container').dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.table-row-drop-target')).toBeNull()
  await act(async () => drag(cellWithText('B1'), 'drop', transfer))
  await settle()
  expect(texts()).toEqual([['B1', 'B2', 'B3'], ['A1', 'A2', 'A3'], ['C1', 'C2', 'C3']])
})

test.each(boundaries)('reorder cancels at %s and rejects a later queued drop', async (_, transition) => {
  const before = snapshot(), transfer = await beginReorder()
  await act(async () => drag(cellWithText('C1'), 'dragover', transfer))
  await transition()
  await drop(transfer, cellWithText('C1'))
  expect(snapshot()).toEqual(before)
  expect(host.querySelector('.table-row-drop-target,.table-col-drop-target')).toBeNull()
})

test('deleting the source row during a drag cannot reorder the next row', async () => {
  const transfer = await beginReorder()
  await mutate(() => $getRoot().getFirstChild().getFirstChild().remove())
  const changed = snapshot()
  await drop(transfer, cellWithText('C1'))
  expect(snapshot()).toEqual(changed)
})

test.each(['row', 'col'])('unsafe %s movement through a merged range is rejected atomically with feedback', async type => {
  await mutate(() => {
    const rows = $getRoot().getFirstChild().getChildren()
    if (type === 'row') { rows[0].getFirstChild().setRowSpan(2); rows[1].getFirstChild().remove() }
    else { rows[0].getChildren()[1].setColSpan(2).setWidth(360); rows[0].getChildren()[2].remove() }
  })
  const before = snapshot(), transfer = await beginReorder(type, cellWithText(type === 'row' ? 'C1' : 'B1'))
  await drop(transfer, cellWithText(type === 'row' ? 'B2' : 'B2'))
  expect(snapshot()).toEqual(before)
  expect(toast.warning).toHaveBeenCalledTimes(1)
})

test('unrelated drag data cannot take over a table gesture or consume the editor drop', async () => {
  const before = snapshot()
  await beginReorder()
  const foreign = dataTransfer(); foreign.setData('application/x-another-feature', 'other')
  let received = false
  const listen = () => { received = true }
  editor.getRootElement().addEventListener('drop', listen)
  await drop(foreign, cellWithText('C1'))
  editor.getRootElement().removeEventListener('drop', listen)
  expect(received).toBe(true)
  expect(snapshot()).toEqual(before)
})

test('two mounted editors keep hover, drop ownership, and column resize writes in their own document', async () => {
  let otherEditor
  function CaptureOther() {
    const [instance] = useLexicalComposerContext()
    useLayoutEffect(() => { otherEditor = instance }, [instance])
    return null
  }
  const otherHost = document.createElement('div'), otherRoot = createRoot(otherHost)
  host.querySelector('.editor-container').append(otherHost)
  try {
    await act(async () => otherRoot.render(<LexicalComposer initialConfig={{
      namespace: 'other-table-gestures', nodes: [TableNode, TableRowNode, TableCellNode],
      editorState: () => $getRoot().append($table([['other1', 'other2', 'other3']])),
      onError: error => errors.push(error),
    }}>
      <CaptureOther />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TablePlugin />
        <TableColumnResizePlugin documentId="other-document" /><TableReorderPlugin documentId="other-document" />
      </div>
    </LexicalComposer>))
    await settle()
    const before = snapshot(), otherBefore = otherEditor.getEditorState().toJSON()
    await hover(cellWithText('other1'))
    expect(otherHost.querySelector('[aria-label="调整表格列宽"]')).toBeTruthy()
    const transfer = await beginReorder()
    await drop(transfer, cellWithText('other1'), cellWithText('C1'))
    expect(snapshot()).toEqual(before)
    expect(otherEditor.getEditorState().toJSON()).toEqual(otherBefore)
    const startX = await beginResize()
    await act(async () => mouse(window, 'mouseup', { clientX: startX + 40, button: 0 }))
    await settle()
    expect(tableJSON().colWidths).toEqual([160, 160, 200])
    expect(otherEditor.getEditorState().toJSON()).toEqual(otherBefore)
  } finally {
    await act(async () => otherRoot.unmount())
    otherHost.remove()
  }
})

test('a large table retains every long cell value through distant column reorder and resize', async () => {
  const long = 'long-content-'.repeat(100)
  await mutate(() => {
    const values = Array.from({ length: 80 }, (_, row) => Array.from({ length: 3 }, (_, col) => `${row}:${col}:${long}`))
    $getRoot().clear().append($table(values))
  })
  const original = texts(), transfer = await beginReorder('col', cellWithText(original[0][0]))
  await drop(transfer, cellWithText(original[79][2]))
  expect(texts()).toEqual(original.map(row => [row[1], row[2], row[0]]))
  const startX = await beginResize(cellWithText(original[79][0]))
  await act(async () => mouse(window, 'mouseup', { clientX: startX + 35, button: 0 }))
  await settle()
  expect(tableJSON().colWidths).toEqual([160, 200, 155])
  expect(texts()).toEqual(original.map(row => [row[1], row[2], row[0]]))
})
