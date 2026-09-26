import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncCenterPanel from './SyncCenterPanel'
import { conflictFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let container, root, settings, status, conflicts, checkError, readError
const baseSettings = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_password_set: false, sync_auto_enabled: false, sync_interval_minutes: 5 }
const baseStatus = { device_id: 'device-a', provider: 'local-lab', enabled: true, base_items: 2, open_conflicts: 0, last_status: 'ok', last_error: '' }
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const isRead = init => !init?.method || init.method === 'GET'
beforeEach(() => {
  settings = { ...baseSettings }; status = { ...baseStatus }; conflicts = []; checkError = null; readError = false
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  window.electronAPI = {
    openAppFolder: vi.fn().mockResolvedValue({ success: true }),
    webdavSecretStatus: vi.fn().mockResolvedValue({ success: true, available: true, stored: false, managed: true, backend: 'dpapi' }),
    webdavSecretSave: vi.fn().mockResolvedValue({ success: true, stored: true, restarted: true, restartRequired: false }),
    webdavSecretClear: vi.fn().mockResolvedValue({ success: true, stored: false, restarted: true, restartRequired: false }),
  }
  api.mockImplementation(async (path, init) => {
    if (isRead(init) && readError) throw new Error('offline')
    if (path === '/api/settings' && isRead(init)) return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return [...conflicts]
    if (path === '/api/settings' && init?.method === 'PUT') { Object.assign(settings, JSON.parse(init.body)); return { ...settings } }
    if (path === '/api/sync/check') { if (checkError) throw checkError; return { provider: 'webdav', initialized: true, generation: 4, items: 12 } }
    if (path === '/api/sync/auto') { settings.sync_auto_enabled = JSON.parse(init.body).enabled; return { ...status } }
    if (path === '/api/sync/plan') return { uploads: 1, downloads: 2, conflicts: 0, noops: 3, needs_init: false }
    if (path === '/api/sync/run') return { plan: { uploads: 1, downloads: 0, conflicts: 0, noops: 2 }, conflicts: 0 }
    if (path === '/api/sync/rebind') { settings.sync_auto_enabled = false; Object.assign(status, { base_items: 0, open_conflicts: 0, remote_store_id: '', remote_revision: '', last_status: 'rebound' }); return { ...status } }
    return null
  })
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() })
  container.remove(); delete window.electronAPI; vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks()
})
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
const field = label => container.querySelector('[aria-label="' + label + '"]')
const writes = () => api.mock.calls.filter(([path, init]) => path === '/api/settings' && init?.method === 'PUT').map(([, init]) => JSON.parse(init.body))
const settingsReads = () => api.mock.calls.filter(([path, init]) => path === '/api/settings' && isRead(init)).length
async function render() { await act(async () => { root.render(<SyncCenterPanel/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }) }
async function input(label, value) { await act(async () => { const node = field(label); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); await flush() }) }
function useWebDAV() { Object.assign(settings, { sync_provider: 'webdav', sync_endpoint: 'https://dav.example.test/notepad', sync_username: 'alice' }); status.provider = 'webdav' }

