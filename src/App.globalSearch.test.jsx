import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api } from '~/services/api'
import { searchCollections } from '~/services/searchCollections'
import { collectSearchResultReport } from '~/services/searchResultExport'
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

async function openSavedCollection() {
 const report = await collectSearchResultReport({query:''}, result(), {mode:'all', request:async()=>result()})
 await act(async()=>searchCollections.save('App资料集', report))
 await click('打开全局检索入口');await settle();await click('本地资料集')
 await act(async()=>{
   const el=container.querySelector('[aria-label="已保存资料集"]')
   Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,searchCollections.list().entries[0].key)
   el.dispatchEvent(new Event('change',{bubbles:true}))
 })
}
it('saved collection uses the real App draft confirmation and cancelling preserves its view',async()=>{
 await click('编辑测试正文');await openSavedCollection();await click('打开当前笔记');await click('取消');await settle()
 expect(container.querySelector('[aria-label="资料集条目 b"]')).toBeTruthy()
 expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('本地资料集')
 expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
 expect(container.querySelector('.workspace-title-button').textContent).toBe('第一章.md')
 expect(mocks.clear).not.toHaveBeenCalled();expect(evidenceNavigation.peek()).toBeNull()
})
it('saved collection discard opens current note without restoring archived content or old search origin',async()=>{
 await click('编辑测试正文');await openSavedCollection();await click('打开当前笔记');await click('不保存');await settle()
 expect(container.querySelector('.workspace-title-button').textContent).toBe('第二章.md')
 expect(container.querySelector('[aria-label="全局检索结果"]')).toBeNull()
 expect(container.querySelector('[aria-label="检索返回导航"]')).toBeNull()
 expect(mocks.clear).toHaveBeenCalledOnce();expect(evidenceNavigation.peek()).toBeNull()
})

async function startCollectionReading(target = 'n7', prepare = true) {
  const { collectionReport } = await import('./test/collectionFixtures')
  if (prepare) {
    searchCollections.save('连续阅读资料', collectionReport())
    api.mockImplementation(async path => {
      if (path.startsWith('/api/files/')) { const id = decodeURIComponent(path.slice('/api/files/'.length)); return { id, title: '当前 ' + id, content: '已存正文' } }
      return result()
    })
  }
  await click('打开全局检索入口'); await settle(); await click('本地资料集')
  const select = container.querySelector('[aria-label="已保存资料集"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, searchCollections.list().entries[0].key)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const row = container.querySelector('[aria-label="资料集条目 ' + target + '"]')
  await act(async () => row.querySelector('button').click()); await settle()
}
it('shows a collection reading bar and returns across pages by identity without dropping a draft', async () => {
  await startCollectionReading()
  expect(container.querySelector('[aria-label="资料集连续阅读"]')).toBeTruthy()
  expect(container.querySelector('[aria-label="检索返回导航"]')).toBeNull()
  await click('下一资料'); await settle()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n8')
  expect(container.querySelector('[aria-label="资料集连续阅读"]').textContent).toContain('第 9 / 23 篇')
  await click('编辑测试正文'); await click('返回资料集'); await settle()
  const row = container.querySelector('[aria-label="资料集条目 n8"]')
  expect(row).toBeTruthy(); expect(document.activeElement).toBe(row)
  expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存'); expect(mocks.clear).not.toHaveBeenCalled()
})
it('next collection note uses cancel and discard decisions before advancing the reading position', async () => {
  await startCollectionReading(); await click('编辑测试正文'); await click('下一资料'); await click('取消'); await settle()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n7')
  expect(container.querySelector('[aria-label="资料集连续阅读"]').textContent).toContain('第 8 / 23 篇')
  expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
  await click('下一资料'); await click('不保存'); await settle()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n8')
  expect(container.querySelector('[aria-label="资料集连续阅读"]').textContent).toContain('第 9 / 23 篇')
  expect(mocks.clear).toHaveBeenCalledOnce()
})
it('a missing next note does not advance or skip to a different identity', async () => {
  await startCollectionReading()
  api.mockImplementation(async path => path === '/api/files/n8' ? { id: 'n8', is_deleted: true } : result())
  await click('下一资料'); await settle()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n7')
  expect(container.querySelector('[aria-label="资料集连续阅读"]').textContent).toContain('第 8 / 23 篇')
  expect(container.textContent).toContain('不自动跳过')
  expect(api.mock.calls.some(([path]) => path === '/api/files/n9')).toBe(false)
})
it('deleting a source while the save dialog is open prevents the destination from being selected', async () => {
  await startCollectionReading(); await click('编辑测试正文'); await click('下一资料')
  const entry = searchCollections.list().entries[0]
  await act(async () => searchCollections.remove(entry))
  await click('不保存'); await settle()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n7')
  expect(container.querySelector('[aria-label="资料集连续阅读"]').textContent).toContain('已停用')
  expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存'); expect(mocks.clear).not.toHaveBeenCalled()
})
it('ending collection reading only removes the navigation bar and preserves the current draft', async () => {
  await startCollectionReading(); await click('编辑测试正文'); await click('结束资料集阅读'); await settle()
  expect(container.querySelector('[aria-label="资料集连续阅读"]')).toBeNull()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('当前 n7')
  expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
  expect(searchCollections.list().entries).toHaveLength(1); expect(mocks.clear).not.toHaveBeenCalled()
})
