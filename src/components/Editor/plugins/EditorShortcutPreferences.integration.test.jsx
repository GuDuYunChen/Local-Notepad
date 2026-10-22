import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode, $createHeadingNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { FormulaNode } from '../nodes/FormulaNode'
import { applyShortcutBindings, getDefaultShortcutBindings, getShortcutSnapshot, reloadShortcutPreferences, SHORTCUT_STORAGE_KEY, shortcutLabel } from '~/services/localShortcuts'
import SearchPlugin from './SearchPlugin'
import DocumentOutlinePlugin from './DocumentOutlinePlugin'
import CommandPalettePlugin from './CommandPalettePlugin'
import EditorShortcutPlugin from './EditorShortcutPlugin'
import TableSelectionPlugin from './TableSelectionPlugin'
import ToolbarPlugin from './ToolbarPlugin'

let root, host, editor, errors, frames, sequence, props, clipboard
const settle = async () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
const snapshot = () => editor.getEditorState().toJSON()
const allNodes = node => [node, ...(node.children || []).flatMap(allNodes)]
const ofType = type => allNodes(snapshot().root).filter(node => node.type === type)
const tableRow = () => ofType('table')[0].children[0]
const button = label => [...host.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label)

function Capture({ editable }) {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance; editor.setEditable(editable) }, [instance, editable])
  return null
}

function Harness({ editable = true, documentId = 'note-A' }) {
  return <LexicalComposer initialConfig={{
    namespace: 'actual-editor-shortcut-preferences',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, FormulaNode],
    onError: error => errors.push(error),
  }}>
    <Capture editable={editable} />
    <div className="editor-shell">
      <ToolbarPlugin documentId={documentId} />
      <SearchPlugin documentId={documentId} />
      <DocumentOutlinePlugin documentId={documentId} documentTitle="本地笔记" />
      <CommandPalettePlugin documentId={documentId} />
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <ListPlugin />
        <CheckListPlugin />
        <EditorShortcutPlugin documentId={documentId} />
        <TableSelectionPlugin documentId={documentId} />
      </div>
    </div>
  </LexicalComposer>
}

async function render(next = {}) {
  props = { ...props, ...next }
  await act(async () => root.render(<Harness {...props} />))
  await settle()
}

async function configure(changes) {
  let result
  await act(async () => {
    result = applyShortcutBindings({ ...getDefaultShortcutBindings(), ...changes }, { expectedRevision: getShortcutSnapshot().revision })
  })
  expect(result.ok, result.error?.message).toBe(true)
  await settle()
}

async function key(value, options = {}, target = window) {
  const event = new KeyboardEvent('keydown', { key: value, ctrlKey: true, bubbles: true, cancelable: true, ...options })
  // happy-dom aliases AltGraph to any Alt key. Ordinary Ctrl+Alt and an
  // actual AltGraph event are distinct inputs; the latter is tested below.
  const readModifier = event.getModifierState.bind(event)
  Object.defineProperty(event, 'getModifierState', { value: name => name === 'AltGraph' ? false : readModifier(name) })
  await act(async () => target.dispatchEvent(event))
  await settle()
  return event
}

async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
  await settle()
}

async function focusEditor() {
  await act(async () => {
    editor.getRootElement().focus()
    editor.update(() => $getRoot().getChildren()[1].selectEnd(), { discrete: true })
  })
  await settle()
}

