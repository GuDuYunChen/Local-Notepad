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
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, createEditor } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { api, searchFiles } from '~/services/api'
import { blockLocator } from '~/services/blockReferenceModel.mjs'
import { changeUiValue, uiQuery, uiValue } from '~/test/uiControlDriver'
import UiThemeProvider from '~/components/ui/UiThemeProvider'
import { LoadContentPlugin } from '../Editor'
import { WikiLinkNode } from '../nodes/WikiLinkNode'
import { MentionNode } from '../nodes/MentionNode'
import { $createCodeBlockNode, CodeBlockNode } from '../nodes/CodeBlockNode'
import { getRecentReferences } from '../utils/referenceUtils'
import WikiLinkPlugin from './WikiLinkPlugin'
import MentionPlugin from './MentionPlugin'
import BlockReferencePlugin from './BlockReferencePlugin'
import TableSelectionPlugin from './TableSelectionPlugin'
import CodeBlockPlugin from './CodeBlockPlugin'

vi.mock('~/services/api', async original => ({ ...await original(), api: vi.fn(), searchFiles: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

// Actual mounted Lexical plugins, Table mode events, completion controls and
// retained selections. Only transport and absent jsdom geometry are supplied;
// these untrusted DOM events are not Windows native acceptance.
const nodes = [TableNode, TableRowNode, TableCellNode, WikiLinkNode, MentionNode, CodeBlockNode]
const blockId = 'b-' + 'd'.repeat(32)
const source = { id: 'source', title: '来源.md', is_folder: false, is_deleted: false, updated_at: 1700000000, content: JSON.stringify({
  root: { type: 'root', version: 1, children: [{ type: 'paragraph', version: 1, $: { localBlockId: blockId },
    children: [{ type: 'text', version: 1, text: '来源正文', format: 0, detail: 0, mode: 'normal', style: '' }],
    format: '', indent: 0, direction: null }], format: '', indent: 0, direction: null },
}) }
let host, reactRoot, editor, errors, props
const rangeGeometry = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)))
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td')]
const button = label => [...host.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)
const query = kind => kind === 'wiki' ? '[[' : kind === 'mention' ? '@' : '目标正文'
function content(kind, suffix = '', withCode = false) {
  const fixture = createEditor({ nodes, onError: error => { throw error } })
  fixture.update(() => {
    const table = $createTableNode()
    for (const row of [[query(kind), 'unselected' + suffix], ['selected-A' + suffix, 'selected-B' + suffix]]) {
      table.append($createTableRowNode().append(...row.map(value => $createTableCellNode().append($createParagraphNode().append($createTextNode(value))))))
    }
    $getRoot().append(table, $createParagraphNode().append($createTextNode('outside' + suffix)))
    if (withCode) $getRoot().append($createCodeBlockNode('const owned = 1', 'plaintext'))
  }, { discrete: true })
  return JSON.stringify(fixture.getEditorState())
}
function Capture() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}
function Harness({ kind, documentId, content: initialContent }) {
  return <UiThemeProvider><LexicalComposer initialConfig={{ namespace: 'MyEditor', nodes, onError: error => errors.push(error) }}>
    <div className="editor-shell">
      {kind === 'block' && <BlockReferencePlugin documentId={documentId} initialContent={initialContent} />}
      <div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TablePlugin /><TableSelectionPlugin documentId={documentId} /><CodeBlockPlugin />
        {kind === 'wiki' && <WikiLinkPlugin documentId={documentId} />}
        {kind === 'mention' && <MentionPlugin documentId={documentId} />}
        <LoadContentPlugin documentId={documentId} content={initialContent} /><Capture />
      </div>
    </div>
  </LexicalComposer></UiThemeProvider>
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); errors = []
  api.mockReset().mockImplementation(async path => path.startsWith('/api/files?') ? [source] : source)
  searchFiles.mockReset().mockResolvedValue([source])
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(20, 40, 1, 20) })
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (rangeGeometry) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeGeometry)
  else delete Range.prototype.getBoundingClientRect
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function mount(kind, withCode = false) {
  props = { kind, documentId: 'destination', content: content(kind, '', withCode) }
  await act(async () => reactRoot.render(<Harness {...props} />)); await settle()
  await act(async () => editor.getRootElement().focus()); await settle()
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectEnd(), { discrete: true }))
  await settle(); await settle()
  expect(editor.getEditorState().read(() => $isRangeSelection($getSelection()) && $getSelection().isCollapsed())).toBe(true)
  expect(editor.getEditorState().read(() => $getSelection().anchor.getNode().getTextContent())).toBe(query(kind))
  expect(editor.getEditorState().read(() => $getSelection().anchor.offset)).toBe(query(kind).length)
  expect(document.getSelection().rangeCount).toBe(1)
  expect(errors).toEqual([])
}
const completion = kind => host.querySelector(kind === 'wiki' ? '.wiki-link-menu [role=option]' : '.mention-menu [role=option]')
function mode(active) { editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { detail: active, bubbles: true })) }
async function click(target) {
  const element = typeof target === 'string' ? button(target) : target
  expect(element).toBeTruthy()
  await act(async () => element.click()); await settle()
}
async function preview() {
  await click('块引用')
  await changeUiValue(uiQuery(host, 'input[placeholder="notepad://block/…"]'), blockLocator(source.id, blockId), ['input', 'change'])
  await click('读取来源块')
  expect(host.querySelector('.block-reference-preview'), host.textContent).toBeTruthy()
}
function firstCellTypes() { return snapshot().root.children[0].children[0].children[0].children.flatMap(paragraph => paragraph.children.map(node => node.type)) }

