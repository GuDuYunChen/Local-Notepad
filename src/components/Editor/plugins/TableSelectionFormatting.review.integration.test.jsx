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
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { LinkNode } from '@lexical/link'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { AttachmentNode } from '../nodes/AttachmentNode'
import { FormulaNode } from '../nodes/FormulaNode'
import { CodeBlockNode } from '../nodes/CodeBlockNode'
import { ImageNode } from '../nodes/ImageNode'
import { ImageGridNode } from '../nodes/ImageGridNode'
import { VideoNode } from '../nodes/VideoNode'
import { uiQuery, prepareUiSelectChange, changeUiValue } from '~/test/uiControlDriver'
import TableSelectionPlugin from './TableSelectionPlugin'
import ToolbarPlugin from './ToolbarPlugin'
import FloatingTextToolbarPlugin from './FloatingTextToolbarPlugin'
import CodeBlockPlugin from './CodeBlockPlugin'
import PasteImagePlugin from './PasteImagePlugin'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn(), uploadImage: vi.fn() }))
vi.mock('../utils/fileUpload', async original => ({ ...await original(), uploadFile: mocks.uploadFile, generateVideoMetadata: async () => ({ duration: 1 }) }))
vi.mock('../utils/imageUpload', async original => ({ ...await original(), uploadImage: mocks.uploadImage }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), loading: () => vi.fn() } }))

let host, reactRoot, editor, errors, finishUpload, finishImage
const captureWindowError = event => { errors.push(event.error || new Error(event.message)) }
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
// Deliver native asynchronous selectionchange like Chromium, rather than
// happy-dom's synchronous selection reconciliation inside Lexical updates.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const frame = () => act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const button = (scope, label) => [...scope.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent === label)
const main = () => host.querySelector('.editor-toolbar')

function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness() {
  return <LexicalComposer initialConfig={{ namespace: 'table-format-owner', nodes: [TableNode, TableRowNode, TableCellNode, HeadingNode, QuoteNode, ListItemNode, ListNode, AttachmentNode, FormulaNode, CodeBlockNode, ImageNode, ImageGridNode, VideoNode, LinkNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (const row of [['OLD-CELL', 'other'], ['selected-C', 'selected-D']]) table.append($createTableRowNode().append(...row.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    $getRoot().append(table, $createParagraphNode().append($createTextNode('Outside table')))
  } }}>
    <div className="editor-shell">
      <ToolbarPlugin documentId="table-format-owner" />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TablePlugin /><ListPlugin /><CheckListPlugin /><LinkPlugin /><CodeBlockPlugin /><PasteImagePlugin documentId="table-format-owner" /><Capture />
        <FloatingTextToolbarPlugin /><TableSelectionPlugin documentId="table-format-owner" />
      </div>
    </div>
  </LexicalComposer>
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); errors = []
  window.addEventListener('error', captureWindowError)
  mocks.uploadFile.mockReset().mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
  mocks.uploadImage.mockReset().mockImplementation(() => new Promise(resolve => { finishImage = resolve }))
  // jsdom has no layout observer; these tests exercise control actions, not
  // resize measurements. Native geometry remains covered by Windows gates.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // Only supply missing layout measurements; all selection, buttons and Select
  // options below are the actual Lexical / Ant Design mounted controls.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 180, 60, 24) })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness />)); await settle()
  const text = cells()[0].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await settle(); await frame()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? selection.getTextContent() : null
  })).toBe('OLD')
  expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  window.removeEventListener('error', captureWindowError)
  if (rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeGeometry)
  else delete Range.prototype.getBoundingClientRect
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click()); await settle()
}
function enter() { editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true })) }
async function selectOtherCells() {
  await act(async () => enter()); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
}
async function prepareAction(name) {
  if (name === 'bold') return () => button(main(), '加粗').click()
  if (name === 'heading') return prepareUiSelectChange(uiQuery(main(), 'select[aria-label="段落类型"]'), 'h1')
  if (name === 'list') return () => button(main(), '无序列表').click()
  if (name.startsWith('floating')) {
    const control = button(host.querySelector('.floating-text-toolbar'), name === 'floating-bold' ? '加粗' : '高亮')
    expect(control).toBeTruthy()
    return () => control.click()
  }
  await click(button(main(), '更多格式'))
  if (name === 'font') return prepareUiSelectChange(uiQuery(main(), 'select[aria-label="字体"]'), 'Arial')
  if (name === 'size') return prepareUiSelectChange(uiQuery(main(), 'select[aria-label="字号"]'), '24px')
  if (name === 'color') {
    await click(button(main(), '文字颜色'))
    return () => button(main().querySelector('[aria-label="文本颜色选择"]'), '红色').click()
  }
  return () => button(main(), name === 'align' ? '居中' : '增加缩进').click()
}

