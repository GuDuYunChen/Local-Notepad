import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import TableActionMenuPlugin from './TableActionMenuPlugin'
import { dispatchTableEvent, isTableEventForEditor } from '../utils/tableEvents'
import { $deleteRowAtCell } from '../utils/tableModel'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, root, editors, errors
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

function Capture({ id }) {
  const [editor] = useLexicalComposerContext()
  useLayoutEffect(() => { editors[id] = editor }, [id, editor])
  return null
}

function Harness({ id }) {
  return <LexicalComposer initialConfig={{
    namespace: `table-event-${id}`, nodes: [TableNode, TableRowNode, TableCellNode],
    onError: error => errors.push(error),
    editorState: () => {
      const table = $createTableNode()
      for (const values of [[`${id}-A`, `${id}-B`], [`${id}-C`, `${id}-D`]]) {
        table.append($createTableRowNode().append(...values.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
      }
      $getRoot().append(table)
    },
  }}>
    <div className="editor-container" data-owner={id}>
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TablePlugin /><Capture id={id} />
      <TableSelectionPlugin documentId={`note-${id}`} /><TableActionMenuPlugin documentId={`note-${id}`} />
    </div>
  </LexicalComposer>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  editors = {}; errors = []; vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function render(ids = ['a']) {
  await act(async () => root.render(ids.map(id => <Harness key={id} id={id} />)))
  await settle()
}
const container = id => host.querySelector(`[data-owner="${id}"]`)
const mode = id => container(id).querySelector('.table-selection-modebar')
const button = (label, id = 'a') => [...container(id).querySelectorAll('button')].find(node => node.textContent.trim() === label)
async function openMenu(id = 'a') {
  await act(async () => editors[id].update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectEnd(), { discrete: true }))
  await settle()
  await act(async () => container(id).querySelector('[aria-label="表格单元格操作"]').click())
  await settle()
  return container(id).querySelector('[role="menu"]')
}

test('a legacy window mode event routes to the only attached editor', async () => {
  await render()
  let facts
  const inspect = event => {
    facts = {
      matches: isTableEventForEditor(editors.a, event),
      globalIdentity: event.target === window,
      viewIdentity: event.target === document.defaultView,
      sameDocument: event.target?.document === document,
      selfWindow: event.target?.window === event.target,
      editorCount: document.querySelectorAll('[data-lexical-editor="true"]').length,
    }
  }
  window.addEventListener('tableSelection:mode', inspect)
  try {
    await act(async () => window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true })))
    await settle()
    expect(facts.matches, JSON.stringify(facts)).toBe(true)
    expect(mode('a')).toBeTruthy()
  } finally {
    window.removeEventListener('tableSelection:mode', inspect)
  }
})

test('an unfocused window event never broadcasts a mutation to multiple editors', async () => {
  await render(['a', 'b'])
  const before = Object.fromEntries(Object.entries(editors).map(([id, editor]) => [id, editor.getEditorState().toJSON()]))
  await act(async () => {
    window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true }))
    window.dispatchEvent(new CustomEvent('tableAction', { detail: { type: 'clear' } }))
  })
  await settle()
  expect(mode('a')).toBeNull()
  expect(mode('b')).toBeNull()
  for (const [id, editor] of Object.entries(editors)) expect(editor.getEditorState().toJSON()).toEqual(before[id])
  expect(errors).toEqual([])
})

test('a focused legacy window event activates only the owning editor', async () => {
  await render(['a', 'b'])
  await act(async () => editors.b.getRootElement().focus())
  await settle()
  await act(async () => window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true })))
  await settle()
  expect(mode('a')).toBeNull()
  expect(mode('b')).toBeTruthy()
  expect(errors).toEqual([])
})