test.each(['wiki', 'mention'])('ordinary %s completion inserts through its actual candidate control', async kind => {
  await mount(kind); const before = snapshot()
  await click(completion(kind))
  expect(firstCellTypes()).toContain(kind === 'wiki' ? 'wiki-link' : 'mention')
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})

test.each(['wiki', 'mention'])('ordinary queued %s completion commits and finishes its own menu exactly once', async kind => {
  await mount(kind); const candidate = completion(kind), before = snapshot()
  expect(candidate).toBeTruthy()
  await act(async () => editor.update(() => candidate.click(), { discrete: true }))
  await settle()
  expect(firstCellTypes().filter(type => type === (kind === 'wiki' ? 'wiki-link' : 'mention'))).toHaveLength(1)
  expect(completion(kind)).toBeNull()
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  if (kind === 'wiki') expect(getRecentReferences()).toContainEqual(expect.objectContaining({ id: source.id, title: source.title }))
  expect(errors).toEqual([])
})

for (const exit of [false, true]) test.each(['wiki', 'mention'])(`queued %s completion cannot cross Table ownership (exit=${exit})`, async kind => {
  await mount(kind); const candidate = completion(kind), before = snapshot()
  expect(candidate).toBeTruthy()
  await act(async () => editor.update(() => {
    candidate.click()
    mode(true)
    if (exit) mode(false)
  }, { discrete: true }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(getRecentReferences()).toEqual([])
  expect(errors).toEqual([])
})

test.each(['wiki', 'mention'])('queued %s completion cannot follow a different matching query into another cell', async kind => {
  await mount(kind)
  await act(async () => editor.update(() => {
    $getRoot().getFirstChild().getFirstChild().getChildAtIndex(1).getFirstChild().getFirstChild().setTextContent(query(kind))
  }, { discrete: true }))
  await settle(); await settle()
  const candidate = completion(kind), before = snapshot()
  expect(candidate).toBeTruthy()
  await act(async () => editor.update(() => {
    candidate.click()
    $getRoot().getFirstChild().getFirstChild().getChildAtIndex(1).getFirstChild().getFirstChild().selectEnd()
  }, { discrete: true }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(getRecentReferences()).toEqual([])
  expect(errors).toEqual([])
})

for (const name of ['Enter', 'Tab']) test.each(['wiki', 'mention'])(`ordinary %s completion owns the real editor ${name} key before Table editing`, async kind => {
  await mount(kind); expect(completion(kind)).toBeTruthy()
  const before = snapshot()
  const event = new KeyboardEvent('keydown', { key: name, code: name, keyCode: name === 'Enter' ? 13 : 9, bubbles: true, cancelable: true })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  expect(event.defaultPrevented).toBe(true)
  expect(firstCellTypes()).toContain(kind === 'wiki' ? 'wiki-link' : 'mention')
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(snapshot().root.children[0].children[0].children[0].children).toHaveLength(1)
  expect(errors).toEqual([])
})

for (const selector of ['.code-textarea', '.code-block-toolbar button']) {
  for (const name of ['Enter', 'Tab']) test.each(['wiki', 'mention'])(`%s completion leaves ${name} in the actual code decorator ${selector}`, async kind => {
    await mount(kind, true); expect(completion(kind)).toBeTruthy()
    const control = host.querySelector(selector), before = snapshot()
    expect(control).toBeTruthy()
    await act(async () => control.focus()); await settle()
    expect(document.activeElement).toBe(control)
    const event = new KeyboardEvent('keydown', { key: name, code: name, keyCode: name === 'Enter' ? 13 : 9, bubbles: true, cancelable: true })
    await act(async () => control.dispatchEvent(event)); await settle()
    expect({ prevented: event.defaultPrevented, tableChanged: JSON.stringify(snapshot().root.children[0]) !== JSON.stringify(before.root.children[0]), focused: document.activeElement === control }).toEqual({ prevented: false, tableChanged: false, focused: true })
    expect(document.activeElement).toBe(control)
    expect(snapshot()).toEqual(before)
    expect(getRecentReferences()).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const selector of ['.code-textarea', '.code-block-toolbar button']) {
  test.each(['Enter', 'Tab'])(`without completion plugins, the actual code decorator ${selector} keeps %s away from the old Table caret`, async name => {
    await mount('none', true)
    expect(host.querySelector('.wiki-link-menu,.mention-menu')).toBeNull()
    const control = host.querySelector(selector), before = snapshot()
    await act(async () => control.focus()); await settle()
    const event = new KeyboardEvent('keydown', { key: name, code: name, keyCode: name === 'Enter' ? 13 : 9, bubbles: true, cancelable: true })
    await act(async () => control.dispatchEvent(event)); await settle()
    expect({ prevented: event.defaultPrevented, tableChanged: JSON.stringify(snapshot().root.children[0]) !== JSON.stringify(before.root.children[0]), focused: document.activeElement === control }).toEqual({ prevented: false, tableChanged: false, focused: true })
    expect(snapshot()).toEqual(before)
    expect(errors).toEqual([])
  })
}

test.each(['wiki', 'mention'])('%s completion does not consume an IME Enter or a foreign input Enter', async kind => {
  await mount(kind); expect(completion(kind)).toBeTruthy()
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })))
  expect(editor.isComposing()).toBe(true)
  const composingBefore = snapshot()
  const composing = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })
  await act(async () => editor.getRootElement().dispatchEvent(composing)); await settle()
  expect(composing.defaultPrevented).toBe(false)
  expect(snapshot()).toEqual(composingBefore)
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))); await settle()
  expect(editor.isComposing()).toBe(false)
  const before = snapshot()
  const foreign = document.createElement('input'); document.body.append(foreign)
  try {
    await act(async () => foreign.focus()); await settle()
    const external = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
    await act(async () => foreign.dispatchEvent(external)); await settle()
    expect(external.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(foreign)
    expect(snapshot()).toEqual(before)
  } finally { foreign.remove() }
  expect(getRecentReferences()).toEqual([])
  expect(errors).toEqual([])
})