const formatActions = ['bold', 'heading', 'list', 'font', 'size', 'color', 'align', 'indent']
test.each([...formatActions, 'floating-bold', 'floating-highlight'])('ordinary %s control really formats the selected text', async action => {
  const run = await prepareAction(action), before = snapshot()
  await act(async () => run()); await settle()
  expect(snapshot()).not.toEqual(before)
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})
test.each(formatActions)('bulk selection blocks the actual %s control from writing the old text range', async action => {
  await selectOtherCells()
  const run = await prepareAction(action), before = snapshot(), storedFont = localStorage.getItem('editor-font-family')
  await act(async () => run()); await settle()
  expect(snapshot()).toEqual(before)
  expect(localStorage.getItem('editor-font-family')).toBe(storedFont)
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(errors).toEqual([])
})
test.each(['bold', 'floating-bold', 'floating-highlight'])('accepted multi-selection ownership blocks %s before React paints the modebar', async action => {
  const run = await prepareAction(action), before = snapshot()
  await act(async () => {
    enter()
    // Both real controls can receive events before React commits the pending
    // modebar render; accepted editor ownership must already be authoritative.
    run()
  }); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

async function startAttachment() {
  await click(button(main(), '插入内容'))
  const input = main().querySelector('input[type="file"]:not([accept])')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['owned'], 'owned.txt', { type: 'text/plain' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
test('ordinary asynchronous attachment inserts through the real toolbar', async () => {
  await startAttachment(); expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  await act(async () => { finishUpload({ url: '/api/assets/owned.txt' }); await Promise.resolve() }); await settle()
  expect(JSON.stringify(snapshot())).toContain('"type":"attachment"')
  expect(errors).toEqual([])
})
test('starting an attachment while cells are selected does not upload or write the old text range', async () => {
  await selectOtherCells(); const before = snapshot()
  await startAttachment()
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test.each([false, true])('pending attachment cannot revive after bulk selection changes ownership (exit=%s)', async exit => {
  await startAttachment(); expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  await selectOtherCells()
  if (exit) await click(button(host.querySelector('.table-selection-modebar'), '完成'))
  const before = snapshot()
  await act(async () => { finishUpload({ url: '/api/assets/owned.txt' }); await Promise.resolve() }); await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each([['代码块', 'code-block'], ['数学公式', 'formula']])('ordinary %s toolbar insertion writes through the current selected cell', async (label, type) => {
  await click(button(main(), '插入内容'))
  await click(button(main(), label))
  expect(JSON.stringify(snapshot())).toContain('"type":"' + type + '"')
  expect(errors).toEqual([])
})
test.each(['代码块', '数学公式'])('bulk selection prevents %s insertion from replacing the old unselected text', async label => {
  await selectOtherCells(); const before = snapshot()
  await click(button(main(), '插入内容'))
  await click(button(main(), label))
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

async function selectOutside() {
  const paragraph = editor.getRootElement().lastElementChild
  const text = paragraph.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    // Native pointer ownership distinguishes this new user caret from the
    // selectionchange still pending after the editor's own DOM reconciliation.
    for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) paragraph.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }))
    document.getSelection().setBaseAndExtent(text, text.textContent.length, text, text.textContent.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? selection.anchor.getNode().getTextContent() : null
  })).toBe('Outside table')
}
async function openTableMenu() {
  await click(button(main(), '插入内容'))
  await click(main().querySelector('.table-insert-trigger'))
}
test('ordinary grid insertion after a table retains the first table and inserts a second', async () => {
  await selectOutside(); const original = snapshot().root.children[0]
  await openTableMenu(); await click(main().querySelector('[aria-label="2 行 2 列"]'))
  expect(snapshot().root.children.filter(node => node.type === 'table'), JSON.stringify(snapshot())).toHaveLength(2)
  expect(snapshot().root.children[0]).toEqual(original)
  expect(errors).toEqual([])
})
test.each([false, true])('an already-open insert grid cannot revive after bulk ownership changes (exit=%s)', async exit => {
  await selectOutside(); await openTableMenu()
  await selectOtherCells()
  if (exit) await click(button(host.querySelector('.table-selection-modebar'), '完成'))
  const before = snapshot()
  await click(main().querySelector('[aria-label="2 行 2 列"]'))
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

async function startMedia(kind) {
  await click(button(main(), '插入内容'))
  const input = main().querySelector('input[accept="' + kind + '/*"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['owned'], 'owned.' + (kind === 'image' ? 'png' : 'mp4'), { type: kind + '/' + (kind === 'image' ? 'png' : 'mp4') })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await settle()
}
async function completeMedia(kind) {
  await act(async () => {
    if (kind === 'image') finishImage({ src: '/api/assets/owned.png', originalSrc: '/api/assets/owned.png', alt: 'owned.png' })
    else finishUpload({ url: '/api/assets/owned.mp4' })
    await Promise.resolve()
  }); await settle()
}
test.each(['image', 'video'])('ordinary async %s toolbar insertion remains available', async kind => {
  await startMedia(kind); await completeMedia(kind)
  expect(JSON.stringify(snapshot())).toContain('"type":"' + kind + '"')
  expect(errors).toEqual([])
})
test.each(['image', 'video'])('a pending %s completion cannot write after entering and exiting bulk selection', async kind => {
  await startMedia(kind); await selectOtherCells()
  await click(button(host.querySelector('.table-selection-modebar'), '完成'))
  const before = snapshot(); await completeMedia(kind)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
async function openLink() {
  await click(button(main(), '添加链接'))
  await changeUiValue(main().querySelector('[aria-label="链接地址或章节锚点"]'), 'https://example.test/owned')
}
test('ordinary link popup applies to the actual selected text', async () => {
  await openLink(); await click(button(main(), '应用'))
  expect(JSON.stringify(snapshot())).toContain('https://example.test/owned')
  expect(errors).toEqual([])
})
test.each([false, true])('an open link popup cannot apply a stale target after bulk selection changes (exit=%s)', async exit => {
  await openLink(); await selectOtherCells()
  if (exit) await click(button(host.querySelector('.table-selection-modebar'), '完成'))
  const before = snapshot(); await click(button(main(), '应用'))
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

async function pasteImage() {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  // jsdom lacks ClipboardEvent/DataTransfer constructors. Supply the browser
  // clipboard payload while dispatching the real root paste event through
  // Lexical's registered DOM listener and the actual PasteImagePlugin.
  Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['owned'], 'pasted.png', { type: 'image/png' })] } })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  expect(event.defaultPrevented).toBe(true)
  expect(mocks.uploadImage).toHaveBeenCalledTimes(1)
}
test('ordinary native paste starts the shared image session and inserts its completed image', async () => {
  await pasteImage(); await completeMedia('image')
  expect(JSON.stringify(snapshot())).toContain('"type":"image"')
  expect(errors).toEqual([])
})
test.each([false, true])('pending pasted image cannot write after bulk selection takes ownership (exit=%s)', async exit => {
  await pasteImage(); await selectOtherCells()
  if (exit) await click(button(host.querySelector('.table-selection-modebar'), '完成'))
  const before = snapshot(); await completeMedia('image')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
