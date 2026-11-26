// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isRangeSelection, $setSelection, createEditor, getNearestEditorFromDOMNode } from 'lexical'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import Editor from '../Editor'

// Happy-dom leaves a contenteditable DOM Range in place when a sibling button
// is focused, matching the observed Chromium failure. jsdom collapses that
// range onto the button itself and would hide the missing product isolation.
// These are real Editor/UiButton event and state tests, not native acceptance;
// no test below edits live DOM text to imitate a browser IME default action.
const { installedTargetRanges } = vi.hoisted(() => {
  const missing = !window.InputEvent.prototype.getTargetRanges
  if (missing) Object.defineProperty(window.InputEvent.prototype, 'getTargetRanges', { configurable: true, value() { return [] } })
  return { installedTargetRanges: missing }
})
afterAll(() => { if (installedTargetRanges) delete window.InputEvent.prototype.getTargetRanges })
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

let host, reactRoot, editor, props, errors
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const snapshot = () => editor.getEditorState().toJSON()
const cells = () => [...host.querySelectorAll('td,th')]
const button = label => [...host.querySelectorAll('.table-selection-modebar button')].find(node => node.textContent.trim() === label)
const selectionFacts = () => editor.getEditorState().read(() => {
  const selection = $getSelection()
  return $isRangeSelection(selection) ? { anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
    focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type }, text: selection.getTextContent(), format: selection.format, style: selection.style } : null
})
const windowError = event => errors.push(event.error || new Error(event.message))
function content(marker = 'IME document') {
  const fixture = createEditor({ nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } })
  fixture.update(() => {
    const table = $createTableNode()
    for (let r = 1; r <= 3; r++) table.append($createTableRowNode().append(...[1, 2, 3].map(c =>
      $createTableCellNode().append($createParagraphNode().append($createTextNode(`R${r}C${c}`))))))
    $getRoot().append($createParagraphNode().append($createTextNode(marker)), table)
  }, { discrete: true })
  return JSON.stringify(fixture.getEditorState())
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); errors = []
  window.addEventListener('error', windowError)
  host = document.createElement('div'); document.body.append(host); reactRoot = createRoot(host)
  props = { documentId: 'table-ime-focus', initialContent: content(), onChange: vi.fn(), readOnly: false }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
  expect(cells()).toHaveLength(9)
  const text = cells()[2].querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, text.length)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(selectionFacts()?.text).toBe('R1C3')
  expect(document.getSelection().toString()).toBe('R1C3')
  expect(errors).toEqual([])
})
afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount())
  host.remove()
  window.removeEventListener('error', windowError)
  vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function selectCells(start = 3, end = 4) {
  await act(async () => {
    cells()[start].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    cells()[start].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    cells()[end].dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerType: 'mouse', pointerId: 1 }))
    cells()[end].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1 }))
    cells()[end].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    cells()[end].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
  }); await settle()
}
async function bulk() {
  await act(async () => editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))); await settle()
  await selectCells()
  expect(host.querySelector('.table-selection-modebar-copy').textContent).toContain('已选择 2 个单元格')
  expect(document.getSelection().toString()).toBe('R1C3')
  expect(selectionFacts()?.text).toBe('R1C3')
}
async function composition(type, data = '') {
  await act(async () => editor.getRootElement().dispatchEvent(new CompositionEvent(type, { bubbles: true, cancelable: false, data }))); await settle()
}
async function finish() {
  await act(async () => { button('完成').focus(); button('完成').click() }); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
}
async function selectParagraph() {
  const paragraph = editor.getRootElement().firstElementChild
  const text = paragraph.querySelector('[data-lexical-text="true"]').firstChild
  await act(async () => {
    paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1 }))
    editor.getRootElement().focus()
    document.getSelection().setBaseAndExtent(text, 0, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
  }); await settle()
  expect(selectionFacts()?.text).toBe('IME')
}
async function insertText(value, inputType = 'insertText') {
  const range = document.getSelection().getRangeAt(0).cloneRange()
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data: value, isComposing: false })
  Object.defineProperty(event, 'getTargetRanges', { value: () => [range] })
  await act(async () => editor.getRootElement().dispatchEvent(event)); await settle()
  expect(event.defaultPrevented).toBe(true)
}

