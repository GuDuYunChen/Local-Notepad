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
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_NORMAL, KEY_DOWN_COMMAND } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { CodeBlockNode, $createCodeBlockNode } from '../nodes/CodeBlockNode'
import { FormulaNode, $createFormulaNode } from '../nodes/FormulaNode'
import { changeUiValue } from '~/test/uiControlDriver'
import CodeBlockPlugin from './CodeBlockPlugin'

let host, reactRoot, editor, errors
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)))
const snapshot = (instance = editor) => instance.getEditorState().toJSON()
const captureWindowError = event => errors.push(event.error || new Error(event.message))
const capturePrimary = instance => { editor = instance }
function Capture({ receive }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { receive(instance) }, [instance, receive])
  return null
}
function Harness({ receive = capturePrimary, guarded = true } = {}) {
  return <LexicalComposer initialConfig={{ namespace: 'table-code-control-owner',
    theme: { codeBlock: 'code-block-wrapper' },
    nodes: [TableNode, TableRowNode, TableCellNode, CodeBlockNode, FormulaNode],
    onError: error => errors.push(error), editorState: () => {
      const table = $createTableNode()
      for (const values of [['KEEP-CELL', 'NEXT-CELL'], ['other-A', 'other-B']]) {
        table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
      }
      $getRoot().append(table, $createParagraphNode().append($createTextNode('Outside paragraph')), $createCodeBlockNode('const owned = 1', 'plaintext'))
    } }}>
    <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
    <TablePlugin /><TabIndentationPlugin maxIndent={8} />
    {guarded && <CodeBlockPlugin />}<Capture receive={receive} />
  </LexicalComposer>
}
async function caret(element, instance = editor, offset) {
  const text = element.querySelector('[data-lexical-text="true"]').firstChild
  const position = offset ?? text.length
  await act(async () => {
    instance.getRootElement().focus()
    for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }))
    document.getSelection().setBaseAndExtent(text, position, text, position)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(instance.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text' && selection.anchor.getNode().getTextContent() === text.data
  })).toBe(true)
}
async function focus(control) {
  expect(control).toBeTruthy()
  await act(async () => control.focus()); await settle()
  expect(document.activeElement).toBe(control)
}
async function press(control, key, init = {}) {
  const codes = { Enter: 13, Tab: 9, F6: 117, s: 83 }
  const event = new KeyboardEvent('keydown', { key, code: key === 's' ? 'KeyS' : key, keyCode: codes[key], bubbles: true, cancelable: true, ...init })
  await act(async () => control.dispatchEvent(event)); await settle()
  return event
}
async function codeControl(kind) {
  if (kind === 'header button') {
    // Use the product's F6 entrance: it preserves the current Table range
    // while moving focus to the genuine first language/header action.
    expect((await press(editor.getRootElement(), 'F6')).defaultPrevented).toBe(true)
    return host.querySelector('.language-selector-button')
  }
  if (kind === 'search input') {
    await act(async () => host.querySelector('.language-selector-button').click()); await settle()
    return host.querySelector('input.language-selector-search')
  }
  return host.querySelector('.code-textarea')
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; errors = []
  window.addEventListener('error', captureWindowError)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  if (!rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(100, 180, 60, 24) })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  await act(async () => reactRoot.render(<Harness />)); await settle()
  // Restore an ordinary collapsed Table caret through Lexical's public
  // selection API before the user focuses a real decorator control.
  await act(async () => {
    editor.getRootElement().focus()
    editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectEnd(), { discrete: true })
  }); await settle()
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.getNode().getTextContent() === 'KEEP-CELL'
  })).toBe(true)
  expect(errors).toEqual([])
})
afterEach(async () => {
  await act(async () => reactRoot.unmount()); host.remove()
  window.removeEventListener('error', captureWindowError)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  if (!rangeGeometry) delete Range.prototype.getBoundingClientRect
})

