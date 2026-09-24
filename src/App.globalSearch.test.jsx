import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api } from '~/services/api'
import { evidenceNavigation } from '~/services/evidenceNavigation'
const mocks = vi.hoisted(() => ({ selectFile: null, clear: vi.fn() }))
vi.mock('~/services/api', () => ({ api: vi.fn(), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn(), searchFiles: vi.fn().mockResolvedValue([]) }))
vi.mock('./components/FileList', () => ({ default: ({ onSelect }) => { mocks.selectFile = onSelect; return null } }))
vi.mock('./components/WorkspaceSidebar', () => ({ default: ({ onOpenSearch, children }) => <aside><button onClick={onOpenSearch}>打开全局检索入口</button>{children}</aside> }))
vi.mock('./components/TextEditor', () => ({ default: React.forwardRef(function Draft({ activeId, onLoaded, onChange, onStatusChange }, ref) {
 React.useEffect(() => { if (activeId) { onLoaded?.('已存正文'); onStatusChange?.({ dirty: false }) } }, [activeId])
 React.useImperativeHandle(ref, () => ({ clearCache: mocks.clear, save: () => null }))
 return activeId ? <button onClick={() => { onChange('未保存的草稿'); onStatusChange?.({ dirty: true }) }}>编辑测试正文</button> : null
}) }))
let container, root
const result = () => ({ query: '', items: [{ id: 'b', title: '第二章.md', folder_path: '项目 / 卷一', updated_at: 0, is_pinned: false, title_match: false, body_count: 0, snippets: [], content_sha256: 'a'.repeat(64) }], folders: [], total: 1, total_occurrences: 0, page: 1, pages: 1, page_size: 20, scanned: 1, unsupported: 0, revision: 'b'.repeat(64) })
const button = text => [...container.querySelectorAll('button')].find(e => e.textContent === text)
const click = async text => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()) }
const settle = async () => {
 await act(async () => { await vi.dynamicImportSettled() })
 await act(async () => { await vi.advanceTimersByTimeAsync(250) })
}
beforeEach(async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); localStorage.clear(); api.mockReset(); mocks.clear.mockClear(); evidenceNavigation.cancel()
 api.mockImplementation(async path => {
  if (!path.startsWith('/api/search?')) return { id: 'b', title: '第二章.md', content: '已存正文' }
  const anchor = new URLSearchParams(path.split('?')[1]).get('anchor_id')
  return anchor ? { ...result(), anchor_id: anchor, anchor_found: anchor === 'b' } : result()
 })
 container = document.createElement('div'); document.body.append(container); root = createRoot(container)
 await act(async () => root.render(<App />)); await settle()
 await act(async () => mocks.selectFile({ id: 'a', title: '第一章.md', content: '已存正文' }))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); evidenceNavigation.cancel(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('opens the real workbench from the sidebar and preserves a draft after cancelling selection', async () => {
 await click('编辑测试正文'); await click('打开全局检索入口'); await settle()
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeTruthy()
 await click('打开笔记'); await click('取消'); await settle()
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeTruthy()
 expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
 expect(container.querySelector('.workspace-title-button').textContent).toBe('第一章.md')
 expect(mocks.clear).not.toHaveBeenCalled(); expect(evidenceNavigation.peek()).toBeNull()
})
it('accepting discard opens the exact selected note and closes search without leaving dirty state', async () => {
 await click('编辑测试正文'); await click('打开全局检索入口'); await settle()
 await click('打开笔记'); await click('不保存'); await settle()
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeNull()
 expect(container.querySelector('.workspace-title-button').textContent).toBe('第二章.md')
 expect(mocks.clear).toHaveBeenCalledOnce()
 await click('打开全局检索入口'); await settle(); expect(container.querySelector('[aria-label="全局检索结果"]')).toBeTruthy()
})
it('uses Ctrl Shift K for the workbench without taking the existing font shortcut', async () => {
 await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true, bubbles: true }))); await settle()
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeTruthy()
})

it('returns to fresh results without discarding the open editor draft', async () => {
 await click('打开全局检索入口');await settle();await click('打开笔记');await settle()
 expect(container.querySelector('[aria-label="检索返回导航"]')).toBeTruthy()
 await click('编辑测试正文');await click('返回检索结果');await settle()
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeTruthy()
 expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
 expect(mocks.clear).not.toHaveBeenCalled()
 expect(api.mock.calls.filter(([path])=>path.startsWith('/api/search?')).at(-1)[0]).toContain('anchor_id=b')
 expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('第二章')
 expect(container.textContent).not.toContain('请更新后端')
 await act(async()=>container.querySelector('[aria-label="关闭全局检索"]').click());await settle()
 expect(container.querySelector('.workspace-title-button').textContent).toBe('第二章.md')
 expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
})
it('ending a search round removes only the return bar, not the draft or current file', async () => {
 await click('打开全局检索入口');await settle();await click('打开笔记');await settle();await click('编辑测试正文')
 await click('结束往返');expect(container.querySelector('[aria-label="检索返回导航"]')).toBeNull()
 expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(mocks.clear).not.toHaveBeenCalled()
})
it('cancelled selection never creates a return bar for an unopened note', async () => {
 await click('编辑测试正文');await click('打开全局检索入口');await settle();await click('打开笔记');await click('取消');await settle()
 expect(container.querySelector('[aria-label="检索返回导航"]')).toBeNull()
})
