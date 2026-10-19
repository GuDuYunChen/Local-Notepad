import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import { toast } from '~/services/toast'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let root, host, editor, errors, finishClipboard, clipboard
let props
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const cellTexts = () => snapshot().root.children[0].children.map(row => row.children.map(cell => cell.children[0].children.map(text => text.text).join('')))

function EditorMode({ editable }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => {
    editor = instance
    if (editor.isEditable() !== editable) editor.setEditable(editable)
  }, [instance, editable])
  return null
}

function Harness({ editable, showPlugin, documentId }) {
  return (
    <LexicalComposer initialConfig={{
      namespace: 'table-clipboard-session', editable: true, nodes: [TableNode, TableRowNode, TableCellNode],
      editorState: () => {
        const table = $createTableNode()
        for (const values of [['A1', 'A2'], ['B1', 'B2']]) {
          const row = $createTableRowNode()
          for (const value of values) row.append($createTableCellNode().append($createParagraphNode().append($createTextNode(value))))
          table.append(row)
        }
        $getRoot().append(table)
      },
      onError: error => errors.push(error),
    }}>
      <EditorMode editable={editable} />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        {showPlugin && <TableSelectionPlugin documentId={documentId} />}
      </div>
    </LexicalComposer>
  )
}

async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<Harness {...props} />))
  await settle()
}

const pasteButton = () => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === '粘贴')

async function selectFirstCell() {
  await act(async () => window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true })))
  await settle()
  const cell = host.querySelector('td')
  expect(cell).toBeTruthy()
  await act(async () => {
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await settle()
  expect(pasteButton()?.disabled).toBe(false)
}

async function startPaste() {
  await act(async () => pasteButton().click())
  await settle()
  expect(clipboard.readText).toHaveBeenCalledTimes(1)
  expect(finishClipboard).toBeTypeOf('function')
}

async function completePaste(text = 'clipboard value') {
  await act(async () => finishClipboard(text))
  await settle()
  expect(errors).toEqual([])
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  finishClipboard = undefined
  props = { editable: true, showPlugin: true, documentId: 'note-A' }
  vi.clearAllMocks()
  clipboard = { readText: vi.fn(() => new Promise(resolve => { finishClipboard = resolve })), writeText: vi.fn() }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await render()
  await selectFirstCell()
  expect(cellTexts()).toEqual([['A1', 'A2'], ['B1', 'B2']])
  expect(errors).toEqual([])
})

afterEach(async () => {
  await act(async () => root.unmount())
  if (finishClipboard) await completePaste('')
  host.remove()
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const boundaries = [
  ['reading mode', () => render({ editable: false })],
  ['reading and an editing return', async () => { await render({ editable: false, showPlugin: false }); await render({ editable: true, showPlugin: true }) }],
  ['plugin unmount', () => render({ showPlugin: false })],
  ['document change', () => render({ documentId: 'note-B' })],
  ['document A-B-A return', async () => { await render({ documentId: 'note-B' }); await render({ documentId: 'note-A' }) }],
]

for (const [label, transition] of boundaries) {
  test(`a clipboard read completed after ${label} cannot rewrite the table`, async () => {
    const before = snapshot(), originalEditor = editor
    await startPaste()
    await transition()
    expect(editor).toBe(originalEditor)
    await completePaste()
    expect(snapshot()).toEqual(before)
    expect(toast.success).not.toHaveBeenCalled()
  })
}

test('a stale paste click at the editable boundary cannot start a clipboard request', async () => {
  const button = pasteButton(), before = snapshot()
  await act(async () => { editor.setEditable(false); button.click() })
  await settle()
  expect(clipboard.readText).not.toHaveBeenCalled()
  expect(snapshot()).toEqual(before)
})

test('a queued tableAction cannot clear content after the live editor becomes read-only', async () => {
  const before = snapshot()
  await act(async () => {
    editor.setEditable(false)
    window.dispatchEvent(new CustomEvent('tableAction', { detail: { type: 'clear' } }))
  })
  await settle()
  expect(snapshot()).toEqual(before)
})

test('a current editable clipboard read still updates only the selected table cell', async () => {
  await startPaste()
  await completePaste()
  expect(cellTexts()).toEqual([['clipboard value', 'A2'], ['B1', 'B2']])
  expect(toast.success).toHaveBeenCalledTimes(1)
})
