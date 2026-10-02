import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { readEditorDraft, writeEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ notes: {}, editorChange: null }))
vi.mock('~/services/api', async () => { const { editorSaveReceiptFixture } = await import('./test/editorSaveReceiptFixture.mjs'); return ({ api: editorSaveReceiptFixture(vi.fn()), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn(async () => []) }) })
vi.mock('~/services/toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
// Real App, real unsaved dialog, real TextEditor, real draft cache and exit bridge.
// Only unrelated navigation panels and the rich-text input are fixtures.
vi.mock('./components/FileList', () => ({ default: ({ onSelect }) => <div>
  <button onClick={() => onSelect({ ...fixture.notes.a })}>打开 A</button>
  <button onClick={() => onSelect({ ...fixture.notes.b })}>打开 B</button>
</div> }))
vi.mock('./components/WorkspaceSidebar', () => ({ default: ({ children, onChangeWorkspace }) => <aside>
  <button onClick={() => onChangeWorkspace('settings')}>切到设置</button>
  <button onClick={() => onChangeWorkspace('notes')}>回到笔记</button>{children}
</aside> }))
vi.mock('./components/SettingsPanel', () => ({ default: () => <div data-test-settings>设置工作区</div> }))
vi.mock('./components/ReferenceMaintenanceStatus', () => ({default: () => null}))
vi.mock('./components/ToastViewport', () => ({ default: () => null }))
vi.mock('./components/ReferenceRefactorDialog', () => ({ default: () => null }))
vi.mock('./components/FocusSessionBar', () => ({ default: () => null }))
vi.mock('./components/EvidenceReviewBar', () => ({ default: () => null }))
vi.mock('./components/SearchReturnBar', () => ({ default: () => null }))
vi.mock('./components/CollectionReadingBar', () => ({ default: () => null }))
vi.mock('./components/Editor/utils/referenceUtils', () => ({
  hasHeadingStructureChanged: () => false, expandRefactorTargetIds: () => [],
  planDeleteReferenceImpact: () => ({}), planTargetReferenceRefactor: () => ({}),
}))
vi.mock('./components/Editor/Editor', () => ({ default: ({ initialContent, onChange, documentId }) => {
  const [text, setText] = React.useState(initialContent || '')
  fixture.editorChange = onChange
  React.useEffect(() => setText(initialContent || ''), [initialContent])
  return <textarea aria-label="实际编辑器输入夹具" data-document-id={documentId} value={text} onChange={event => {
    setText(event.target.value); onChange(event.target.value)
  }}/>
} }))
let host, root, prepare, release, dispose, results, deferredSaves
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const until = fn => vi.waitFor(async () => { await act(tick); fn() }, { timeout: 2000, interval: 10 })
const field = () => host.querySelector('textarea')
const dialog = () => host.querySelector('[role="dialog"]')
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
async function click(label) {
  const node = [...host.querySelectorAll('button')].find(node => node.textContent === label)
  expect(node, label).toBeTruthy()
  await act(async () => { node.click(); await tick() })
}
async function type(text) {
  const node = field(); expect(node).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function openA() { await click('打开 A'); await until(() => expect(field()?.dataset.documentId).toBe('a')) }
async function quit() {
  await act(async () => { prepare({ id: 'a'.repeat(32) }); await tick() })
  await until(() => expect(results).toHaveLength(1))
  return results[0]
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await import('./components/Editor/Editor')
  await import('./components/SettingsPanel')
  localStorage.clear(); for (const id of ['a','b','orphan']) { editorQuit.forget(id); removeEditorDraft(id) }
  fixture.notes = { a: { id: 'a', title: 'A.md', content: '原文 A', updated_at: 100 }, b: { id: 'b', title: 'B.md', content: '原文 B', updated_at: 100 } }
  results = []; deferredSaves = []
  api.mockReset()
  api.mockImplementation(async (url, init) => {
    const id = url.split('/').pop()
    if (!fixture.notes[id]) throw new Error('Unexpected fixture request ' + url)
    if (init?.method === 'PUT') {
      const next = { ...fixture.notes[id], ...JSON.parse(init.body), updated_at: 101 }
      fixture.notes[id] = next; return { ...next }
    }
    return { ...fixture.notes[id] }
  })
  host = document.createElement('div'); host.id = 'root'; document.body.append(host); root = createRoot(host)
  dispose = installDocumentQuitBridge({ bridge: {
    onQuitPrepare(fn) { prepare = fn; return () => {} },
    onQuitRelease(fn) { release = fn; return () => {} },
    reportQuitResult(value) { results.push(value) },
  } })
  await act(async () => root.render(<App/>))
  await until(() => expect([...host.querySelectorAll('button')].some(node => node.textContent === '打开 A')).toBe(true))
})
afterEach(async () => {
  dispose?.()
  await act(async () => { for (const item of deferredSaves) item.resolve(item.receipt); await tick() })
  await act(async () => root.unmount()); host.remove()
  for (const id of ['a','b','orphan']) { editorQuit.forget(id); removeEditorDraft(id) }
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})
it('discard then leave the editor and quit does not resurrect the abandoned draft', async () => {
  await openA(); await type('明确放弃的正文')
  expect(editorQuit.pending()).toBe(1)
  await click('切到设置'); expect(dialog()?.textContent).toContain('当前笔记未保存')
  await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
  expect(readEditorDraft('a')).toBeNull(); expect(editorQuit.pending()).toBe(0)
  expect(puts()).toHaveLength(0); expect(fixture.notes.a.content).toBe('原文 A')
})
it('discard then switch notes releases A without saving its discarded text', async () => {
  await openA(); await type('放弃 A'); await click('打开 B'); await click('不保存')
  await until(() => expect(field()?.dataset.documentId).toBe('b'))
  expect(editorQuit.pending()).toBe(0); expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
  expect(puts()).toHaveLength(0); expect(readEditorDraft('a')).toBeNull()
})
it('discard cancels a scheduled draft-cache write and reopens the saved content', async () => {
  await openA(); await type('不得重新缓存'); await click('切到设置'); await click('不保存')
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)))
  expect(readEditorDraft('a')).toBeNull()
  await click('回到笔记'); await until(() => expect(field()?.value).toBe('原文 A'))
  expect(editorQuit.pending()).toBe(0)
})
it('undo to the saved baseline then leave needs no save and does not block quit', async () => {
  await openA(); await type('修改'); await type('原文 A'); await click('切到设置')
  await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(dialog()).toBeNull(); expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true }); expect(puts()).toHaveLength(0)
})
it('an unchanged editor initialization notification cannot leave an orphan ledger entry', async () => {
  await openA(); await act(async () => fixture.editorChange('原文 A'))
  await click('切到设置'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true }); expect(puts()).toHaveLength(0)
})
it('a recovered cached draft is not mistaken for a saved baseline by the navigation guard', async () => {
  writeEditorDraft('a', '恢复出来的未保存正文')
  await openA(); await until(() => expect(field()?.value).toBe('恢复出来的未保存正文'))
  await click('切到设置'); expect(dialog()?.textContent).toContain('当前笔记未保存')
  await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true }); expect(puts()).toHaveLength(0)
})
it('cancel does not release the draft or permit navigation', async () => {
  await openA(); await type('必须保留'); await click('切到设置'); await click('取消')
  expect(field()?.value).toBe('必须保留'); expect(editorQuit.pending()).toBe(1)
  expect(host.querySelector('[data-test-settings]')).toBeNull(); expect(puts()).toHaveLength(0)
})
it('pending writes refuse discard and navigation until their exact receipt has settled', async () => {
  await openA(); await type('已发出的旧写入')
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  const receipt = { ...fixture.notes.a, content: '已发出的旧写入', updated_at: 101 }
  deferredSaves.push({ resolve, receipt })
  api.mockImplementationOnce(() => promise)
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); await tick() })
  expect(puts()).toHaveLength(1)
  await type('尚未发送的新草稿'); await click('切到设置'); await click('不保存')
  expect(dialog()?.textContent).toContain('当前笔记未保存'); expect(field()?.value).toBe('尚未发送的新草稿')
  expect(host.querySelector('[data-test-settings]')).toBeNull(); expect(editorQuit.pending()).toBe(1)
  expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('尚未放弃草稿'))
  fixture.notes.a = receipt
  await act(async () => { resolve(receipt); await tick() })
  await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(puts()).toHaveLength(1); expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
})
it('a genuine save failure still blocks quit and retains the current draft', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await openA(); await type('离线时保留')
  api.mockRejectedValueOnce(new Error('offline'))
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: false, code: 'save-failed' })
  expect(editorQuit.pending()).toBe(1); expect(field()?.value).toBe('离线时保留'); expect(host.inert).not.toBe(true)
})
it('discarding A never erases an unrelated unresolved document', async () => {
  await openA(); await type('放弃 A'); editorQuit.remember('orphan', '另一篇未保存正文')
  await click('切到设置'); await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: false, code: 'unresolved' }); expect(editorQuit.pending()).toBe(1)
})
