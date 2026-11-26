// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot, $setSelection } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import DocumentSessionPlugin, { captureDocumentSelectionSnapshot, readDocumentSession, writeDocumentSession } from './DocumentSessionPlugin'

let host, root, editor, errors, geometry
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
beforeAll(() => {
  geometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  if (!geometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => { if (!geometry) delete Range.prototype.getBoundingClientRect })
function $table(prefix) {
  return $createTableNode().append($createTableRowNode().append(...['first', 'second'].map(value =>
    $createTableCellNode().append($createParagraphNode().append($createTextNode(`${prefix}-${value}`))),
  )))
}
function Capture({ editable }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance; instance.setEditable(editable) }, [instance, editable])
  return null
}
function Harness({ documentId, restoreSelection }) {
  return <LexicalComposer initialConfig={{
    namespace: 'document-table-session-review', nodes: [TableNode, TableRowNode, TableCellNode],
    editorState: () => $getRoot().append($table('A')), onError: error => errors.push(error),
  }}>
    <div className="editor-container">
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <Capture editable={restoreSelection} /><TablePlugin />
      <DocumentSessionPlugin documentId={documentId} restoreSelection={restoreSelection} />
    </div>
  </LexicalComposer>
}
async function render(documentId, restoreSelection) {
  await act(async () => root.render(<Harness documentId={documentId} restoreSelection={restoreSelection} />))
  await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); errors = []
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render('note-A', true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test.each([false, true])('reading note B preserves its own saved table selection instead of note A’s (existing=%s)', async existing => {
  let savedB = null, savedA
  if (existing) {
    await act(async () => editor.update(() => {
      $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectStart()
      savedB = captureDocumentSelectionSnapshot()
    }, { discrete: true }))
    writeDocumentSession('note-B', { scrollTop: 80, selection: savedB })
  }
  await act(async () => editor.update(() => {
    $getRoot().getFirstChild().getFirstChild().getLastChild().getFirstChild().selectEnd()
    savedA = captureDocumentSelectionSnapshot()
  }, { discrete: true }))
  await render('note-B', false)
  // The reused editor receives B's body after the selection-restoration mode
  // has changed, as it does during a real asynchronous document load.
  await act(async () => editor.update(() => {
    $getRoot().clear().append($table('B'))
    $setSelection(null)
  }, { discrete: true }))
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  expect(readDocumentSession('note-A').selection).toEqual(savedA)
  expect(readDocumentSession('note-B').selection).toEqual(savedB)
  expect(errors).toEqual([])
})
