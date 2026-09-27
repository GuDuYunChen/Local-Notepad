import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Center from './SyncCenterPanel'
import { api } from '~/services/api'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { conflictFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The activity poller is independently tested. The center, status reader,
// overview, queue, review and diagnostic panel are real here.
vi.mock('./SyncActivityPanel', () => ({ default: () => null }))
let root, container, settings, status, conflicts, actMode, readError, pendingRun
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const nav = label => container.querySelector(`[aria-label="定位${label}"]`)
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
const region = key => container.querySelector(`[data-sync-section="${key}"]`)
const writes = () => api.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function render() { await act(async () => { root.render(<Center/>); await flush() }) }
beforeEach(() => {
  actMode = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fixture = overviewFixture(); settings = { ...fixture.settings, sync_endpoint: 'https://example.test', sync_username: 'alice' }
  status = { ...fixture.status, device_id: 'device-a', remote_store_id: 'store' }; conflicts = []; readError = false; pendingRun = null
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.mockImplementation(async (path, init) => {
    const read = !init?.method || init.method === 'GET'
    if (read && readError) throw new Error('offline')
    if (path === '/api/settings' && read) return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return [...conflicts]
    if (path === '/api/sync/run') return pendingRun ? new Promise(r => { pendingRun.finish = r }) : { conflicts: 0 }
    if (path.endsWith('/resolve')) return null
    throw new Error('Unexpected endpoint ' + path)
  })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = actMode
})
for (const [label, key] of [['状态与恢复', 'health'], ['连接配置', 'connection'], ['预演与执行', 'execution'], ['诊断摘要', 'diagnostic']]) {
  it(`${label} focuses an existing inert region without sending a request`, async () => {
    await render(); const before = api.mock.calls.length
    await click(nav(label)); expect(document.activeElement).toBe(region(key))
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(api.mock.calls.length).toBe(before); expect(writes()).toHaveLength(0)
    await click(button('返回同步总览')); expect(document.activeElement).toBe(region('overview'))
  })
}
it('conflict navigation retains the exact current review and never selects or submits', async () => {
  status.open_conflicts = 1; status.last_status = 'conflicts'; conflicts = [conflictFixture()]
  await render(); await click(nav('冲突队列')); expect(document.activeElement).toBe(region('conflicts'))
  await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  const capturedPreview = container.querySelector('[aria-label="本机正文预览"]')
  await click(nav('诊断摘要')); await click(nav('冲突队列'))
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(container.querySelector('[aria-label="本机正文预览"]')).toBe(capturedPreview)
  expect(writes()).toHaveLength(0)
  await click(button('确认处理此冲突'))
  expect(api.mock.calls.filter(([path]) => path.endsWith('/resolve'))).toHaveLength(1)
})
it('disabled sync has no execution or conflict target and navigation does not enable it', async () => {
  settings.sync_enabled = false; conflicts = [conflictFixture()]; status.open_conflicts = 1
  await render(); expect(nav('预演与执行').disabled).toBe(true); expect(nav('冲突队列').disabled).toBe(true)
  expect(region('execution')).toBeNull(); expect(region('conflicts')).toBeNull()
  await click(nav('连接配置')); expect(writes()).toHaveLength(0)
})
it('read failures preserve snapshot values but allow access to the status and diagnostic regions', async () => {
  await render(); readError = true; await click(button('刷新状态')); const before = api.mock.calls.length
  await click(nav('诊断摘要')); expect(container.querySelector('.sync-overview').textContent).toContain('上次读取结果')
  expect(api.mock.calls.length).toBe(before); expect(button('生成诊断摘要')).toBeTruthy()
  expect(container.querySelector('textarea')).toBeNull()
})
it('navigation does not erase unsaved endpoint/password drafts', async () => {
  await render()
  await act(async () => {
    for (const [label, value] of [['WebDAV 端点', 'https://unsaved.test'], ['WebDAV 密码', 'PRIVATE']]) {
      const node = container.querySelector(`[aria-label="${label}"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
      node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await flush()
  })
  await click(nav('状态与恢复')); await click(nav('连接配置'))
  expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE')
  expect(container.querySelector('.sync-overview').textContent).not.toContain('PRIVATE')
  expect(button('预演同步').disabled).toBe(true); expect(writes()).toHaveLength(0)
})
it('uncertain-write confirmation is still required at the original execute button', async () => {
  status.recovery = { mode: 'review_required' }; status.last_status = 'review_required'
  await render(); await click(nav('预演与执行')); expect(writes()).toHaveLength(0)
  window.confirm.mockReturnValue(false); await click(button('执行同步')); expect(writes()).toHaveLength(0)
  window.confirm.mockReturnValue(true); await click(button('执行同步'))
  expect(api).toHaveBeenCalledWith('/api/sync/run', { method: 'POST', body: JSON.stringify({ acknowledge_uncertain: true }) })
})
it('navigation while a write is pending never cancels, duplicates or releases its lock', async () => {
  pendingRun = {}; await render(); await click(button('执行同步'))
  await click(nav('诊断摘要')); await click(button('返回同步总览'))
  expect(button('同步中…').disabled).toBe(true); expect(writes()).toHaveLength(1)
  await act(async () => { pendingRun.finish({ conflicts: 0 }); await flush() })
  expect(writes()).toHaveLength(1)
})
it('two mounted centers cannot focus each other and removed targets fail locally', async () => {
  await act(async () => { root.render(<><Center/><Center/></>); await flush() })
  const centers = container.querySelectorAll('[data-sync-center]')
  await click(centers[1].querySelector('[aria-label="定位连接配置"]'))
  expect(document.activeElement).toBe(centers[1].querySelector('[data-sync-section="connection"]'))
  centers[1].querySelector('[data-sync-section="connection"]').remove()
  await click(centers[1].querySelector('[aria-label="定位连接配置"]'))
  expect(centers[1].textContent).toContain('该区域已变化或暂不可定位')
  expect(document.activeElement).not.toBe(centers[0].querySelector('[data-sync-section="connection"]'))
  expect(writes()).toHaveLength(0)
})