test('environment control: the actual UiButton can focus without moving the retained DOM text range', async () => {
  await bulk(); const before = snapshot(), selection = selectionFacts()
  await act(async () => button('复制').focus()); await settle()
  expect(document.activeElement).toBe(button('复制'))
  expect(document.getSelection().toString()).toBe('R1C3')
  expect(selectionFacts()).toEqual(selection)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('blocked IME in the real Editor removes the writable native range and keeps it detached through composition events', async () => {
  await bulk(); const before = snapshot()
  await composition('compositionstart', '表')
  expect(document.activeElement).toBe(button('复制'))
  expect(document.getSelection().rangeCount).toBe(0)
  expect(selectionFacts()).toBeNull()
  expect(editor.isComposing()).toBe(false)
  for (const type of ['compositionupdate', 'compositionend']) {
    await composition(type, '表')
    expect(document.activeElement).toBe(button('复制'))
    expect(document.getSelection().rangeCount).toBe(0)
    expect(selectionFacts()).toBeNull()
    expect(snapshot()).toEqual(before)
  }
  expect(errors).toEqual([])
})

test('finishing an isolated IME restores the exact former range and permits ordinary input', async () => {
  await bulk(); const selected = selectionFacts()
  await composition('compositionstart', '表'); await composition('compositionupdate', '表'); await composition('compositionend', '表')
  await finish()
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(selectionFacts()).toEqual(selected)
  expect(document.getSelection().toString()).toBe('R1C3')
  await insertText('普通输入')
  expect(cells()[2].textContent).toBe('普通输入')
  expect(cells()[3].textContent).toBe('R2C1'); expect(cells()[4].textContent).toBe('R2C2')
  expect(errors).toEqual([])
})

test('finishing an isolated IME still permits a normal composition and controlled commit', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  await finish()
  await composition('compositionstart')
  expect(editor.isComposing()).toBe(true)
  await composition('compositionupdate', '输入')
  await insertText('输入', 'insertFromComposition')
  await composition('compositionend', '输入')
  expect(editor.isComposing()).toBe(false)
  expect(cells()[2].textContent).toBe('输入')
  expect(cells()[3].textContent).toBe('R2C1'); expect(cells()[4].textContent).toBe('R2C2')
  expect(errors).toEqual([])
})

test('clearing the former endpoint while in bulk mode invalidates its suspended range without restoring old text', async () => {
  await bulk(); const selected = selectionFacts()
  await composition('compositionstart', '表'); await composition('compositionend', '表')
  await selectCells(2, 2)
  await act(async () => button('清空').click()); await settle()
  expect(editor.getEditorState().read(() => $getNodeByKey(selected.anchor.key))).toBeNull()
  const before = snapshot()
  await finish()
  expect(snapshot()).toEqual(before)
  expect(cells()[2].textContent).toBe('')
  expect(selectionFacts()?.anchor.key).not.toBe(selected.anchor.key)
  expect(errors).toEqual([])
})

test('a new user text selection outside the table supersedes the suspended IME range', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  await selectParagraph()
  const selected = selectionFacts(), before = snapshot()
  expect(selected?.text).toBe('IME')
  await finish()
  expect(selectionFacts()).toEqual(selected)
  expect(document.getSelection().toString()).toBe('IME')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a later user selection followed by a cleared editor selection cannot revive the earlier suspended range', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  await selectParagraph()
  // A later public editor selection reset is selection-only too; it cannot
  // resurrect a ticket already revoked by the real DOM gesture above.
  await act(async () => editor.update(() => $setSelection(null), { discrete: true })); await settle()
  expect(selectionFacts()).toBeNull()
  const before = snapshot()
  await finish()
  expect(selectionFacts()?.text).not.toBe('R1C3')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('repeated blocked composition keeps the first owned range until explicit completion', async () => {
  await bulk(); const selected = selectionFacts(), before = snapshot()
  for (const value of ['表', '格']) {
    await composition('compositionstart', value); await composition('compositionupdate', value); await composition('compositionend', value)
    expect(selectionFacts()).toBeNull(); expect(document.getSelection().rangeCount).toBe(0)
  }
  await finish()
  expect(selectionFacts()).toEqual(selected)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('the actual formatted text range retains its endpoints and formatting across blocked IME', async () => {
  await act(async () => {
    editor.getRootElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }))
  }); await settle()
  await bulk(); const selected = selectionFacts(), before = snapshot()
  expect(selected.anchor.offset).toBe(0); expect(selected.focus.offset).toBe(4)
  expect(selected.format).toBe(1)
  await composition('compositionstart', '表'); await composition('compositionend', '表')
  await finish()
  expect(selectionFacts()).toEqual(selected)
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test.each(['document round trip', 'reading round trip'])('suspended IME range is discarded across a %s without late focus restoration', async transition => {
  await bulk()
  await composition('compositionstart', '表'); await composition('compositionend', '表')
  const original = { ...props }, before = snapshot()
  props = transition.startsWith('document') ? { ...props, documentId: 'different-ime-document', initialContent: content('Another note') } : { ...props, readOnly: true }
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  props = original
  await act(async () => reactRoot.render(<Editor {...props} />)); await settle()
  const input = document.createElement('input'); document.body.append(input)
  try {
    await act(async () => input.focus()); await settle(); await settle()
    expect(document.activeElement).toBe(input)
    expect(snapshot()).toEqual(before)
    // DocumentSession may legitimately restore the original caret when edit
    // mode returns. Its persisted snapshot must not revive the old suspended
    // ticket after a new bulk session explicitly has no text selection.
    await act(async () => {
      editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))
      editor.update(() => $setSelection(null), { discrete: true })
    }); await settle()
    expect(document.activeElement).toBe(input)
    expect(selectionFacts()).toBeNull()
    await finish()
    expect(selectionFacts()?.text).not.toBe('R1C3')
    expect(snapshot()).toEqual(before)
  } finally { input.remove() }
  expect(errors).toEqual([])
})

test('unmount discards the suspended range and leaves an independently focused control alone', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  const before = snapshot(), input = document.createElement('input'); document.body.append(input)
  try {
    await act(async () => { input.focus(); reactRoot.unmount() }); reactRoot = null
    await settle(); await settle()
    expect(document.activeElement).toBe(input)
    expect(editor.getRootElement()).toBeNull()
    expect(snapshot()).toEqual(before)
    expect(selectionFacts()).toBeNull()
  } finally { input.remove() }
  expect(errors).toEqual([])
})