test.each(['wiki', 'mention'])('real two-cell selection closes %s completion and finishing permits a fresh completion', async kind => {
  await mount(kind); expect(completion(kind)).toBeTruthy()
  const before = snapshot()
  await act(async () => mode(true)); await settle()
  await act(async () => {
    cells()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[3].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(completion(kind)).toBeNull()
  expect(snapshot()).toEqual(before)
  await click('完成')
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectEnd(), { discrete: true }))
  await settle(); await settle()
  await click(completion(kind))
  expect(firstCellTypes()).toContain(kind === 'wiki' ? 'wiki-link' : 'mention')
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})

for (const transition of ['active', 'enter-exit', 'read-only', 'read-only-return']) {
  test.each(['wiki', 'mention'])(`${transition} %s completion cannot write through a retained candidate in the same event turn`, async kind => {
    await mount(kind); const candidate = completion(kind), before = snapshot()
    expect(candidate).toBeTruthy()
    await act(async () => {
      if (transition.startsWith('read-only')) {
        editor.setEditable(false)
        if (transition === 'read-only-return') editor.setEditable(true)
      } else {
        mode(true)
        if (transition === 'enter-exit') mode(false)
      }
      candidate.click()
    })
    await settle()
    expect(snapshot()).toEqual(before)
    expect(errors).toEqual([])
  })
}

