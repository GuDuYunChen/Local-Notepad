// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, REDO_COMMAND, UNDO_COMMAND } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TablePresentationPlugin from './TablePresentationPlugin'
import TableColumnResizePlugin from './TableColumnResizePlugin'
import { $deleteRowAtCell, $insertRowAtCell, $moveTableColumn } from '../utils/tableModel'

const editorCSS = readFileSync('src/components/Editor/Editor.css', 'utf8')
const documentCSS = readFileSync('src/styles/editor-document.css', 'utf8')
let host, root, editor, errors, history, props, frames, frameId, styles, initialState
const snapshot = () => editor.getEditorState().toJSON()
const tableJSON = () => snapshot().root.children[0]
const tableDOM = () => host.querySelector('.editor-input table')
const cell = (row = 0, column = 0) => tableDOM().rows[row].cells[column]
const settle = () => act(async () => { for (let index = 0; index < 8; index++) await Promise.resolve() })
const update = async callback => { await act(async () => editor.update(callback, { discrete: true })); await settle() }
const mouse = (target, type, options = {}) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...options }))

// jsdom exposes CSS declarations, not table layout, and does not rank selector
// specificity across these stylesheets. Read the actual, more-specific width
// rule when it matches this real DOM cell; automatic cells use the document
// defaults. Resolve only standard var() references. No invented CSS or boxes
// establish native layout: the unchanged Windows driver still owns that gate.
function minimum(element) {
  const style = getComputedStyle(element)
  const rules = [...styles[0].sheet.cssRules].filter(rule => rule.selectorText?.includes('.editor-table-cell[style*="width"]'))
  expect(rules).toHaveLength(1)
  let value = element.style.minWidth || (element.matches(rules[0].selectorText) ? rules[0].style.getPropertyValue('min-width') : style.minWidth)
  for (let count = 0; count < 8 && value.includes('var('); count++) {
    value = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,
      (_, name, fallback = '') => style.getPropertyValue(name).trim() || fallback.trim())
  }
  expect(value, 'the production minimum must resolve to a usable pixel size').toMatch(/^\d+(?:\.\d+)?px$/)
  return Number.parseFloat(value)
}
const minimums = () => [...tableDOM().rows].map(row => [...row.cells].map(minimum))
const widths = (values, rows = 3) => Array.from({ length: rows }, () => [...values])
function verifyWidthCascade() {
  const visit = rules => [...rules].flatMap(rule => rule.selectorText ? [rule] : rule.cssRules ? visit(rule.cssRules) : [])
  const rules = styles.flatMap(style => visit(style.sheet.cssRules)).filter(rule =>
    rule.selectorText?.includes('.editor-table-cell') && rule.style.getPropertyValue('min-width'))
  const explicit = '.editor-input .editor-table .editor-table-cell[style*="width"]'
  // The explicit rule has specificity (0,4,0); every actual default below is
  // at most (0,3,0), including the conditional media rules. No !important or
  // an unreviewed competing selector may invalidate this narrow CSSOM read.
  const defaults = ['.editor-table-cell', '.editor-input .editor-table-cell',
    '.editor-input .editor-table-cell:first-child', '.editor-input .editor-table-cell:not(:first-child)']
  expect(rules.some(rule => rule.selectorText === explicit)).toBe(true)
  for (const rule of rules) {
    expect(rule.style.getPropertyPriority('min-width')).toBe('')
    expect([explicit, ...defaults]).toContain(rule.selectorText)
  }
}
function $plain({ columns, cells, headers = true } = {}) {
  const table = $createTableNode()
  if (columns !== undefined) table.setColWidths(columns)
  for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
    const row = $createTableRowNode()
    for (let column = 0; column < 3; column++) row.append(
      $createTableCellNode(headers && rowIndex === 0 ? 1 : 0, 1, cells?.[column])
        .append($createParagraphNode().append($createTextNode(`R${rowIndex + 1}C${column + 1}`))),
    )
    table.append(row)
  }
  return table
}
function $value(text, width, colSpan = 1, rowSpan = 1) {
  return $createTableCellNode(0, colSpan, width).setRowSpan(rowSpan)
    .append($createParagraphNode().append($createTextNode(text)))
}
function Capture({ editable }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance; if (editor.isEditable() !== editable) editor.setEditable(editable) }, [instance, editable])
  return null
}
function Harness({ editable, documentId, resize }) {
  return <LexicalComposer initialConfig={{ namespace: 'table-width-layout', editable: true,
    nodes: [TableNode, TableRowNode, TableCellNode],
    theme: { table: 'editor-table', tableCell: 'editor-table-cell', tableCellHeader: 'editor-table-cell-header' },
    editorState: () => $getRoot().append(initialState(), $createParagraphNode().append($createTextNode('outside'))),
    onError: error => errors.push(error),
  }}>
    <Capture editable={editable}/>
    <div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/>
      <TablePlugin/><HistoryPlugin externalHistoryState={history}/><TablePresentationPlugin/>
      {resize && <TableColumnResizePlugin documentId={documentId}/>}</div>
  </LexicalComposer>
}
async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<Harness {...props}/>)); await settle()
}
async function mount(options = {}) {
  initialState = options.state || (() => $plain(options))
  await render({ editable: options.editable !== false })
  expect(errors).toEqual([])
}
function geometry() {
  // Only locate the real resize handle and provide a controlled intrinsic text
  // measurement. These boxes do not assert that a browser has rendered widths.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.hasAttribute('data-table-autofit-measure')
      ? Math.max(...[...this.querySelectorAll('td,th')].map(item => item.textContent.length * 8 + 28))
      : Number.parseFloat(this.style.width) || (this.tagName === 'TABLE' ? 800 : 240)
    const left = this.cellIndex >= 0 ? 20 + this.cellIndex * 240 : 20
    return { x: left, y: 40, left, top: 40, right: left + width, bottom: 80, width, height: 40, toJSON() {} }
  })
}
async function hover(element = cell()) {
  await act(async () => mouse(element, 'mousemove', { clientX: element.getBoundingClientRect().right }))
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)) })
  await settle()
}
async function begin(element = cell()) {
  await hover(element)
  const button = host.querySelector('[aria-label="调整表格列宽"]')
  expect(button).toBeTruthy()
  const start = element.getBoundingClientRect().right
  await act(async () => mouse(button, 'mousedown', { clientX: start, button: 0, detail: 1 }))
  return start
}
async function move(x) { await act(async () => mouse(window, 'mousemove', { clientX: x })) }
async function end(x) { await act(async () => mouse(window, 'mouseup', { clientX: x, button: 0 })); await settle() }
async function command(value) { await act(async () => editor.dispatchCommand(value, undefined)); await settle() }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; history = createEmptyHistoryState(); frames = new Map(); frameId = 0
  props = { editable: true, resize: true, documentId: 'width-note-A' }
  styles = [editorCSS, documentCSS].map(text => { const style = document.createElement('style'); style.textContent = text; document.head.append(style); return style })
  verifyWidthCascade()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); styles.forEach(style => style.remove())
  vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors).toEqual([])
})

