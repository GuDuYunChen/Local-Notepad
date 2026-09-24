import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import QuickSwitcher from './QuickSwitcher'
import { api, searchFiles } from '~/services/api'
vi.mock('~/services/api', () => ({ api: vi.fn(), searchFiles: vi.fn() }))
let root, container
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.mockReset(); searchFiles.mockReset(); api.mockResolvedValue([{ id: 'a', title: 'one', content: '' }]); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render(props = {}) { await act(async () => root.render(<QuickSwitcher open {...props} />)); await act(async () => vi.advanceTimersByTimeAsync(220)) }
it('keeps fetch errors distinct from genuine empty search and exposes retry', async () => {
 vi.spyOn(console, 'error').mockImplementation(() => {}); api.mockRejectedValue(new Error('offline')); await render()
 expect(container.textContent).toContain('快速搜索未完成'); expect(container.textContent).not.toContain('还没有可打开')
 api.mockResolvedValue([]); await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '重试快速搜索').click()); await act(async () => vi.advanceTimersByTimeAsync(220))
 expect(container.textContent).toContain('还没有可打开的笔记')
})
it('offers full search with the current query instead of implying twenty results are complete', async () => {
 const onOpenSearchWorkspace = vi.fn(); await render({ onOpenSearchWorkspace })
 await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '完整检索与筛选').click())
 expect(onOpenSearchWorkspace).toHaveBeenCalledWith(''); expect(container.textContent).toContain('最多展示 20 项')
})
it('does not open a result when Enter is used to finish IME composition', async () => {
 const onSelectFile = vi.fn(); await render({ onSelectFile })
 await act(async () => container.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
 expect(onSelectFile).not.toHaveBeenCalled()
})
it('cannot open stale entries while the next request is pending', async () => {
 const onSelectFile = vi.fn(); await render({ onSelectFile })
 searchFiles.mockReturnValue(new Promise(() => {})); const input = container.querySelector('input')
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'new'); input.dispatchEvent(new Event('input', { bubbles: true })) })
 await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
 expect(onSelectFile).not.toHaveBeenCalled()
})