test('an explicit mode reset discards the suspended range without claiming outside focus', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  const before = snapshot(), input = document.createElement('input'); document.body.append(input)
  try {
    await act(async () => {
      input.focus()
      editor.getRootElement().dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: false }))
    }); await settle()
    expect(host.querySelector('.table-selection-modebar')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(selectionFacts()).toBeNull()
    expect(snapshot()).toEqual(before)
  } finally { input.remove() }
  expect(errors).toEqual([])
})

test('a queued composition isolation cannot clear a new selection after the original mode has ended and restarted', async () => {
  await bulk(); const before = snapshot(), root = editor.getRootElement()
  await act(async () => editor.update(() => {
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: false, data: '表' }))
    button('完成').click()
    root.dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))
    $getRoot().getFirstChild().getFirstChild().select(0, 3)
  }, { discrete: true })); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeTruthy()
  expect(selectionFacts()?.text).toBe('IME')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a queued completion cannot restore the old text range after a new bulk session takes ownership', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  const before = snapshot(), root = editor.getRootElement()
  await act(async () => editor.update(() => {
    button('完成').click()
    root.dispatchEvent(new CustomEvent('tableSelection:mode', { bubbles: true, detail: true }))
    $getRoot().getFirstChild().getFirstChild().select(0, 3)
  }, { discrete: true })); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeTruthy()
  expect(selectionFacts()?.text).toBe('IME')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a queued completion cannot replace a newer text selection in the same inactive session', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  const before = snapshot()
  await act(async () => editor.update(() => {
    button('完成').click()
    $getRoot().getFirstChild().getFirstChild().select(0, 3)
  }, { discrete: true })); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(selectionFacts()?.text).toBe('IME')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('ordinary queued completion restores the suspended range when no new owner intervenes', async () => {
  await bulk(); const selected = selectionFacts(), before = snapshot()
  await composition('compositionstart', '表'); await composition('compositionend', '表')
  await act(async () => editor.update(() => button('完成').click(), { discrete: true })); await settle()
  expect(host.querySelector('.table-selection-modebar')).toBeNull()
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(selectionFacts()).toEqual(selected)
  expect(document.getSelection().toString()).toBe('R1C3')
  expect(snapshot()).toEqual(before)
  expect(errors).toEqual([])
})

test('a queued completion cannot reclaim focus after the user moves to an outside input', async () => {
  await bulk(); await composition('compositionstart', '表'); await composition('compositionend', '表')
  const before = snapshot(), input = document.createElement('input'); document.body.append(input)
  let selectionWasNull
  try {
    await act(async () => editor.update(() => {
      button('完成').click()
      input.focus()
      selectionWasNull = $getSelection() === null
    }, { discrete: true })); await settle()
    expect(selectionWasNull).toBe(true)
    expect(host.querySelector('.table-selection-modebar')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(selectionFacts()).toBeNull()
    expect(snapshot()).toEqual(before)
  } finally { input.remove() }
  expect(errors).toEqual([])
})