test.each(['active', 'enter-exit', 'read-only-return', 'document-switch'])('Wiki search cannot revive a completion after %s while its response is pending', async transition => {
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount('wiki')
  expect(finish).toEqual(expect.any(Function))
  expect(completion('wiki')).toBeNull()
  if (transition === 'document-switch') {
    props = { ...props, documentId: 'next-wiki', content: content('wiki', '-next') }
    await act(async () => reactRoot.render(<Harness {...props} />)); await settle()
  } else await act(async () => {
    if (transition === 'read-only-return') { editor.setEditable(false); editor.setEditable(true) }
    else { mode(true); if (transition === 'enter-exit') mode(false) }
  })
  const before = snapshot()
  await act(async () => finish([source])); await settle()
  expect(completion('wiki')).toBeNull()
  expect(host.querySelector('.wiki-link-menu')).toBeNull()
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each(['wiki', 'mention'])('%s completion belongs to the current document, and a fresh query in the next document still works', async kind => {
  await mount(kind); expect(completion(kind)).toBeTruthy()
  props = { ...props, documentId: 'another-completion-document', content: content(kind, '-next') }
  await act(async () => reactRoot.render(<Harness {...props} />)); await settle()
  expect(completion(kind)).toBeNull()
  const before = snapshot()
  await act(async () => editor.getRootElement().focus()); await settle()
  await act(async () => editor.update(() => $getRoot().getFirstChild().getFirstChild().getFirstChild().getFirstChild().getFirstChild().selectEnd(), { discrete: true }))
  await settle(); await settle()
  await click(completion(kind))
  expect(firstCellTypes()).toContain(kind === 'wiki' ? 'wiki-link' : 'mention')
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(errors).toEqual([])
})

test.each(['active', 'enter-exit'])('pending reviewed Block Reference insertion refuses a Table %s transition with unchanged document bytes', async transition => {
  await mount('block'); await preview()
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await click('确认插入引用')
  expect(finish).toEqual(expect.any(Function))
  const before = snapshot()
  await act(async () => { mode(true); if (transition === 'enter-exit') mode(false) })
  expect(snapshot()).toEqual(before)
  await act(async () => finish(source)); await settle()
  expect(snapshot()).toEqual(before)
  expect(firstCellTypes()).not.toContain('wiki-link')
  expect(errors).toEqual([])
})

test('ordinary reviewed Block Reference still inserts after checking the saved source twice', async () => {
  await mount('block'); await preview(); const before = snapshot()
  await click('确认插入引用')
  expect(firstCellTypes()).toContain('wiki-link')
  expect(snapshot().root.children[0].children[1]).toEqual(before.root.children[0].children[1])
  expect(api).toHaveBeenCalledTimes(2)
  expect(errors).toEqual([])
})

test('Block Reference source-anchor creation refuses a ticket from before Table enter-exit', async () => {
  await mount('block'); await click('块引用'); const before = snapshot()
  await act(async () => { mode(true); mode(false) })
  await click('为当前块创建引用')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('ordinary queued Table source-anchor creation updates its ticket only after the real commit', async () => {
  await mount('block'); await click('块引用')
  const create = button('为当前块创建引用')
  await act(async () => editor.update(() => create.click(), { discrete: true })); await settle()
  const identity = snapshot().root.children[0].$?.localBlockId
  expect(identity).toMatch(/^b-[a-f0-9]{32}$/)
  expect(host.querySelector('[role=status]')?.textContent).toContain('块标识已加入当前草稿')
  const saved = JSON.stringify(editor.getEditorState())
  api.mockResolvedValue({ ...source, id: props.documentId, content: saved })
  await click('核对保存并复制引用')
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(uiValue(uiQuery(host, '.block-reference-panel > section:first-of-type input[readonly]'))).toBe(blockLocator(props.documentId, identity))
  expect(JSON.stringify(editor.getEditorState())).toBe(saved)
  expect(errors).toEqual([])
})

test.each([false, true])('queued Table source-anchor creation never reports success after Table ownership changes (exit=%s)', async exit => {
  await mount('block'); await click('块引用')
  const create = button('为当前块创建引用'), before = snapshot()
  await act(async () => editor.update(() => {
    create.click()
    mode(true)
    if (exit) mode(false)
  }, { discrete: true }))
  await settle()
  expect(snapshot()).toEqual(before)
  expect(host.textContent).not.toContain('块标识已加入当前草稿')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('当前笔记、编辑状态或表格选择已变化')
  expect(errors).toEqual([])
})

test('a Table source anchor serializes the entire table and copies only after every saved cell matches', async () => {
  await mount('block'); await click('块引用'); const before = snapshot()
  await click('为当前块创建引用')
  expect(host.querySelector('[role=alert]')?.textContent).toBeUndefined()
  const identity = snapshot().root.children[0].$?.localBlockId
  expect(identity, host.textContent).toMatch(/^b-[a-f0-9]{32}$/)
  expect(snapshot().root.children[0].children).toEqual(before.root.children[0].children)
  expect(api).not.toHaveBeenCalled()
  const saved = JSON.stringify(editor.getEditorState())
  const reopened = createEditor({ nodes, onError: error => { throw error } })
  reopened.setEditorState(reopened.parseEditorState(saved))
  expect(JSON.stringify(reopened.getEditorState())).toBe(saved)
  const mismatched = JSON.parse(saved)
  mismatched.root.children[0].children[1].children[1].children[0].children[0].text = 'another cell was not saved'
  api.mockResolvedValue({ ...source, id: props.documentId, content: JSON.stringify(mismatched) })
  await click('核对保存并复制引用')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('当前块尚未保存或已改变')
  expect(uiQuery(host, '.block-reference-panel > section:first-of-type input[readonly]')).toBeNull()
  expect(JSON.stringify(editor.getEditorState())).toBe(saved)
  api.mockResolvedValue({ ...source, id: props.documentId, content: saved })
  await click('核对保存并复制引用')
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(uiValue(uiQuery(host, '.block-reference-panel > section:first-of-type input[readonly]'))).toBe(blockLocator(props.documentId, identity))
  expect(api).toHaveBeenCalledTimes(2)
  expect(api.mock.calls.every(([path]) => path === '/api/files/' + props.documentId)).toBe(true)
  expect(JSON.stringify(editor.getEditorState())).toBe(saved)
  expect(errors).toEqual([])
})

test('Block Reference refuses opening against the old caret while Table owns the editor', async () => {
  await mount('block'); const before = snapshot()
  await act(async () => mode(true))
  await click('块引用')
  expect(host.querySelector('.block-reference-panel')).toBeNull()
  expect(host.textContent).toContain('请先完成单元格多选')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each(['read-only', 'read-only-return', 'document-switch'])('pending reviewed Block Reference refuses completion after %s', async transition => {
  await mount('block'); await preview()
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await click('确认插入引用')
  if (transition.startsWith('read-only')) await act(async () => {
    editor.setEditable(false)
    if (transition === 'read-only-return') editor.setEditable(true)
  })
  else {
    props = { ...props, documentId: 'another-document', content: content('block', '-new') }
    await act(async () => reactRoot.render(<Harness {...props} />)); await settle()
  }
  const before = snapshot()
  await act(async () => finish(source)); await settle()
  expect(snapshot()).toEqual(before)
  expect(firstCellTypes()).not.toContain('wiki-link')
  if (transition !== 'read-only-return') expect(host.querySelector('.block-reference-panel')).toBeNull()
  else expect(host.querySelector('[role=alert]')?.textContent).toContain('当前笔记、编辑状态或表格选择已变化')
  expect(errors).toEqual([])
})
