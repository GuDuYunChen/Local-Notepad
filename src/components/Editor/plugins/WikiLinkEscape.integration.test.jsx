// @vitest-environment jsdom
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin'
import {
  $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection,
  CONTROLLED_TEXT_INSERTION_COMMAND, HISTORY_PUSH_TAG,
} from 'lexical'
import { api, searchFiles } from '~/services/api'
import UiThemeProvider from '~/components/ui/UiThemeProvider'
import { WikiLinkNode } from '../nodes/WikiLinkNode'
import WikiLinkPlugin from './WikiLinkPlugin'

vi.mock('~/services/api', async original => ({
  ...await original(), api: vi.fn(), searchFiles: vi.fn(),
}))

// Real RichText, History, WikiLinkPlugin, DOM focus and Lexical selection.
// These DOM key events are untrusted jsdom events, not Windows acceptance.
// Initial text/insertion use actual editor commands; nothing refocuses the
// editor between Escape and Ctrl+Z. Exact saved JSON equality is the App's
// content-dirty comparison; this harness does not claim a native save-chip UI.
const originalText = '临时输入触发符后使用真实撤销，恢复这段原文。'
let host, reactRoot, editor, history, errors, nativeTargets, foreign, rangeRect

beforeAll(() => {
  rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  if (!rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(20, 20, 1, 18),
  })
})
afterAll(() => { if (!rangeRect) delete Range.prototype.getBoundingClientRect })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  editor = null; history = createEmptyHistoryState(); errors = []; nativeTargets = []
  api.mockReset(); searchFiles.mockReset()
  api.mockImplementation(async route => {
    expect(route).toBe('/api/files?page=1&size=20&compact=1')
    return [{ id: 'one', title: '第一个本地结果' }, { id: 'two', title: '第二个本地结果' }]
  })
  host = document.createElement('div')
  foreign = document.createElement('input')
  document.body.append(host, foreign)
  reactRoot = createRoot(host)
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove(); foreign.remove()
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

function CaptureEditor() {
  const [instance] = useLexicalComposerContext()
  useEffect(() => { editor = instance }, [instance])
  return null
}

async function mount() {
  await act(async () => reactRoot.render(<UiThemeProvider>
    <LexicalComposer initialConfig={{ namespace: 'wiki-escape-ownership', nodes: [WikiLinkNode], onError: error => errors.push(error) }}>
      <CaptureEditor />
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <HistoryPlugin externalHistoryState={history} />
      <WikiLinkPlugin />
    </LexicalComposer>
  </UiThemeProvider>))
  await act(async () => {
    editor.update(() => {
      const text = $createTextNode(originalText)
      $getRoot().clear().append($createParagraphNode().append(text))
      text.selectEnd()
    }, { discrete: true, tag: HISTORY_PUSH_TAG })
    editor.getRootElement().focus()
  })
  expect(document.activeElement).toBe(editor.getRootElement())
  expect(errors).toEqual([])
  return JSON.stringify(editor.getEditorState())
}

async function openWiki() {
  await act(async () => editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, '[['))
  // The production empty-query search uses its normal zero-delay timer.
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  expect(host.querySelectorAll('.wiki-link-menu button')).toHaveLength(2)
  expect(document.activeElement).toBe(editor.getRootElement())
}

function snapshot() {
  const dom = document.getSelection()
  return {
    active: document.activeElement,
    body: JSON.stringify(editor.getEditorState()),
    dom: { anchorNode: dom.anchorNode, anchorOffset: dom.anchorOffset, focusNode: dom.focusNode, focusOffset: dom.focusOffset, rangeCount: dom.rangeCount },
    logical: editor.getEditorState().read(() => {
      const selection = $getSelection()
      return $isRangeSelection(selection) ? {
        anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
        focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
        format: selection.format, style: selection.style,
      } : null
    }),
    undo: history.undoStack.length,
  }
}

async function key(name, options = {}) {
  const target = document.activeElement
  nativeTargets.push({ key: name, target })
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
  await act(async () => target.dispatchEvent(event))
  expect(event.isTrusted).toBe(false)
  return event
}

describe('Wiki completion Escape ownership with real RichText and History', () => {
  it('closes the owned menu without blur or caret/history changes, then Ctrl+Z restores the exact clean saved body', async () => {
    const saved = await mount()
    await openWiki()
    await key('ArrowDown')
    const before = snapshot()
    const escape = await key('Escape')
    const closed = snapshot(), menuClosed = !host.querySelector('.wiki-link-menu')
    await key('z', { code: 'KeyZ', ctrlKey: true })
    const undone = snapshot()
    expect({
      menuClosed, escapeConsumed: escape.defaultPrevented,
      editorFocusRetained: closed.active === editor.getRootElement(),
      undoDeliveredToEditor: nativeTargets.at(-1).target === editor.getRootElement(),
      exactSavedBodyRestored: undone.body === saved,
      contentDirty: undone.body !== saved,
    }).toEqual({ menuClosed: true, escapeConsumed: true, editorFocusRetained: true,
      undoDeliveredToEditor: true, exactSavedBodyRestored: true, contentDirty: false })
    expect(closed.dom).toEqual(before.dom)
    expect(closed.logical).toEqual(before.logical)
    expect(closed.body).toBe(before.body)
    expect(closed.undo).toBe(before.undo)
    expect(undone.body).toBe(saved)
    expect(editor.getRootElement().textContent).toBe(originalText)
    expect(api).toHaveBeenCalledTimes(1); expect(searchFiles).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })

  it('keeps the original RichText Escape blur when no Wiki menu owns the key', async () => {
    const saved = await mount(), before = snapshot()
    expect(host.querySelector('.wiki-link-menu')).toBeNull()
    await key('Escape')
    expect(document.activeElement).toBe(document.body)
    expect(snapshot().body).toBe(saved)
    expect(snapshot().undo).toBe(before.undo)
    expect(api).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })

  it('does not take focus from a foreign input when the document-level dismissal closes the menu', async () => {
    await mount(); await openWiki()
    const before = snapshot()
    foreign.focus()
    await key('Escape')
    expect(document.activeElement).toBe(foreign)
    expect(host.querySelector('.wiki-link-menu')).toBeNull()
    expect(snapshot().body).toBe(before.body)
    expect(snapshot().undo).toBe(before.undo)
    expect(errors).toEqual([])
  })
})
