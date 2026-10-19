import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { $getRoot } from 'lexical'
import { ImageNode, $createImageNode } from './ImageNode'
import { ImageGridNode, $createImageGridNode } from './ImageGridNode'
import { AttachmentNode, $createAttachmentNode } from './AttachmentNode'
import { uploadFile } from '../utils/fileUpload'

vi.mock('../utils/fileUpload', () => ({ uploadFile: vi.fn() }))

const imageSrc = 'data:image/png;base64,aW1hZ2U='
const gridItems = [
  { src: imageSrc, alt: 'one.png', caption: '第一张原说明' },
  { src: imageSrc, alt: 'two.png', caption: '第二张原说明' },
]
const fixtures = {
  image: () => $createImageNode({ src: imageSrc, originalSrc: imageSrc, alt: 'original.png', caption: '图片原说明', width: 640 }),
  grid: () => $createImageGridNode({ items: gridItems, columns: 2, gap: 8 }),
  attachment: () => $createAttachmentNode({ src: 'data:text/plain,original', name: 'original.txt', size: 8, mime: 'text/plain' }),
}
const selectors = {
  image: { block: '.editor-image-block', caption: '.editor-image-caption-input', remove: '.editor-image-toolbar .danger' },
  grid: { block: '.editor-image-grid-block', caption: '.editor-image-grid-caption', remove: '.editor-image-grid-toolbar .danger' },
  attachment: { block: '.attachment-block', remove: '.attachment-delete-button' },
}
let root, host, editor, errors

function CaptureEditor() {
  const [instance] = useLexicalComposerContext()
  useEffect(() => { editor = instance }, [instance])
  return null
}

const settle = async () => act(async () => { for (let index = 0; index < 8; index++) await Promise.resolve() })

async function mount(kind, editable = true) {
  await act(async () => root.render(
    <LexicalComposer initialConfig={{
      namespace: 'media-reading-mode',
      editable,
      nodes: [ImageNode, ImageGridNode, AttachmentNode],
      editorState: () => $getRoot().append(fixtures[kind]()),
      onError: error => { errors.push(error) },
    }}>
      <RichTextPlugin contentEditable={<ContentEditable />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <CaptureEditor />
    </LexicalComposer>
  ))
  await settle()
  expect(errors).toEqual([])
}

function documentJSON() { return editor.getEditorState().toJSON() }
function firstNode() { return documentJSON().root.children[0] }
function button(text) { return [...host.querySelectorAll('button')].find(item => item.textContent.trim() === text) }

async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.click())
  await settle()
}

async function select(kind) { await click(host.querySelector(selectors[kind].block)) }
async function setEditable(value) { await act(async () => editor.setEditable(value)); await settle() }

