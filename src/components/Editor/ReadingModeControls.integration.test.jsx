import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $getRoot } from 'lexical'
import { TodoNode, $createTodoNode } from './nodes/TodoNode'
import { CalloutNode, $createCalloutNode } from './nodes/CalloutNode'
import { ToggleNode, $createToggleNode } from './nodes/ToggleNode'
import { CodeBlockNode, $createCodeBlockNode } from './nodes/CodeBlockNode'
import { FormulaNode, $createFormulaNode } from './nodes/FormulaNode'
import { EmbedNode, $createEmbedNode } from './nodes/EmbedNode'

let host, root, editor, errors
function Capture() {
  const [current] = useLexicalComposerContext()
  useEffect(() => { editor = current }, [current])
  return null
}
function Harness({ editable = true }) {
  return <LexicalComposer initialConfig={{
    namespace: 'reading-mode-controls', editable,
    nodes: [TodoNode, CalloutNode, ToggleNode, CodeBlockNode, FormulaNode, EmbedNode],
    onError: error => errors.push(error),
  }}><RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} /><Capture /></LexicalComposer>
}
const flush = () => act(async () => { for (let index = 0; index < 6; index++) await Promise.resolve() })
async function mount(factory, editable = true) {
  await act(async () => root.render(<Harness editable={editable} />))
  await act(async () => editor.update(() => $getRoot().clear().append(factory(), $createParagraphNode()), { discrete: true }))
  await flush()
}
async function mode(editable) { await act(async () => editor.setEditable(editable)); await flush() }
async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
  await flush()
}
async function field(element, value) {
  expect(element).toBeTruthy()
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
const snapshot = () => JSON.stringify(editor.getEditorState())
const button = label => [...host.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors).toEqual([])
})

test('a live todo cannot be checked or rewritten in reading mode and remains editable afterwards', async () => {
  await mount(() => $createTodoNode({ text: 'original todo' }))
  await click(host.querySelector('.todo-text-button'))
  await mode(false)
  const before = snapshot()
  await click(host.querySelector('.todo-checkbox'))
  await field(host.querySelector('.todo-input'), 'reading must not write')
  expect(snapshot()).toBe(before)
  expect(host.querySelector('.todo-checkbox').disabled).toBe(true)
  expect(host.querySelector('.todo-input').readOnly).toBe(true)
  await mode(true)
  await field(host.querySelector('.todo-input'), 'updated todo')
  expect(snapshot()).toContain('updated todo')
})

test('callout text and an already opened icon picker stop writing when the editor becomes read-only', async () => {
  await mount(() => $createCalloutNode({ text: 'original callout' }))
  await click(button('选择提示图标'))
  const previousIconButton = button('选择图标 ⚠️')
  const before = snapshot()
  await act(async () => { editor.setEditable(false); previousIconButton.click() })
  await field(host.querySelector('.callout-textarea'), 'reading must not write')
  expect(snapshot()).toBe(before)
  expect(host.querySelector('.callout-textarea').readOnly).toBe(true)
  expect(button('选择提示图标').disabled).toBe(true)
  await mode(true)
  await field(host.querySelector('.callout-textarea'), 'updated callout')
  expect(snapshot()).toContain('updated callout')
})

test('reading can expand and collapse a block without persisting view changes or text edits', async () => {
  await mount(() => $createToggleNode({ title: 'original title', content: 'original body', collapsed: true }))
  await mode(false)
  const before = snapshot()
  await click(button('展开折叠块'))
  expect(host.querySelector('.toggle-textarea')).toBeTruthy()
  await field(host.querySelector('.toggle-title-input'), 'reading title')
  await field(host.querySelector('.toggle-textarea'), 'reading body')
  expect(snapshot()).toBe(before)
  expect(host.querySelector('.toggle-title-input').readOnly).toBe(true)
  expect(host.querySelector('.toggle-textarea').readOnly).toBe(true)
  await click(button('收起折叠块'))
  expect(snapshot()).toBe(before)
  await mode(true)
  await click(button('展开折叠块'))
  await field(host.querySelector('.toggle-textarea'), 'updated body')
  expect(snapshot()).toContain('updated body')
})

test('memoized code controls react to both live mode changes without replacing the code node', async () => {
  await mount(() => $createCodeBlockNode('original code', 'plaintext'))
  const textarea = host.querySelector('.code-textarea')
  const before = snapshot()
  await mode(false)
  expect(host.querySelector('.code-textarea')).toBe(textarea)
  await field(textarea, 'reading must not write')
  expect(snapshot()).toBe(before)
  expect(textarea.readOnly).toBe(true)
  expect(host.querySelector('.language-selector-button').disabled).toBe(true)
  expect(button('删除')).toBeUndefined()
  expect(button('复制')).toBeTruthy()
  await click(button('自动换行'))
  expect(snapshot()).toBe(before)
  await mode(true)
  expect(textarea.readOnly).toBe(false)
  await field(textarea, 'updated code')
  expect(snapshot()).toContain('updated code')
})

test('a code delete click queued before the readonly rerender checks the current editor mode', async () => {
  await mount(() => $createCodeBlockNode('keep this code', 'plaintext'))
  const remove = button('删除'), before = snapshot()
  await act(async () => { editor.setEditable(false); remove.click() })
  await flush()
  expect(snapshot()).toBe(before)
})

test('formula editing pauses in reading mode and preserves the unapplied expression for editing', async () => {
  await mount(() => $createFormulaNode({ expression: 'x^2' }))
  await act(async () => host.querySelector('.formula-rendered').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await field(host.querySelector('.formula-editor textarea'), 'x^3')
  const save = button('完成'), before = snapshot()
  await act(async () => { editor.setEditable(false); save.click() })
  await flush()
  expect(snapshot()).toBe(before)
  const readingInput = host.querySelector('.formula-editor textarea')
  expect(!readingInput || readingInput.readOnly).toBe(true)
  expect(!button('完成') || button('完成').disabled).toBe(true)
  expect(!button('删除') || button('删除').disabled).toBe(true)
  await mode(true)
  expect(host.querySelector('.formula-editor textarea').value).toBe('x^3')
  await click(button('完成'))
  expect(snapshot()).toContain('x^3')
})

test('embed editing pauses in reading mode without applying or losing its pending title', async () => {
  await mount(() => $createEmbedNode({ url: 'https://example.test/fixture', title: 'original title' }))
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="text"]'), 'pending title')
  const save = button('保存'), before = snapshot()
  await act(async () => { editor.setEditable(false); save.click() })
  await flush()
  expect(snapshot()).toBe(before)
  expect([...host.querySelectorAll('.embed-input')].every(element => element.readOnly)).toBe(true)
  expect(!button('保存') || button('保存').disabled).toBe(true)
  await mode(true)
  expect(host.querySelector('input[type="text"]').value).toBe('pending title')
  await click(button('保存'))
  expect(snapshot()).toContain('pending title')
})

test('empty decorators opened directly in reading mode expose no writable form controls', async () => {
  await mount(() => $createTodoNode(), false)
  await act(async () => editor.update(() => $getRoot().append($createCalloutNode(), $createToggleNode(), $createFormulaNode(), $createEmbedNode()), { discrete: true }))
  await flush()
  const controls = [...host.querySelectorAll('input,textarea')]
  expect(controls.every(element => element.disabled || element.readOnly)).toBe(true)
  const before = snapshot()
  await click(host.querySelector('.todo-checkbox'))
  expect(snapshot()).toBe(before)
})
