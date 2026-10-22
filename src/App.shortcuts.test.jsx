import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './services/api'
import { applyShortcutBindings, getShortcutSnapshot, reloadShortcutPreferences, SHORTCUT_STORAGE_KEY, serializeShortcutPreferences } from './services/localShortcuts'

const fixture = vi.hoisted(() => ({ select: null, clear: vi.fn(), save: vi.fn() }))
vi.mock('./services/api', () => ({ api: vi.fn(), searchFiles: vi.fn().mockResolvedValue([]), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn() }))
vi.mock('./components/FileList', () => ({ default: ({ onSelect }) => { fixture.select = onSelect; return null } }))
vi.mock('./components/WorkspaceSidebar', () => ({ default: ({ children, onOpenShortcuts }) => <aside><button onClick={onOpenShortcuts}>管理快捷键</button>{children}</aside> }))
vi.mock('./components/TextEditor', () => ({ default: React.forwardRef(function EditorFixture({ activeId, onLoaded, onChange, onStatusChange }, ref) {
  React.useEffect(() => { if (activeId) { onLoaded?.('原正文'); onStatusChange?.({ dirty: false }) } }, [activeId])
  React.useImperativeHandle(ref, () => ({ clearCache: fixture.clear, save: fixture.save, getReferenceRefactorState: () => ({ savedContent: '原正文' }) }))
  return activeId ? <button onClick={() => { onChange('用户未保存草稿'); onStatusChange?.({ dirty: true }) }}>编辑正文</button> : null
}) }))
let host, root
const settle = async () => { await act(async () => vi.dynamicImportSettled()); await act(async () => vi.advanceTimersByTimeAsync(250)) }
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text)
const click = async text => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()); await settle() }
async function key(key, options = {}, target = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  // happy-dom maps Ctrl+Alt to AltGraph; Chromium has a separate modifierAltGraph flag.
  Object.defineProperty(event, 'getModifierState', { value: name => name === 'AltGraph' ? Boolean(options.altGraph) : false })
  await act(async () => target.dispatchEvent(event)); await settle()
  return event
}
async function remap(changes) {
  await act(async () => {
    const snapshot = getShortcutSnapshot()
    expect(applyShortcutBindings({ ...snapshot.bindings, ...changes }, { expectedRevision: snapshot.revision }).ok).toBe(true)
  })
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); localStorage.clear(); reloadShortcutPreferences()
  fixture.clear.mockReset().mockReturnValue(true); fixture.save.mockReset().mockResolvedValue(null)
  api.mockReset().mockImplementation(async path => path === '/api/files?size=200'
    ? [{ id: 'b', title: '目标笔记.md', content: '原正文' }]
    : { id: 'b', title: '目标笔记.md', content: '原正文' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<App />)); await settle()
  await act(async () => fixture.select({ id: 'a', title: '当前笔记.md', content: '原正文' })); await settle()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  localStorage.clear(); reloadShortcutPreferences()
  vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

it('uses a remapped focus key immediately, releases F11, and keeps the tooltip in sync', async () => {
  await remap({ focusMode: 'Mod+Alt+J' })
  expect(host.querySelector('[aria-label="进入专注模式"]').title).toContain('Ctrl + Alt + J')
  await key('F11'); expect(host.querySelector('.focus-mode')).toBeNull()
  await key('j', { ctrlKey: true, altKey: true }); expect(host.querySelector('.focus-mode')).toBeTruthy()
  await key('j', { ctrlKey: true, altKey: true }); expect(host.querySelector('.focus-mode')).toBeNull()
})
it('keeps remapped quick switching on the existing unsaved-note decision path', async () => {
  await remap({ quickSwitch: 'Mod+Alt+J' }); await click('编辑正文')
  await key('k', { ctrlKey: true }); expect(host.querySelector('.quick-switcher')).toBeNull()
  await key('j', { ctrlKey: true, altKey: true }); expect(host.querySelector('.quick-switcher')).toBeTruthy()
  await act(async () => host.querySelector('[role="option"]').click()); await settle()
  await click('取消')
  expect(host.querySelector('.workspace-title-button').textContent).toBe('当前笔记.md')
  expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存')
  expect(host.querySelector('.quick-switcher')).toBeTruthy()
  expect(fixture.clear).not.toHaveBeenCalled()
})
it('preserves exact Ctrl+S without saving for split-cell or extra modifiers', async () => {
  await key('s', { ctrlKey: true, altKey: true }); expect(fixture.save).not.toHaveBeenCalled()
  await key('S', { ctrlKey: true, shiftKey: true }); expect(fixture.save).not.toHaveBeenCalled()
  await key('s', { ctrlKey: true }); expect(fixture.save).toHaveBeenCalledTimes(1)
})
it('rejects simultaneous Ctrl and Meta while preserving the fixed Meta S save entry', async () => {
  const combined = await key('s', { ctrlKey: true, metaKey: true })
  expect(combined.defaultPrevented).toBe(false)
  expect(fixture.save).not.toHaveBeenCalled()
  await key('s', { metaKey: true })
  expect(fixture.save).toHaveBeenCalledTimes(1)
})
it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altGraph: true }])('ignores composing, repeating and AltGraph application commands: %j', async flags => {
  await key('F11', flags); expect(host.querySelector('.focus-mode')).toBeNull()
  await key('s', { ctrlKey: true, ...flags }); expect(fixture.save).not.toHaveBeenCalled()
})
it('keeps F1 and the mouse entry available after clearing the editable help binding', async () => {
  await remap({ shortcuts: null })
  await key('/', { ctrlKey: true }); expect(host.querySelector('[data-shortcut-settings]')).toBeNull()
  await key('F1'); expect(host.querySelector('[data-shortcut-settings]')).toBeTruthy()
})
it('never executes application shortcuts while recording a combination or editing its search field', async () => {
  await click('管理快捷键')
  const search = host.querySelector('[data-shortcut-search]')
  expect(search).toBeTruthy()
  await key('s', { ctrlKey: true }, search)
  await key('F11', {}, search)
  expect(fixture.save).not.toHaveBeenCalled(); expect(host.querySelector('.focus-mode')).toBeNull()
  await act(async () => host.querySelector('[data-shortcut-edit="focusMode"]').click()); await settle()
  const recorder = host.querySelector('[data-shortcut-recorder]')
  expect(recorder).toBeTruthy()
  await key('s', { ctrlKey: true }, recorder)
  expect(fixture.save).not.toHaveBeenCalled()
  expect(host.querySelector('[data-shortcut-settings]')).toBeTruthy()
})
it('updates a running window from current storage bytes without reviving a stale event payload', async () => {
  const next = { ...getShortcutSnapshot().bindings, focusMode: 'Mod+Alt+J' }
  await act(async () => {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, serializeShortcutPreferences(next).raw)
    window.dispatchEvent(new StorageEvent('storage', { key: SHORTCUT_STORAGE_KEY, newValue: 'stale payload' }))
  })
  await key('F11'); expect(host.querySelector('.focus-mode')).toBeNull()
  await key('j', { ctrlKey: true, altKey: true }); expect(host.querySelector('.focus-mode')).toBeTruthy()
})
