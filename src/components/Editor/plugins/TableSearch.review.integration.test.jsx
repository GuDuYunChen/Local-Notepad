// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, CAN_USE_BEFORE_INPUT } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { CodeBlockNode, $createCodeBlockNode } from '../nodes/CodeBlockNode'
import SearchPlugin from './SearchPlugin'
import TableActionMenuPlugin from './TableActionMenuPlugin'
import TableSelectionPlugin from './TableSelectionPlugin'
import TablePresentationPlugin from './TablePresentationPlugin'
import ToolbarPlugin from './ToolbarPlugin'

const { addedTargetRanges } = vi.hoisted(() => {
  const missing = !InputEvent.prototype.getTargetRanges
  if (missing) Object.defineProperty(InputEvent.prototype, 'getTargetRanges', { configurable: true, value() { return [] } })
  return { addedTargetRanges: missing }
})
afterAll(() => { if (addedTargetRanges) delete InputEvent.prototype.getTargetRanges })

let host, reactRoot, editor, errors, frames, frameId, history, rangeRects, scrollCalls
const layoutDescriptors = []
beforeAll(() => {
  for (const [prototype, key, value] of [
    [Range.prototype, 'getClientRects', function () { return rangeRects(this) }],
    [Range.prototype, 'getBoundingClientRect', function () { return rangeRects(this)[0] || new DOMRect() }],
    [HTMLElement.prototype, 'scrollIntoView', function () {}],
  ]) {
    layoutDescriptors.push([prototype, key, Object.getOwnPropertyDescriptor(prototype, key)])
    Object.defineProperty(prototype, key, { configurable: true, writable: true, value })
  }
})
afterAll(() => { for (const [prototype, key, descriptor] of layoutDescriptors) { if (descriptor) Object.defineProperty(prototype, key, descriptor); else delete prototype[key] } })
const initialCells = [['alpha', 'keep'], ['alpha', 'tail'], ['al', 'pha']]
const snapshot = () => editor.getEditorState().toJSON()
const texts = () => snapshot().root.children.find(node => node.type === 'table').children.map(row => row.children.map(cell => cell.children.map(p => p.children.map(text => text.text || '').join('')).join('\n')))
const settle = async () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })

function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness({ documentId }) {
  return <LexicalComposer key={documentId} initialConfig={{ namespace: 'table-search-review', nodes: [TableNode, TableRowNode, TableCellNode, CodeBlockNode], onError: error => errors.push(error) }}>
    <div className="editor-shell">
      <ToolbarPlugin documentId={documentId} />
      <SearchPlugin documentId={documentId} />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TablePlugin /><HistoryPlugin externalHistoryState={history} /><Capture />
        <TableActionMenuPlugin documentId={documentId} /><TableSelectionPlugin documentId={documentId} /><TablePresentationPlugin />
      </div>
    </div>
  </LexicalComposer>
}
async function tick() {
  await act(async () => {
    const queued = [...frames.values()]; frames.clear()
    for (const callback of queued) callback()
  })
  await settle()
}
async function seed(values = initialCells) {
  await act(async () => editor.update(() => {
    const table = $createTableNode()
    table.setFrozenRows(1); table.setFrozenColumns(1); table.setColWidths(values[0].map(() => 240))
    for (const [index, row] of values.entries()) table.append($createTableRowNode().append(...row.map(text => $createTableCellNode(index === 0 ? 1 : 0).append($createParagraphNode().append($createTextNode(text))))))
    $getRoot().clear().append(table, $createParagraphNode().append($createTextNode('outside unique paragraph')))
  }, { discrete: true }))
  await settle()
}
async function mount(documentId = 'A') {
  await act(async () => reactRoot.render(<Harness documentId={documentId} />))
  await seed(); await tick()
}
const input = label => host.querySelector(`input[aria-label="${label}"]`)
const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label)
async function click(label) {
  const target = button(label); expect(target, label).toBeTruthy(); expect(target.disabled).toBe(false)
  await act(async () => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    if (target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))) target.focus()
  })
  await settle()
  await act(async () => {
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    target.click()
  })
  await settle(); await tick()
}
async function field(label, value, flushFrame = true) {
  await act(async () => {
    const target = input(label); expect(target).toBeTruthy()
    target.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle(); if (flushFrame) await tick()
}
async function open(replace = false) {
  await act(async () => editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key: replace ? 'h' : 'f', ctrlKey: true, bubbles: true, cancelable: true })))
  await settle(); await tick()
  expect(document.activeElement).toBe(input('查找内容'))
}
const highlight = () => [...(CSS.highlights.get('notepad-document-find') || [])]

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; frames = new Map(); frameId = 0; history = createEmptyHistoryState(); rangeRects = () => []; scrollCalls = []
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++frameId; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.stubGlobal('CSS', { ...(globalThis.CSS || {}), highlights: new Map() })
  vi.stubGlobal('Highlight', class extends Set { constructor(...ranges) { super(ranges) } })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Only jsdom's absent layout APIs are supplied. SearchPlugin, Lexical, Table,
  // controls, replacement, history, and the DOM Range itself remain production.
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await mount()
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); frames.clear()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors.map(error => error.stack)).toEqual([])
})

