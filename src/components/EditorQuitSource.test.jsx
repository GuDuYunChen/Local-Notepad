import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MarkdownSourcePlugin from './Editor/plugins/MarkdownSourcePlugin'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { editorQuit } from '~/services/editorQuit.mjs'

// This narrow source-panel fixture must not replace the Lexical context used by
// the separate TextEditor/IME tests. Both suites run in the exit-save CI gate.
const fakeEditor = vi.hoisted(() => ({
  getEditorState: () => ({}),
  parseEditorState: value => value,
  setEditorState: vi.fn(),
  focus: vi.fn(),
}))
vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [fakeEditor],
}))
vi.mock('~/services/markdownSource', () => ({
  analyzeMarkdownSourceCompatibility: () => ({ markdown: 'original', issues: [], editable: true }),
}))
vi.mock('~/services/importContent', () => ({ markdownToLexical: value => value }))

let root, host, prepare, results, dispose
const challengeId = 'a'.repeat(32)
const until = assertion => vi.waitFor(async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  assertion()
}, { timeout: 1500, interval: 10 })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  results = []
  host = document.createElement('div'); host.id = 'root'
  document.body.appendChild(host); root = createRoot(host)
  fakeEditor.setEditorState.mockReset(); fakeEditor.focus.mockReset()
  dispose = installDocumentQuitBridge({ bridge: {
    onQuitPrepare(fn) { prepare = fn; return () => { prepare = null } },
    onQuitRelease() { return () => {} },
    reportQuitResult(value) { results.push(value) },
  }, registry: editorQuit })
})
afterEach(async () => {
  dispose()
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})

async function openSource() {
  await act(async () => root.render(<MarkdownSourcePlugin />))
  await act(async () => window.dispatchEvent(new Event('editor:toggle-source-mode')))
  await until(() => expect(host.querySelector('[aria-label="Markdown 源码内容"]')).not.toBeNull())
  return host.querySelector('[aria-label="Markdown 源码内容"]')
}

it('an open Markdown source draft must be applied explicitly before exit', async () => {
  const textarea = await openSource()
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'unapplied source')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(host.textContent).toContain('有未应用更改')
  await act(async () => prepare({ id: challengeId }))
  await until(() => expect(results).toEqual([{ id: challengeId, ready: false, code: 'source' }]))
  expect(fakeEditor.setEditorState).not.toHaveBeenCalled()
  expect(textarea.value).toBe('unapplied source')
  expect(host.inert).not.toBe(true)
})

it('an unchanged source view does not create an implicit editor write', async () => {
  await openSource()
  await act(async () => prepare({ id: challengeId }))
  await until(() => expect(results).toEqual([{ id: challengeId, ready: true }]))
  expect(fakeEditor.setEditorState).not.toHaveBeenCalled()
  expect(host.inert).toBe(true)
})
