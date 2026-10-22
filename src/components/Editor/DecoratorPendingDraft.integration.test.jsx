import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $getRoot } from 'lexical'
import { FormulaNode, $createFormulaNode } from './nodes/FormulaNode'
import { EmbedNode, $createEmbedNode } from './nodes/EmbedNode'
import { EditorPendingDraftContext } from './hooks/useEditorPendingDraft'
import { createEditorPendingDrafts } from '../../services/editorPendingDrafts.mjs'

let host, root, editor, errors, registry, previousIframeLoading

function CaptureEditor() {
  const [current] = useLexicalComposerContext()
  useEffect(() => { editor = current }, [current])
  return null
}

function Harness() {
  return <EditorPendingDraftContext.Provider value={registry}><LexicalComposer initialConfig={{
    namespace: 'decorator-pending-draft', nodes: [FormulaNode, EmbedNode],
    onError: error => errors.push(error),
  }}>
    <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
    <CaptureEditor />
  </LexicalComposer></EditorPendingDraftContext.Provider>
}

const flush = () => act(async () => { for (let index = 0; index < 6; index++) await Promise.resolve() })
const snapshot = () => JSON.stringify(editor.getEditorState())
const nodeJSON = type => {
  // Lexical places an inline formula inside a paragraph when its layout changes.
  const find = node => node.type === type ? node : node.children?.map(find).find(Boolean)
  return find(editor.getEditorState().toJSON().root)
}
const button = text => [...host.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
const formulaExpression = () => host.querySelector('.formula-rendered annotation[encoding="application/x-tex"]')?.textContent

async function mount(factory) {
  await act(async () => root.render(<Harness />))
  await act(async () => editor.update(() => $getRoot().clear().append(factory(), $createParagraphNode()), { discrete: true }))
  await flush()
}

async function mode(editable) {
  await act(async () => editor.setEditable(editable))
  await flush()
}

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

async function editFormula() {
  await act(async () => host.querySelector('.formula-rendered').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await flush()
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // Inspect the actual iframe destination without requesting external websites.
  previousIframeLoading = window.happyDOM.settings.disableIframePageLoading
  window.happyDOM.settings.disableIframePageLoading = true
  errors = []
  registry = createEditorPendingDrafts()
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  expect(registry.hasPending()).toBe(false)
  host.remove()
  window.happyDOM.settings.disableIframePageLoading = previousIframeLoading
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors).toEqual([])
})

test('reading renders the committed formula and layout while keeping its unapplied draft for later completion', async () => {
  await mount(() => $createFormulaNode({ expression: 'x^2', displayMode: true }))
  const before = snapshot(), originalRoot = editor.getRootElement()
  await editFormula()
  await field(host.querySelector('textarea'), 'y^3')
  await click(button('行内公式'))
  expect(registry.capture().drafts.map(({ label, value }) => ({ label, value }))).toEqual([
    { label: '公式', value: JSON.stringify(['y^3', false]) },
  ])
  await mode(false)
  expect(snapshot()).toBe(before)
  expect(editor.getRootElement()).toBe(originalRoot)
  expect(formulaExpression()).toBe('x^2')
  expect(host.querySelector('.formula-rendered').classList.contains('block')).toBe(true)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未应用')
  expect(host.querySelector('textarea')).toBeNull()
  expect(registry.hasPending()).toBe(true)
  await mode(true)
  expect(host.querySelector('textarea').value).toBe('y^3')
  expect(button('行内公式').classList.contains('active')).toBe(true)
  await click(button('完成'))
  expect(formulaExpression()).toBe('y^3')
  expect(host.querySelector('.formula-rendered').classList.contains('inline')).toBe(true)
  expect(snapshot()).not.toBe(before)
  expect(nodeJSON('formula')).toMatchObject({ expression: 'y^3', displayMode: false })
  expect(registry.hasPending()).toBe(false)
  expect(host.querySelector('[role="status"]')).toBeNull()
})