test('actual far-row search reveals the matched line instead of the centre of its very tall paragraph', async () => {
  const values = Array.from({ length: 80 }, (_, r) => Array.from({ length: 3 }, (_, c) => `row-${r + 1}-column-${c + 1}`))
  values[79][2] = 'TARGET ' + 'long content '.repeat(200)
  await seed(values)
  const before = snapshot(), table = host.querySelector('table'), target = table.rows[79].cells[2].querySelector('p')
  Object.defineProperties(table, { clientWidth: { value: 600 }, clientHeight: { value: 400 }, scrollWidth: { value: 800 }, scrollHeight: { value: 25000 } })
  table.style.overflowX = table.style.overflowY = 'auto'
  table.getBoundingClientRect = () => rect(100, 100, 600, 400)
  table.scrollTo = options => { scrollCalls.push(options); table.scrollTop = Math.max(0, Math.min(24600, options.top)); table.scrollLeft = Math.max(0, Math.min(200, options.left)) }
  for (const [r, row] of [...table.rows].entries()) for (const [c, cell] of [...row.cells].entries()) {
    if (r === 0 || c === 0) cell.style.position = 'sticky'
    cell.getBoundingClientRect = () => rect(100 + c * 280 - (c ? table.scrollLeft : 0), r ? 100 + r * 280 - table.scrollTop : 100, 240, r ? 1200 : 56)
  }
  target.scrollIntoView = () => {
    // Browser centre alignment of this 1200px paragraph places its first line
    // above the 400px Table viewport, despite the element being the right one.
    table.scrollTop = 79 * 280 + 600 - 200
    table.scrollLeft = 200
  }
  rangeRects = range => target.contains(range.startContainer) ? [rect(672 - table.scrollLeft, 79 * 280 + 108 - table.scrollTop, 70, 20)] : []
  await open(); await field('查找内容', 'TARGET')
  expect(host.querySelector('.search-count').textContent).toBe('1/1')
  const [range] = highlight(); expect(range.toString()).toBe('TARGET')
  expect(target.contains(range.startContainer)).toBe(true)
  const line = range.getClientRects()[0]
  expect(line.top).toBeGreaterThanOrEqual(156)
  expect(line.bottom).toBeLessThanOrEqual(500)
  expect(line.left).toBeGreaterThanOrEqual(340)
  expect(line.right).toBeLessThanOrEqual(700)
  expect(document.activeElement).toBe(input('查找内容'))
  expect(snapshot()).toEqual(before)
})

test('matching never joins the end of one Table cell to the next cell', async () => {
  await seed([['al', 'pha']]); const before = snapshot()
  await open(); await field('查找内容', 'alpha')
  expect(host.querySelector('.search-count').textContent).toBe('0 处')
  expect(highlight()).toEqual([])
  expect(snapshot()).toEqual(before)
})

