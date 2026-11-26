import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, UNDO_COMMAND, REDO_COMMAND } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import TableSelectionPlugin from './TableSelectionPlugin'
import TableActionMenuPlugin from './TableActionMenuPlugin'
import { toast } from '~/services/toast'

vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, root, editors, errors, finishClipboard, clipboard, props
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const snapshot = (id = 'a') => editors[id].getEditorState().toJSON()
const texts = (id = 'a') => snapshot(id).root.children.filter(n => n.type === 'table').map(t => t.children.map(r => r.children.map(c => c.children.map(p => (p.children || []).map(n => n.text || '').join('')).join('|'))))

function Capture({ id, editable }) {
  const [editor] = useLexicalComposerContext()
  useLayoutEffect(() => { editors[id] = editor; editor.setEditable(editable) }, [editor, id, editable])
  return null
}
function Harness({ id = 'a', editable = true, documentId = 'note-a' }) {
  return <LexicalComposer initialConfig={{ namespace: `table-operations-${id}`, nodes: [TableNode, TableRowNode, TableCellNode], onError: error => errors.push(error), editorState: () => {
    const table = $createTableNode()
    for (let ri = 0; ri < 3; ri++) {
      const row = $createTableRowNode()
      for (let ci = 0; ci < 3; ci++) row.append($createTableCellNode(ri === 0 ? 1 : 0).append($createParagraphNode().append($createTextNode(`${id}${ri}${ci}`))))
      table.append(row)
    }
    $getRoot().append(table, $createParagraphNode().append($createTextNode('outside')))
  } }}>
    <div className="editor-container" data-test-editor={id}>
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/>
      <TablePlugin/><HistoryPlugin/><Capture id={id} editable={editable}/>
      <TableSelectionPlugin documentId={documentId}/><TableActionMenuPlugin documentId={documentId}/>
    </div>
  </LexicalComposer>
}
const container = (id = 'a') => host.querySelector(`[data-test-editor="${id}"]`)
const buttons = (id = 'a') => [...container(id).querySelectorAll('button')]
const button = (text, id = 'a') => buttons(id).find(b => b.textContent.trim() === text)
const getKeys = (ri, ci, id = 'a') => editors[id].getEditorState().read(() => {
  const table = $getRoot().getFirstChild(), row = table.getChildren()[ri], cell = row.getChildren()[ci]
  return { tableKey: table.getKey(), rowKey: row.getKey(), cellKey: cell.getKey(), ri, ci }
})
async function action(type, payload, id = 'a') {
  await act(async () => editors[id].getRootElement().dispatchEvent(new CustomEvent('tableAction', { bubbles: true, detail: { type, payload } })))
  await settle()
}
async function select(r1, c1, r2 = r1, c2 = c1, id = 'a', ctrlKey = false) {
  if (!container(id).querySelector('.table-selection-modebar')) {
    await act(async () => editors[id].getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true })))
    await settle()
  }
  const rows = container(id).querySelector('table').rows, a = rows[r1].cells[c1], b = rows[r2].cells[c2]
  await act(async () => {
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey }))
    b.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, ctrlKey }))
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ctrlKey }))
  })
  await settle()
}
async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<><Harness {...props}/>{props.multiple && <Harness id="b" documentId="note-b"/>}</>))
  await settle()
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  editors = {}; errors = []; props = {}; finishClipboard = undefined; vi.clearAllMocks()
  clipboard = { readText: vi.fn(() => new Promise(resolve => { finishClipboard = resolve })), writeText: vi.fn().mockResolvedValue(undefined) }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  if (finishClipboard) await act(async () => finishClipboard(''))
  host.remove(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('the shipped row and column move commands preserve the other cells', async () => {
  await action('moveRowUp', getKeys(2, 1))
  expect(texts()).toEqual([[['a00', 'a01', 'a02'], ['a20', 'a21', 'a22'], ['a10', 'a11', 'a12']]])
  await action('moveColLeft', getKeys(1, 2))
  expect(texts()).toEqual([[['a00', 'a02', 'a01'], ['a20', 'a22', 'a21'], ['a10', 'a12', 'a11']]])
  expect(errors).toEqual([])
})
test('header cells participate in the same selection and clear operation', async () => {
  await select(0, 0, 0, 1)
  expect(container().querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  await act(async () => button('清空').click()); await settle()
  expect(texts()[0][0]).toEqual(['', '', 'a02'])
  expect(texts()[0][1]).toEqual(['a10', 'a11', 'a12'])
})
test('merging a two by three region preserves every source value exactly once', async () => {
  await select(1, 0, 2, 2)
  await act(async () => button('合并').click()); await settle()
  const table = snapshot().root.children[0]
  expect(table.children[1].children).toHaveLength(1)
  expect(table.children[2].children).toHaveLength(0)
  expect(table.children[1].children[0]).toMatchObject({ colSpan: 3, rowSpan: 2 })
  expect(texts()[0][1][0].split('|').filter(Boolean)).toEqual(['a10', 'a11', 'a12', 'a20', 'a21', 'a22'])
  expect(errors).toEqual([])
})
test('an outstanding clipboard read cannot overwrite a table after a structural edit', async () => {
  await select(1, 1)
  await act(async () => button('粘贴').click()); await settle()
  expect(clipboard.readText).toHaveBeenCalledOnce()
  await action('deleteRow', getKeys(1, 0))
  const afterDelete = snapshot()
  await act(async () => finishClipboard('late paste')); await settle()
  expect(snapshot()).toEqual(afterDelete)
  expect(toast.success).not.toHaveBeenCalled()
})
test('clipboard completion cannot overwrite a newer cell edit', async () => {
  await select(1, 1)
  await act(async () => button('粘贴').click()); await settle()
  const key = getKeys(1, 1).cellKey
  await act(async () => editors.a.update(() => $getNodeByKey(key).clear().append($createParagraphNode().append($createTextNode('newer edit'))), { discrete: true }))
  await act(async () => finishClipboard('late paste')); await settle()
  expect(texts()[0][1][1]).toBe('newer edit')
  expect(toast.success).not.toHaveBeenCalled()
})
test('repeated paste clicks start only one clipboard read and one undoable change', async () => {
  await select(1, 1)
  const paste = button('粘贴')
  await act(async () => { paste.click(); paste.click(); paste.click() }); await settle()
  expect(clipboard.readText).toHaveBeenCalledOnce()
  await act(async () => finishClipboard('pasted')); await settle()
  expect(texts()[0][1][1]).toBe('pasted')
  await act(async () => editors.a.dispatchCommand(UNDO_COMMAND)); await settle()
  expect(texts()[0][1][1]).toBe('a11')
  await act(async () => editors.a.dispatchCommand(REDO_COMMAND)); await settle()
  expect(texts()[0][1][1]).toBe('pasted')
})
test('finishing selection invalidates pending paste without changing the note', async () => {
  await select(1, 1)
  await act(async () => button('粘贴').click()); await settle()
  const before = snapshot()
  await act(async () => button('完成').click()); await settle()
  await act(async () => finishClipboard('cancelled paste')); await settle()
  expect(snapshot()).toEqual(before)
  expect(toast.success).not.toHaveBeenCalled()
})
test('selected cells keep their identity when an earlier row is removed', async () => {
  const firstRow = getKeys(0, 0)
  await select(2, 1)
  await action('deleteRow', firstRow)
  await act(async () => button('清空').click()); await settle()
  expect(texts()).toEqual([[['a10', 'a11', 'a12'], ['a20', '', 'a22']]])
})
test('a mode event from one editor never activates another editor', async () => {
  await render({ multiple: true })
  await select(1, 1)
  expect(container('a').querySelector('.table-selection-modebar')).toBeTruthy()
  expect(container('b').querySelector('.table-selection-modebar')).toBeNull()
  const before = snapshot('b')
  await action('clear', getKeys(1, 1))
  expect(snapshot('b')).toEqual(before)
})
test('document changes clear stale selection controls on the reused editor', async () => {
  await select(1, 1)
  await render({ documentId: 'note-other' })
  expect(container().querySelector('.table-selection-modebar')).toBeNull()
  expect(container().querySelector('.table-selection-outline')).toBeNull()
})
test('the menu cannot submit through an old callback after the editor becomes read only', async () => {
  await act(async () => editors.a.update(() => $getRoot().getFirstChild().getChildren()[1].getChildren()[1].getFirstChild().selectEnd(), { discrete: true })); await settle()
  await act(async () => container().querySelector('[aria-label="表格单元格操作"]').click()); await settle()
  const menuButton = button('删除当前行'), before = snapshot()
  await act(async () => { editors.a.setEditable(false); menuButton.click() }); await settle()
  expect(snapshot()).toEqual(before)
  expect(container().querySelector('[role="menu"]')).toBeNull()
})

test.each([
  { name: 'partly scrolled out', left: 20, top: 40, expected: { left: '50px', top: '80px', width: '70px', height: '60px' } },
  { name: 'fully scrolled out', left: -100, top: 40, expected: null },
])('selection outlines stay inside the table scroll viewport when a cell is $name', async ({ left, top, expected }) => {
  await select(1, 1)
  const table = container().querySelector('table'), cell = table.rows[1].cells[1]
  const before = snapshot()
  const rectangle = (x, y, width, height) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} })
  vi.spyOn(container(), 'getBoundingClientRect').mockReturnValue(rectangle(0, 0, 600, 400))
  vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rectangle(50, 80, 400, 200))
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rectangle(left, top, 100, 100))
  for (const [element, width, height] of [[container(), 600, 400], [table, 400, 200]]) {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
      clientLeft: { configurable: true, value: 0 }, clientTop: { configurable: true, value: 0 },
    })
  }
  // The shipped document stylesheet makes TABLE itself the scroll viewport;
  // these boxes represent a genuine partially/fully hidden scrolled cell.
  table.style.overflow = 'auto'; table.scrollLeft = 100; table.scrollTop = 60
  await act(async () => {
    table.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const outline = container().querySelector('.table-selection-outline')
  if (expected) {
    expect(outline).toBeTruthy()
    for (const [property, value] of Object.entries(expected)) expect(outline.style[property]).toBe(value)
  } else expect(outline).toBeNull()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each([
  { name: 'header row shares the sticky cell box', headerRowTop: 80 },
  { name: 'header row scrolls behind its sticky cells', headerRowTop: 60 },
])('scrolled body outlines exclude the frozen row and column while their own corner outline remains visible: $name', async ({ headerRowTop }) => {
  await action('toggleFrozenRow', getKeys(0, 0))
  await action('toggleFrozenColumn', getKeys(0, 0))
  await select(1, 1)
  const table = container().querySelector('table'), before = snapshot()
  const rectangle = (x, y, width, height) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} })
  vi.spyOn(container(), 'getBoundingClientRect').mockReturnValue(rectangle(0, 0, 600, 400))
  vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rectangle(50, 80, 400, 200))
  for (const [element, width, height] of [[container(), 600, 400], [table, 400, 200]]) {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
      clientLeft: { configurable: true, value: 0 }, clientTop: { configurable: true, value: 0 },
    })
  }
  // Supply the same derived metadata and sticky geometry as the production
  // TablePresentationPlugin/styles; this fixture keeps the real data flags.
  table.dataset.lexicalFrozenRow = 'true'; table.dataset.lexicalFrozenColumn = 'true'
  table.style.overflow = 'auto'; table.scrollLeft = 20; table.scrollTop = 20
  for (const [rowIndex, row] of [...table.rows].entries()) {
    const y = [80, 100, 200][rowIndex], height = rowIndex === 0 ? 40 : 100
    // The sticky CSS applies to TD/TH, not TR. Once the table scrolls,
    // the row's normal-flow box can be above its painted sticky cells.
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rectangle(50, rowIndex === 0 ? headerRowTop : y, 440, height))
    for (const [columnIndex, cell] of [...row.cells].entries()) {
      cell.dataset.tableColumn = String(columnIndex)
      if (rowIndex === 0 || columnIndex === 0) cell.style.position = 'sticky'
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rectangle([50, 110, 210][columnIndex], y, [80, 100, 260][columnIndex], height))
    }
  }
  const refresh = async () => act(async () => {
    table.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await refresh()
  let outline = container().querySelector('.table-selection-outline')
  expect(outline).toBeTruthy()
  expect([outline.style.left, outline.style.top, outline.style.width, outline.style.height]).toEqual(['130px', '120px', '80px', '80px'])
  await select(0, 0)
  await refresh()
  outline = container().querySelector('.table-selection-outline')
  expect(outline).toBeTruthy()
  expect([outline.style.left, outline.style.top, outline.style.width, outline.style.height]).toEqual(['50px', '80px', '80px', '40px'])
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