test('Escape discards both the unapplied formula expression and display-mode change', async () => {
  await mount(() => $createFormulaNode({ expression: 'x^2', displayMode: true }))
  const before = snapshot()
  await editFormula()
  await field(host.querySelector('textarea'), 'y^3')
  await click(button('行内公式'))
  await mode(false)
  await mode(true)
  await act(async () => host.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
  expect(snapshot()).toBe(before)
  expect(formulaExpression()).toBe('x^2')
  expect(host.querySelector('.formula-rendered').classList.contains('block')).toBe(true)
  expect(registry.hasPending()).toBe(false)
  await editFormula()
  expect(host.querySelector('textarea').value).toBe('x^2')
  expect(button('独立公式').classList.contains('active')).toBe(true)
})

test('an empty committed formula stays empty in reading mode and explicit cancel clears its pending draft', async () => {
  await mount(() => $createFormulaNode())
  const before = snapshot()
  await field(host.querySelector('textarea'), 'E=mc^2')
  await mode(false)
  expect(snapshot()).toBe(before)
  expect(formulaExpression()).toBeUndefined()
  expect(host.querySelector('.formula-rendered').textContent).toContain('空公式')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未应用')
  await mode(true)
  expect(host.querySelector('textarea').value).toBe('E=mc^2')
  await click(button('取消'))
  expect(snapshot()).toBe(before)
  expect(host.querySelector('[role="status"]')).toBeNull()
  await editFormula()
  expect(host.querySelector('textarea').value).toBe('')
})

test('reading embeds only the committed URL and title, then resumes and applies the pending values in editing', async () => {
  await mount(() => $createEmbedNode({ url: 'https://youtu.be/original123', title: '已应用标题' }))
  const before = snapshot(), originalRoot = editor.getRootElement()
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="url"]'), 'https://youtu.be/pending456')
  await field(host.querySelector('input[type="text"]'), '尚未应用标题')
  expect(registry.capture().drafts.map(({ label, value }) => ({ label, value }))).toEqual([
    { label: '嵌入内容', value: JSON.stringify(['https://youtu.be/pending456', '尚未应用标题']) },
  ])
  await mode(false)
  expect(snapshot()).toBe(before)
  expect(editor.getRootElement()).toBe(originalRoot)
  expect(host.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube.com/embed/original123')
  expect(host.querySelector('iframe').getAttribute('title')).toBe('已应用标题')
  expect(host.querySelector('.embed-title').textContent).toBe('已应用标题')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未应用')
  await mode(true)
  expect(host.querySelector('input[type="url"]').value).toBe('https://youtu.be/pending456')
  expect(host.querySelector('input[type="text"]').value).toBe('尚未应用标题')
  await click(button('保存'))
  expect(host.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube.com/embed/pending456')
  expect(host.querySelector('.embed-title').textContent).toBe('尚未应用标题')
  expect(snapshot()).not.toBe(before)
  expect(nodeJSON('embed')).toMatchObject({ url: 'https://youtu.be/pending456', title: '尚未应用标题' })
  expect(registry.hasPending()).toBe(false)
  expect(host.querySelector('[role="status"]')).toBeNull()
})

test('a supported pending embed URL cannot start an iframe from an unsupported committed link in reading mode', async () => {
  await mount(() => $createEmbedNode({ url: 'https://example.test/original', title: '原说明' }))
  const before = snapshot()
  expect(host.querySelector('iframe')).toBeNull()
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="url"]'), 'https://youtu.be/pending456')
  await mode(false)
  expect(snapshot()).toBe(before)
  expect(host.querySelector('iframe')).toBeNull()
  expect(host.querySelector('.embed-title').textContent).toBe('原说明')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未应用')
})

test('cancel after returning to editing restores both committed embed fields without changing the document', async () => {
  await mount(() => $createEmbedNode({ url: 'https://youtu.be/original123', title: '已应用标题' }))
  const before = snapshot()
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="url"]'), 'https://youtu.be/pending456')
  await field(host.querySelector('input[type="text"]'), '尚未应用标题')
  await mode(false)
  await mode(true)
  await click(button('取消'))
  expect(snapshot()).toBe(before)
  expect(host.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube.com/embed/original123')
  expect(host.querySelector('.embed-title').textContent).toBe('已应用标题')
  expect(host.querySelector('[role="status"]')).toBeNull()
  await click(button('编辑嵌入内容'))
  expect(host.querySelector('input[type="url"]').value).toBe('https://youtu.be/original123')
  expect(host.querySelector('input[type="text"]').value).toBe('已应用标题')
})

test('an empty committed embed does not publish or load its pending URL during reading', async () => {
  await mount(() => $createEmbedNode())
  const before = snapshot()
  await field(host.querySelector('input[type="url"]'), 'https://youtu.be/pending456')
  await field(host.querySelector('input[type="text"]'), '待应用嵌入')
  await mode(false)
  expect(snapshot()).toBe(before)
  expect(host.querySelector('iframe')).toBeNull()
  expect(host.querySelector('.embed-title')).toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toContain('未应用')
  await mode(true)
  await click(button('取消'))
  expect(snapshot()).toBe(before)
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(host.querySelector('iframe')).toBeNull()
})

test('completing a formula draft that trims to its committed value clears pending state without changing the document', async () => {
  await mount(() => $createFormulaNode({ expression: 'x^2', displayMode: true }))
  const before = snapshot()
  await editFormula()
  await field(host.querySelector('textarea'), '  x^2  ')
  expect(registry.hasPending()).toBe(true)
  await click(button('完成'))
  expect(snapshot()).toBe(before)
  expect(registry.hasPending()).toBe(false)
  await mode(false)
  expect(formulaExpression()).toBe('x^2')
  expect(host.querySelector('[role="status"]')).toBeNull()
})

test('saving an embed title draft that trims to its committed value clears pending state without changing the document', async () => {
  await mount(() => $createEmbedNode({ url: 'https://youtu.be/original123', title: '已应用标题' }))
  const before = snapshot()
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="text"]'), '  已应用标题  ')
  expect(registry.hasPending()).toBe(true)
  await click(button('保存'))
  expect(snapshot()).toBe(before)
  expect(registry.hasPending()).toBe(false)
  await mode(false)
  expect(host.querySelector('.embed-title').textContent).toBe('已应用标题')
  expect(host.querySelector('[role="status"]')).toBeNull()
})