test.each([true, false])('table-level saved widths constrain every cell in editability %s without adding cell data', async editable => {
  await mount({ columns: [240, 320, 240], editable })
  const before = snapshot()
  expect([...tableDOM().querySelectorAll('col')].map(item => item.style.width)).toEqual(['240px', '320px', '240px'])
  expect([...tableDOM().rows[0].cells].map(item => item.style.width)).toEqual(['', '', ''])
  expect(minimums()).toEqual(widths([240, 320, 240]))
  expect(snapshot()).toEqual(before)
  expect(JSON.stringify(before)).not.toContain('--table-cell-')
})
test('canonical columns take priority over obsolete individual width hints', async () => {
  await mount({ columns: [240, 320, 240], cells: [90, 100, 110] })
  const before = snapshot()
  expect([...tableDOM().rows[0].cells].map(item => item.style.width)).toEqual(['90px', '100px', '110px'])
  expect(minimums()).toEqual(widths([240, 320, 240]))
  expect(snapshot()).toEqual(before)
})
test('legacy cell-only widths constrain their actual columns without creating a colgroup', async () => {
  await mount({ cells: [100, 180, 240] })
  const before = snapshot()
  expect(tableDOM().querySelector('colgroup')).toBeNull()
  expect(minimums()).toEqual(widths([100, 180, 240]))
  expect(snapshot()).toEqual(before)
})
test('unknown automatic columns retain document defaults beside known legacy columns', async () => {
  await mount({ cells: [100, undefined, 240] })
  const before = snapshot()
  expect(minimums()).toEqual(widths([100, 150, 240]))
  expect(cell(0, 1).style.getPropertyValue('--table-cell-width')).toBe('')
  expect(cell(0, 1).style.width).toBe('')
  expect(tableJSON().colWidths).toBeUndefined()
  expect(snapshot()).toEqual(before)
})
test('fully automatic tables retain their existing widths and serialization', async () => {
  await mount()
  const before = snapshot()
  expect(minimums()).toEqual(widths([96, 150, 150]))
  for (const item of tableDOM().querySelectorAll('td,th')) expect(item.style.getPropertyValue('--table-cell-width')).toBe('')
  expect(snapshot()).toEqual(before)
})
test('a cell spanning rows and columns uses logical column widths for the whole span', async () => {
  await mount({ state: () => $createTableNode().setColWidths([90, 150, 240]).append(
    $createTableRowNode().append($value('merged', undefined, 2, 2), $value('top-tail')),
    $createTableRowNode().append($value('bottom-tail')),
  ) })
  const before = snapshot()
  expect(minimums()).toEqual([[240, 240], [240]])
  expect(cell(1, 0).dataset.tableColumn).toBe('2')
  expect(snapshot()).toEqual(before)
})
test('legacy spanning widths use the existing shared inference without guessing an automatic tail', async () => {
  await mount({ state: () => $createTableNode().append(
    $createTableRowNode().append($value('merge', 300, 2), $value('tail')),
    $createTableRowNode().append($value('left', 120), $value('right'), $value('bottom-tail')),
  ) })
  const before = snapshot()
  expect(minimums()).toEqual([[300, 150], [120, 180, 150]])
  expect(cell(1, 1).style.width).toBe('')
  expect(cell(1, 2).style.getPropertyValue('--table-cell-width')).toBe('')
  expect(snapshot()).toEqual(before)
})
test('clearing saved widths removes stale constraints from surviving cell DOM', async () => {
  await mount({ columns: [240, 320, 240] })
  const old = cell()
  expect(minimums()).toEqual(widths([240, 320, 240]))
  await update(() => $getRoot().getFirstChild().setColWidths(undefined))
  const before = snapshot()
  expect(cell()).toBe(old)
  expect(minimums()).toEqual(widths([96, 150, 150]))
  for (const item of tableDOM().querySelectorAll('td,th')) expect(item.style.getPropertyValue('--table-cell-width')).toBe('')
  expect(snapshot()).toEqual(before)
})
test('cell replacement and document reparse derive current widths without writing presentation data', async () => {
  await mount({ columns: [240, 320, 240] })
  const original = cell()
  await update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().setBackgroundColor('#fff3cd'))
  expect(original.isConnected).toBe(false)
  expect(minimum(cell())).toBe(240)
  const saved = snapshot(), oldTable = tableDOM()
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved)))); await settle()
  expect(oldTable.isConnected).toBe(false)
  expect(minimums()).toEqual(widths([240, 320, 240]))
  expect(snapshot()).toEqual(saved)
})
test('row insertion, deletion and column movement keep constraints with the logical data', async () => {
  await mount({ columns: [240, 320, 240] })
  await update(() => $insertRowAtCell($getRoot().getFirstChild().getFirstChild().getFirstChild(), true))
  expect(minimums()).toEqual(widths([240, 320, 240], 4))
  await update(() => $deleteRowAtCell($getRoot().getFirstChild().getChildren()[1].getFirstChild()))
  await update(() => $moveTableColumn($getRoot().getFirstChild(), 1, -1))
  const saved = snapshot()
  expect(minimums()).toEqual(widths([320, 240, 240]))
  expect([...tableDOM().rows[0].cells].map(item => item.textContent)).toEqual(['R1C2', 'R1C1', 'R1C3'])
  expect(snapshot()).toEqual(saved)
})

