import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createEditor, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isNodeSelection } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import EvidenceNavigationPlugin, { $applyEvidenceTarget } from './EvidenceNavigationPlugin'
import DocumentSessionPlugin, { writeDocumentSession } from './DocumentSessionPlugin'
import { LoadContentPlugin } from '../Editor'
import { WikiLinkNode } from '../nodes/WikiLinkNode'
import { createTextEvidenceTarget, createWikiEvidenceTarget } from '../utils/evidenceNavigationUtils'
import { collectProjectPlainText } from '../../projectEntityMentionUtils'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { toast } from '~/services/toast'

function prepared(build) {
  const editor = createEditor({ namespace: 'evidence-test', nodes: [WikiLinkNode], onError: error => { throw error } })
  editor.update(() => { $getRoot().append(build()) }, { discrete: true })
  return editor
}
function textTarget(content, nth = 0, match = '关关') {
  const plain = collectProjectPlainText(content)
  let start = -1
  for (let index = 0; index <= nth; index++) start = plain.indexOf(match, start + 1)
  return createTextEvidenceTarget(content, { start, end: start + match.length, match })
}
function selected(editor) {
  return editor.getEditorState().read(() => {
    const selection = $getSelection()
    return $isRangeSelection(selection) ? { text: selection.getTextContent(), anchor: selection.anchor.offset, focus: selection.focus.offset } : null
  })
}