test('the editor registry can explicitly discard both pending decorators during reading without writing Lexical', async () => {
  await mount(() => $createFormulaNode({ expression: 'x^2', displayMode: true }))
  await act(async () => editor.update(() => $getRoot().append($createEmbedNode({
    url: 'https://youtu.be/original123', title: '已应用标题',
  })), { discrete: true }))
  await flush()
  const before = snapshot()
  await editFormula()
  await field(host.querySelector('textarea'), 'y^3')
  await click(button('行内公式'))
  await click(button('编辑嵌入内容'))
  await field(host.querySelector('input[type="url"]'), 'https://youtu.be/pending456')
  await field(host.querySelector('input[type="text"]'), '尚未应用标题')
  await mode(false)
  const reviewed = registry.capture()
  expect(reviewed.drafts.map(({ label }) => label)).toEqual(['公式', '嵌入内容'])
  await act(async () => {
    expect(registry.discard(reviewed)).toBe(true)
    expect(registry.hasPending()).toBe(false)
  })
  await flush()
  expect(snapshot()).toBe(before)
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(formulaExpression()).toBe('x^2')
  expect(host.querySelector('.formula-rendered').classList.contains('block')).toBe(true)
  expect(host.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube.com/embed/original123')
  expect(host.querySelector('.embed-title').textContent).toBe('已应用标题')
  await mode(true)
  expect(host.querySelector('textarea, input')).toBeNull()
  await editFormula()
  expect(host.querySelector('textarea').value).toBe('x^2')
  expect(button('独立公式').classList.contains('active')).toBe(true)
  await click(button('编辑嵌入内容'))
  expect(host.querySelector('input[type="url"]').value).toBe('https://youtu.be/original123')
  expect(host.querySelector('input[type="text"]').value).toBe('已应用标题')
})
