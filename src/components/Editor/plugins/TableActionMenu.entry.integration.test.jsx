import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableActionMenuPlugin from './TableActionMenuPlugin'

let host, root, editor, errors
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()

function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(
    <LexicalComposer initialConfig={{ namespace: 'table-menu-entry', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error) }}>
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <Capture />
        <TableActionMenuPlugin />
      </div>
    </LexicalComposer>,
  ))
  await settle()
  await act(async () => editor.update(() => {
    const paragraph = $createParagraphNode().append($createTextNode('preserved cell'))
    $getRoot().clear().append($createTableNode().append($createTableRowNode().append($createTableCellNode().append(paragraph))))
    paragraph.selectEnd()
  }, { discrete: true }))
  await settle()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('the real cell menu opens and enters existing multiselect without changing the document', async () => {
  const before = snapshot()
  const trigger = host.querySelector('[aria-label="表格单元格操作"]')
  expect(trigger).toBeTruthy()
  await act(async () => trigger.click())
  await settle()
  expect(host.querySelector('[aria-label="表格操作"]')).toBeTruthy()
  const entry = [...host.querySelectorAll('button')].find(button => button.textContent === '多选单元格…')
  expect(entry).toBeTruthy()
  const outcomes = []
  const receive = event => outcomes.push(event.detail)
  window.addEventListener('tableSelection:mode', receive)
  try {
    await act(async () => entry.click())
    await settle()
  } finally {
    window.removeEventListener('tableSelection:mode', receive)
  }
  expect(outcomes).toEqual([true])
  expect(host.querySelector('[aria-label="表格操作"]')).toBeNull()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
