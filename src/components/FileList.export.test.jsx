import React, { act, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { DndProvider } from 'react-dnd'
import { TestBackend } from 'react-dnd-test-backend'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FileList from './FileList'
import { api, listAllFiles } from '~/services/api'
vi.mock('~/services/api', () => ({ api: vi.fn(), listAllFiles: vi.fn() }))

let host, root, native, beforeNew, selected, plan
const button = label => [...host.querySelectorAll('button')].find(value => value.textContent.trim() === label)
const settle = async () => { await act(async () => vi.dynamicImportSettled()) }
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); await settle() }
const enter = async () => {
  await click(host.querySelector('[aria-label="更多笔记操作"]'))
  await click(host.querySelector('[data-local-export-entry]'))
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const rows = [
    { id: 'folder', title: '导出目录', parent_id: '', is_folder: true },
    { id: 'one', title: '当前笔记', parent_id: 'folder', is_folder: false },
    { id: 'two', title: '第二篇', parent_id: 'folder', is_folder: false },
  ]
  api.mockReset().mockResolvedValue([]); listAllFiles.mockReset().mockResolvedValue(rows)
  beforeNew = vi.fn(); selected = vi.fn()
  native = Object.fromEntries(['Prepare', 'ChooseDirectory', 'Start', 'Status', 'Cancel', 'Retry', 'Reveal', 'Release'].map(name => ['exportWorkspace' + name, vi.fn(async () => ({ success: true, plan }))]))
  native.exportWorkspacePrepare.mockImplementation(async input => {
    plan = { planId: 'plan-1', requestId: input.requestId, source: 'saved', state: 'prepared', phase: 'prepared', format: input.format, busy: false,
      destination: '', canStart: false, canRetry: false, canReveal: false,
      items: [{ id: 'one', title: '当前笔记', relativePath: '当前笔记.md', preview: '原已保存正文', status: 'ready', message: '', warnings: [] }],
      counts: { total: 1, ready: 1, running: 0, succeeded: 0, failed: 0, cancelled: 0 } }
    return { success: true, plan }
  })
  window.electronAPI = native
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<DndProvider backend={TestBackend}><Suspense fallback={null}><FileList selectedId="one" onSelect={selected} onBeforeNew={beforeNew} /></Suspense></DndProvider>))
  await settle()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete window.electronAPI
  vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
it('connects the existing library entry through the real selector to a saved-body preview without saving or navigating', async () => {
  await enter(); expect(host.textContent).toContain('选择导出内容'); expect(host.querySelector('[data-local-export-workspace]')).toBeNull()
  await click(button('下一步')); expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(host.querySelector('[data-local-export-workspace]')).toBeTruthy()
  await click(host.querySelector('[data-local-export-prepare]'))
  expect(native.exportWorkspacePrepare).toHaveBeenCalledWith(expect.objectContaining({ ids: ['one'], format: 'markdown' }))
  expect(host.textContent).toContain('原已保存正文'); expect(beforeNew).not.toHaveBeenCalled(); expect(selected).not.toHaveBeenCalled()
  expect(api.mock.calls.some(([, options]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options?.method))).toBe(false)
})
it('retains selection when returning from format preview to the real selector', async () => {
  await enter(); await click(button('全选')); await click(button('下一步'))
  await click(button('更改选择')); expect(host.textContent).toContain('选择导出内容')
  expect(button('取消全选')).toBeTruthy(); await click(button('下一步')); await click(host.querySelector('[data-local-export-prepare]'))
  expect(native.exportWorkspacePrepare).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['folder'] }))
})
it('cancels selection without preparing or writing export files', async () => {
  await enter(); await click(button('取消'))
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(native.exportWorkspacePrepare).not.toHaveBeenCalled(); expect(native.exportWorkspaceStart).not.toHaveBeenCalled()
  expect(beforeNew).not.toHaveBeenCalled()
})
