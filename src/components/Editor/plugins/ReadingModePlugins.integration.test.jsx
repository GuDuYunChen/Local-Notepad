import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createLinkNode, LinkNode } from '@lexical/link'
import { api, searchFiles } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { VideoNode, $createVideoNode } from '../nodes/VideoNode'
import { WikiLinkNode } from '../nodes/WikiLinkNode'
import MarkdownSourcePlugin from './MarkdownSourcePlugin'
import ResourceManagerPlugin from './ResourceManagerPlugin'
import WikiLinkPlugin from './WikiLinkPlugin'
import LinkInteractionPlugin from './LinkInteractionPlugin'

vi.mock('~/services/api', () => ({ api: vi.fn(), searchFiles: vi.fn() }))

let host, root, editor, errors
function Plugins({ readOnly }) {
  const [current] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = current; current.setEditable(!readOnly) }, [current, readOnly])
  return <><MarkdownSourcePlugin readOnly={readOnly} /><ResourceManagerPlugin readOnly={readOnly} /><WikiLinkPlugin /><LinkInteractionPlugin readOnly={readOnly} /></>
}
function Harness({ readOnly = false }) {
  return <LexicalComposer initialConfig={{ namespace: 'reading-mode-plugins', editable: !readOnly, nodes: [VideoNode, WikiLinkNode, LinkNode], theme: { link: 'editor-link' }, onError: error => errors.push(error) }}>
    <div className="editor-shell"><RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} /><Plugins readOnly={readOnly} /></div>
  </LexicalComposer>
}
const flush = () => act(async () => { for (let index = 0; index < 6; index++) await Promise.resolve() })
async function mount(factory) {
  await act(async () => root.render(<Harness />))
  await act(async () => editor.update(() => $getRoot().clear().append(factory()), { discrete: true }))
  await flush()
}
async function mode(readOnly) { await act(async () => root.render(<Harness readOnly={readOnly} />)); await flush() }
const snapshot = () => JSON.stringify(editor.getEditorState())
const button = label => [...host.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label)
async function click(element) { expect(element).toBeTruthy(); await act(async () => element.click()); await flush() }
async function field(element, value) {
  expect(element).toBeTruthy()
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
async function source() {
  await mount(() => $createParagraphNode().append($createTextNode('original body')))
  await act(async () => window.dispatchEvent(new CustomEvent('editor:toggle-source-mode')))
  await field(host.querySelector('.markdown-source-textarea'), 'pending source draft')
}
async function wikiQuery() {
  await mount(() => $createParagraphNode().append($createTextNode('placeholder')))
  editor.getRootElement().focus()
  await act(async () => editor.update(() => {
    const text = $createTextNode('See [[Target')
    $getRoot().clear().append($createParagraphNode().append(text))
    text.selectEnd()
  }, { discrete: true }))
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  await flush()
  expect(host.querySelector('.wiki-link-menu-item')).toBeTruthy()
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  localStorage.clear()
  api.mockResolvedValue([])
  searchFiles.mockResolvedValue([{ id: 'target-id', title: 'Target' }])
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  expect(errors).toEqual([])
})

test('an open Markdown source draft becomes read-only and resumes without being overwritten', async () => {
  await source()
  const before = snapshot()
  await mode(true)
  const textarea = host.querySelector('.markdown-source-textarea')
  expect(textarea.readOnly).toBe(true)
  expect(button('应用更改')).toBeUndefined()
  await field(textarea, 'reading must not overwrite source')
  expect(textarea.value).toBe('pending source draft')
  expect(snapshot()).toBe(before)
  await mode(false)
  expect(textarea.readOnly).toBe(false)
  expect(textarea.value).toBe('pending source draft')
  await click(button('应用更改'))
  expect(snapshot()).toContain('pending source draft')
})

test('a source apply event queued before the mode rerender cannot replace readonly content', async () => {
  await source()
  const apply = button('应用更改'), before = snapshot()
  await act(async () => { editor.setEditable(false); apply.click() })
  await flush()
  expect(snapshot()).toBe(before)
})