test('single replacement, later ordinary input, row deletion and undo preserve the other cells', async () => {
  await open(true); await field('查找内容', 'alpha'); await field('替换内容', 'β'); await click('替换当前')
  expect(texts()).toEqual([['β', 'keep'], ['alpha', 'tail'], ['al', 'pha']])
  await click('关闭文内查找')
  await act(async () => { editor.getRootElement().focus(); await new Promise(resolve => setTimeout(resolve, 0)) })
  await settle()
  const text = host.querySelector('table').rows[1].cells[1].querySelector('[data-lexical-text]').firstChild
  await act(async () => {
    text.parentElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    document.getSelection().setBaseAndExtent(text, 0, text, 4)
    document.dispatchEvent(new Event('selectionchange'))
    text.parentElement.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
  expect(document.getSelection().toString()).toBe('tail')
  expect(editor.getEditorState().read(() => $getSelection()?.getTextContent())).toBe('tail')
  await act(async () => {
    expect(CAN_USE_BEFORE_INPUT).toBe(true)
    const range = document.getSelection().getRangeAt(0).cloneRange()
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'tail新' })
    Object.defineProperty(event, 'getTargetRanges', { value: () => [range] })
    editor.getRootElement().dispatchEvent(event)
  })
  await settle(); expect(texts()[1][1]).toBe('tail新')
  const edited = snapshot()
  await click('表格单元格操作'); await click('删除当前行')
  expect(texts()).toEqual([['β', 'keep'], ['al', 'pha']])
  await click('撤销')
  expect(snapshot()).toEqual(edited)
})

test('confirmed replacement across two Table cells is one exact undoable change', async () => {
  const before = snapshot()
  await open(true); await field('查找内容', 'alpha'); await field('替换内容', 'β'); await click('全部替换…')
  expect(snapshot()).toEqual(before)
  await click('确认全部替换')
  expect(texts()).toEqual([['β', 'keep'], ['β', 'tail'], ['al', 'pha']])
  await click('撤销')
  expect(snapshot()).toEqual(before)
})

test('cancelling Table replacement confirmation never changes the saved document shape', async () => {
  const before = snapshot()
  await open(true); await field('查找内容', 'alpha'); await field('替换内容', 'β'); await click('全部替换…'); await click('取消')
  expect(snapshot()).toEqual(before)
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

test('Table search stays available in reading mode without exposing mutation controls', async () => {
  await act(async () => editor.setEditable(false)); const before = snapshot()
  await open(true); await field('查找内容', 'alpha')
  expect(host.querySelector('.search-count').textContent).toBe('1/2')
  expect(highlight()[0].toString()).toBe('alpha')
  expect(input('替换内容')).toBeNull(); expect(button('显示替换').disabled).toBe(true)
  expect(snapshot()).toEqual(before)
})

test('becoming read-only retires pending Table replacement consent', async () => {
  const before = snapshot()
  await open(true); await field('查找内容', 'alpha'); await field('替换内容', 'β'); await click('全部替换…')
  await act(async () => editor.setEditable(false)); await settle()
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(snapshot()).toEqual(before)
})

test('document replacement cancels the old pending Table range and confirmation', async () => {
  await open(true); await field('查找内容', 'alpha'); await field('替换内容', 'β'); await click('全部替换…')
  await field('查找内容', 'tail', false)
  const oldRange = highlight()[0]
  await mount('B'); await tick()
  expect(host.querySelector('.document-search')).toBeNull()
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(highlight()).toEqual([])
  expect(oldRange?.startContainer.isConnected).not.toBe(true)
  expect(texts()).toEqual(initialCells)
})

test('ordinary paragraphs and code blocks retain their existing navigation paths', async () => {
  let codeKey
  await act(async () => editor.update(() => {
    const code = $createCodeBlockNode('unique-code-result', 'plaintext'); codeKey = code.getKey(); $getRoot().append(code)
  }, { discrete: true }))
  await settle(); const before = snapshot(), events = []
  const paragraphScroll = vi.spyOn(editor.getRootElement().querySelector(':scope > p'), 'scrollIntoView')
  const codeScroll = vi.spyOn(editor.getElementByKey(codeKey), 'scrollIntoView')
  const listener = event => events.push(event.detail)
  window.addEventListener('editor:code-search-match', listener)
  try {
    await open(); await field('查找内容', 'outside unique')
    expect(highlight()[0].toString()).toBe('outside unique')
    expect(paragraphScroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' })
    await field('查找内容', 'unique-code-result')
    expect(codeScroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' })
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ offset: 0, length: 18, focus: false })
    expect(highlight()).toEqual([])
    expect(document.activeElement).toBe(input('查找内容'))
    expect(snapshot()).toEqual(before)
  } finally { window.removeEventListener('editor:code-search-match', listener) }
})
