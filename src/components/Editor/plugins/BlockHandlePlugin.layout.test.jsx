import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import UiThemeProvider from '../../ui/UiThemeProvider'
import BlockHandlePlugin from './BlockHandlePlugin'
import DragDropPlugin from './DragDropPlugin'

let host, root, editor, errors, port, block, viewport
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
const serialized = () => JSON.stringify(editor.getEditorState().toJSON())
const mouse = async (node, type, x, y) => act(async () => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })))

function CaptureEditor() {
  const [instance] = useLexicalComposerContext()
  useLayoutEffect(() => { editor = instance }, [instance])
  return null
}

async function openMenu() {
  const handle = host.querySelector('.block-handle')
  expect(handle).toBeTruthy()
  await act(async () => handle.click())
  const menu = host.querySelector('.block-menu')
  expect(menu).toBeTruthy()
  return { handle, menu }
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  port = rect(180, 100, 500, 340)
  block = rect(256, 150, 400, 24)
  viewport = { width: 704, height: 455 }
  vi.stubGlobal('innerWidth', viewport.width)
  vi.stubGlobal('innerHeight', viewport.height)
  // The DOM environment has no layout engine. Only measured geometry is supplied;
  // the real Lexical selection, menu handlers, controls and drag plugin run intact.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('editor-container')) return port
    if (this.matches('.editor-input > p')) return block
    if (this.classList.contains('block-handle') || this.classList.contains('block-menu')) {
      const owner = this.closest('.editor-container')
      const left = port.left + Number.parseFloat(this.style.left || '0') - owner.scrollLeft
      const top = port.top + Number.parseFloat(this.style.top || '0') - owner.scrollTop
      return rect(left, top, this.offsetWidth, this.offsetHeight)
    }
    return rect(0, 0, 0, 0)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    if (this.classList.contains('block-handle')) return 24
    if (this.classList.contains('block-menu')) return Math.min(210, Number.parseFloat(this.style.maxWidth) || 210)
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    if (this.classList.contains('block-handle')) return 24
    if (this.classList.contains('block-menu')) return Math.min(320, Number.parseFloat(this.style.maxHeight) || 320)
    return 0
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(
    <UiThemeProvider>
      <LexicalComposer initialConfig={{ namespace: 'block-layout', onError: error => errors.push(error) }}>
        <div className="editor-container">
          <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
          <CaptureEditor />
          <BlockHandlePlugin />
          <DragDropPlugin />
        </div>
      </LexicalComposer>
    </UiThemeProvider>,
  ))
  const owner = host.querySelector('.editor-container')
  Object.defineProperties(owner, {
    clientWidth: { configurable: true, get: () => port.width },
    clientHeight: { configurable: true, get: () => port.height },
    clientLeft: { configurable: true, value: 0 },
    clientTop: { configurable: true, value: 0 },
  })
  await act(async () => editor.update(() => {
    const paragraph = $createParagraphNode().append($createTextNode('Preserved source block'))
    $getRoot().clear().append(paragraph)
    paragraph.selectStart()
  }, { discrete: true }))
  const text = host.querySelector('.editor-input p').firstChild
  const selection = window.getSelection()
  const range = document.createRange()
  range.setStart(text, 0)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  await mouse(owner, 'mousemove', port.left + 10, block.top)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('the selected block handle fits the visible scroll port and retains its actual drag key', async () => {
  const before = serialized()
  const handle = host.querySelector('.block-handle')
  expect(handle).toBeTruthy()
  const box = handle.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(port.left)
  expect(box.right).toBeLessThanOrEqual(port.right)
  expect(box.top).toBeGreaterThanOrEqual(port.top)
  expect(box.bottom).toBeLessThanOrEqual(port.bottom)
  expect(handle.getAttribute('draggable')).toBe('true')
  let key
  editor.getEditorState().read(() => { key = $getRoot().getFirstChild().getKey() })
  expect(handle.dataset.blockKey).toBe(key)
  const dataTransfer = { effectAllowed: '', setData: vi.fn() }
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  await act(async () => handle.dispatchEvent(event))
  expect(dataTransfer.effectAllowed).toBe('move')
  expect(dataTransfer.setData.mock.calls).toEqual([['application/x-local-notepad-block', key], ['text/plain', '']])
  await act(async () => handle.dispatchEvent(new Event('dragend', { bubbles: true })))
  expect(serialized()).toBe(before)
  expect(errors).toEqual([])
})

test('the actual menu has an explicit bounded anchor instead of a static position after the document', async () => {
  const before = serialized()
  const { handle, menu } = await openMenu()
  expect(menu.style.top).not.toBe('')
  expect(menu.style.left).not.toBe('')
  const box = menu.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(port.left)
  expect(box.right).toBeLessThanOrEqual(port.right)
  expect(box.top).toBeGreaterThanOrEqual(port.top)
  expect(box.bottom).toBeLessThanOrEqual(port.bottom)
  expect(Math.abs(box.left - handle.getBoundingClientRect().left)).toBeLessThanOrEqual(8)
  expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(14)
  expect(serialized()).toBe(before)
  expect(errors).toEqual([])
})

test('pointer travel into an open menu keeps the same menu and business controls mounted', async () => {
  const before = serialized()
  const { menu } = await openMenu()
  const entry = menu.querySelector('[role="menuitem"]')
  await mouse(entry, 'mousemove', port.left + 120, block.top + 50)
  expect(host.querySelector('.block-menu')).toBe(menu)
  expect(host.querySelector('.block-menu [role="menuitem"]')).toBe(entry)
  await act(async () => entry.click())
  editor.getEditorState().read(() => {
    const children = $getRoot().getChildren()
    expect(children.map(node => node.getTextContent())).toEqual(['', 'Preserved source block'])
  })
  expect(host.querySelector('.block-menu')).toBeNull()
  expect(serialized()).not.toBe(before)
  expect(errors).toEqual([])
})

test('scroll and resize track the selected block without changing content or leaving an offscreen menu', async () => {
  const before = serialized()
  const { menu } = await openMenu()
  const owner = host.querySelector('.editor-container')
  owner.scrollTop = 30
  block = rect(block.left, block.top - 30, block.width, block.height)
  await act(async () => owner.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.block-handle').getBoundingClientRect().top).toBe(block.top)
  expect(host.querySelector('.block-menu')).toBe(menu)
  port = rect(180, 100, 360, 220)
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(port.right)
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(port.bottom)
  owner.scrollTop = 200
  block = rect(block.left, -100, block.width, block.height)
  await act(async () => owner.dispatchEvent(new Event('scroll')))
  expect(host.querySelector('.block-menu')).toBeNull()
  expect(host.querySelector('.block-handle')).toBeNull()
  expect(serialized()).toBe(before)
  expect(errors).toEqual([])
})

test('the original outside mousedown closes the menu without changing the selected block', async () => {
  const before = serialized()
  await openMenu()
  await mouse(document.body, 'mousedown', 10, 10)
  expect(host.querySelector('.block-menu')).toBeNull()
  expect(serialized()).toBe(before)
  expect(errors).toEqual([])
})
