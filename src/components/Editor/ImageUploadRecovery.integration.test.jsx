import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNearestEditorFromDOMNode, PASTE_COMMAND } from 'lexical'
import Editor from './Editor'
import { desktopNote } from '../../../scripts/desktop-save-fixture.mjs'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn(), compressImage: vi.fn() }))
vi.mock('./utils/fileUpload', async original => ({ ...await original(), ...mocks }))

describe('image insertion recovery through the actual editor entry points', () => {
  let host, root, editor, file, preview, feedback, render
  const onToast = event => { if (event.detail.action === 'show') feedback.push(event.detail.toast) }
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear(); feedback = []
    window.addEventListener('local-notepad:toast', onToast)
    file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'original.jpg', { type: 'image/jpeg' })
    preview = new File(['preview'], 'original-preview.jpg', { type: 'image/jpeg' })
    mocks.compressImage.mockReset().mockResolvedValue(preview)
    mocks.uploadFile.mockReset()
    host = document.createElement('div'); document.body.append(host)
    root = createRoot(host)
    render = (readOnly = false, id = 'image-recovery') => <Editor documentId={id} initialContent={desktopNote('图片恢复', '保留正文')} onChange={() => {}} readOnly={readOnly} />
    await act(async () => root.render(render()))
    editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
  })
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove()
    window.removeEventListener('local-notepad:toast', onToast)
    vi.restoreAllMocks()
  })
  async function start(entry) {
    if (entry === 'paste') {
      await act(async () => editor.dispatchCommand(PASTE_COMMAND, { clipboardData: { files: [file] }, preventDefault() {} }))
    } else {
      await act(async () => host.querySelector('[aria-label="插入内容"]').click())
      const input = host.querySelector('input[accept="image/*"]')
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    }
  }
  async function selectAgain() {
    if (!host.querySelector('input[accept="image/*"]')) await act(async () => host.querySelector('[aria-label="插入内容"]').click())
    const input = host.querySelector('input[accept="image/*"]')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  function images() {
    const nodes = JSON.parse(JSON.stringify(editor.getEditorState())).root.children
    return nodes.flatMap(n => n.type === 'image' ? [n] : (n.children || []).filter(c => c.type === 'image'))
  }
  for (const entry of ['toolbar', 'paste']) {
    it(`${entry}: failed preview uses the successfully uploaded original exactly once`, async () => {
      mocks.uploadFile.mockImplementation(async image => {
        if (image === preview) throw new Error('preview upload failed')
        return { url: '/uploads/owned-original.jpg' }
      })
      await start(entry)
      expect(images()).toHaveLength(1)
      expect(images()[0].src).toBe('/uploads/owned-original.jpg')
      expect(images()[0].originalSrc).toBe('/uploads/owned-original.jpg')
      expect(mocks.uploadFile.mock.calls.filter(([image]) => image === file)).toHaveLength(1)
    })
    it(`${entry}: original failure is visible and never inserts a preview-only image`, async () => {
      mocks.uploadFile.mockImplementation(async image => {
        if (image === file) throw new Error('original upload failed')
        return { url: '/uploads/preview.jpg' }
      })
      await start(entry)
      expect(images()).toHaveLength(0)
      expect(feedback.some(t => t.type === 'error')).toBe(true)
      expect(mocks.uploadFile.mock.calls.filter(([image]) => image === file)).toHaveLength(1)
    })
    it(`${entry}: compression failure falls back without changing the note's existing text`, async () => {
      mocks.compressImage.mockRejectedValue(new Error('canvas unavailable'))
      mocks.uploadFile.mockResolvedValue({ url: '/uploads/owned-original.jpg' })
      await start(entry)
      expect(images()).toHaveLength(1)
      expect(JSON.stringify(editor.getEditorState())).toContain('保留正文')
      expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    })
    it(`${entry}: reading and returning to editing does not revive delayed compression`, async () => {
      let finish
      mocks.compressImage.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      await start(entry)
      await act(async () => root.render(render(true)))
      await act(async () => root.render(render(false)))
      await act(async () => finish(preview))
      expect(images()).toHaveLength(0); expect(mocks.uploadFile).not.toHaveBeenCalled()
    })
  }
  it('toolbar cancellation settles and rejects the late receipt without inserting an image', async () => {
    let finish
    mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await start('toolbar')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在插入图片')
    const cancel = [...host.querySelectorAll('button')].find(button => button.textContent === '取消图片上传')
    await act(async () => cancel.click())
    expect(mocks.uploadFile.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => finish({ url: '/uploads/late.jpg' }))
    expect(images()).toHaveLength(0)
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
  it('toolbar and paste share one editor-wide upload session and cancellation control', async () => {
    let finish
    mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await start('paste')
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    await selectAgain()
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[aria-label="图片上传进度"]')).not.toBeNull()
    expect(feedback.some(t => t.type === 'warning' && t.content.includes('正在处理中'))).toBe(true)
    const cancel = [...host.querySelectorAll('button')].find(button => button.textContent === '取消图片上传')
    await act(async () => cancel.click())
    expect(mocks.uploadFile.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => finish({ url: '/uploads/late-paste.jpg' }))
    expect(images()).toHaveLength(0)
  })
  it('toolbar allows explicitly selecting the same failed file again', async () => {
    mocks.uploadFile.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ url: '/uploads/retried.jpg' })
    await start('toolbar')
    expect(images()).toHaveLength(0)
    await act(async () => host.querySelector('[aria-label="插入内容"]').click())
    expect(host.querySelector('input[accept="image/*"]').value).toBe('')
    await selectAgain()
    expect(images()).toHaveLength(1)
    expect(mocks.uploadFile.mock.calls.filter(([image]) => image === file)).toHaveLength(2)
    expect(mocks.uploadFile).toHaveBeenCalledTimes(3)
  })
  it('toolbar refuses duplicate overlapping image selections', async () => {
    let finish
    mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await start('toolbar'); await selectAgain()
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    const cancel = [...host.querySelectorAll('button')].find(button => button.textContent === '取消图片上传')
    await act(async () => cancel.click())
    await act(async () => finish({ url: '/uploads/late.jpg' }))
    expect(images()).toHaveLength(0)
  })
  for (const entry of ['toolbar', 'paste']) {
    it(`${entry}: switching documents aborts the old transport and preserves the new note`, async () => {
      let finish
      mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      await start(entry)
      const signal = mocks.uploadFile.mock.calls[0][1].signal
      await act(async () => root.render(render(false, 'different-note')))
      expect(signal.aborted).toBe(true)
      await act(async () => finish({ url: '/uploads/late.jpg' }))
      expect(images()).toHaveLength(0)
      expect(JSON.stringify(editor.getEditorState())).toContain('保留正文')
    })
  }
  it('pasted batches keep successful images in order and report failed items', async () => {
    const a = new File(['a'], 'a.png', { type: 'image/png' })
    const b = new File(['b'], 'b.png', { type: 'image/png' })
    const c = new File(['c'], 'c.png', { type: 'image/png' })
    mocks.uploadFile.mockImplementation(async image => {
      if (image === b) throw new Error('missing image')
      return { url: '/uploads/' + image.name }
    })
    const preventDefault = vi.fn()
    await act(async () => editor.dispatchCommand(PASTE_COMMAND, { clipboardData: { files: [a, b, c] }, preventDefault }))
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(images().map(image => image.alt)).toEqual(['a.png', 'c.png'])
    expect(feedback.some(t => t.type === 'error' && t.content.includes('1 张失败'))).toBe(true)
    expect(mocks.uploadFile).toHaveBeenCalledTimes(3)
  })
  it('pasted oversized images are rejected visibly before any upload', async () => {
    file = new File([], 'oversized.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    await start('paste')
    expect(mocks.uploadFile).not.toHaveBeenCalled()
    expect(images()).toHaveLength(0)
    expect(feedback.some(t => t.type === 'error' && t.content.includes('10 MB'))).toBe(true)
  })

  it('pending toolbar insertion closes its menu and focuses the persistent cancellation control', async () => {
    mocks.uploadFile.mockImplementation(() => new Promise(() => {}))
    await start('toolbar')
    expect(host.querySelector('.toolbar-more-menu')).toBeNull()
    const status = host.querySelector('[aria-label="图片上传进度"]')
    expect(status?.textContent).toContain('正在插入图片')
    const cancel = status.querySelector('button')
    expect(cancel.textContent).toBe('取消图片上传')
    expect(document.activeElement).toBe(cancel)
    await act(async () => cancel.click())
    expect(images()).toHaveLength(0)
    expect(host.querySelector('[aria-label="图片上传进度"]')).toBeNull()
  })

})
