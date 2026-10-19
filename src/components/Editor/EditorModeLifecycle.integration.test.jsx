import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { $createTextNode, $getRoot, getNearestEditorFromDOMNode } from 'lexical'
import Editor from './Editor'
import { desktopNote } from '../../../scripts/desktop-save-fixture.mjs'

describe('real editor reading-mode lifecycle', () => {
  let host, root
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  const legacyContent = JSON.stringify({ root: {
    children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: '旧格式正文', type: 'text', version: 1 }], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 }],
    direction: null, format: '', indent: 0, type: 'root', version: 1,
  } })

  for (const [label, initialContent, visibleText] of [
    ['an empty stored body', '', ''],
    ['valid older JSON requiring normalization', legacyContent, '旧格式正文'],
  ]) {
    it(`opens ${label} directly in reading mode without reporting a user edit, then observes real editing`, async () => {
      const onChange = vi.fn()
      const render = readOnly => <Editor documentId="reading-initial-load" initialContent={initialContent} onChange={onChange} readOnly={readOnly} />
      await act(async () => root.render(render(true)))
      const input = host.querySelector('.editor-input')
      const editor = getNearestEditorFromDOMNode(input)
      expect(input.textContent).toBe(visibleText)
      expect(editor.isEditable()).toBe(false)
      // This verifies a real normalization, not a fixture which was already
      // identical to the serializer's output and could mask a false dirty draft.
      expect(JSON.stringify(editor.getEditorState())).not.toBe(initialContent)
      expect(onChange).not.toHaveBeenCalled()

      await act(async () => root.render(render(false)))
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => editor.update(() => {
        $getRoot().getLastChild().append($createTextNode(' 新输入'))
      }, { discrete: true }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith(JSON.stringify(editor.getEditorState()))
      expect(input.textContent).toBe(visibleText + ' 新输入')
    })
  }

  it('keeps an accepted edit separate from a scheduled content load and observes the next edit', async () => {
    const originalContent = desktopNote('加载边界', '原正文')
    const replacementContent = desktopNote('加载边界', '外部载入正文')
    const onChange = vi.fn()
    const render = initialContent => <Editor documentId="load-commit-boundary" initialContent={initialContent} onChange={onChange} readOnly={false} />
    await act(async () => root.render(render(originalContent)))
    const editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
    onChange.mockClear()

    await act(async () => {
      // Queue the load first, then accept a user update before its microtask
      // commits. The load's tag must never absorb that accepted update.
      flushSync(() => root.render(render(replacementContent)))
      editor.update(() => {
        $getRoot().getLastChild().append($createTextNode(' 已接受的输入'))
      })
      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toContain('原正文 已接受的输入')
    const observedDraft = onChange.mock.calls[0][0]
    expect(host.querySelector('.editor-input').textContent).toBe('加载边界外部载入正文')

    onChange.mockClear()
    // Returning to the formerly observed body is still a new user edit after
    // loading. The observer's deduplication baseline must follow the load.
    await act(async () => editor.update(() => {
      $getRoot().getLastChild().clear().append($createTextNode('原正文 已接受的输入'))
    }, { discrete: true }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(observedDraft)
  })

  it('retains the same editor and draft while switching modes without another content change', async () => {
    const initialContent = desktopNote('阅读测试', '原正文')
    const onChange = vi.fn()
    const render = readOnly => <Editor documentId="mode-draft" initialContent={initialContent} onChange={onChange} readOnly={readOnly} />
    await act(async () => root.render(render(false)))
    const input = host.querySelector('.editor-input')
    const editor = getNearestEditorFromDOMNode(input)
    await act(async () => editor.update(() => {
      $getRoot().getLastChild().append($createTextNode(' 未保存草稿'))
    }, { discrete: true }))
    const draft = JSON.stringify(editor.getEditorState())
    onChange.mockClear()

    await act(async () => root.render(render(true)))
    expect(host.querySelector('.editor-input')).toBe(input)
    expect(getNearestEditorFromDOMNode(input)).toBe(editor)
    expect(editor.isEditable()).toBe(false)
    expect(input.contentEditable).toBe('false')
    expect(JSON.stringify(editor.getEditorState())).toBe(draft)
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => root.render(render(false)))
    expect(host.querySelector('.editor-input')).toBe(input)
    expect(editor.isEditable()).toBe(true)
    expect(JSON.stringify(editor.getEditorState())).toBe(draft)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not lose a committed pre-switch edit while Lexical reconciliation is still queued', async () => {
    const initialContent = desktopNote('切换时序', '原正文')
    const onChange = vi.fn()
    const render = readOnly => <Editor documentId="mode-queued-edit" initialContent={initialContent} onChange={onChange} readOnly={readOnly} />
    await act(async () => root.render(render(false)))
    const editor = getNearestEditorFromDOMNode(host.querySelector('.editor-input'))
    onChange.mockClear()

    await act(async () => {
      // Lexical queues its commit. A synchronous mode change must not remove
      // the draft observer before that already-accepted update is delivered.
      editor.update(() => {
        $getRoot().getLastChild().append($createTextNode(' 切换前最后输入'))
      })
      flushSync(() => root.render(render(true)))
      await Promise.resolve()
    })
    const draft = JSON.stringify(editor.getEditorState())
    expect(draft).toContain('切换前最后输入')
    expect(editor.isEditable()).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(draft)
  })
})