describe('SyncCenterPanel', () => {
  it('shows shared local-first scope and identity', async () => { await render(); expect(container.textContent).toContain('WebDAV 只替换传输层'); expect(container.textContent).toContain('笔记、文件夹、标签、标签关联和附件'); expect(container.textContent).toContain('device-a') })
  it('previews without running', async () => { await render(); await click(button('预演同步')); expect(api).toHaveBeenCalledWith('/api/sync/plan', { method: 'POST', body: '{}' }); expect(container.textContent).toContain('上传 1 · 下载 2 · 冲突 0 · 无变化 3') })
  it('runs only on explicit click', async () => { await render(); expect(api.mock.calls.some(([path]) => path === '/api/sync/run')).toBe(false); await click(button('执行同步')); expect(api).toHaveBeenCalledWith('/api/sync/run', { method: 'POST', body: '{}' }) })
  it('requires conflict side selection', async () => {
    status.open_conflicts = 1; status.last_status = 'conflicts'
    conflicts = [conflictFixture()]
    await render(); expect(container.textContent).toContain('不会自动覆盖'); await click(button('保留本机'))
    expect(api.mock.calls.some(([path]) => path.endsWith('/resolve'))).toBe(false)
    expect(container.textContent).toContain('本机正文'); expect(container.textContent).toContain('远端正文')
    await click(container.querySelector('input[type="checkbox"]')); await click(button('确认处理此冲突'))
    expect(api).toHaveBeenCalledWith('/api/sync/conflicts/c1/resolve', { method: 'POST', body: JSON.stringify({ choice: 'local' }) })
  })
  it('opens app-owned remote folder only for local lab', async () => { await render(); await click(button('打开模拟远端')); expect(window.electronAPI.openAppFolder).toHaveBeenCalledWith('syncLab') })
  it('shows readable attachment conflict labels', async () => {
    status.open_conflicts = 1; conflicts = [{ id: 'a1', item_id: 'attachment:00', local_record: { kind: 'attachment', state: 'present', attachment: { name: '资料.pdf' } }, remote_record: { kind: 'attachment', state: 'purged' } }]
    await render(); expect(container.textContent).toContain('资料.pdf'); expect(container.textContent).toContain('已永久删除')
  })
  it('migrates a new password, verifies read-only, then enables WebDAV', async () => {
    await render(); await input('WebDAV 端点', 'https://dav.example.test/notepad'); await input('WebDAV 用户名', 'alice'); await input('WebDAV 密码', 'secret'); await click(button('保存、验证并启用 WebDAV'))
    expect(writes()[0]).toEqual({ sync_enabled: false, sync_auto_enabled: false, sync_provider: 'webdav', sync_endpoint: 'https://dav.example.test/notepad', sync_username: 'alice' })
    expect(window.electronAPI.webdavSecretSave).toHaveBeenCalledWith('secret'); expect(writes()[1]).toEqual({ sync_password: '' })
    expect(api).toHaveBeenCalledWith('/api/sync/check', { method: 'POST', body: '{}' }); expect(writes()[2]).toEqual({ sync_enabled: true })
    expect(field('WebDAV 密码').value).toBe('')
  })
  it('does not send an empty password over an already configured WebDAV secret', async () => {
    useWebDAV(); settings.sync_password_set = true; await render(); await click(button('保存并重新验证 WebDAV'))
    expect(writes().some(body => Object.prototype.hasOwnProperty.call(body, 'sync_password'))).toBe(false); expect(container.textContent).toContain('留空保持不变')
  })
  it('rebinds remote metadata only after explicit confirmation', async () => {
    await render(); await click(button('重新绑定远端')); expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/sync/rebind', { method: 'POST', body: '{}' }); expect(button('重新绑定远端')).toBeUndefined()
  })
  it('configures automatic WebDAV sync without replacing manual controls', async () => {
    useWebDAV(); await render(); await click(button('开启自动同步'))
    expect(api).toHaveBeenCalledWith('/api/sync/auto', { method: 'POST', body: JSON.stringify({ enabled: true, interval_minutes: 5 }) })
    expect(button('预演同步')).toBeTruthy(); expect(button('执行同步')).toBeTruthy()
  })
  it('shows OS-protected secret status without requiring a SQLite password flag', async () => {
    useWebDAV(); window.electronAPI.webdavSecretStatus.mockResolvedValue({ success: true, available: true, stored: true, managed: true, backend: 'dpapi' })
    await render(); expect(container.textContent).toContain('操作系统保护存储'); expect(container.textContent).toContain('不写入新的 SQLite / .lnw')
  })
  it('does not partially change WebDAV settings when secure storage is unavailable', async () => {
    window.electronAPI.webdavSecretStatus.mockResolvedValue({ success: true, available: false, stored: false, managed: true, backend: 'basic_text' })
    await render(); await input('WebDAV 端点', 'https://dav.example.test/notepad'); await input('WebDAV 用户名', 'alice'); await input('WebDAV 密码', 'secret'); await click(button('保存、验证并启用 WebDAV'))
    expect(window.electronAPI.webdavSecretSave).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0)
  })
  it('checks a saved WebDAV connection without replacing manual sync actions', async () => {
    useWebDAV(); await render(); await click(button('测试连接（只读）'))
    expect(api).toHaveBeenCalledWith('/api/sync/check', { method: 'POST', body: '{}' }); expect(button('预演同步')).toBeTruthy(); expect(button('执行同步')).toBeTruthy()
  })
  it('leaves WebDAV disabled when read-only validation fails', async () => {
    checkError = new Error('401 unauthorized'); await render(); await input('WebDAV 端点', 'https://dav.example.test/notepad'); await input('WebDAV 用户名', 'alice'); await click(button('保存、验证并启用 WebDAV'))
    expect(writes()[0].sync_enabled).toBe(false); expect(writes().some(body => body.sync_enabled === true)).toBe(false)
    expect(field('WebDAV 端点').value).toBe('https://dav.example.test/notepad'); expect(container.textContent).toContain('401 unauthorized')
  })
  it('allows read-only connection check while WebDAV is saved but disabled', async () => {
    useWebDAV(); settings.sync_enabled = false; status.enabled = false; await render(); await click(button('测试连接（只读）'))
    expect(api).toHaveBeenCalledWith('/api/sync/check', { method: 'POST', body: '{}' })
  })
})