test('a rooted mode event reaches its owner even when another editor has focus', async () => {
  await render(['a', 'b'])
  await act(async () => editors.b.getRootElement().focus())
  await settle()
  await act(async () => dispatchTableEvent(editors.a, 'tableSelection:mode', true))
  await settle()
  expect(mode('a')).toBeTruthy()
  expect(mode('b')).toBeNull()
  expect(button('粘贴').disabled).toBe(true)
  expect(errors).toEqual([])
})

test('a child editor rooted event does not route to a containing editor', () => {
  const outer = document.createElement('div'), inner = document.createElement('div')
  outer.dataset.lexicalEditor = 'true'; inner.dataset.lexicalEditor = 'true'
  outer.append(inner); host.append(outer)
  const parentEditor = { getRootElement: () => outer }, childEditor = { getRootElement: () => inner }
  const routes = []
  const inspect = event => routes.push([isTableEventForEditor(parentEditor, event), isTableEventForEditor(childEditor, event)])
  window.addEventListener('tableSelection:mode', inspect)
  try {
    dispatchTableEvent(childEditor, 'tableSelection:mode', true)
    expect(routes).toEqual([[false, true]])
  } finally {
    window.removeEventListener('tableSelection:mode', inspect)
  }
})

test('a global paste with no focused owner cannot write into two active table selections', async () => {
  await render(['a', 'b'])
  const clipboard = { readText: vi.fn().mockResolvedValue('unowned paste') }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  for (const id of ['a', 'b']) {
    await act(async () => dispatchTableEvent(editors[id], 'tableSelection:mode', true))
    await settle()
    const cell = container(id).querySelector('td')
    await act(async () => {
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    })
    await settle()
    expect(button('粘贴', id).disabled).toBe(false)
  }
  await act(async () => document.activeElement?.blur())
  expect(document.activeElement).toBe(document.body)
  const before = Object.fromEntries(Object.entries(editors).map(([id, editor]) => [id, editor.getEditorState().toJSON()]))
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })))
  await settle()
  expect(clipboard.readText).not.toHaveBeenCalled()
  for (const [id, editor] of Object.entries(editors)) expect(editor.getEditorState().toJSON()).toEqual(before[id])
  expect(errors).toEqual([])
})

test('menu arrow keys and Escape maintain keyboard focus without editing the document', async () => {
  await render()
  const menu = await openMenu()
  const before = editors.a.getEditorState().toJSON()
  const choices = [...menu.querySelectorAll('button:not(:disabled)')]
  expect(document.activeElement).toBe(choices[0])
  await act(async () => choices[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement).toBe(choices[1])
  await act(async () => choices[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement).toBe(choices.at(-1))
  await act(async () => choices.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await settle()
  expect(container('a').querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(container('a').querySelector('[aria-label="表格单元格操作"]'))
  expect(editors.a.getEditorState().toJSON()).toEqual(before)
  expect(errors).toEqual([])
})

test('moving keyboard focus outside the menu closes it without swallowing the next control', async () => {
  await render()
  await openMenu()
  const next = document.createElement('button')
  next.textContent = 'outside control'; host.append(next)
  const before = editors.a.getEditorState().toJSON()
  await act(async () => next.focus())
  await settle()
  expect(document.activeElement).toBe(next)
  expect(container('a').querySelector('[role="menu"]')).toBeNull()
  expect(editors.a.getEditorState().toJSON()).toEqual(before)
  expect(errors).toEqual([])
})

test('a retained menu click cannot delete the neighbouring row after a structural update', async () => {
  await render()
  await openMenu()
  const remove = button('删除当前行')
  let afterDelete
  await act(async () => {
    editors.a.update(() => $deleteRowAtCell($getRoot().getFirstChild().getFirstChild().getFirstChild()), { discrete: true })
    afterDelete = editors.a.getEditorState().toJSON()
    remove.click()
  })
  await settle()
  expect(editors.a.getEditorState().toJSON()).toEqual(afterDelete)
  expect(afterDelete.root.children[0].children).toHaveLength(1)
  expect(container('a').querySelector('[role="menu"]')).toBeNull()
  expect(errors).toEqual([])
})
