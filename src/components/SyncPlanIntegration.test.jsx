import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import SyncCenterPanel from './SyncCenterPanel'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import { makePlan, manyPlan } from '../../scripts/fixtures/sync-plan-view.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Isolate the already-tested activity poller; parent, status reader, explorer,
// and explicit preview/run handlers remain real components/production modules.
vi.mock('./SyncActivityPanel', () => ({ default: ({ onSettled }) => <button onClick={onSettled}>模拟任务结束</button> }))
let container, root, settings, status, rawPlan, readError, previewError, finishPreview, actEnvironment
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const calls = path => api.mock.calls.filter(([url]) => url === path)
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const panel = () => container.querySelector('[aria-label="同步计划详情"]')
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  settings = { sync_enabled: true, sync_provider: 'webdav', sync_endpoint: 'https://dav.example.test/a', sync_username: 'alice', sync_auto_enabled: false, sync_interval_minutes: 5 }
  status = { device_id: 'a', provider: 'webdav', enabled: true, base_items: 2, open_conflicts: 0, remote_store_id: 'store', remote_revision: 'one', last_status: 'ok', last_error: '' }
  rawPlan = manyPlan(); readError = false; previewError = false; finishPreview = null
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.mockImplementation(async (path, init) => {
    if ((!init?.method || init.method === 'GET') && readError) throw new Error('offline')
    if (path === '/api/settings') return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return []
    if (path === '/api/sync/plan') { if (previewError) throw new Error('preview offline'); return rawPlan }
    if (path === '/api/sync/run') return { plan: rawPlan, conflicts: 0 }
    if (path === '/api/sync/check') return { initialized: true, generation: 3, items: 65 }
    throw new Error('Unexpected endpoint: ' + path)
  })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment
  vi.restoreAllMocks(); vi.clearAllMocks()
})
async function render() { await act(async () => { root.render(<SyncCenterPanel/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }) }
async function input(label, value) {
  await act(async () => {
    const node = container.querySelector('[aria-label="' + label + '"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); await flush()
  })
}
it('mount is read-only; preview and paging never trigger run or resolve', async () => {
  await render(); expect(calls('/api/sync/plan')).toHaveLength(0); expect(panel()).toBeNull()
  await click(button('预演同步')); expect(calls('/api/sync/plan')).toHaveLength(1)
  const before = api.mock.calls.length
  await click(button('下一页')); await input('同步计划搜索', 'note-065')
  expect(panel().textContent).toContain('note-065'); expect(api.mock.calls.length).toBe(before)
  expect(calls('/api/sync/run')).toHaveLength(0); expect(api.mock.calls.some(([path]) => path.endsWith('/resolve'))).toBe(false)
})
it('run stays explicit and its result is labeled as a historical plan', async () => {
  await render(); await click(button('预演同步')); await click(button('执行同步'))
  expect(calls('/api/sync/run')).toHaveLength(1); expect(panel().textContent).toContain('执行时计划（历史）')
  expect(panel().textContent).toContain('不是剩余任务或实际写入数量')
})
it('a failed second preview retains stale evidence, and only a new successful preview replaces it', async () => {
  await render(); await click(button('预演同步')); previewError = true
  await click(button('重新预演')); expect(panel().textContent).toContain('此计划已失效'); expect(panel().textContent).toContain('note-001')
  previewError = false; rawPlan = makePlan([{ id: 'new-plan', action: 'download' }])
  await click(button('重新预演')); expect(panel().textContent).not.toContain('此计划已失效'); expect(panel().textContent).toContain('new-plan')
  expect(panel().textContent).not.toContain('note-001'); expect(calls('/api/sync/run')).toHaveLength(0)
})
it('observed target A-B-A cannot revive an old preview', async () => {
  await render(); await click(button('预演同步')); settings.sync_username = 'bob'
  await click(button('刷新状态')); expect(panel().textContent).toContain('此计划已失效')
  settings.sync_username = 'alice'; await click(button('刷新状态'))
  expect(panel().textContent).toContain('此计划已失效'); expect(calls('/api/sync/plan')).toHaveLength(1)
})
it('read failure remains invalidated even after the same status is read successfully', async () => {
  await render(); await click(button('预演同步')); readError = true
  await click(button('刷新状态')); readError = false; await click(button('刷新状态'))
  expect(panel().textContent).toContain('此计划已失效'); expect(calls('/api/sync/run')).toHaveLength(0)
})
it('a changed revision or a completed background task invalidates the existing plan', async () => {
  await render(); await click(button('预演同步')); status.remote_revision = 'two'; await click(button('刷新状态'))
  expect(panel().textContent).toContain('此计划已失效')
  await click(button('重新预演')); expect(panel().textContent).not.toContain('此计划已失效')
  await click(button('模拟任务结束')); expect(panel().textContent).toContain('此计划已失效')
})
it('unsaved credentials invalidate but never enter the plan or trigger a new request', async () => {
  await render(); await click(button('预演同步')); await input('WebDAV 密码', 'private-draft')
  expect(panel().textContent).toContain('此计划已失效'); expect(panel().textContent).not.toContain('private-draft')
  expect(button('重新预演').disabled).toBe(true); expect(button('预演同步').disabled).toBe(true)
  await click(button('刷新状态'))
  expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('private-draft')
  expect(calls('/api/sync/plan')).toHaveLength(1)
})
it('duplicate clicks and unmount during a pending preview never cause another operation', async () => {
  const base = api.getMockImplementation()
  api.mockImplementation((path, init) => path === '/api/sync/plan' ? new Promise(resolve => { finishPreview = resolve }) : base(path, init))
  await render(); await click(button('预演同步')); await click(button('预演中…'))
  expect(calls('/api/sync/plan')).toHaveLength(1)
  await act(async () => { root.unmount(); root = null; finishPreview(rawPlan); await flush() })
  expect(container.textContent).toBe(''); expect(calls('/api/sync/run')).toHaveLength(0); expect(toast.success).not.toHaveBeenCalled()
})
it('invalid preview data is not displayed as zero or reported as verified preview success', async () => {
  rawPlan = { ...makePlan(), items: [] }
  await render(); await click(button('预演同步'))
  expect(panel().querySelector('[role="alert"]')).toBeTruthy(); expect(panel().textContent).not.toContain('上传 0')
  expect(toast.error).toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
})
it('a presentation error after successful run never claims the write itself failed', async () => {
  rawPlan = { ...makePlan(), items: [] }
  await render(); await click(button('执行同步'))
  expect(panel().querySelector('[role="alert"]')).toBeTruthy(); expect(toast.success).toHaveBeenCalledWith('同步完成')
  expect(toast.error).not.toHaveBeenCalled(); expect(calls('/api/sync/run')).toHaveLength(1)
})
it('unchanged refresh and read-only connection checks do not discard a valid snapshot', async () => {
  await render(); await click(button('预演同步')); await click(button('刷新状态')); await click(button('测试连接（只读）'))
  expect(panel().textContent).not.toContain('此计划已失效'); expect(panel().textContent).toContain('note-001')
  expect(calls('/api/sync/plan')).toHaveLength(1)
})
it('uncertain-write confirmation remains required and is never supplied by the explorer', async () => {
  status.recovery = { mode: 'review_required' }
  await render(); await click(button('预演同步')); window.confirm.mockReturnValue(false); await click(button('执行同步'))
  expect(calls('/api/sync/run')).toHaveLength(0)
  window.confirm.mockReturnValue(true); await click(button('执行同步'))
  expect(api).toHaveBeenCalledWith('/api/sync/run', { method: 'POST', body: JSON.stringify({ acknowledge_uncertain: true }) })
})
