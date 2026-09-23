import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { createTextEvidenceTarget } from './Editor/utils/evidenceNavigationUtils'
import { toast } from '~/services/toast'

vi.mock('~/services/api', () => ({ api: vi.fn(), getBacklinks: vi.fn().mockResolvedValue([]) }))
vi.mock('./Editor/Editor', async importOriginal => {
  const { LoadContentPlugin } = await importOriginal()
  const { LexicalComposer } = await import('@lexical/react/LexicalComposer')
  const { RichTextPlugin } = await import('@lexical/react/LexicalRichTextPlugin')
  const { ContentEditable } = await import('@lexical/react/LexicalContentEditable')
  const { LexicalErrorBoundary } = await import('@lexical/react/LexicalErrorBoundary')
  const { default: EvidenceNavigationPlugin } = await import('./Editor/plugins/EvidenceNavigationPlugin')
  return { default: function TestEditor({ initialContent, documentId }) {
    return <LexicalComposer initialConfig={{ namespace: 'async-load', onError: error => { throw error } }}>
      <div className="editor-shell"><div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <LoadContentPlugin content={initialContent} documentId={documentId} />
        <EvidenceNavigationPlugin initialContent={initialContent} documentId={documentId} />
      </div></div>
    </LexicalComposer>
  } }
})
function body(text = '关关返回。') {
  const editor = createEditor()
  editor.update(() => $getRoot().append($createParagraphNode().append($createTextNode(text))), { discrete: true })
  return JSON.stringify(editor.getEditorState().toJSON())
}
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j }); return { resolve, reject, promise } }
let container, root
beforeEach(async () => {
  await import('./Editor/Editor')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  api.mockReset()
  vi.spyOn(toast, 'warning').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); evidenceNavigation.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function render(activeId, props = {}, strict = false) {
  const node = <TextEditor activeId={activeId} autoSaveOnSwitch={false} {...props} />
  await act(async () => root.render(strict ? <React.StrictMode>{node}</React.StrictMode> : node))
}
async function resolve(request, id, content) {
  await act(async () => { request.resolve({ id, content, updated_at: 1 }); await request.promise })
}

describe('async content loading before real Lexical evidence navigation', () => {
  it('does not mount an empty editor or consume the request while the file is loading', async () => {
    const request = deferred(); api.mockReturnValue(request.promise)
    const content = body(); evidenceNavigation.start('c1', createTextEvidenceTarget(content, { start: 0, end: 2, match: '关关' }))
    await render('c1')
    expect(container.querySelector('.editor-input')).toBeNull()
    expect(evidenceNavigation.peek('c1')).not.toBeNull()
    await resolve(request, 'c1', content)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('.editor-input').textContent).toBe('关关返回。')
    expect(evidenceNavigation.peek()).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('StrictMode cleanup cannot cancel the replayed load or publish the obsolete response', async () => {
    const loads = []
    api.mockImplementation(() => { const d = deferred(); loads.push(d); return d.promise })
    await render('c1', {}, true)
    expect(loads.length).toBe(2)
    await resolve(loads[0], 'c1', body('旧数据'))
    expect(container.querySelector('.editor-input')).toBeNull()
    await resolve(loads[1], 'c1', body('最新正文'))
    expect(container.querySelector('.editor-input').textContent).toBe('最新正文')
  })

  it('A to B to A ignores a stale response even when its document ID matches again', async () => {
    const loads = []; api.mockImplementation(() => { const d = deferred(); loads.push(d); return d.promise })
    await render('a'); await render('b'); await render('a')
    await resolve(loads[2], 'a', body('新版本'))
    await resolve(loads[0], 'a', body('旧版本'))
    await resolve(loads[1], 'b', body('其他章节'))
    expect(container.querySelector('.editor-input').textContent).toBe('新版本')
  })

  it('loading failure is noneditable and a successful retry mounts the intended document', async () => {
    const request = deferred(); api.mockReturnValueOnce(request.promise)
    await render('c1')
    await act(async () => { request.reject(new Error('offline')); await request.promise.catch(() => {}) })
    expect(container.querySelector('.editor-input')).toBeNull()
    expect(container.querySelector('[role="alert"]').textContent).toContain('正文加载失败')
    api.mockResolvedValueOnce({ id: 'c1', content: body('重试成功') })
    await act(async () => container.querySelector('button').click())
    expect(container.querySelector('.editor-input').textContent).toBe('重试成功')
  })

  it('external save while loading cannot overwrite the new document with old or empty content', async () => {
    const request = deferred(); api.mockReturnValue(request.promise)
    const ref = React.createRef()
    await render('c1', { ref })
    await act(async () => { expect(await ref.current.save()).toBeUndefined() })
    expect(api.mock.calls.every(([, options]) => !options?.method)).toBe(true)
  })

  it('changing autosave preference does not reload the current document', async () => {
    api.mockResolvedValue({ id: 'c1', content: body('当前正文') })
    await render('c1')
    await render('c1', { autoSaveOnSwitch: true })
    expect(api).toHaveBeenCalledOnce()
    expect(container.querySelector('.editor-input').textContent).toBe('当前正文')
  })

  it('a genuinely empty loaded file still opens as an editable empty paragraph', async () => {
    api.mockResolvedValue({ id: 'c1', content: '', updated_at: 1 })
    await render('c1')
    expect(container.querySelector('.editor-input')).not.toBeNull()
    expect(container.querySelector('.editor-input').textContent).toBe('')
  })
})