async function field(element, value) {
  expect(element).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

async function tick() {
  await act(async () => {
    for (let pass = 0; pass < 3; pass++) {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback()
      await Promise.resolve()
    }
  })
  await settle()
}

async function selectCells(first = 0, last = 1) {
  await act(async () => window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: true })))
  await settle()
  const cells = host.querySelectorAll('td')
  expect(cells[last]).toBeTruthy()
  await act(async () => {
    cells[first].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    cells[last].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    cells[last].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await settle()
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []; frames = new Map(); sequence = 0; props = { editable: true, documentId: 'note-A' }
  localStorage.removeItem(SHORTCUT_STORAGE_KEY)
  reloadShortcutPreferences()
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++sequence; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'clipboard text') }
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(clipboard)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
  await act(async () => editor.update(() => {
    const row = $createTableRowNode()
    for (const text of ['cell one', 'cell two']) row.append($createTableCellNode().append($createParagraphNode().append($createTextNode(text))))
    $getRoot().clear().append(
      $createHeadingNode('h1').append($createTextNode('章节一')),
      $createParagraphNode().append($createTextNode('alpha alpha body')),
      $createTableNode().append(row),
    )
  }, { discrete: true }))
  await focusEditor()
  expect(errors).toEqual([])
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.removeItem(SHORTCUT_STORAGE_KEY)
  reloadShortcutPreferences()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('configured find yields the actual outline once while the old key no longer opens search', async () => {
  await configure({ find: 'Mod+Alt+F', outline: 'Mod+Alt+O' })
  await key('o', { altKey: true })
  expect(host.querySelector('.document-outline-panel')).toBeTruthy()
  const before = snapshot(), events = []
  const receive = event => events.push(event.detail)
  window.addEventListener('editor:open-search', receive)
  try {
    expect((await key('f')).defaultPrevented).toBe(false)
    expect(host.querySelector('.document-search')).toBeNull()
    await key('f', { altKey: true })
    await tick()
  } finally { window.removeEventListener('editor:open-search', receive) }
  expect(events).toEqual([{ documentId: 'note-A', replace: false }])
  expect(host.querySelector('.document-outline-panel')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('[aria-label="查找内容"]'))
  expect(snapshot()).toEqual(before)
})

test('configured find and replace work in their own search fields and keep the query', async () => {
  await configure({ find: 'Mod+Alt+F', replace: 'Mod+Alt+H' })
  await key('f', { altKey: true }); await tick()
  const input = host.querySelector('[aria-label="查找内容"]')
  await field(input, 'alpha')
  await key('h', { altKey: true }, input)
  expect(host.querySelector('[aria-label="替换内容"]')).toBeTruthy()
  expect(input.value).toBe('alpha')
  await key('f', { altKey: true }, input)
  expect(host.querySelector('[aria-label="替换内容"]')).toBeNull()
  expect(input.value).toBe('alpha')
})

test('reading keeps configured search and outline but refuses content shortcuts', async () => {
  await configure({ find: 'Mod+Alt+F', replace: 'Mod+Alt+H', outline: 'Mod+Alt+O', formula: 'Mod+Shift+E', checklist: 'Mod+Shift+T', commandPalette: 'Mod+Alt+P' })
  await render({ editable: false })
  const before = snapshot()
  await key('e', { shiftKey: true }); await key('t', { shiftKey: true })
  await key('p', { altKey: true })
  expect(host.querySelector('.editor-command-palette')).toBeNull()
  await key('h', { altKey: true })
  expect(host.querySelector('.document-search')).toBeTruthy()
  expect(host.querySelector('[aria-label="替换内容"]')).toBeNull()
  await click(button('关闭文内查找'))
  await key('o', { altKey: true })
  expect(host.querySelector('.document-outline-panel')).toBeTruthy()
  expect(snapshot()).toEqual(before)
})

for (const [label, options] of [
  ['extra shift modifier', { altKey: true, shiftKey: true }],
  ['IME composition', { altKey: true, isComposing: true }],
  ['IME key code', { altKey: true, keyCode: 229 }],
  ['key repeat', { altKey: true, repeat: true }],
]) test(`${label} cannot execute configured document search`, async () => {
  await configure({ find: 'Mod+Alt+F' })
  const before = snapshot()
  await key('f', options)
  expect(host.querySelector('.document-search')).toBeNull()
  expect(snapshot()).toEqual(before)
})

test('already consumed and AltGraph events cannot execute editor shortcuts', async () => {
  await configure({ find: 'Mod+Alt+F', formula: 'Mod+Shift+E' })
  const before = snapshot()
  const consumed = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, cancelable: true })
  consumed.preventDefault()
  const altGraph = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, altKey: true, cancelable: true })
  Object.defineProperty(altGraph, 'getModifierState', { value: name => name === 'AltGraph' })
  await act(async () => { window.dispatchEvent(consumed); window.dispatchEvent(altGraph) })
  await settle()
  expect(host.querySelector('.document-search')).toBeNull()
  expect(snapshot()).toEqual(before)
})