let container, root, captured, frames, nextFrame
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.spyOn(toast, 'warning').mockImplementation(() => {})
  vi.spyOn(toast, 'success').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  captured = null
  localStorage.clear()
  evidenceNavigation.cancel()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  evidenceNavigation.cancel()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function Capture() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { captured = editor }, [editor])
  return null
}
async function render(content, { documentId = 'c1', load = true, editable = true } = {}) {
  await act(async () => root.render(
    <LexicalComposer initialConfig={{ namespace: 'evidence-dom', nodes: [WikiLinkNode], editable, onError: error => { throw error } }}>
      <div className="editor-shell"><div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <Capture />
        {load && <LoadContentPlugin documentId={documentId} content={content} />}
        <DocumentSessionPlugin documentId={documentId} restoreSelection={editable} />
        <EvidenceNavigationPlugin documentId={documentId} initialContent={content} />
      </div></div>
    </LexicalComposer>
  ))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
async function flushFrames() {
  for (let count = 0; count < 4 && frames.size; count++) {
    const current = [...frames.values()]
    frames.clear()
    await act(async () => { current.forEach(callback => callback(0)); await Promise.resolve() })
  }
}
const content = () => JSON.stringify(prepared(() => $createParagraphNode().append($createTextNode('关关出发，关关返回。'))).getEditorState().toJSON())

describe('evidence navigation in the real Lexical editor', () => {
  it('selects the exact repeated occurrence without changing content or dirty nodes', () => {
    const editor = prepared(() => $createParagraphNode().append($createTextNode('关关出发，关关返回。')))
    const before = JSON.stringify(editor.getEditorState().toJSON())
    const updates = []
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => updates.push(dirtyElements.size + dirtyLeaves.size))
    let result
    editor.update(() => { result = $applyEvidenceTarget(textTarget(before, 1)) }, { discrete: true })
    expect(result.status).toBe('found')
    expect(selected(editor)).toEqual({ text: '关关', anchor: 5, focus: 7 })
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before)
    expect(updates.every(count => count === 0)).toBe(true)
    unregister()
  })

  it('selects across formatting and a decomposed combining character', () => {
    const editor = prepared(() => $createParagraphNode().append($createTextNode('E'), $createTextNode('\u0301lodie').toggleFormat('bold')))
    const before = JSON.stringify(editor.getEditorState().toJSON())
    editor.update(() => $applyEvidenceTarget(textTarget(before, 0, 'Élodie')), { discrete: true })
    expect(selected(editor).text).toBe('E\u0301lodie')
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before)
  })

  it('selects the requested WikiLink node without changing its identity', () => {
    const editor = prepared(() => $createParagraphNode().append(new WikiLinkNode('a', '关关'), $createTextNode('然后'), new WikiLinkNode('a', '关关')))
    const before = JSON.stringify(editor.getEditorState().toJSON())
    editor.update(() => $applyEvidenceTarget(createWikiEvidenceTarget(before, 'a', 1)), { discrete: true })
    editor.getEditorState().read(() => {
      expect($isNodeSelection($getSelection())).toBe(true)
      expect($getSelection().getNodes()[0].getKey()).toBe($getRoot().getFirstChild().getLastChild().getKey())
    })
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before)
  })

  it('waits for the actual LoadContentPlugin commit, not a guessed timer', async () => {
    const body = content()
    evidenceNavigation.start('c1', textTarget(body, 1))
    await render(body, { load: false })
    expect(evidenceNavigation.peek('c1')).not.toBeNull()
    await render(body)
    expect(evidenceNavigation.peek()).toBeNull()
    expect(selected(captured)).toEqual({ text: '关关', anchor: 5, focus: 7 })
    await flushFrames()
    expect(container.querySelector('.editor-evidence-target')).toBeTruthy()
  })

  it('does not allow saved session restoration to overwrite explicit navigation', async () => {
    const body = content()
    writeDocumentSession('c1', { scrollTop: 123, selection: { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 0, offset: 0 } } })
    evidenceNavigation.start('c1', textTarget(body, 1))
    await render(body)
    await flushFrames()
    expect(selected(captured).text).toBe('关关')
    expect(selected(captured).anchor).toBe(5)
  })

  it('keeps ordinary session restoration when there is no evidence request', async () => {
    const body = content()
    writeDocumentSession('c1', { scrollTop: 123, selection: { anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 0, offset: 2 } } })
    await render(body)
    await flushFrames()
    expect(selected(captured).anchor).toBe(2)
    expect(container.querySelector('.editor-container').scrollTop).toBe(123)
  })

  it('cannot consume a different document request even when the text is identical', async () => {
    const body = content()
    evidenceNavigation.start('c2', textTarget(body, 1))
    await render(body, { documentId: 'c1' })
    expect(evidenceNavigation.peek('c2')).not.toBeNull()
    await render(body, { documentId: 'c2' })
    expect(evidenceNavigation.peek()).toBeNull()
    expect(selected(captured).anchor).toBe(5)
  })

  it('reports stale evidence and does not modify the current selection or manuscript', async () => {
    const body = content()
    await render(body)
    const prior = selected(captured)
    const old = body.replace('关关出发', '关关先前出发')
    await act(async () => { evidenceNavigation.start('c1', textTarget(old)); await Promise.resolve() })
    expect(evidenceNavigation.peek()).toBeNull()
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('过期'))
    expect(selected(captured)).toEqual(prior)
  })

  it('blocks navigation behind a Markdown source overlay without closing or editing it', async () => {
    const body = content()
    await render(body)
    const overlay = document.createElement('div')
    overlay.className = 'markdown-source-overlay'
    container.querySelector('.editor-shell').appendChild(overlay)
    await act(async () => { evidenceNavigation.start('c1', textTarget(body)); await Promise.resolve() })
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('源码'))
    expect(overlay.isConnected).toBe(true)
  })

  it('latest request wins while the target editor is still loading', async () => {
    const body = content()
    evidenceNavigation.start('c1', textTarget(body))
    evidenceNavigation.start('c1', textTarget(body, 1))
    await render(body)
    expect(selected(captured).anchor).toBe(5)
  })

  it('read-only navigation reveals the target without changing serialized content', async () => {
    const body = content()
    evidenceNavigation.start('c1', textTarget(body, 1))
    await render(body, { editable: false })
    expect(captured.isEditable()).toBe(false)
    expect(JSON.stringify(captured.getEditorState().toJSON())).toBe(body)
    await flushFrames()
    expect(container.querySelector('.editor-evidence-target')).toBeTruthy()
  })
})