test('grow and shrink previews change the real minimum but leave the stored width untouched', async () => {
  geometry(); await mount({ columns: [240, 320, 240], cells: [240, 320, 240] })
  const before = snapshot(), start = await begin()
  await move(start + 90)
  expect(minimums()).toEqual(widths([330, 320, 240]))
  expect(snapshot()).toEqual(before)
  await move(start - 120)
  expect(minimums()).toEqual(widths([120, 320, 240]))
  expect(cell().style.getPropertyValue('--table-cell-width')).toBe('240px')
  expect(snapshot()).toEqual(before)
})
test.each([
  ['Escape', async () => act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))],
  ['blur', async () => act(async () => window.dispatchEvent(new Event('blur')))],
  ['scroll', async () => act(async () => tableDOM().dispatchEvent(new Event('scroll')))],
  ['reading mode', async () => render({ editable: false })],
  ['document change', async () => render({ documentId: 'width-note-B' })],
  ['plugin unmount', async () => render({ resize: false })],
])('a %s cancellation restores derived widths and removes all owned preview constraints', async (_, cancel) => {
  geometry(); await mount({ columns: [240, 320, 240], cells: [240, 320, 240] })
  const before = snapshot(), start = await begin()
  await move(start - 100)
  expect(minimum(cell())).toBe(140)
  await cancel(); await end(start - 100)
  expect(snapshot()).toEqual(before)
  expect(minimums()).toEqual(widths([240, 320, 240]))
  for (const item of tableDOM().querySelectorAll('td,th')) expect(item.style.getPropertyValue('--table-cell-preview-width')).toBe('')
  expect(history.undoStack).toHaveLength(0)
})
test('committing a shrink keeps one undo entry and restores the same constraints after redo and reload', async () => {
  geometry(); await mount({ columns: [240, 320, 240], cells: [240, 320, 240] })
  const before = snapshot(), start = await begin()
  await move(start - 60); await end(start - 80)
  const saved = snapshot()
  expect(tableJSON().colWidths).toEqual([160, 320, 240])
  expect(minimums()).toEqual(widths([160, 320, 240]))
  expect(history.undoStack).toHaveLength(1)
  await command(UNDO_COMMAND)
  expect(snapshot()).toEqual(before); expect(minimums()).toEqual(widths([240, 320, 240]))
  await command(REDO_COMMAND)
  expect(snapshot()).toEqual(saved); expect(minimums()).toEqual(widths([160, 320, 240]))
  await act(async () => editor.setEditorState(editor.parseEditorState(JSON.stringify(saved)))); await settle()
  expect(snapshot()).toEqual(saved); expect(minimums()).toEqual(widths([160, 320, 240]))
})
test('new canonical widths on the same cell DOM cancel an obsolete preview without restoring its old minimum', async () => {
  geometry(); await mount({ columns: [240, 320, 240] })
  const oldCell = cell(), start = await begin()
  await move(start - 100)
  await update(() => $getRoot().getFirstChild().setColWidths([210, 320, 240]))
  const saved = snapshot()
  expect(cell()).toBe(oldCell)
  await end(start - 100)
  expect(snapshot()).toEqual(saved)
  expect(cell().style.width).toBe('')
  expect(minimums()).toEqual(widths([210, 320, 240]))
  expect(cell().style.getPropertyValue('--table-cell-preview-width')).toBe('')
})
test('a presentation refresh during a valid preview keeps the preview minimum separate from saved widths', async () => {
  geometry(); await mount({ columns: [240, 320, 240], cells: [240, 320, 240] })
  const start = await begin()
  await move(start - 100)
  await update(() => $getRoot().getFirstChild().getChildren()[1].getChildren()[1].setBackgroundColor('#fff3cd'))
  expect(minimum(cell())).toBe(140)
  expect(cell().style.getPropertyValue('--table-cell-width')).toBe('240px')
})
test('a resized column changes spanning-cell minimums without changing its unselected logical neighbours', async () => {
  geometry(); await mount({ state: () => $createTableNode().setColWidths([120, 160, 240]).append(
    $createTableRowNode().append($value('merge', 280, 2), $value('tail', 240)),
    $createTableRowNode().append($value('left', 120), $value('right', 160), $value('bottom-tail', 240)),
  ) })
  const before = snapshot(), start = await begin(cell(1, 1))
  await move(start - 60)
  expect(minimums()).toEqual([[220, 240], [120, 100, 240]])
  expect(snapshot()).toEqual(before)
  await end(start - 60)
  expect(tableJSON().colWidths).toEqual([120, 100, 240])
  expect(minimums()).toEqual([[220, 240], [120, 100, 240]])
})
test('autofit measures unclamped clone content and can repeatedly shrink a saved wide column', async () => {
  geometry(); await mount({ columns: [500, 320, 240], cells: [500, 320, 240] })
  let measurements = 0
  const append = Element.prototype.append
  vi.spyOn(Element.prototype, 'append').mockImplementation(function (...nodes) {
    for (const node of nodes) if (node?.hasAttribute?.('data-table-autofit-measure')) {
      measurements++
      for (const item of node.querySelectorAll('td,th')) {
        expect(item.style.getPropertyValue('--table-cell-width')).toBe('')
        expect(item.style.getPropertyValue('--table-cell-preview-width')).toBe('')
        expect(item.style.width).toBe('auto'); expect(item.style.minWidth).toBe('0'); expect(item.style.maxWidth).toBe('none')
      }
    }
    return append.apply(this, nodes)
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    await hover(); await act(async () => mouse(host.querySelector('[aria-label="调整表格列宽"]'), 'dblclick', { detail: 2 })); await settle()
    expect(tableJSON().colWidths).toEqual([90, 320, 240])
    expect(minimums()).toEqual(widths([90, 320, 240]))
    expect(host.querySelector('[data-table-autofit-measure]')).toBeNull()
  }
  expect(measurements).toBe(2)
  expect(history.undoStack).toHaveLength(1)
})
