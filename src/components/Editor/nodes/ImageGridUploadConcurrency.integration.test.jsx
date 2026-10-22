import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { $getRoot, HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND } from 'lexical'
import { ImageGridNode, $createImageGridNode } from './ImageGridNode'
import { uploadFile } from '../utils/fileUpload'

vi.mock('../utils/fileUpload', () => ({ uploadFile: vi.fn() }))

const originalItems = [
  { src: 'data:image/png;base64,b25l', alt: 'one.png', caption: 'first original caption' },
  { src: 'data:image/png;base64,dHdv', alt: 'two.png', caption: 'second original caption' },
]
let root, host, editor, errors, finishUpload, pendingUploads

function CaptureEditor() {
  const [instance] = useLexicalComposerContext()
  useEffect(() => { editor = instance }, [instance])
  return null
}

const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const items = () => editor.getEditorState().toJSON().root.children[0].items

async function click(element) {
  expect(element).toBeTruthy()
  expect(element.disabled).not.toBe(true)
  await act(async () => element.click())
  await settle()
}

async function chooseFiles(input, files) {
  expect(input.disabled).toBe(false)
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

async function startUpload(replaceIndex) {
  const callCount = uploadFile.mock.calls.length
  if (replaceIndex !== undefined) await click(host.querySelectorAll('.editor-image-grid-replace')[replaceIndex])
  const input = host.querySelector(replaceIndex === undefined ? 'input[type="file"][multiple]' : 'input[type="file"]:not([multiple])')
  await chooseFiles(input, [new File(['replacement'], 'uploaded.png', { type: 'image/png' })])
  expect(uploadFile).toHaveBeenCalledTimes(callCount + 1)
  expect(finishUpload).toBeTypeOf('function')
}

async function changeCaption(index, value) {
  const input = host.querySelectorAll('.editor-image-grid-caption')[index]
  expect(input.readOnly).toBe(false)
  expect(input.disabled).toBe(false)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
  expect(items()[index].caption).toBe(value)
}

async function completeUpload() {
  await act(async () => finishUpload({ url: 'https://example.test/uploaded.png' }))
  await settle()
  expect(errors).toEqual([])
}

function button(text) {
  return [...host.querySelectorAll('button')].find(element => element.textContent.trim() === text)
}

function status() {
  return host.querySelector('[role="status"]')?.textContent || ''
}

async function reorder(fromIndex, toIndex) {
  const start = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn() } })
  await act(async () => host.querySelectorAll('.editor-image-grid-drag')[fromIndex].dispatchEvent(start))
  await settle()
  await act(async () => host.querySelectorAll('.editor-image-grid-card')[toIndex].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })))
  await settle()
}

