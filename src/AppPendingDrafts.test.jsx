import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
import { readEditorDraft, writeEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ notes: {}, editorChange: null, discards: 0 }))
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
vi.mock('./components/SettingsPanel', () => ({ default: ({ onOpenFile }) => <div data-test-settings>
  设置工作区<button onClick={() => onOpenFile('b')}>从设置打开 B</button>
</div> }))
vi.mock('./components/ReferenceMaintenanceStatus', () => ({default: () => null}))
vi.mock('./components/ToastViewport', () => ({ default: () => null }))
vi.mock('./components/ReferenceRefactorDialog', () => ({ default: () => null }))
vi.mock('./components/FocusSessionBar', () => ({ default: () => null }))
vi.mock('./components/EvidenceReviewBar', () => ({ default: () => null }))
vi.mock('./components/SearchReturnBar', () => ({ default: () => null }))
vi.mock('./components/CollectionReadingBar', () => ({ default: () => null }))
vi.mock('./components/Editor/utils/referenceUtils', async (importOriginal) => ({
  ...(await importOriginal()),
  hasHeadingStructureChanged: () => false, expandRefactorTargetIds: () => [],
  planDeleteReferenceImpact: () => ({}), planTargetReferenceRefactor: () => ({}),
}))
vi.mock('./components/Editor/Editor', async () => {
  const { useEditorPendingDraft } = await import('./components/Editor/hooks/useEditorPendingDraft')
  return { default: ({ initialContent, onChange, documentId, readOnly }) => {
    const [text, setText] = React.useState(initialContent || '')
    const [committed, setCommitted] = React.useState(() => initialContent?.split('公式: ')[1] || 'x = 1')
    const [draft, setDraft] = React.useState(committed)
    fixture.editorChange = onChange
    useEditorPendingDraft({
      nodeKey: 'formula-' + documentId, label: '公式', dirty: draft !== committed,
      value: JSON.stringify([draft, committed]),
      discard: () => { fixture.discards += 1; setDraft(committed) },
    })
    React.useEffect(() => setText(initialContent || ''), [initialContent])
    return <div>
      <textarea aria-label="实际编辑器输入夹具" data-document-id={documentId} value={text} readOnly={readOnly}
        onChange={event => { setText(event.target.value); onChange(event.target.value) }}/>
      <input aria-label="公式字段夹具" value={draft} disabled={readOnly} onChange={event => setDraft(event.target.value)}/>
      <span data-committed-formula>{committed}</span>
      <button disabled={readOnly} onClick={() => {
        setCommitted(draft)
        const next = text.split('\n公式: ')[0] + '\n公式: ' + draft
        setText(next); onChange(next)
      }}>应用块草稿</button>
      <button disabled={readOnly} onClick={() => { setDraft(committed) }}>取消块草稿</button>
    </div>
  } }
})
let host, root, prepare, release, dispose, results, deferredSaves, autosave
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
  const result = results[0]
  if (result.ready) await act(async () => { release({ id: result.id }); await tick() })
  results = []
  return result
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await import('./components/Editor/Editor')
  await import('./components/SettingsPanel')
  localStorage.clear(); for (const id of ['a','b','orphan']) { editorQuit.forget(id); removeEditorDraft(id) }
  fixture.notes = { a: { id: 'a', title: 'A.md', content: '原文 A', updated_at: 100 }, b: { id: 'b', title: 'B.md', content: '原文 B', updated_at: 100 } }
  results = []; deferredSaves = []; fixture.discards = 0; autosave = null
  const originalInterval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30000) autosave = callback
    return originalInterval(callback, ms, ...args)
  })
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
const block = () => host.querySelector('[aria-label="公式字段夹具"]')
async function changeBlock(value) {
  const node = block(); expect(node).toBeTruthy(); expect(node.disabled).toBe(false)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function mode(reading) {
  const button = host.querySelector('[aria-label="切换到' + (reading ? '阅读' : '编辑') + '模式"]')
  expect(button).toBeTruthy(); await act(async () => { button.click(); await tick() })
  expect(block().disabled).toBe(reading)
}
async function save() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    await tick()
  })
}
it('unapplied-only changes block navigation and cancel preserves them across reading/editing', async () => {
  await openA(); await changeBlock('x = 2'); await mode(true)
  expect(host.querySelector('.editor-unapplied-draft-pill')?.textContent).toContain('公式更改已保留')
  expect(host.querySelector('[data-committed-formula]').textContent).toBe('x = 1')
  await click('打开 B'); expect(dialog()?.textContent).toContain('未应用')
  await click('取消'); expect(field().dataset.documentId).toBe('a')
  await mode(false); expect(block().value).toBe('x = 2')
  expect(puts()).toHaveLength(0); expect(fixture.discards).toBe(0)
})
it('Save in the leave dialog neither silently drops a block draft nor announces success', async () => {
  await openA(); await changeBlock('x = 2'); await click('打开 B'); await click('保存')
  expect(dialog()?.textContent).toContain('未应用')
  expect(field().dataset.documentId).toBe('a'); expect(block().value).toBe('x = 2')
  expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('完成或取消'))
  expect(toast.success).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0)
})
it('explicit do-not-save clears pending blocks and body without resurrecting either on A to B to A', async () => {
  await openA(); await type('放弃的正文'); await changeBlock('放弃的公式'); await mode(true)
  await click('打开 B'); await click('不保存')
  await until(() => expect(field()?.dataset.documentId).toBe('b'))
  expect(fixture.discards).toBe(1); expect(readEditorDraft('a')).toBeNull()
  expect(host.querySelector('.editor-unapplied-draft-pill')).toBeNull()
  await click('打开 A'); await until(() => expect(field()?.dataset.documentId).toBe('a'))
  expect(field().value).toBe('原文 A'); expect(block().value).toBe('x = 1')
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
  expect(puts()).toHaveLength(0)
})
it('unapplied fields block a normal quit while reading and explicit field cancel releases quit', async () => {
  await openA(); await changeBlock('x = 2'); await mode(true)
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: false, code: 'unapplied' })
  expect(host.inert).not.toBe(true); expect(block().value).toBe('x = 2')
  expect(puts()).toHaveLength(0)
  await mode(false); await click('取消块草稿')
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
  expect(fixture.notes.a.content).toBe('原文 A')
})
it('finishing a preserved draft permits normal Ctrl+S, navigation and a fresh database reload', async () => {
  await openA(); await changeBlock('x = 2'); await mode(true); await save()
  expect(puts()).toHaveLength(0); expect(toast.success).not.toHaveBeenCalled()
  await mode(false); await click('应用块草稿'); await save()
  await until(() => expect(fixture.notes.a.content).toBe('原文 A\n公式: x = 2'))
  expect(toast.success).toHaveBeenCalledWith('正文已保存')
  expect(host.querySelector('.editor-unapplied-draft-pill')).toBeNull()
  await click('打开 B'); await until(() => expect(field()?.dataset.documentId).toBe('b'))
  expect(dialog()).toBeNull()
  await click('打开 A'); await until(() => expect(field()?.dataset.documentId).toBe('a'))
  expect(field().value).toBe(fixture.notes.a.content); expect(block().value).toBe('x = 2')
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
})
it('the existing body autosave continues while unapplied fields remain guarded and visible', async () => {
  await openA(); await type('独立正文自动保存'); await changeBlock('未应用公式')
  expect(autosave).toBeTypeOf('function')
  await act(async () => { autosave(); await tick() })
  await until(() => expect(fixture.notes.a.content).toBe('独立正文自动保存'))
  expect(puts()).toHaveLength(1); expect(block().value).toBe('未应用公式')
  expect(host.querySelector('.editor-unapplied-draft-pill')).toBeTruthy()
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: false, code: 'unapplied' })
  await click('切到设置'); expect(dialog()?.textContent).toContain('未应用')
  await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(fixture.notes.a.content).toBe('独立正文自动保存'); expect(puts()).toHaveLength(1)
})
it('a new block draft typed while a manual save is in flight cannot receive a false complete signal', async () => {
  await openA(); await type('保存途中的正文')
  let resolve; const pending = new Promise(yes => { resolve = yes })
  const receipt = { ...fixture.notes.a, content: '保存途中的正文', updated_at: 101 }
  deferredSaves.push({ resolve, receipt }); api.mockImplementationOnce(() => pending)
  await save(); expect(puts()).toHaveLength(1)
  await changeBlock('更新的未应用公式')
  fixture.notes.a = receipt
  await act(async () => { resolve(receipt); await tick() })
  await until(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('完成或取消')))
  expect(toast.success).not.toHaveBeenCalled(); expect(block().value).toBe('更新的未应用公式')
  await click('打开 B'); expect(dialog()?.textContent).toContain('未应用')
})
it('an outstanding body write refuses explicit discard without clearing a pending block', async () => {
  await openA(); await type('已发送的正文')
  let resolve; const pending = new Promise(yes => { resolve = yes })
  const receipt = { ...fixture.notes.a, content: '已发送的正文', updated_at: 101 }
  deferredSaves.push({ resolve, receipt }); api.mockImplementationOnce(() => pending)
  await save(); await changeBlock('必须保留的字段')
  await click('切到设置'); await click('不保存')
  expect(dialog()?.textContent).toContain('未应用'); expect(block().value).toBe('必须保留的字段')
  expect(fixture.discards).toBe(0); expect(host.querySelector('[data-test-settings]')).toBeNull()
  fixture.notes.a = receipt; await act(async () => { resolve(receipt); await tick() })
  await click('不保存'); await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(fixture.discards).toBe(1); expect(fixture.notes.a.content).toBe('已发送的正文')
})
it('browser reload is cancelled while fields are unapplied and released after explicit cancel', async () => {
  await openA(); await changeBlock('reload必须保留')
  const blocked = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(blocked); expect(blocked.defaultPrevented).toBe(true)
  await click('取消块草稿')
  const allowed = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(allowed); expect(allowed.defaultPrevented).toBe(false)
})
it('discarding the active block cannot release an unrelated unresolved note from quit protection', async () => {
  await openA(); await changeBlock('放弃这个块'); editorQuit.remember('orphan', '另一篇未保存正文')
  await click('切到设置'); await click('不保存')
  await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(fixture.discards).toBe(1)
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: false, code: 'unresolved' })
  expect(editorQuit.pending()).toBe(1)
})
it('explicit discard clears the App field status before unmount so opening another note from settings remains usable', async () => {
  await openA(); await changeBlock('明确放弃后不得遗留状态')
  await click('切到设置'); await click('不保存')
  await until(() => expect(host.querySelector('[data-test-settings]')).toBeTruthy())
  expect(fixture.discards).toBe(1); expect(field()).toBeNull()
  await click('从设置打开 B')
  expect(dialog()).toBeNull()
  await until(() => expect(field()?.dataset.documentId).toBe('b'))
  expect(block().value).toBe('x = 1'); expect(puts()).toHaveLength(0)
  expect(await quit()).toEqual({ id: 'a'.repeat(32), ready: true })
})