function inputValue(element, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function fileInputChange(element, names = ['replacement.png']) {
  Object.defineProperty(element, 'files', {
    configurable: true,
    value: names.map(name => new File(['new content'], name, { type: 'image/png' })),
  })
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function chooseFile(element, names) {
  expect(element).toBeTruthy()
  await act(async () => fileInputChange(element, names))
  await settle()
}

const uploadCases = [
  { name: 'image replacement', kind: 'image', prepare: () => host.querySelector('input[type="file"]') },
  { name: 'grid addition', kind: 'grid', prepare: () => host.querySelector('input[type="file"][multiple]') },
  { name: 'grid replacement', kind: 'grid', prepare: async () => {
    await click(host.querySelector('.editor-image-grid-replace'))
    return host.querySelector('input[type="file"]:not([multiple])')
  } },
  { name: 'attachment replacement', kind: 'attachment', prepare: () => host.querySelector('input[type="file"]') },
]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  errors = []
  uploadFile.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('media nodes with the actual Lexical editable state', () => {
  for (const kind of ['image', 'grid', 'attachment']) {
    it(`${kind}: opening in reading mode prevents native edit controls`, async () => {
      await mount(kind, false)
      const before = documentJSON()
      await select(kind)
      const remove = host.querySelector(selectors[kind].remove)
      expect(remove === null || remove.disabled).toBe(true)
      for (const input of host.querySelectorAll('input:not([type="file"])')) expect(input.readOnly || input.disabled).toBe(true)
      for (const input of host.querySelectorAll('input[type="file"]')) expect(input.disabled).toBe(true)
      expect(documentJSON()).toEqual(before)
      expect(uploadFile).not.toHaveBeenCalled()
    })

    it(`${kind}: switching in place updates controls and keeps the same document and root`, async () => {
      await mount(kind)
      await select(kind)
      const before = documentJSON()
      const originalRoot = editor.getRootElement()
      const originalBlock = host.querySelector(selectors[kind].block)
      await setEditable(false)
      expect(editor.getRootElement()).toBe(originalRoot)
      expect(host.querySelector(selectors[kind].block)).toBe(originalBlock)
      const remove = host.querySelector(selectors[kind].remove)
      expect(remove === null || remove.disabled).toBe(true)
      if (selectors[kind].caption) expect(host.querySelector(selectors[kind].caption).readOnly).toBe(true)
      expect(documentJSON()).toEqual(before)
      await setEditable(true)
      await select(kind)
      expect(host.querySelector(selectors[kind].remove).disabled).toBe(false)
      if (selectors[kind].caption) {
        const caption = host.querySelector(selectors[kind].caption)
        expect(caption.readOnly).toBe(false)
        await act(async () => inputValue(caption, '切回编辑后输入'))
        await settle()
        expect(kind === 'image' ? firstNode().caption : firstNode().items[0].caption).toBe('切回编辑后输入')
      }
      expect(errors).toEqual([])
    })

    it(`${kind}: a previously rendered delete handler cannot write before React rerenders`, async () => {
      await mount(kind)
      await select(kind)
      const remove = host.querySelector(selectors[kind].remove)
      expect(remove).toBeTruthy()
      const before = documentJSON()
      await act(async () => {
        editor.setEditable(false)
        remove.click()
      })
      await settle()
      expect(documentJSON()).toEqual(before)
      expect(errors).toEqual([])
    })
  }

  for (const kind of ['image', 'grid']) {
    it(`${kind}: an input event already queued at mode change cannot change the caption`, async () => {
      await mount(kind)
      const caption = host.querySelector(selectors[kind].caption)
      const before = documentJSON()
      await act(async () => {
        editor.setEditable(false)
        inputValue(caption, '禁止写入的图注')
      })
      await settle()
      expect(documentJSON()).toEqual(before)
      expect(host.querySelector(selectors[kind].caption).value).not.toBe('禁止写入的图注')
    })
  }

  for (const uploadCase of uploadCases) {
    it(`${uploadCase.name}: a queued native file event cannot start an upload after reading begins`, async () => {
      uploadFile.mockResolvedValue({ url: 'https://example.test/forbidden.png' })
      await mount(uploadCase.kind)
      await select(uploadCase.kind)
      const input = await uploadCase.prepare()
      const before = documentJSON()
      await act(async () => {
        editor.setEditable(false)
        fileInputChange(input)
      })
      await settle()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(documentJSON()).toEqual(before)
    })

    for (const returnToEditing of [false, true]) {
      it(`${uploadCase.name}: late upload cannot apply after entering reading${returnToEditing ? ' and returning to editing' : ''}`, async () => {
        let finishUpload
        uploadFile.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
        await mount(uploadCase.kind)
        await select(uploadCase.kind)
        const input = await uploadCase.prepare()
        const before = documentJSON()
        await chooseFile(input)
        expect(uploadFile).toHaveBeenCalledTimes(1)
        await setEditable(false)
        if (returnToEditing) await setEditable(true)
        await act(async () => finishUpload({ url: 'https://example.test/late.png' }))
        await settle()
        expect(documentJSON()).toEqual(before)
        expect(errors).toEqual([])
      })
    }

    it(`${uploadCase.name}: normal editable upload still changes the intended node`, async () => {
      uploadFile.mockResolvedValue({ url: 'https://example.test/current.png' })
      await mount(uploadCase.kind)
      await select(uploadCase.kind)
      await chooseFile(await uploadCase.prepare())
      expect(uploadFile).toHaveBeenCalledTimes(1)
      const node = firstNode()
      if (uploadCase.name === 'grid addition') {
        expect(node.items.slice(0, 2)).toEqual(gridItems)
        expect(node.items[2].src).toBe('https://example.test/current.png')
      } else if (uploadCase.kind === 'grid') {
        expect(node.items[0].src).toBe('https://example.test/current.png')
        expect(node.items[1]).toEqual(gridItems[1])
      } else expect(node.src).toBe('https://example.test/current.png')
      expect(errors).toEqual([])
    })
  }

  for (const mode of ['editing', 'reading', 'returning']) {
    it(`grid dragging ${mode === 'editing' ? 'still reorders in editing' : `cannot outlive ${mode === 'reading' ? 'reading mode' : 'a reading-to-editing return'}`}`, async () => {
      await mount('grid')
      await select('grid')
      const before = documentJSON()
      const start = new Event('dragstart', { bubbles: true, cancelable: true })
      Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn() } })
      await act(async () => host.querySelector('.editor-image-grid-drag').dispatchEvent(start))
      await settle()
      if (mode !== 'editing') await setEditable(false)
      if (mode === 'returning') await setEditable(true)
      await act(async () => host.querySelectorAll('.editor-image-grid-card')[1].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })))
      await settle()
      if (mode === 'editing') expect(firstNode().items).toEqual([gridItems[1], gridItems[0]])
      else expect(documentJSON()).toEqual(before)
    })
  }

  it('grid batch upload stops before the next file after switching to reading', async () => {
    let finishFirst
    uploadFile.mockImplementation(() => new Promise(resolve => { finishFirst = resolve }))
    await mount('grid')
    await select('grid')
    const before = documentJSON()
    await chooseFile(host.querySelector('input[type="file"][multiple]'), ['first.png', 'second.png'])
    expect(uploadFile).toHaveBeenCalledTimes(1)
    await setEditable(false)
    await act(async () => finishFirst({ url: 'https://example.test/first.png' }))
    await settle()
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(documentJSON()).toEqual(before)
  })

  it('image download remains available in reading mode without changing the node', async () => {
    const downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push({ href: this.href, name: this.download }) })
    await mount('image', false)
    const before = documentJSON()
    await select('image')
    await click(button('下载'))
    expect(downloads).toEqual([{ href: imageSrc, name: 'original.png' }])
    expect(documentJSON()).toEqual(before)
  })

  it('attachment preview and download stay usable while both delete entries are closed', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '附件可阅读正文', blob: async () => new Blob(['附件可阅读正文']) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reading-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await mount('attachment')
    await click(button('预览'))
    const before = documentJSON()
    expect(host.querySelector('.attachment-text-preview').textContent).toBe('附件可阅读正文')
    await setEditable(false)
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    expect(host.querySelector('.attachment-preview-delete')).toBeNull()
    expect(host.querySelector('.attachment-delete-button')).toBeNull()
    await click(host.querySelector('.attachment-preview-header-actions button'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(documentJSON()).toEqual(before)
  })
})
