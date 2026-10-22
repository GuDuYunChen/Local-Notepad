import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Center from './SyncCenterPanel'
import { api } from '~/services/api'
import { queueFixture } from '../../scripts/fixtures/sync-conflict-queue.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
let root, container, settings, status, conflicts, readError, oldClipboard, oldAct, write
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
const area = () => container.querySelector('[aria-label="可复制的诊断摘要"]')
const isRead = init => !init?.method || init.method === 'GET'
async function render() { await act(async () => { root.render(<Center/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
beforeEach(() => {
  oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); write = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  settings = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_auto_enabled: false, sync_interval_minutes: 5 }
  status = { device_id: 'PRIVATE_DEVICE', provider: 'local-lab', enabled: true, base_items: 20, open_conflicts: 0, last_status: 'ok', last_error: '', recovery: { mode: 'idle', last_success_at: 1790499990 } }
  conflicts = []; readError = false
  api.mockImplementation(async (path, init) => {
    if (isRead(init) && readError) throw new Error('PRIVATE_READ_FAILURE')
    if (path === '/api/settings') return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return [...conflicts]
    if (path === '/api/sync/run') return { conflicts: 0 }
    return null
  })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() }); container.remove()
  if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard); else delete navigator.clipboard
  globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; vi.restoreAllMocks(); vi.clearAllMocks()
})
it('capture, copy, selection and closing add no API requests or sync mutations', async () => {
  await render(); const before = api.mock.calls.length
  await click(button('生成诊断摘要')); await click(button('复制诊断摘要')); await click(button('选择摘要')); await click(button('收起诊断摘要'))
  expect(api.mock.calls.length).toBe(before); expect(write).toHaveBeenCalledTimes(1)
  expect(write.mock.calls[0][0]).not.toContain('PRIVATE_DEVICE')
})
it('diagnostics are available when sync is disabled or initial reads fail', async () => {
  settings.sync_enabled = false; readError = true; await render(); await click(button('生成诊断摘要'))
  expect(area().value).toContain('尚无可核实的读取结果'); expect(area().value).toContain('当前已读取列表数：未知')
  expect(area().value).not.toContain('PRIVATE_READ_FAILURE'); expect(write).not.toHaveBeenCalled()
})
it('a later read failure retains prior values but marks a newly generated report stale', async () => {
  await render(); readError = true; await click(button('刷新状态')); await click(button('生成诊断摘要'))
  expect(area().value).toContain('上次读取结果；刷新失败'); expect(area().value).toContain('基线对象数：20')
})
it('draft, recovery and error markers do not export raw private values or bypass confirmation', async () => {
  status.recovery = { mode: 'review_required', error: 'PRIVATE_RECOVERY' }; status.last_error = 'PRIVATE_ERROR'
  await render(); const password = container.querySelector('[aria-label="WebDAV 密码"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(password, 'PRIVATE_PASSWORD')
    password.dispatchEvent(new Event('input', { bubbles: true })); await flush()
  })
  await click(button('生成诊断摘要')); expect(area().value).toContain('存在未保存草稿：是')
  expect(area().value).toContain('不要反复执行或重新绑定'); expect(area().value).not.toContain('PRIVATE_')
  await click(button('执行同步')); expect(window.confirm).toHaveBeenCalledTimes(1)
  expect(api.mock.calls.some(([path]) => path === '/api/sync/run')).toBe(false)
})
it('diagnostic inspection does not choose a side, clear or grant existing conflict consent', async () => {
  conflicts = queueFixture(1); status.open_conflicts = 1; await render()
  await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  expect(button('确认处理此冲突').disabled).toBe(false)
  const before = api.mock.calls.length
  await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  expect(button('确认处理此冲突').disabled).toBe(false); expect(api.mock.calls.length).toBe(before)
  expect(area().value).toContain('逐项对照并明确确认'); expect(area().value).not.toContain('本机笔记 001')
})
it('report generation is independent of a pending read-only plan and never cancels it', async () => {
  let finish; const original = api.getMockImplementation()
  api.mockImplementation((path, init) => path === '/api/sync/plan' ? new Promise(r => { finish = r }) : original(path, init))
  await render(); await click(button('预演同步')); const before = api.mock.calls.length
  await click(button('生成诊断摘要')); expect(area().value).toContain('界面正在等待操作：是')
  expect(button('停止等待预演')).toBeTruthy(); expect(api.mock.calls.length).toBe(before)
  await act(async () => { finish({ uploads: 0, downloads: 0, conflicts: 0, noops: 0, items: [] }); await flush() })
  expect(button('停止等待预演')).toBeUndefined(); expect(container.textContent).toContain('可见诊断字段已变化')
})