async function updateGrid(update) {
  await act(async () => editor.update(() => update($getRoot().getFirstChild()), { discrete: true, tag: HISTORY_PUSH_TAG }))
  await settle()
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  finishUpload = undefined
  pendingUploads = []
  uploadFile.mockReset()
  uploadFile.mockImplementation(() => new Promise((resolve, reject) => {
    finishUpload = resolve
    pendingUploads.push({ resolve, reject })
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(
    <LexicalComposer initialConfig={{
      namespace: 'image-grid-upload-concurrency', editable: true, nodes: [ImageGridNode],
      onError: error => errors.push(error),
    }}>
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <HistoryPlugin delay={0} />
      <CaptureEditor />
    </LexicalComposer>
  ))
  await settle()
  await act(async () => editor.update(() => {
    $getRoot().clear().append($createImageGridNode({ items: originalItems, columns: 2, gap: 8 }))
  }, { discrete: true, tag: HISTORY_PUSH_TAG }))
  await settle()
  await click(host.querySelector('.editor-image-grid-block'))
  expect(items()).toEqual(originalItems)
  expect(errors).toEqual([])
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('adding an image preserves a caption committed while its upload was pending', async () => {
  await startUpload()
  await changeCaption(0, 'caption edited during addition')
  await completeUpload()
  expect(items()[0].caption).toBe('caption edited during addition')
  expect(items()[1]).toEqual(originalItems[1])
  expect(items()[2].src).toBe('https://example.test/uploaded.png')
})

test('replacing an image preserves target and neighboring captions committed during upload', async () => {
  await startUpload(0)
  await changeCaption(0, 'new target caption')
  await changeCaption(1, 'new neighboring caption')
  await completeUpload()
  expect(items().map(item => item.caption)).toEqual(['new target caption', 'new neighboring caption'])
  expect(items()[0].src).toBe('https://example.test/uploaded.png')
  expect(items()[1].src).toBe(originalItems[1].src)
})

test('a pending replacement does not resurrect a removed neighbor or switch its target by index', async () => {
  await startUpload(1)
  await click(host.querySelectorAll('.editor-image-grid-remove')[0])
  expect(items()).toEqual([originalItems[1]])
  await completeUpload()
  expect(items()).toHaveLength(1)
  expect(items()[0]).toMatchObject({ src: 'https://example.test/uploaded.png', caption: originalItems[1].caption })
})

test('a pending replacement follows its image through reorder and keeps the latest caption', async () => {
  await startUpload(0)
  await reorder(0, 1)
  expect(items()).toEqual([originalItems[1], originalItems[0]])
  await changeCaption(1, 'caption after moving the target')
  await completeUpload()
  expect(items()).toHaveLength(2)
  expect(items()[0]).toEqual(originalItems[1])
  expect(items()[1]).toMatchObject({ src: 'https://example.test/uploaded.png', caption: 'caption after moving the target' })
})

test('removing the target visibly cancels its upload and a retry cannot be overwritten by the old result', async () => {
  await startUpload(0)
  const first = pendingUploads[0]
  await click(host.querySelectorAll('.editor-image-grid-remove')[0])
  expect(items()).toEqual([originalItems[1]])
  expect(status()).toContain('取消')
  await startUpload(0)
  await act(async () => first.resolve({ url: 'https://example.test/stale.png' }))
  await settle()
  expect(items()).toEqual([originalItems[1]])
  expect(button('处理中…').disabled).toBe(true)
  await completeUpload()
  expect(items()).toHaveLength(1)
  expect(items()[0]).toMatchObject({ src: 'https://example.test/uploaded.png', caption: originalItems[1].caption })
})

test('removing the target and undoing in the same React batch never revives its old replacement', async () => {
  await startUpload(0)
  await act(async () => {
    host.querySelectorAll('.editor-image-grid-remove')[0].click()
    editor.read(() => {})
    expect(items()).toEqual([originalItems[1]])
    editor.dispatchCommand(UNDO_COMMAND)
  })
  await settle()
  expect(items()).toEqual(originalItems)
  await completeUpload()
  expect(items()).toEqual(originalItems)
  expect(status()).toContain('取消')
})

test('undo and redo cannot revive a replacement even when the original item reference returns', async () => {
  await changeCaption(1, 'caption before uploading')
  const before = items()
  await startUpload(0)
  await act(async () => {
    editor.dispatchCommand(UNDO_COMMAND)
    editor.read(() => {})
    expect(items()).toEqual(originalItems)
    editor.dispatchCommand(REDO_COMMAND)
  })
  await settle()
  expect(items()).toEqual(before)
  await completeUpload()
  expect(items()).toEqual(before)
  expect(status()).toContain('取消')
})

test('an unrecognized replacement of equal item objects cancels instead of guessing image identity', async () => {
  await startUpload(0)
  await updateGrid(node => node.setItems(node.__items.map(item => ({ ...item }))))
  expect(items()).toEqual(originalItems)
  await completeUpload()
  expect(items()).toEqual(originalItems)
  expect(status()).toContain('取消')
})

test('two identical images remain distinct replacement targets after reorder', async () => {
  await updateGrid(node => node.setItems([{ ...originalItems[0] }, { ...originalItems[0] }]))
  await startUpload(1)
  await reorder(1, 0)
  await changeCaption(0, 'selected identical image')
  await completeUpload()
  expect(items()[0]).toMatchObject({ src: 'https://example.test/uploaded.png', caption: 'selected identical image' })
  expect(items()[1]).toEqual(originalItems[0])
})

test('adding images uses the latest order and membership when upload completes', async () => {
  await startUpload()
  await reorder(0, 1)
  await click(host.querySelectorAll('.editor-image-grid-remove')[1])
  expect(items()).toEqual([originalItems[1]])
  await changeCaption(0, 'remaining image caption')
  await completeUpload()
  expect(items()).toHaveLength(2)
  expect(items()[0]).toMatchObject({ src: originalItems[1].src, caption: 'remaining image caption' })
  expect(items()[1].src).toBe('https://example.test/uploaded.png')
})

for (const kind of ['addition', 'replacement']) {
  test(`${kind} upload failure is visible and preserves content before a successful retry`, async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await startUpload(kind === 'replacement' ? 0 : undefined)
    await act(async () => pendingUploads[0].reject(new Error('fixture upload failure')))
    await settle()
    expect(items()).toEqual(originalItems)
    expect(status()).toContain('失败')
    expect(button('添加图片').disabled).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(1)
    await startUpload(kind === 'replacement' ? 0 : undefined)
    await completeUpload()
    expect(items()[kind === 'replacement' ? 0 : 2].src).toBe('https://example.test/uploaded.png')
    expect(status()).not.toContain('失败')
  })
}

test('cancelling a pending upload leaves content intact and allows an independent new upload', async () => {
  await startUpload(0)
  const first = pendingUploads[0]
  await click(button('取消本次上传'))
  expect(items()).toEqual(originalItems)
  expect(status()).toContain('取消')
  await startUpload()
  await act(async () => first.resolve({ url: 'https://example.test/cancelled.png' }))
  await settle()
  expect(items()).toEqual(originalItems)
  await completeUpload()
  expect(items().slice(0, 2)).toEqual(originalItems)
  expect(items()[2].src).toBe('https://example.test/uploaded.png')
})

test('cancelling file selection does not start an upload and does not block another selection', async () => {
  await click(host.querySelectorAll('.editor-image-grid-replace')[0])
  await chooseFiles(host.querySelector('input[type="file"]:not([multiple])'), [])
  expect(uploadFile).not.toHaveBeenCalled()
  expect(items()).toEqual(originalItems)
  await startUpload(1)
  await completeUpload()
  expect(items()[0]).toEqual(originalItems[0])
  expect(items()[1].src).toBe('https://example.test/uploaded.png')
})

test('a rejected oversized replacement stays unchanged and another valid selection succeeds', async () => {
  await click(host.querySelectorAll('.editor-image-grid-replace')[0])
  const file = new File(['oversized'], 'oversized.png', { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
  await chooseFiles(host.querySelector('input[type="file"]:not([multiple])'), [file])
  expect(uploadFile).not.toHaveBeenCalled()
  expect(items()).toEqual(originalItems)
  expect(status()).toContain('10 MB')
  await startUpload(0)
  await completeUpload()
  expect(items()[0].src).toBe('https://example.test/uploaded.png')
})

test('a partial multi-image upload retains successful additions and shows the failed portion', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const input = host.querySelector('input[type="file"][multiple]')
  await chooseFiles(input, ['first.png', 'second.png'].map(name => new File(['image'], name, { type: 'image/png' })))
  await changeCaption(1, 'caption while batch uploads')
  await act(async () => pendingUploads[0].resolve({ url: 'https://example.test/first.png' }))
  await settle()
  expect(uploadFile).toHaveBeenCalledTimes(2)
  await act(async () => pendingUploads[1].reject(new Error('second fixture failed')))
  await settle()
  expect(items()).toHaveLength(3)
  expect(items()[1].caption).toBe('caption while batch uploads')
  expect(items()[2]).toMatchObject({ src: 'https://example.test/first.png', caption: 'first.png' })
  expect(status()).toContain('失败')
  expect(button('添加图片').disabled).toBe(false)
  expect(consoleError).toHaveBeenCalledTimes(1)
})
