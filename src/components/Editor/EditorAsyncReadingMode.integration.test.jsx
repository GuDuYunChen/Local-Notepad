import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PASTE_COMMAND, getNearestEditorFromDOMNode } from 'lexical'
import Editor from './Editor'
import { desktopNote } from '../../../scripts/desktop-save-fixture.mjs'

const mocks = vi.hoisted(() => ({ uploadFile: vi.fn() }))
vi.mock('./utils/fileUpload', async importOriginal => ({
  ...await importOriginal(), uploadFile: mocks.uploadFile,
}))

describe('pending editor uploads when reading mode changes', () => {
  let host, root, finishUpload, editor, render
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mocks.uploadFile.mockReset()
    mocks.uploadFile.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const initialContent = desktopNote('异步插入', '原正文')
    render = readOnly => <Editor documentId="async-reading" initialContent={initialContent} onChange={() => {}} readOnly={readOnly} />
    await act(async () => root.render(render(false)))
    editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  async function startToolbarUpload() {
    await act(async () => host.querySelector('[aria-label="插入内容"]').click())
    const input = host.querySelector('input[type="file"]:not([accept])')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['owned'], 'owned.txt', { type: 'text/plain' })] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  }

  for (const returnToEditing of [false, true]) {
    it(`ignores a toolbar upload completed after entering reading mode${returnToEditing ? ' and returning to editing' : ''}`, async () => {
      await startToolbarUpload()
      const before = JSON.stringify(editor.getEditorState())
      await act(async () => root.render(render(true)))
      if (returnToEditing) await act(async () => root.render(render(false)))
      await act(async () => { finishUpload({ url: '/api/assets/owned.txt' }); await Promise.resolve() })
      expect(JSON.stringify(editor.getEditorState())).toBe(before)
      expect(host.querySelector('.attachment-block')).toBeNull()
    })
  }

  it('keeps a current editable upload working through the normal content observer', async () => {
    await startToolbarUpload()
    await act(async () => { finishUpload({ url: '/api/assets/owned.txt' }); await Promise.resolve() })
    expect(JSON.stringify(editor.getEditorState())).toContain('owned.txt')
    expect(JSON.stringify(editor.getEditorState())).toContain('"type":"attachment"')
  })

  it('ignores pasted-image completion after reading and editing without reviving the old operation', async () => {
    await act(async () => editor.dispatchCommand(PASTE_COMMAND, {
      clipboardData: { files: [new File(['owned-image'], 'owned.png', { type: 'image/png' })] },
      preventDefault() {},
    }))
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
    const before = JSON.stringify(editor.getEditorState())
    await act(async () => root.render(render(true)))
    await act(async () => root.render(render(false)))
    await act(async () => { finishUpload({ url: '/api/assets/owned.png' }); await Promise.resolve() })
    expect(JSON.stringify(editor.getEditorState())).toBe(before)
  })
})