test('resource deletion checks live editable state while resource navigation still works in reading mode', async () => {
  await mount(() => $createVideoNode({ src: '/fixture.mp4' }))
  await click(host.querySelector('.editor-resource-toggle'))
  const remove = host.querySelector('.editor-resource-actions .danger'), before = snapshot()
  await act(async () => { editor.setEditable(false); remove.click() })
  await flush()
  expect(snapshot()).toBe(before)
  await mode(true)
  expect(host.querySelector('.editor-resource-actions .danger')).toBeNull()
  await click(button('定位'))
  expect(snapshot()).toBe(before)
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
})

test('Wiki suggestions close as soon as reading mode starts', async () => {
  vi.useFakeTimers()
  await wikiQuery()
  const before = snapshot()
  await mode(true)
  expect(host.querySelector('.wiki-link-menu')).toBeNull()
  expect(snapshot()).toBe(before)
})

test('a Wiki insertion click already queued at the mode boundary cannot rewrite the query', async () => {
  vi.useFakeTimers()
  await wikiQuery()
  const insert = host.querySelector('.wiki-link-menu-item'), before = snapshot()
  await act(async () => { editor.setEditable(false); insert.click() })
  await flush()
  expect(snapshot()).toBe(before)
})

test.each(['应用', '移除'])('a queued link %s action cannot mutate readonly text and links still open', async action => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  await mount(() => $createParagraphNode().append($createLinkNode('https://example.test/original').append($createTextNode('read this link'))))
  await click(host.querySelector('a.editor-link'))
  await field(host.querySelector('[aria-label="链接地址"]'), 'https://example.test/changed')
  const mutate = button(action), before = snapshot()
  await act(async () => { editor.setEditable(false); mutate.click() })
  await flush()
  expect(snapshot()).toBe(before)
  await mode(true)
  await click(host.querySelector('a.editor-link'))
  expect(open).toHaveBeenCalledWith('https://example.test/original', '_blank', 'noopener,noreferrer')
  expect(snapshot()).toBe(before)
})

test.each(['button', 'event'])('closing an unapplied source draft by %s requires a decision and keeps exit protection until then', async trigger => {
  await source()
  await mode(true)
  const before = snapshot()
  const close = async () => {
    if (trigger === 'button') await click(button('关闭'))
    else await act(async () => window.dispatchEvent(new CustomEvent('editor:toggle-source-mode')))
    await flush()
  }
  await close()
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await expect(editorQuit.flush()).rejects.toMatchObject({ code: 'source' })
  await click([...document.querySelectorAll('button')].find(element => element.textContent === '继续查看'))
  expect(host.querySelector('.markdown-source-textarea').value).toBe('pending source draft')
  expect(snapshot()).toBe(before)
  await close()
  await click([...document.querySelectorAll('button')].find(element => element.textContent === '放弃更改并关闭'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('.markdown-source-overlay')).toBeNull()
  await expect(editorQuit.flush()).resolves.toBeUndefined()
  expect(snapshot()).toBe(before)
  await act(async () => window.dispatchEvent(new CustomEvent('editor:toggle-source-mode')))
  expect(host.querySelector('.markdown-source-textarea').value).toContain('original body')
})

test('a readonly link popover opens and copies the same stored address that it displays', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await mount(() => $createParagraphNode().append($createLinkNode('https://example.test/original').append($createTextNode('read this link'))))
  await click(host.querySelector('a.editor-link'))
  await field(host.querySelector('[aria-label="链接地址"]'), 'https://example.test/unapplied')
  await mode(true)
  expect(host.querySelector('.editor-link-popover-url').textContent).toBe('https://example.test/original')
  await click(button('复制'))
  expect(copy).toHaveBeenCalledWith('https://example.test/original')
  await click(button('打开'))
  expect(open).toHaveBeenCalledWith('https://example.test/original', '_blank', 'noopener,noreferrer')
})