for (const kind of ['textarea', 'header button', 'search input']) test.each(['Enter', 'Tab'])(`the actual code ${kind} owns %s without editing the retained Table caret`, async key => {
  const control = await codeControl(kind), before = snapshot()
  await focus(control)
  expect(editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? selection.anchor.getNode().getTextContent() : null
  })).toBe('KEEP-CELL')
  const event = await press(control, key)
  expect(event.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(control)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each(['textarea', 'header button', 'search input'])('the window Save shortcut still receives Ctrl+S from the code %s', async kind => {
  const control = await codeControl(kind), before = snapshot(), saveShortcut = vi.fn()
  const listener = event => { if (event.ctrlKey && event.key === 's') saveShortcut(event) }
  window.addEventListener('keydown', listener)
  try {
    await focus(control)
    const event = await press(control, 's', { ctrlKey: true })
    expect(saveShortcut).toHaveBeenCalledTimes(1)
    expect(saveShortcut).toHaveBeenCalledWith(event)
    expect(event.defaultPrevented).toBe(false)
    expect(snapshot()).toEqual(before)
    expect(errors).toEqual([])
  } finally { window.removeEventListener('keydown', listener) }
})

test('ordinary paragraph Enter still splits the selected paragraph', async () => {
  await caret(editor.getRootElement().querySelector(':scope > p'))
  const before = snapshot()
  await press(editor.getRootElement(), 'Enter')
  expect(snapshot().root.children.filter(node => node.type === 'paragraph')).toHaveLength(2)
  expect(snapshot().root.children[0]).toEqual(before.root.children[0])
  expect(errors).toEqual([])
})
test('ordinary paragraph Tab still uses the existing indentation plugin', async () => {
  await caret(editor.getRootElement().querySelector(':scope > p'), editor, 0)
  const before = snapshot()
  expect((await press(editor.getRootElement(), 'Tab')).defaultPrevented).toBe(true)
  expect(snapshot().root.children[1].indent).toBe(1)
  expect(snapshot().root.children[0]).toEqual(before.root.children[0])
  expect(errors).toEqual([])
})
test('ordinary Table Tab still moves to the next actual cell', async () => {
  const before = snapshot()
  expect((await press(editor.getRootElement(), 'Tab')).defaultPrevented).toBe(true)
  expect(editor.getEditorState().read(() => $getSelection().anchor.getNode().getTextContent())).toBe('NEXT-CELL')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('the actual code textarea still commits its own edited value', async () => {
  const before = snapshot(), control = await codeControl('textarea')
  await focus(control)
  await changeUiValue(control, 'const updated = 2\nreturn updated')
  await settle()
  expect(snapshot().root.children.find(node => node.type === 'code-block').code).toBe('const updated = 2\nreturn updated')
  expect(snapshot().root.children[0]).toEqual(before.root.children[0])
  expect(errors).toEqual([])
})
test('the actual code header action keeps its original click behavior', async () => {
  const before = snapshot(), control = host.querySelector('.code-block-toolbar button')
  await focus(control); await act(async () => control.click()); await settle()
  expect(control.textContent).toBe('取消换行')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('F6 still enters the existing language action and header Tab preserves its native boundary', async () => {
  const before = snapshot(), language = host.querySelector('.language-selector-button')
  expect((await press(editor.getRootElement(), 'F6')).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(language)
  expect((await press(language, 'Tab')).defaultPrevented).toBe(false)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
test('another genuine decorator control still reaches its own Lexical command listener', async () => {
  await act(async () => editor.update(() => $getRoot().append($createFormulaNode()), { discrete: true })); await settle()
  const control = host.querySelector('.formula-editor textarea'), receive = vi.fn(() => true)
  const unregister = editor.registerCommand(KEY_DOWN_COMMAND, receive, COMMAND_PRIORITY_NORMAL)
  try {
    await focus(control)
    const event = await press(control, 'Enter')
    expect(receive).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledWith(event, editor)
    expect(event.defaultPrevented).toBe(false)
    expect(errors).toEqual([])
  } finally { unregister() }
})
test('a control which does not own focus is not allowed to capture the editor key pipeline', async () => {
  const control = host.querySelector('.code-textarea'), receive = vi.fn(() => true)
  const unregister = editor.registerCommand(KEY_DOWN_COMMAND, receive, COMMAND_PRIORITY_NORMAL)
  try {
    expect(document.activeElement).toBe(editor.getRootElement())
    const event = await press(control, 'Enter')
    expect(receive).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledWith(event, editor)
    expect(errors).toEqual([])
  } finally { unregister() }
})
test('a second editor retains ordinary Enter independently of the first editor code controls', async () => {
  const before = snapshot(), foreignHost = document.createElement('div')
  document.body.append(foreignHost)
  const foreignRoot = createRoot(foreignHost); let foreignEditor
  try {
    await act(async () => foreignRoot.render(<Harness guarded={false} receive={value => { foreignEditor = value }} />)); await settle()
    await caret(foreignEditor.getRootElement().querySelector(':scope > p'), foreignEditor)
    await press(foreignEditor.getRootElement(), 'Enter')
    expect(snapshot(foreignEditor).root.children.filter(node => node.type === 'paragraph')).toHaveLength(2)
    expect(snapshot()).toEqual(before)
    expect(errors).toEqual([])
  } finally { await act(async () => foreignRoot.unmount()); foreignHost.remove() }
})