describe('sync health and read recovery', () => {
  it('keeps unsaved endpoint, username and password across automatic status reads', async () => {
    vi.useFakeTimers(); useWebDAV(); settings.sync_auto_enabled = true; await render()
    await input('WebDAV 端点', 'https://dav.example.test/unsaved'); await input('WebDAV 用户名', 'bob'); await input('WebDAV 密码', 'unsaved-secret')
    const before = settingsReads()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await flush() })
    expect(settingsReads()).toBe(before + 1); expect(field('WebDAV 端点').value).toBe('https://dav.example.test/unsaved'); expect(field('WebDAV 用户名').value).toBe('bob'); expect(field('WebDAV 密码').value).toBe('unsaved-secret')
    expect(writes()).toHaveLength(0)
  })
  it('silently backs off failed reads and permits immediate manual recovery', async () => {
    vi.useFakeTimers(); readError = true; await render(); expect(container.textContent).toContain('连续读取失败 1 次')
    const before = settingsReads(); await act(async () => { await vi.advanceTimersByTimeAsync(29999); await flush() }); expect(settingsReads()).toBe(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await flush() }); expect(settingsReads()).toBe(before + 1)
    expect(toast.error).not.toHaveBeenCalled(); readError = false; await click(button('刷新状态'))
    expect(container.textContent).not.toContain('连续读取失败'); expect(button('执行同步')).toBeTruthy()
    expect(api.mock.calls.some(([path, init]) => init?.method === 'POST')).toBe(false)
  })
  it('retains the previous snapshot and labels it stale after a failed read', async () => {
    await render(); readError = true; await click(button('刷新状态'))
    expect(container.textContent).toContain('上次读取结果'); expect(container.textContent).toContain('device-a'); expect(toast.error).not.toHaveBeenCalled()
  })
  it('keeps a check receipt visible and invalidates it when the draft changes', async () => {
    useWebDAV(); await render(); await click(button('测试连接（只读）')); expect(container.textContent).toContain('第 4 代 · 12 个对象')
    expect(container.textContent).toContain('不代表写入权限或持续在线'); await input('WebDAV 用户名', 'bob')
    expect(container.textContent).not.toContain('第 4 代 · 12 个对象'); expect(button('测试连接（只读）').disabled).toBe(true)
  })
  it('labels an error timestamp as an attempt, not a successful sync', async () => {
    status.last_status = 'error'; status.last_sync_at = 1790400000; await render()
    expect(container.textContent).toContain('最近同步尝试'); expect(container.textContent).toContain('最近一次同步失败'); expect(container.textContent).not.toContain('最近一次同步完成')
  })
  it('stops automatic read timers on unmount', async () => {
    vi.useFakeTimers(); useWebDAV(); settings.sync_auto_enabled = true; await render()
    await act(async () => { root.unmount(); await flush() }); root = createRoot(container)
    const before = settingsReads(); await act(async () => { await vi.advanceTimersByTimeAsync(600000); await flush() }); expect(settingsReads()).toBe(before)
  })
})

describe('reviewed conflict integration', () => {
  const submitted = () => api.mock.calls.filter(([path, init]) => path.endsWith('/resolve') && init?.method === 'POST')
  async function prepare() {
    status.open_conflicts = 1; conflicts = [conflictFixture()]
    await render(); await click(button('保留本机'))
    await click(container.querySelector('input[type="checkbox"]'))
  }
  it('rechecks a changed backend conflict before sending any mutation', async () => {
    await prepare(); conflicts = [conflictFixture({ remote_hash: 'd'.repeat(64) })]
    await click(button('确认处理此冲突'))
    expect(submitted()).toHaveLength(0); expect(container.textContent).toContain('冲突或同步目标已变化')
  })
  it('rechecks the backend target rather than trusting the previous UI snapshot', async () => {
    await prepare(); status.remote_store_id = 'different-store'
    await click(button('确认处理此冲突'))
    expect(submitted()).toHaveLength(0); expect(container.textContent).toContain('同步目标已变化')
  })
  it('an offline recheck refuses mutation and keeps the reviewed body visible', async () => {
    await prepare(); readError = true; await click(button('确认处理此冲突'))
    expect(submitted()).toHaveLength(0); expect(container.textContent).toContain('本机正文')
    expect(button('确认处理此冲突').disabled).toBe(true); expect(toast.success).not.toHaveBeenCalled()
  })
  it('a conflict already removed by another action is not submitted again', async () => {
    await prepare(); conflicts = []; await click(button('确认处理此冲突'))
    expect(submitted()).toHaveLength(0); expect(toast.success).not.toHaveBeenCalled()
  })
  it('a failed mutation is never automatically repeated or reported as success', async () => {
    await prepare(); const original = api.getMockImplementation()
    api.mockImplementation(async (path, init) => { if (path.endsWith('/resolve')) throw new Error('write reply lost'); return original(path, init) })
    await click(button('确认处理此冲突'))
    expect(submitted()).toHaveLength(1); expect(toast.success).not.toHaveBeenCalled()
    expect(container.textContent).toContain('处理未确认'); expect(container.querySelector('input[type="checkbox"]').checked).toBe(false)
  })
  it('leaving the panel aborts the pre-submission read and blocks a late write', async () => {
    await prepare(); const original = api.getMockImplementation(); let finish, signal
    api.mockImplementation((path, init) => {
      if (path === '/api/sync/conflicts') { signal = init?.signal; return new Promise(r => { finish = r }) }
      return original(path, init)
    })
    await click(button('确认处理此冲突')); expect(signal).toBeTruthy()
    await act(async () => { root.unmount(); await flush() }); root = createRoot(container)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(conflicts); await flush() }); expect(submitted()).toHaveLength(0)
  })
})