test('fixed font selection rejects simultaneous Ctrl and Meta while retaining each exact primary modifier', async () => {
  await click(button('更多格式'))
  await focusEditor()
  const font = host.querySelector('select[aria-label="字体"]')
  expect(font).toBeTruthy()
  expect((await key('F', { shiftKey: true, metaKey: true })).defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(editor.getRootElement())
  expect((await key('F', { shiftKey: true })).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(font)
  await focusEditor()
  expect((await key('F', { ctrlKey: false, metaKey: true, shiftKey: true })).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(font)
})

test('fixed font selection opens its existing menu and focuses the actual selector', async () => {
  expect(host.querySelector('.toolbar-format-menu')).toBeNull()
  expect((await key('F', { shiftKey: true })).defaultPrevented).toBe(true)
  const font = host.querySelector('select[aria-label="字体"]')
  expect(font).toBeTruthy()
  expect(document.activeElement).toBe(font)
})

test('fixed font selection yields extra Alt to the configured document search', async () => {
  await configure({ find: 'Mod+Shift+Alt+F' })
  const before = snapshot(), received = []
  const receive = event => received.push(event.detail)
  window.addEventListener('editor:open-search', receive)
  try { await key('F', { shiftKey: true, altKey: true }); await tick() }
  finally { window.removeEventListener('editor:open-search', receive) }
  expect(received).toEqual([{ documentId: 'note-A', replace: false }])
  expect(document.activeElement).toBe(host.querySelector('[aria-label="查找内容"]'))
  expect(snapshot()).toEqual(before)
})

test('ordinary input, shortcut recording and another modal keep foreground ownership', async () => {
  await configure({ find: 'Mod+Alt+F', outline: 'Mod+Alt+O', commandPalette: 'Mod+Alt+P' })
  const before = snapshot()
  const external = document.createElement('input')
  document.body.append(external)
  try {
    external.focus()
    for (const keyName of ['f', 'o', 'p']) await key(keyName, { altKey: true }, external)
    expect(host.querySelector('.document-search,.document-outline-panel,.editor-command-palette')).toBeNull()
    external.setAttribute('data-shortcut-recorder', '')
    await key('f', { shiftKey: true }, external)
    expect(document.activeElement).toBe(external)
    external.removeAttribute('data-shortcut-recorder')
    const modal = document.createElement('section'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    try {
      await focusEditor()
      for (const keyName of ['f', 'o', 'p']) await key(keyName, { altKey: true })
      expect(host.querySelector('.document-search,.document-outline-panel,.editor-command-palette')).toBeNull()
    } finally { modal.remove() }
    expect(snapshot()).toEqual(before)
  } finally { external.remove() }
})

test('current bindings update toolbar and outline hints and open the original command palette', async () => {
  const originalEditor = editor
  await configure({ find: 'Mod+Alt+F', outline: 'Mod+Alt+O', commandPalette: 'Mod+Alt+P', checklist: 'Mod+Shift+T', formula: 'Mod+Shift+E' })
  const bindings = getShortcutSnapshot().bindings
  expect(button('文内查找与替换').title).toContain(shortcutLabel('find', bindings))
  expect(button('文档目录').title).toContain(shortcutLabel('outline', bindings))
  expect(button('编辑器命令').title).toContain(shortcutLabel('commandPalette', bindings))
  expect(button('待办清单').title).toContain(shortcutLabel('checklist', bindings))
  await key('p', { shiftKey: true })
  expect(host.querySelector('.editor-command-palette')).toBeNull()
  await key('p', { altKey: true })
  expect(host.querySelector('.editor-command-palette kbd').textContent).toBe(shortcutLabel('commandPalette', bindings))
  expect(editor).toBe(originalEditor)
  const input = host.querySelector('[aria-label="搜索编辑器命令"]')
  await field(input, '数学公式')
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const before = snapshot()
  await key('Enter', { ctrlKey: false, isComposing: true }, input)
  await key('Escape', { ctrlKey: false, isComposing: true }, input)
  expect(host.querySelector('.editor-command-palette')).toBeTruthy()
  expect(snapshot()).toEqual(before)
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await key('Enter', { ctrlKey: false }, input)
  expect(host.querySelector('.editor-command-palette')).toBeNull()
  expect(ofType('formula')).toHaveLength(1)
  expect(errors).toEqual([])
})

test('configured formula and checklist shortcuts use real Lexical commands and preserve old-key inactivity', async () => {
  await configure({ formula: 'Mod+Shift+E', checklist: 'Mod+Shift+T' })
  const before = snapshot()
  await key('e', { altKey: true }); await key('t', { altKey: true })
  expect(snapshot()).toEqual(before)
  await key('e', { shiftKey: true })
  expect(ofType('formula')).toHaveLength(1)
  await focusEditor()
  await key('t', { shiftKey: true })
  expect(ofType('list').some(node => node.listType === 'check')).toBe(true)
  expect(errors).toEqual([])
})

test('configured reference shortcut reaches the existing clipboard path once without changing body', async () => {
  await configure({ copyReference: 'Mod+Shift+Alt+R' })
  const before = snapshot()
  await key('r', { altKey: true })
  expect(clipboard.writeText).not.toHaveBeenCalled()
  await key('r', { shiftKey: true, altKey: true })
  expect(clipboard.writeText).toHaveBeenCalledTimes(1)
  expect(clipboard.writeText.mock.calls[0][0]).toContain('本地笔记')
  expect(snapshot()).toEqual(before)
})

for (const [label, transition] of [
  ['document change', () => render({ documentId: 'note-B' })],
  ['reading and editing return', async () => { await render({ editable: false }); await render({ editable: true }) }],
]) test(`a queued configured formula command cannot write after ${label}`, async () => {
  await configure({ formula: 'Mod+Shift+E' })
  const before = snapshot(), apply = editor.update.bind(editor), pending = []
  const intercept = vi.spyOn(editor, 'update').mockImplementation((callback, options) => { pending.push({ callback, options }) })
  try {
    await key('e', { shiftKey: true })
    expect(pending).toHaveLength(1)
  } finally { intercept.mockRestore() }
  await transition()
  await act(async () => apply(pending[0].callback, { ...pending[0].options, discrete: true }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('configured table merge and split operate on the actual selected cells', async () => {
  await configure({ mergeCells: 'Mod+Shift+M', splitCell: 'Mod+Shift+Alt+S' })
  await selectCells()
  const before = snapshot()
  await key('m', { altKey: true })
  expect(snapshot()).toEqual(before)
  await key('m', { shiftKey: true })
  expect(tableRow().children).toHaveLength(1)
  expect(tableRow().children[0].colSpan).toBe(2)
  await selectCells(0, 0)
  const splitEvent = await key('s', { shiftKey: true, altKey: true })
  expect(splitEvent.defaultPrevented).toBe(true)
  if (errors.length) throw errors[0]
  expect(errors.map(error => String(error))).toEqual([])
  expect(tableRow().children).toHaveLength(2)
  expect(tableRow().children[0].colSpan).toBe(1)
  const text = ofType('text').map(node => node.text).join(' ')
  expect(text).toContain('cell one'); expect(text).toContain('cell two')
  expect(errors).toEqual([])
})

test('configured split also uses the current caret after merging clears the rectangle', async () => {
  await configure({ mergeCells: 'Mod+Shift+M', splitCell: 'Mod+Shift+Alt+S' })
  await selectCells()
  await key('m', { shiftKey: true })
  expect(tableRow().children).toHaveLength(1)
  await act(async () => editor.update(() => {
    $getRoot().getChildren().find(node => node instanceof TableNode).getFirstChild().getFirstChild().getFirstChild().selectEnd()
  }, { discrete: true }))
  await settle()
  const event = await key('s', { shiftKey: true, altKey: true })
  expect(event.defaultPrevented).toBe(true)
  if (errors.length) throw errors[0]
  expect(tableRow().children).toHaveLength(2)
  expect(tableRow().children[0].colSpan).toBe(1)
  expect(ofType('text').map(node => node.text).join(' ')).toContain('cell two')
  expect(errors).toEqual([])
})

test('a selected table does not accept configured writes during another modal or reading', async () => {
  await configure({ mergeCells: 'Mod+Shift+M' })
  await selectCells()
  const before = snapshot(), modal = document.createElement('section')
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal)
  try { await key('m', { shiftKey: true }); expect(snapshot()).toEqual(before) } finally { modal.remove() }
  await render({ editable: false })
  await key('m', { shiftKey: true })
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})
